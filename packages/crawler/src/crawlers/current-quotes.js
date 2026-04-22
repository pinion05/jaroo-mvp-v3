import { createRequire } from 'node:module';
import { fmpFetch, getProviderStatus, polygonFetch } from './api-clients.js';

const require = createRequire(import.meta.url);
const { getMarketSnapshot, getNearestBusinessDayInAWeek } = require('./krx-client.cjs');

const KRX_DEPENDENCY_ERROR_PATTERNS = [
  /Cannot find package ['"]krx-js-client['"]/i,
  /Cannot find module ['"]krx-js-client/i,
  /ERR_MODULE_NOT_FOUND/i,
  /Failed to load krx-js-client/i,
  /Failed to init client/i,
  /krx-js-client/i,
];

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

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function isKrxDependencyError(error) {
  const text = [error?.code, error?.message, error?.cause?.message, error?.stack]
    .filter(Boolean)
    .join('\n');

  return KRX_DEPENDENCY_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function classifyKrxFailure(error) {
  if (isKrxDependencyError(error)) {
    return {
      reason: 'dependency-unavailable',
      message: getErrorMessage(error, 'krx-js-client unavailable'),
    };
  }

  return {
    reason: 'runtime-unavailable',
    message: getErrorMessage(error, 'krx runtime unavailable'),
  };
}

function buildUsProviderNotConfiguredMissing(ticker, providerNames) {
  return {
    market: 'US',
    code: null,
    ticker,
    reason: 'provider-not-configured',
    providers: providerNames,
    message: `${providerNames.join(', ')} providers are not configured`,
  };
}

function getUsProviderStatuses(providerStatus = null) {
  return {
    polygon: providerStatus?.polygon ?? getProviderStatus('polygon'),
    fmp: providerStatus?.fmp ?? getProviderStatus('fmp'),
  };
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

  const tradeDateResolver = typeof options.krxTradeDateResolver === 'function'
    ? options.krxTradeDateResolver
    : resolveKrxTradeDate;
  const snapshotFetcher = typeof options.krxSnapshotFetcher === 'function'
    ? options.krxSnapshotFetcher
    : (tradeDate) => getMarketSnapshot(tradeDate, 'ALL');

  try {
    const tradeDate = await tradeDateResolver(options.tradeDate);
    const snapshot = await snapshotFetcher(tradeDate);
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
    const failure = classifyKrxFailure(error);
    return {
      asOf: null,
      items: [],
      missing: normalizedCodes.map((code) => ({
        market: 'KR',
        code,
        ticker: null,
        reason: failure.reason,
        message: failure.message,
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

export async function getUsCurrentQuotes(tickers, options = {}) {
  const normalizedTickers = uniqueStrings(tickers || [], (value) => value.toUpperCase());
  if (normalizedTickers.length === 0) {
    return { items: [], missing: [] };
  }

  const providerStatus = getUsProviderStatuses(options.providerStatus);
  const polygonQuoteFetcher = typeof options.polygonQuoteFetcher === 'function'
    ? options.polygonQuoteFetcher
    : getUsQuoteFromPolygon;
  const fmpQuoteFetcher = typeof options.fmpQuoteFetcher === 'function'
    ? options.fmpQuoteFetcher
    : getUsQuoteFromFmp;

  const results = await Promise.all(normalizedTickers.map(async (ticker) => {
    const configuredProviders = [];
    const providerErrors = [];

    if (providerStatus.polygon?.configured) {
      configuredProviders.push('polygon');
      try {
        const polygonQuote = await polygonQuoteFetcher(ticker);
        if (polygonQuote) return polygonQuote;
      } catch (error) {
        providerErrors.push(`polygon:${getErrorMessage(error, 'unavailable')}`);
      }
    }

    if (providerStatus.fmp?.configured) {
      configuredProviders.push('fmp');
      try {
        const fmpQuote = await fmpQuoteFetcher(ticker);
        if (fmpQuote) return fmpQuote;
      } catch (error) {
        providerErrors.push(`fmp:${getErrorMessage(error, 'unavailable')}`);
      }
    }

    if (configuredProviders.length === 0) {
      return buildUsProviderNotConfiguredMissing(ticker, ['polygon', 'fmp']);
    }

    if (providerErrors.length === configuredProviders.length && providerErrors.length > 0) {
      return {
        market: 'US',
        code: null,
        ticker,
        reason: 'provider-unavailable',
        providers: configuredProviders,
        message: providerErrors.join('; '),
      };
    }

    return { market: 'US', code: null, ticker, reason: 'not-found' };
  }));

  return {
    items: results.filter((item) => item.status === 'ok'),
    missing: results.filter((item) => item.status !== 'ok'),
  };
}

export async function getCurrentQuotes(input = {}, options = {}) {
  const { codes, tickers, tradeDate } = normalizeQuoteInputs(input);
  const providerStatus = getUsProviderStatuses(options.providerStatus);
  const [krResult, usResult] = await Promise.all([
    getKrxCurrentQuotes(codes, {
      tradeDate,
      krxTradeDateResolver: options.krxTradeDateResolver,
      krxSnapshotFetcher: options.krxSnapshotFetcher,
    }),
    getUsCurrentQuotes(tickers, {
      providerStatus,
      polygonQuoteFetcher: options.polygonQuoteFetcher,
      fmpQuoteFetcher: options.fmpQuoteFetcher,
    }),
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
    providerStatus,
  };
}
