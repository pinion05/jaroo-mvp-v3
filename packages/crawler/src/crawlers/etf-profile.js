// 한국 ETF 프로필 수집기 — 네이버 내부 API(구성종목·시세성 기본정보)와
// 위세리포트 ETF 스냅샷(상품정보·기간별 수익률)을 병합해 jaroo-etf-profile-v1 반환.
// 웹 EtfProfileJson(스펙 2026-09-15 §4)과 동일 모양. Playwright 불필요 — 경량 fetch.

import { fetchWiseReportEtfSnapshot } from './wisereport-etf.js';

const NAVER_DOMESTIC_DETAIL_BASE = 'https://stock.naver.com/api/domestic/detail';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DEFAULT_ETF_PROFILE_TIMEOUT_MS = 10_000;
const HOLDINGS_LIMIT = 30;

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

function mapMarket(snapshot) {
  const marketName = String(snapshot?.product?.marketName ?? '').toLowerCase();
  return marketName.includes('kosdaq') ? 'kosdaq' : 'kospi';
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

export function buildEtfProfile({ code, snapshot = null, naverPrice = null, naverComponent = null }) {
  const normalizedCode = normalizeCode(code);
  const name = String(snapshot?.product?.name || naverPrice?.itemname || normalizedCode);

  return {
    schemaVersion: 'jaroo-etf-profile-v1',
    code: normalizedCode,
    name,
    market: mapMarket(snapshot),
    ok: true,
    product: buildProduct({ snapshot, naverPrice }),
    returns: buildReturns(snapshot),
    holdings: buildHoldings(naverComponent),
    daily: null, // 2단계에서 naver chart 일봉 추가
  };
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

export async function fetchEtfProfile(code, options = {}) {
  const normalizedCode = normalizeCode(code);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ETF_PROFILE_TIMEOUT_MS;
  const fetchSnapshot = options.fetchSnapshot ?? fetchWiseReportEtfSnapshot;

  const [naverPrice, naverComponent, snapshot] = await Promise.all([
    fetchNaverJson(`${NAVER_DOMESTIC_DETAIL_BASE}/${normalizedCode}/price`, { fetchImpl, timeoutMs }).catch(
      () => null,
    ),
    fetchNaverJson(`${NAVER_DOMESTIC_DETAIL_BASE}/${normalizedCode}/ETFComponent`, {
      fetchImpl,
      timeoutMs,
    }).catch(() => null),
    fetchSnapshot(normalizedCode).catch(() => null),
  ]);

  if (!naverPrice) {
    throw new Error(`etf profile unavailable: naver price missing for ${normalizedCode}`);
  }

  return buildEtfProfile({ code: normalizedCode, snapshot, naverPrice, naverComponent });
}
