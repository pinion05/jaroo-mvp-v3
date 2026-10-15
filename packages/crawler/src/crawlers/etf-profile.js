// 한국 ETF 프로필 수집기 — 네이버 내부 API(구성종목·시세성 기본정보)와
// 위세리포트 ETF 스냅샷(상품정보·기간별 수익률)을 병렬 병합해 jaroo-etf-profile-v1 반환.
// 웹 EtfProfileJson(스펙 2026-09-15 §4)과 동일 모양 + 선택 필드 sources.wisereport
// ('ok'|'empty'|'failed' — 스냅샷 소스 상태 마커). Playwright 불필요 — 경량 fetch.

import { fetchWiseReportEtfSnapshot } from './wisereport-etf.js';

const NAVER_DOMESTIC_DETAIL_BASE = 'https://stock.naver.com/api/domestic/detail';
const NAVER_M_STOCK_API_BASE = 'https://m.stock.naver.com/api';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DEFAULT_ETF_PROFILE_TIMEOUT_MS = 30_000;
const HOLDINGS_LIMIT = 30;
// 일봉: m.stock price API는 pageSize 상한 60 — 5페이지(≈300거래일)로 1년치 확보
const DAILY_PRICE_PAGE_SIZE = 60;
const DAILY_PRICE_PAGES = 5;

function normalizeCode(code) {
  const match = String(code ?? '').trim().match(/^\d{6}$/);
  if (!match) throw new Error(`invalid KR ETF code: ${code}`);
  return match[0];
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 시장은 위세리포트 스냅샷의 marketName에서만 확정한다 — 네이버 price 응답엔
// 시장 식별자가 없다(069500·229200 실측 모두 sosok:"0"). 스냅샷 부재·인식 불가
// 시 'kospi'로 추측하는 건 KOSDAQ 상품(229200 KODEX 코스닥150)의 시장을 조용히
// 오염시키는 무음 반패턴(이슈 #42·PR #60 계열)이므로 null(unknown)이 유일한 정직한 값.
function mapMarket(snapshot) {
  const marketName = String(snapshot?.product?.marketName ?? '').toLowerCase();
  if (marketName.includes('kosdaq')) return 'kosdaq';
  if (marketName.includes('kospi')) return 'kospi';
  return null;
}

function buildHoldings(naverComponent) {
  if (!Array.isArray(naverComponent)) return null;
  return naverComponent
    .filter((row) => String(row?.componentItemCode ?? '').trim())
    .map((row) => ({
      code: String(row.componentItemCode).trim(),
      name: String(row.componentName ?? '').trim(),
      weightPct: toFiniteNumber(row.weight),
    }))
    .filter((row) => row.weightPct != null)
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, HOLDINGS_LIMIT)
    .map((row, index) => ({
      rank: index + 1,
      code: row.code,
      name: row.name,
      weightPct: row.weightPct,
      changePct: null, // 2단계에서 구성 코드 일괄 quotes로 채운다
    }));
}

function buildReturns(snapshot) {
  const returns = snapshot?.marketStatus?.returns;
  if (!returns) return null;
  return {
    m1: toFiniteNumber(returns.oneMonthPct),
    m3: toFiniteNumber(returns.threeMonthPct),
    m6: toFiniteNumber(returns.sixMonthPct),
    y1: toFiniteNumber(returns.twelveMonthPct),
  };
}

function buildProduct({ snapshot, naverPrice }) {
  const snapshotProduct = snapshot?.product ?? {};
  const deviationRate = toFiniteNumber(naverPrice?.deviationRate);
  const deviationSigned =
    deviationRate == null
      ? null
      : String(naverPrice?.deviationSign ?? '+').trim() === '-'
        ? -deviationRate
        : deviationRate;

  return {
    // 위세리포트 우선(정식 상품정보), 네이버 보강
    issuerName: snapshotProduct.issuerName || (naverPrice?.issuerNameKo ? String(naverPrice.issuerNameKo) : null),
    baseIndexName: snapshotProduct.baseIndexName || null,
    totalFeePct: toFiniteNumber(snapshotProduct.totalFeePct) ?? toFiniteNumber(naverPrice?.totalFee),
    firstSettleDate: snapshotProduct.firstSettleDate || null,
    aum: toFiniteNumber(naverPrice?.totalNetAssets),
    nav: toFiniteNumber(naverPrice?.nav),
    deviationPct: deviationSigned,
  };
}

export function buildEtfProfile({ code, snapshot = null, naverPrice = null, naverComponent = null, daily = null }) {
  const normalizedCode = normalizeCode(code);
  const name = String(snapshot?.product?.name || naverPrice?.itemname || normalizedCode);

  return {
    schemaVersion: 'jaroo-etf-profile-v1',
    code: normalizedCode,
    name,
    market: mapMarket(snapshot),
    ok: true,
    // quotes/current엔 등락률이 없어서 전일 대비는 네이버 price의 prevChangeRate로 내린다
    quote: { changePct: toFiniteNumber(naverPrice?.prevChangeRate) },
    product: buildProduct({ snapshot, naverPrice }),
    returns: buildReturns(snapshot),
    holdings: buildHoldings(naverComponent),
    daily: Array.isArray(daily) && daily.length > 0 ? daily : null,
  };
}

function parseNaverMoneyNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// m.stock.naver.com price 페이지네이션(최신순)을 과거→최신 오름차순 일봉으로 묶는다.
// 빈 페이지가 오면 조기 종료 — 실패는 관용(null)으로: 프로필 전체를 죽이지 않는다.
async function fetchNaverDailyHistory(code, { fetchImpl, timeoutMs }) {
  const rows = [];
  for (let page = 1; page <= DAILY_PRICE_PAGES; page += 1) {
    const pageRows = await fetchNaverJson(
      `${NAVER_M_STOCK_API_BASE}/stock/${code}/price?page=${page}&pageSize=${DAILY_PRICE_PAGE_SIZE}`,
      { fetchImpl, timeoutMs },
    ).catch(() => null);
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;

    for (const row of pageRows) {
      const close = parseNaverMoneyNumber(row?.closePrice);
      if (typeof row?.localTradedAt === 'string' && row.localTradedAt && close !== null) {
        rows.push({ date: row.localTradedAt, close });
      }
    }
    if (pageRows.length < DAILY_PRICE_PAGE_SIZE) break;
  }

  if (rows.length === 0) return null;
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchNaverJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`naver etf api ${response.status}: ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export class NotAnEtfError extends Error {
  constructor(code) {
    super(`not an ETF instrument: ${code}`);
    this.name = 'NotAnEtfError';
    this.code = 'NOT_ETF';
  }
}

// 위세리포트 스냅샷 — 실패해도 관용(ok:true 유지)하되 무음으로 삼키지 않는다
// (무음 반패턴 이력: 이슈 #42·PR #60). 흔적을 두 곳에 남긴다:
//  - 서버 콘솔 warn(코드 + 에러명/메시지) — api-clients.js의 `[태그] 상세` 관행
//  - 응답 sources.wisereport 마커 'ok' | 'empty' | 'failed'
//    ok=스냅샷 확보, empty=빈/인식 불가 페이지로 null 해결(wisereport-etf.js),
//    failed=fetch/파싱 throw. 에러 상세는 공개 엔드포인트라 응답에 실지 않고
//    로그에만 둔다.
async function fetchSnapshotWithStatus(code, fetchSnapshot) {
  try {
    const snapshot = await fetchSnapshot(code);
    return snapshot ? { snapshot, status: 'ok' } : { snapshot: null, status: 'empty' };
  } catch (error) {
    console.warn(
      `[etf-profile] wisereport 스냅샷 실패 — 관용 처리(ok:true 유지) code=${code} ` +
        `error=${error?.name ?? 'Error'}: ${error?.message ?? 'unknown'}`,
    );
    return { snapshot: null, status: 'failed' };
  }
}

export async function fetchEtfProfile(code, options = {}) {
  const normalizedCode = normalizeCode(code);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ETF_PROFILE_TIMEOUT_MS;
  const fetchSnapshot = options.fetchSnapshot ?? fetchWiseReportEtfSnapshot;

  const [naverPrice, naverComponent, snapshotResult, dailyHistory] = await Promise.all([
    fetchNaverJson(`${NAVER_DOMESTIC_DETAIL_BASE}/${normalizedCode}/price`, { fetchImpl, timeoutMs }).catch(
      () => null,
    ),
    fetchNaverJson(`${NAVER_DOMESTIC_DETAIL_BASE}/${normalizedCode}/ETFComponent`, {
      fetchImpl,
      timeoutMs,
    }).catch(() => null),
    fetchSnapshotWithStatus(normalizedCode, fetchSnapshot),
    fetchNaverDailyHistory(normalizedCode, { fetchImpl, timeoutMs }).catch(() => null),
  ]);

  if (!naverPrice) {
    throw new Error(`etf profile unavailable: naver price missing for ${normalizedCode}`);
  }

  // ETF 전용 신호(nav/iNav/운용사)가 전혀 없으면 상장 주식 코드 — ETF 프로필로
  // 내보내면 안 된다(QA ISSUE-001: 주식 코드가 ok:true 프로필로 반환됨).
  const hasEtfSignal =
    naverPrice.nav != null || naverPrice.inav != null || Boolean(String(naverPrice.issuerNameKo ?? '').trim());
  if (!hasEtfSignal) {
    throw new NotAnEtfError(normalizedCode);
  }

  // buildEtfProfile은 순수 데이터 빌더로 유지 — 실패 지식이 있는 fetch 레이어에서
  // 마커를 부착한다(스키마 v1의 하위호환 선택 필드).
  const profile = buildEtfProfile({
    code: normalizedCode,
    snapshot: snapshotResult.snapshot,
    naverPrice,
    naverComponent,
    daily: dailyHistory,
  });
  return { ...profile, sources: { wisereport: snapshotResult.status } };
}
