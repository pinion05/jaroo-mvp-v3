// 미국 ETF 프로필 수집기 — Polygon 2종(일봉·티커 상세) + Yahoo quoteSummary 보강을 병합해
// jaroo-etf-profile-v1(market:'us') 반환. 한국 etf-profile.js(네이버 내부 API)와
// 같은 경량 패턴. POLYGON_API_KEY 필수, Yahoo는 무키 보강.
//
// 소스 (2026-09-16 실증):
// - Polygon aggs (키): 시세·전일 종가·약 2년 일봉(52주 지표 산출 충분)
//   ※ Yahoo chart v8은 Node fetch TLS 지문으로 429 차단(실측) — 일봉은 Polygon
//     (기존 us-ohlc 크롤러 재사용)을 1차 소스로 쓴다.
// - Polygon ticker details (키): type 'ETF' 판별(주식 티커면 NOT_ETF)·명칭·통화
// - Yahoo quoteSummary v10 (쿠키+crumb, 무키): 운용사·보수·AUM·NAV·구성종목 Top10
//   — 실패 관용: 이 계층이 죽어도 일봉·판별·명칭은 Polygon으로 살아있다
//
// 실패 관용 규칙(한국판과 동일한 등급): 일봉은 필수, 상세·quoteSummary는 선택 —
// 프로필 전체를 죽이지 않고 채운 것만 내려간다.

import { getUSOhlc, } from './us-ohlc.js';
import { polygonFetch } from './api-clients.js';

const YAHOO_QUERY1_BASE = 'https://query1.finance.yahoo.com';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DEFAULT_US_ETF_PROFILE_TIMEOUT_MS = 10_000;
// 52주 지표(etf-metrics 최소 260거래일) + 여유 — 약 2년
const DAILY_LIMIT = 510;
const HOLDINGS_LIMIT = 10; // quoteSummary topHoldings가 주는 상위 10종목
const CRUMB_TTL_MS = 30 * 60_000;

// crumb은 요청당 새로 받지 않고 프로세스 캐시로 재사용한다(Yahoo 쿠키·crumb은 수명이 길다).
let cachedCrumb = null; // { cookie, crumb, fetchedAt } | null

function normalizeSymbol(symbol) {
  const match = String(symbol ?? '').trim().match(/^[A-Za-z]{1,5}$/);
  if (!match) throw new Error(`invalid US ETF symbol: ${symbol}`);
  return match[0].toUpperCase();
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rawOf(yahooField) {
  // Yahoo quoteSummary 수치는 { raw, fmt } 래핑 — raw만 쓴다
  if (yahooField == null || typeof yahooField !== 'object') return null;
  return toFiniteNumber(yahooField.raw);
}

async function fetchYahooJson(url, { fetchImpl, timeoutMs, headers = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`yahoo api ${response.status}: ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 쿠키(fc.yahoo.com)→crumb(getcrumb) 2단계 — quoteSummary 접근에 필요. */
async function fetchYahooCrumb({ fetchImpl, timeoutMs }) {
  if (cachedCrumb && Date.now() - cachedCrumb.fetchedAt < CRUMB_TTL_MS) {
    return cachedCrumb;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://fc.yahoo.com', {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      signal: controller.signal,
    });
    const setCookies =
      typeof response.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const cookie = setCookies
      .map((line) => String(line).split(';')[0])
      .filter(Boolean)
      .join('; ');
    if (!cookie) {
      throw new Error('yahoo crumb flow: no cookie');
    }

    const crumb = await fetchYahooJson(`${YAHOO_QUERY1_BASE}/v1/test/getcrumb`, {
      fetchImpl,
      timeoutMs,
      headers: { Cookie: cookie },
    }).then((value) => (typeof value === 'string' ? value.trim() : ''));

    if (!crumb) {
      throw new Error('yahoo crumb flow: empty crumb');
    }
    cachedCrumb = { cookie, crumb, fetchedAt: Date.now() };
    return cachedCrumb;
  } finally {
    clearTimeout(timer);
  }
}

/** Polygon OHLC → { daily(과거→최신), price, previousClose } — 시세 파생은 마지막 두 종가로. */
export function extractPolygonSeries(ohlcPayload) {
  const series = Array.isArray(ohlcPayload?.series) ? ohlcPayload.series : [];
  const daily = series
    .map((row) => {
      const close = toFiniteNumber(row?.close);
      if (typeof row?.date !== 'string' || !row.date || close == null) return null;
      return { date: row.date, close };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));

  const last = daily[daily.length - 1] ?? null;
  const previous = daily[daily.length - 2] ?? null;
  return {
    daily,
    price: last?.close ?? null,
    previousClose: previous?.close ?? null,
  };
}

/** Polygon ticker details → { instrumentType, name, currency } — null 관용. */
export function extractPolygonTickerDetails(detailsPayload) {
  const results = detailsPayload?.results;
  if (!results || typeof results !== 'object') return null;
  return {
    instrumentType: typeof results.type === 'string' ? results.type.toUpperCase() : null,
    name: String(results.name ?? '').trim() || null,
    currency: String(results.currency_name ?? '').toLowerCase() === 'usd' ? 'USD' : null,
  };
}

export function buildUsEtfProfile({ symbol, polygon, details = null, quoteSummary = null }) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const fundProfile = quoteSummary?.fundProfile ?? null;
  const topHoldings = quoteSummary?.topHoldings ?? null;
  const summaryDetail = quoteSummary?.summaryDetail ?? null;
  const keyStats = quoteSummary?.defaultKeyStatistics ?? null;

  const expenseRatio = rawOf(fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio)
    ?? rawOf(keyStats?.annualReportExpenseRatio);
  const changePct =
    polygon.price != null && polygon.previousClose != null && polygon.previousClose > 0
      ? (polygon.price / polygon.previousClose - 1) * 100
      : null;

  const holdings = Array.isArray(topHoldings?.holdings)
    ? topHoldings.holdings
        .map((holding) => {
          const weightPct = rawOf(holding?.holdingPercent);
          return {
            code: String(holding?.symbol ?? '').trim(),
            name: String(holding?.holdingName ?? '').trim(),
            weightPct: weightPct != null ? weightPct * 100 : null,
          };
        })
        .filter((holding) => holding.code && holding.weightPct != null)
        .sort((left, right) => right.weightPct - left.weightPct)
        .slice(0, HOLDINGS_LIMIT)
        .map((holding, index) => ({
          rank: index + 1,
          code: holding.code,
          name: holding.name,
          weightPct: holding.weightPct,
          changePct: null, // 구성종목 등락률은 별도 소스 과제(한국판과 동일)
        }))
    : null;

  return {
    schemaVersion: 'jaroo-etf-profile-v1',
    code: normalizedSymbol,
    name: details?.name ?? normalizedSymbol,
    market: 'us',
    ok: true,
    currency: details?.currency ?? 'USD',
    quote: { changePct },
    product: {
      issuerName: typeof fundProfile?.family === 'string' && fundProfile.family.trim() ? fundProfile.family.trim() : null,
      // categoryName('Large Blend')은 스타일 박스라 기준지수가 아니다 — 비워둔다
      baseIndexName: null,
      totalFeePct: expenseRatio != null ? expenseRatio * 100 : null,
      firstSettleDate: null,
      aum: rawOf(keyStats?.totalAssets),
      nav: rawOf(summaryDetail?.navPrice),
      // 미국 ETF는 장중 iNAV 괴리율을 이 소스에서 얻을 수 없다
      deviationPct: null,
    },
    returns: null, // 기간 수익률은 웹에서 일봉으로 산출(한국판 2단계와 동일)
    holdings: holdings && holdings.length > 0 ? holdings : null,
    daily: polygon.daily.length > 0 ? polygon.daily : null,
  };
}

export class NotAnEtfError extends Error {
  constructor(symbol) {
    super(`not an ETF instrument: ${symbol}`);
    this.name = 'NotAnEtfError';
    this.code = 'NOT_ETF';
  }
}

export async function fetchUsEtfProfile(symbol, options = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_US_ETF_PROFILE_TIMEOUT_MS;
  const fetchOhlc = options.fetchOhlc ?? getUSOhlc;
  const fetchTickerDetails =
    options.fetchTickerDetails ??
    (async (ticker) => polygonFetch(`/v3/reference/tickers/${encodeURIComponent(ticker)}`, { cacheTTL: 24 * 60 * 60_000 }));

  const [ohlc, detailsPayload] = await Promise.all([
    fetchOhlc(normalizedSymbol, { limit: DAILY_LIMIT }).catch(() => null),
    fetchTickerDetails(normalizedSymbol).catch(() => null),
  ]);

  const polygon = extractPolygonSeries(ohlc);
  if (polygon.price == null || polygon.daily.length === 0) {
    throw new Error(`us etf profile unavailable: polygon daily missing for ${normalizedSymbol}`);
  }

  const details = detailsPayload ? extractPolygonTickerDetails(detailsPayload) : null;
  // Polygon 상세가 종목 유형을 알려주면 ETF가 아닌 심볼(EQUITY/CS 등)은 거부한다 —
  // 한국판 NOT_ETF 가드와 동일. 상세 실패는 관용: 일봉이 살아있으면 진행(이름만 심볼 폴백).
  if (details?.instrumentType && details.instrumentType !== 'ETF') {
    throw new NotAnEtfError(normalizedSymbol);
  }

  const quoteSummary = await fetchYahooCrumb({ fetchImpl, timeoutMs })
    .then(({ cookie, crumb }) =>
      fetchYahooJson(
        `${YAHOO_QUERY1_BASE}/v10/finance/quoteSummary/${encodeURIComponent(normalizedSymbol)}` +
          `?modules=fundProfile,topHoldings,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`,
        { fetchImpl, timeoutMs, headers: { Cookie: cookie } },
      ),
    )
    .then((payload) => {
      const result = Array.isArray(payload?.quoteSummary?.result) ? payload.quoteSummary.result[0] : null;
      return result ?? null;
    })
    .catch(() => null); // crumb/quoteSummary 실패는 관용 — 채운 것만 내려간다

  return buildUsEtfProfile({ symbol: normalizedSymbol, polygon, details, quoteSummary });
}
