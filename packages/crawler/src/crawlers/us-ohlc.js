/**
 * us-ohlc.js — 미국주식 OHLC 시계열
 *
 * - OHLC primary source: Polygon `/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}`
 */

import { polygonFetch, getProviderStatus } from './api-clients.js';

export const DEFAULT_US_OHLC_LIMIT = 252;

function getPolygonDateRange(limit) {
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - Math.ceil(limit * 1.5));
  return {
    from: fromDate.toISOString().split('T')[0],
    to: toDate.toISOString().split('T')[0],
  };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeFmpOhlcPoint(item = {}) {
  const date = typeof item.date === 'string'
    ? item.date
    : Number.isFinite(item.t)
      ? new Date(item.t).toISOString().split('T')[0]
      : null;
  if (!date) return null;

  const open = toFiniteNumber(item.open ?? item.o);
  const high = toFiniteNumber(item.high ?? item.h);
  const low = toFiniteNumber(item.low ?? item.l);
  const close = toFiniteNumber(item.close ?? item.c);
  const volume = toFiniteNumber(item.volume ?? item.v);

  if (open === null || high === null || low === null || close === null || volume === null) {
    return null;
  }

  return {
    symbol: item.symbol ?? item.T ?? null,
    date,
    open,
    high,
    low,
    close,
    volume,
    change: toFiniteNumber(item.change),
    changePercent: toFiniteNumber(item.changePercent),
    vwap: toFiniteNumber(item.vwap ?? item.vw),
  };
}

export function normalizeFmpOhlcSeries(payload, limit = DEFAULT_US_OHLC_LIMIT) {
  if (!Array.isArray(payload)) return [];
  return payload
    .map(normalizeFmpOhlcPoint)
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * 미국주식 OHLC 시계열 조회
 * @param {string} ticker
 * @param {Object} [opts]
 * @param {number} [opts.limit=252]
 * @returns {Promise<Object>}
 */
export async function getUSOhlc(ticker, opts = {}) {
  const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : DEFAULT_US_OHLC_LIMIT;
  const polygonStatus = getProviderStatus('polygon');

  if (!normalizedTicker) {
    return {
      ticker: null,
      provider: 'polygon',
      source: 'polygon-v2-aggs-ticker-range-day',
      series: [],
      meta: {
        status: 'missing',
        reason: 'ticker_required',
      },
    };
  }

  if (!polygonStatus.configured) {
    return {
      ticker: normalizedTicker,
      provider: 'polygon',
      source: 'polygon-v2-aggs-ticker-range-day',
      series: [],
      meta: {
        status: 'provider_not_configured',
        reason: 'polygon_api_key_missing',
      },
    };
  }

  const { from, to } = getPolygonDateRange(limit);
  const raw = await polygonFetch(
    `/v2/aggs/ticker/${encodeURIComponent(normalizedTicker)}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${limit}`,
    { cacheTTL: 30 * 60 * 1000 },
  );

  const series = normalizeFmpOhlcSeries(raw?.results, limit);

  return {
    ticker: normalizedTicker,
    provider: 'polygon',
    source: 'polygon-v2-aggs-ticker-range-day',
    series,
    meta: {
      status: series.length > 0 ? 'ok' : 'missing',
      requestedLimit: limit,
      count: series.length,
      primarySource: 'polygon',
    },
  };
}
