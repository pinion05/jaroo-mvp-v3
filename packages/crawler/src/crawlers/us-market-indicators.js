/**
 * us-market-indicators.js — 미국 시장 지표
 *
 * - S&P 500: Polygon `/v2/aggs/ticker/I:SPX/prev`
 * - NASDAQ: Polygon `/v2/aggs/ticker/I:IXIC/prev`
 * - VIX: Polygon `/v2/aggs/ticker/I:VIX/prev`
 * - S&P 500 200일 이동평균 대비 계산
 */

import { apiFetch, polygonFetch } from './api-clients.js';

const YAHOO_SYMBOLS = Object.freeze({
  'I:SPX': '^GSPC',
  'I:IXIC': '^IXIC',
  'I:VIX': '^VIX',
  'I:DJI': '^DJI',
  'I:RUT': '^RUT',
});

const INDEX_TICKERS = Object.freeze({
  sp500: 'I:SPX',
  nasdaq: 'I:IXIC',
  vix: 'I:VIX',
  dow: 'I:DJI',
  russell: 'I:RUT',
});

const YAHOO_CHART_BASE_URL = 'https://query1.finance.yahoo.com';
const YAHOO_CHART_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json',
});

function toNullableNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPrevCloseChange(close, previousClose) {
  if (!Number.isFinite(close) || !Number.isFinite(previousClose)) {
    return {
      change: null,
      changePct: null,
    };
  }

  const change = close - previousClose;

  return {
    change: +change.toFixed(2),
    changePct: previousClose !== 0 ? +((change / previousClose) * 100).toFixed(2) : null,
  };
}

async function getPolygonPreviousCloseReference(ticker, timestamp) {
  if (!Number.isFinite(timestamp)) return null;

  const toDate = new Date(timestamp);
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - 14);

  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = toDate.toISOString().split('T')[0];
  const data = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=2`,
    { cacheTTL: 5 * 60 * 1000 },
  );

  return Number.isFinite(data?.results?.[1]?.c) ? data.results[1].c : null;
}

async function fetchYahooChart(ticker, range = '1y') {
  const yahooSymbol = YAHOO_SYMBOLS[ticker];
  if (!yahooSymbol) return null;

  return apiFetch({
    apiName: 'yahooChart',
    baseUrl: YAHOO_CHART_BASE_URL,
    path: `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`,
    headers: YAHOO_CHART_HEADERS,
    cacheTTL: range === '1mo' ? 5 * 60 * 1000 : 30 * 60 * 1000,
  });
}

function normalizeYahooChartRows(data) {
  const result = data?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};

  const rows = timestamps
    .map((timestamp, index) => ({
      timestamp,
      open: toNullableNumber(quote.open?.[index]),
      high: toNullableNumber(quote.high?.[index]),
      low: toNullableNumber(quote.low?.[index]),
      close: toNullableNumber(quote.close?.[index]),
      volume: toNullableNumber(quote.volume?.[index]),
    }))
    .filter((row) => Number.isFinite(row.close));

  return rows.length ? rows : null;
}

async function getYahooChartRows(ticker, range = '1y') {
  return normalizeYahooChartRows(await fetchYahooChart(ticker, range));
}

function getYahooRangeForDays(days) {
  if (days <= 22) return '1mo';
  if (days <= 66) return '3mo';
  if (days <= 126) return '6mo';
  if (days <= 252) return '1y';
  if (days <= 504) return '2y';
  if (days <= 1260) return '5y';
  return '10y';
}

async function getYahooSmaCloses(ticker, days) {
  const rows = await getYahooChartRows(ticker, getYahooRangeForDays(days));
  const closes = rows?.map((row) => row.close).filter(Number.isFinite).slice(-days);
  return closes?.length ? closes : null;
}

/**
 * 직전 거래일 지표 데이터 조회 (Polygon previous close)
 * @param {string} ticker - 지표 티커 (예: I:SPX)
 * @returns {Promise<Object|null>}
 */
export async function getIndexPrevClose(ticker) {
  const data = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`,
    { cacheTTL: 5 * 60 * 1000 },
  );

  const result = data?.results?.[0];
  if (!result) {
    const rows = await getYahooChartRows(ticker, '1mo');
    const latest = rows?.at(-1);
    const previousClose = rows?.at(-2)?.close ?? null;
    if (!latest) return null;

    const { change, changePct } = buildPrevCloseChange(latest.close, previousClose);

    return {
      ticker,
      open: Number.isFinite(latest.open) ? latest.open : null,
      high: Number.isFinite(latest.high) ? latest.high : null,
      low: Number.isFinite(latest.low) ? latest.low : null,
      close: Number.isFinite(latest.close) ? latest.close : null,
      volume: Number.isFinite(latest.volume) ? latest.volume : null,
      timestamp: Number.isFinite(latest.timestamp) ? latest.timestamp * 1000 : null,
      change,
      changePct,
      source: 'yahoo-chart',
    };
  }

  const previousClose = await getPolygonPreviousCloseReference(ticker, result.t);
  const { change, changePct } = buildPrevCloseChange(result.c, previousClose);

  return {
    ticker,
    open: result.o ?? null,
    high: result.h ?? null,
    low: result.l ?? null,
    close: result.c ?? null,
    volume: result.v ?? null,
    timestamp: result.t ?? null,
    change,
    changePct,
    source: 'polygon',
  };
}

/**
 * 지표 장기 이동평균 조회
 * @param {string} ticker - 지표 티커
 * @param {number} [days=200] - 이동평균 기간
 * @returns {Promise<Object|null>} { sma, currentVsSma, currentVsSmaPct }
 */
export async function getIndexSMA(ticker, days = 200) {
  const period = Number.isFinite(days) ? Math.max(1, Math.trunc(days)) : 200;
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - period * 1.5);
  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = toDate.toISOString().split('T')[0];

  const data = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=${period}`,
    { cacheTTL: 30 * 60 * 1000 },
  );

  const polygonCloses = data?.results?.map((row) => row.c).filter(Number.isFinite);
  const closes = polygonCloses?.length
    ? polygonCloses
    : await getYahooSmaCloses(ticker, period);

  if (!closes?.length) return null;

  const sma = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const latest = polygonCloses?.length ? closes[0] : closes.at(-1);

  return {
    ticker,
    period,
    sma: +sma.toFixed(2),
    latestClose: latest,
    currentVsSma: +(latest - sma).toFixed(2),
    currentVsSmaPct: +(((latest - sma) / sma) * 100).toFixed(2),
    aboveSma: latest > sma,
    dataPoints: closes.length,
    source: polygonCloses?.length ? 'polygon' : 'yahoo-chart',
  };
}

/**
 * 미국 시장 핵심 지표 전체 조회
 * S&P 500, NASDAQ, VIX 현재값 + S&P 500 200일 이동평균 대비
 *
 * @returns {Promise<Object>}
 */
export async function getUSMarketIndicators() {
  const [sp500, nasdaq, vix, sp500Sma] = await Promise.all([
    getIndexPrevClose(INDEX_TICKERS.sp500).catch(() => null),
    getIndexPrevClose(INDEX_TICKERS.nasdaq).catch(() => null),
    getIndexPrevClose(INDEX_TICKERS.vix).catch(() => null),
    getIndexSMA(INDEX_TICKERS.sp500, 200).catch(() => null),
  ]);

  return {
    sp500,
    nasdaq,
    vix,
    sp500Sma200: sp500Sma,
    summary: {
      sp500Close: sp500?.close ?? null,
      sp500ChangePct: sp500?.changePct ?? null,
      nasdaqClose: nasdaq?.close ?? null,
      nasdaqChangePct: nasdaq?.changePct ?? null,
      vixClose: vix?.close ?? null,
      vixChangePct: vix?.changePct ?? null,
      sp500Above200Sma: sp500Sma?.aboveSma ?? null,
      sp500Vs200SmaPct: sp500Sma?.currentVsSmaPct ?? null,
    },
  };
}
