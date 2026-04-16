import { createRequire } from 'node:module';
import { fmpFetch, getProviderStatus, polygonFetch } from './api-clients.js';

const require = createRequire(import.meta.url);
const { getMarketSnapshot, getNearestBusinessDayInAWeek } = require('./krx-client.cjs');

function uniqueStrings(values, transform = (value) => value) {
  const seen = new Set();
  const output = [];

  for (const rawValue of values || []) {
    const normalized = transform(String(rawValue || '').trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateToYyyymmdd(value) {
  return String(value || '').replace(/-/g, '');
}

function yyyymmddToIsoDate(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{8}$/.test(normalized)) return null;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

export function normalizeQuoteInputs(input = {}) {
  return {
    codes: uniqueStrings(input.codes || []),
    tickers: uniqueStrings(input.tickers || [], (value) => value.toUpperCase()),
    tradeDate: input.tradeDate ? String(input.tradeDate).trim() : null,
  };
}

async function resolveKrxTradeDate(tradeDate) {
  const baseDate = tradeDate || todayIsoDate();
  const yyyymmdd = isoDateToYyyymmdd(baseDate);
  const resolved = await getNearestBusinessDayInAWeek(yyyymmdd, true);
  return String(resolved || yyyymmdd);
}

export async function getKrxCurrentQuotes(codes, options = {}) {
  const normalizedCodes = uniqueStrings(codes || []);
  if (normalizedCodes.length === 0) {
    return { asOf: null, items: [], missing: [] };
  }

  try {
    const tradeDate = await resolveKrxTradeDate(options.tradeDate);
    const snapshot = await getMarketSnapshot(tradeDate, 'ALL');
    const rowsByCode = new Map((snapshot || []).map((row) => [String(row.code || '').trim(), row]));

    const items = [];
    const missing = [];

    for (const code of normalizedCodes) {
      const row = rowsByCode.get(code);
      const price = Number(row?.['종가']);

      if (!row || !Number.isFinite(price)) {
        missing.push({ market: 'KR', code, ticker: null, reason: 'not-found' });
        continue;
      }

      items.push({
        market: 'KR',
        code,
        ticker: null,
        price,
        currency: 'KRW',
        asOf: yyyymmddToIsoDate(tradeDate),
        source: 'krx',
        status: 'ok',
      });
    }

    return {
      asOf: yyyymmddToIsoDate(tradeDate),
      items,
      missing,
    };
  } catch (error) {
    return {
      asOf: null,
      items: [],
      missing: normalizedCodes.map((code) => ({
        market: 'KR',
        code,
        ticker: null,
        reason: 'upstream-unavailable',
        message: error instanceof Error ? error.message : 'krx unavailable',
      })),
    };
  }
}

async function getUsQuoteFromPolygon(ticker) {
  const data = await polygonFetch(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`, { cacheTTL: 5 * 60 * 1000 });
  const result = Array.isArray(data?.results) ? data.results[0] : null;
  const price = Number(result?.c);

  if (!Number.isFinite(price)) {
    return null;
  }

  return {
    market: 'US',
    code: null,
    ticker,
    price: +price.toFixed(2),
    currency: 'USD',
    asOf: Number.isFinite(result?.t) ? new Date(result.t).toISOString() : null,
    source: 'polygon',
    status: 'ok',
  };
}

async function getUsQuoteFromFmp(ticker) {
  const data = await fmpFetch(`/stable/profile?symbol=${encodeURIComponent(ticker)}`, { cacheTTL: 10 * 60 * 1000 });
  const profile = Array.isArray(data) ? data[0] : data;
  const price = Number(profile?.price);

  if (!Number.isFinite(price)) {
    return null;
  }

  return {
    market: 'US',
    code: null,
    ticker,
    price: +price.toFixed(2),
    currency: 'USD',
    asOf: null,
    source: 'fmp',
    status: 'ok',
  };
}

export async function getUsCurrentQuotes(tickers) {
  const normalizedTickers = uniqueStrings(tickers || [], (value) => value.toUpperCase());
  if (normalizedTickers.length === 0) {
    return { items: [], missing: [] };
  }

  const results = await Promise.all(normalizedTickers.map(async (ticker) => {
    const polygonQuote = await getUsQuoteFromPolygon(ticker);
    if (polygonQuote) return polygonQuote;
    const fmpQuote = await getUsQuoteFromFmp(ticker);
    return fmpQuote || { market: 'US', code: null, ticker, reason: 'not-found' };
  }));

  return {
    items: results.filter((item) => item.status === 'ok'),
    missing: results.filter((item) => item.status !== 'ok'),
  };
}

export async function getCurrentQuotes(input = {}) {
  const { codes, tickers, tradeDate } = normalizeQuoteInputs(input);
  const [krResult, usResult] = await Promise.all([
    getKrxCurrentQuotes(codes, { tradeDate }),
    getUsCurrentQuotes(tickers),
  ]);

  return {
    requested: {
      codes,
      tickers,
      tradeDate: tradeDate || null,
    },
    items: [...krResult.items, ...usResult.items],
    missing: [...krResult.missing, ...usResult.missing],
    asOf: {
      kr: krResult.asOf,
      us: null,
    },
    providerStatus: {
      polygon: getProviderStatus('polygon'),
      fmp: getProviderStatus('fmp'),
    },
  };
}
