/**
 * us-ohlc.js — 미국주식 OHLC 시계열
 *
 * - OHLC primary source: FMP `/stable/historical-price-eod/full`
 */

import { fmpFetch, getProviderStatus } from './api-clients.js';

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeFmpOhlcPoint(item = {}) {
  const date = typeof item.date === 'string' ? item.date : null;
  if (!date) return null;

  const open = toFiniteNumber(item.open);
  const high = toFiniteNumber(item.high);
  const low = toFiniteNumber(item.low);
  const close = toFiniteNumber(item.close);
  const volume = toFiniteNumber(item.volume);

  if (open === null || high === null || low === null || close === null || volume === null) {
    return null;
  }

  return {
    symbol: item.symbol ?? null,
    date,
    open,
    high,
    low,
    close,
    volume,
    change: toFiniteNumber(item.change),
    changePercent: toFiniteNumber(item.changePercent),
    vwap: toFiniteNumber(item.vwap),
  };
}

export function normalizeFmpOhlcSeries(payload, limit = 60) {
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
 * @param {number} [opts.limit=60]
 * @returns {Promise<Object>}
 */
export async function getUSOhlc(ticker, opts = {}) {
  const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 60;
  const fmpStatus = getProviderStatus('fmp');

  if (!normalizedTicker) {
    return {
      ticker: null,
      provider: 'fmp',
      source: 'fmp-historical-price-eod/full',
      series: [],
      meta: {
        status: 'missing',
        reason: 'ticker_required',
      },
    };
  }

  if (!fmpStatus.configured) {
    return {
      ticker: normalizedTicker,
      provider: 'fmp',
      source: 'fmp-historical-price-eod/full',
      series: [],
      meta: {
        status: 'provider_not_configured',
        reason: 'fmp_api_key_missing',
      },
    };
  }

  const raw = await fmpFetch(
    `/stable/historical-price-eod/full?symbol=${encodeURIComponent(normalizedTicker)}`,
    { cacheTTL: 30 * 60 * 1000 },
  );

  const series = normalizeFmpOhlcSeries(raw, limit);

  return {
    ticker: normalizedTicker,
    provider: 'fmp',
    source: 'fmp-historical-price-eod/full',
    series,
    meta: {
      status: series.length > 0 ? 'ok' : 'missing',
      requestedLimit: limit,
      count: series.length,
      primarySource: 'fmp',
    },
  };
}
