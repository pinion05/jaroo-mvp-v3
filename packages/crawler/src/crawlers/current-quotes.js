import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const WISE_ETF_NAV_DATA_URL = 'https://comp.wisereport.co.kr/ETF/GetNAVData.aspx';
const NAVER_STOCK_BASIC_URL_PREFIX = 'https://m.stock.naver.com/api/stock/';
const DEFAULT_NAVER_CURRENT_QUOTES_TIMEOUT_MS = 1_200;
const DEFAULT_NAVER_CURRENT_QUOTES_CONCURRENCY = 4;
const CURRENT_QUOTES_DIR = path.dirname(fileURLToPath(import.meta.url));
const KR_EXCHANGE_PRODUCT_UNIVERSE_PATH = path.resolve(
  CURRENT_QUOTES_DIR,
  '../../../../src/lib/data/instrument-universe.json',
);

let cachedKrExchangeProductTypeByCode = null;

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

function normalizeKrCode(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const exactMatch = text.match(/^\d{6}$/);
  if (exactMatch) return exactMatch[0];

  const embeddedMatch = text.match(/(?:^|[^0-9])(\d{6})(?:[^0-9]|$)/);
  return embeddedMatch?.[1] ?? text;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDateDays(value, days) {
  const nextDate = new Date(`${value}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
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

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getNaverCurrentQuotesTimeoutMs(options = {}) {
  if (options.naverCurrentQuotesTimeoutMs === null || options.naverCurrentQuotesTimeoutMs === false) {
    return null;
  }

  if (options.naverCurrentQuotesTimeoutMs !== undefined) {
    return parsePositiveInteger(options.naverCurrentQuotesTimeoutMs, DEFAULT_NAVER_CURRENT_QUOTES_TIMEOUT_MS);
  }

  return parsePositiveInteger(process.env.NAVER_CURRENT_QUOTES_TIMEOUT_MS, DEFAULT_NAVER_CURRENT_QUOTES_TIMEOUT_MS);
}

function getNaverCurrentQuotesConcurrency(options = {}) {
  if (options.naverCurrentQuotesConcurrency !== undefined) {
    return parsePositiveInteger(options.naverCurrentQuotesConcurrency, DEFAULT_NAVER_CURRENT_QUOTES_CONCURRENCY);
  }

  return parsePositiveInteger(
    process.env.NAVER_CURRENT_QUOTES_CONCURRENCY,
    DEFAULT_NAVER_CURRENT_QUOTES_CONCURRENCY,
  );
}

async function mapWithConcurrency(values, concurrency, mapper) {
  if (values.length === 0) {
    return [];
  }

  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, concurrency));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function withFetchTimeout(fetchImpl, url, init, timeoutMs) {
  if (!timeoutMs) {
    return fetchImpl(url, init);
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getFetchImpl(fetchImpl) {
  if (typeof fetchImpl === 'function') {
    return fetchImpl;
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }

  throw new Error('fetch implementation unavailable');
}

function isKrxDependencyError(error) {
  const text = [error?.code, error?.message, error?.cause?.message, error?.stack]
    .filter(Boolean)
    .join('\n');

  return KRX_DEPENDENCY_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function parseQuoteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  const parsed = Number(text.replace(/[\s,]/g, '').replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : null;
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

function classifyNaverQuoteFailure(error) {
  const message = getErrorMessage(error, 'naver current quote unavailable');
  const isAbort = error?.name === 'AbortError' || /aborted|abort|timeout|timed out/i.test(message);

  return {
    reason: isAbort ? 'provider-timeout' : 'provider-unavailable',
    message,
  };
}

function loadKrExchangeProductTypeByCode() {
  if (cachedKrExchangeProductTypeByCode) {
    return cachedKrExchangeProductTypeByCode;
  }

  try {
    const universe = JSON.parse(fs.readFileSync(KR_EXCHANGE_PRODUCT_UNIVERSE_PATH, 'utf8'));
    cachedKrExchangeProductTypeByCode = new Map(
      (Array.isArray(universe) ? universe : [])
        .filter((item) => item?.locale === 'KR' && (item?.market === 'ETF' || item?.market === 'ETN') && item?.code)
        .map((item) => [String(item.code).trim(), item.market]),
    );
  } catch {
    cachedKrExchangeProductTypeByCode = new Map();
  }

  return cachedKrExchangeProductTypeByCode;
}

function resolveKrExchangeProductType(code, options = {}) {
  if (typeof options.krExchangeProductTypeResolver === 'function') {
    return options.krExchangeProductTypeResolver(code);
  }

  return loadKrExchangeProductTypeByCode().get(code) ?? null;
}

async function getKrExchangeProductQuote(code, productType, tradeDate, options = {}) {
  if (typeof options.krExchangeProductQuoteFetcher === 'function') {
    return options.krExchangeProductQuoteFetcher(code, productType, tradeDate);
  }

  const fetchImpl = getFetchImpl(options.fetchImpl);
  const endDate = yyyymmddToIsoDate(tradeDate) ?? todayIsoDate();
  const startDate = shiftIsoDateDays(endDate, -120);
  const searchParams = new URLSearchParams({
    startDT: startDate,
    endDT: endDate,
    dataType: 'D',
    cmp_cd: code,
    cmp_typ: productType === 'ETN' ? '25' : '5',
  });

  const response = await fetchImpl(`${WISE_ETF_NAV_DATA_URL}?${searchParams.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://comp.wisereport.co.kr/ETF/lookup.aspx',
    },
  });

  if (!response.ok) {
    throw new Error(`WiseReport exchange product quote fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  const gridData = Array.isArray(payload?.grid_data) ? payload.grid_data : [];
  const exactDate = yyyymmddToIsoDate(tradeDate);
  const row = (exactDate ? gridData.find((item) => item?.TRD_DT === exactDate) : null) ?? gridData.at(-1);
  const price = Number(row?.CLOSE_PRC);

  if (!row || !Number.isFinite(price)) {
    return null;
  }

  return {
    market: 'KR',
    code,
    ticker: null,
    price,
    currency: 'KRW',
    asOf: row.TRD_DT ?? exactDate,
    source: productType === 'ETN' ? 'wisereport-etn' : 'wisereport-etf',
    status: 'ok',
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

async function getNaverCurrentQuote(code, options = {}) {
  if (typeof options.naverQuoteFetcher === 'function') {
    return options.naverQuoteFetcher(code);
  }

  const normalizedCode = normalizeKrCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) {
    return null;
  }

  const fetchImpl = getFetchImpl(options.naverFetchImpl ?? options.fetchImpl);
  const timeoutMs = getNaverCurrentQuotesTimeoutMs(options);
  const response = await withFetchTimeout(
    fetchImpl,
    `${NAVER_STOCK_BASIC_URL_PREFIX}${encodeURIComponent(normalizedCode)}/basic`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    },
    timeoutMs,
  );

  if (response.status === 404 || response.status === 409) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Naver current quote returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const price = parseQuoteNumber(payload?.closePrice);

  if (!Number.isFinite(price)) {
    return null;
  }

  return {
    market: 'KR',
    code: normalizedCode,
    ticker: null,
    price,
    currency: 'KRW',
    asOf: typeof payload?.localTradedAt === 'string' ? payload.localTradedAt : null,
    source: 'naver-finance',
    status: 'ok',
  };
}

export async function getNaverCurrentQuotes(codes, options = {}) {
  const normalizedCodes = uniqueStrings(codes || [], normalizeKrCode);
  if (normalizedCodes.length === 0) {
    return { asOf: null, items: [], missing: [] };
  }

  const concurrency = getNaverCurrentQuotesConcurrency(options);
  const results = await mapWithConcurrency(normalizedCodes, concurrency, async (code) => {
    if (!/^\d{6}$/.test(code)) {
      return {
        type: 'missing',
        missing: {
          market: 'KR',
          code,
          ticker: null,
          reason: 'invalid-code',
          message: 'KR current quote code must be a 6 digit code',
        },
      };
    }

    try {
      const item = await getNaverCurrentQuote(code, options);
      return item
        ? { type: 'item', item }
        : { type: 'missing', missing: { market: 'KR', code, ticker: null, reason: 'not-found' } };
    } catch (error) {
      const failure = classifyNaverQuoteFailure(error);
      return {
        type: 'missing',
        missing: {
          market: 'KR',
          code,
          ticker: null,
          reason: failure.reason,
          message: failure.message,
        },
      };
    }
  });

  const items = results.filter((result) => result.type === 'item').map((result) => result.item);
  const missing = results.filter((result) => result.type === 'missing').map((result) => result.missing);

  return {
    asOf: items.find((item) => item.asOf)?.asOf ?? null,
    items,
    missing,
  };
}

export function normalizeQuoteInputs(input = {}) {
  return {
    codes: uniqueStrings(input.codes || [], normalizeKrCode),
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
  const normalizedCodes = uniqueStrings(codes || [], normalizeKrCode);
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
    const fallbackTargets = [];

    for (const code of normalizedCodes) {
      const row = rowsByCode.get(code);
      const price = Number(row?.['종가']);

      if (!row || !Number.isFinite(price)) {
        const productType = resolveKrExchangeProductType(code, options);
        if (productType === 'ETF' || productType === 'ETN') {
          fallbackTargets.push({ code, productType });
          continue;
        }

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

    if (fallbackTargets.length > 0) {
      const fallbackResults = await Promise.all(
        fallbackTargets.map(async ({ code, productType }) => {
          try {
            const item = await getKrExchangeProductQuote(code, productType, tradeDate, options);
            return item
              ? { type: 'item', item }
              : { type: 'missing', missing: { market: 'KR', code, ticker: null, reason: 'not-found' } };
          } catch (error) {
            return {
              type: 'missing',
              missing: {
                market: 'KR',
                code,
                ticker: null,
                reason: 'not-found',
                message: getErrorMessage(error, 'exchange product quote unavailable'),
              },
            };
          }
        }),
      );

      for (const result of fallbackResults) {
        if (result.type === 'item') {
          items.push(result.item);
        } else {
          missing.push(result.missing);
        }
      }
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

export async function getKrCurrentQuotes(codes, options = {}) {
  const normalizedCodes = uniqueStrings(codes || [], normalizeKrCode);
  if (normalizedCodes.length === 0) {
    return { asOf: null, items: [], missing: [] };
  }

  if (options.tradeDate) {
    return getKrxCurrentQuotes(normalizedCodes, options);
  }

  const naverResult = await getNaverCurrentQuotes(normalizedCodes, {
    naverQuoteFetcher: options.naverQuoteFetcher,
    naverFetchImpl: options.naverFetchImpl,
    fetchImpl: options.fetchImpl,
    naverCurrentQuotesTimeoutMs: options.naverCurrentQuotesTimeoutMs,
    naverCurrentQuotesConcurrency: options.naverCurrentQuotesConcurrency,
  });
  const foundCodes = new Set(naverResult.items.map((item) => normalizeKrCode(item.code)).filter(Boolean));
  const fallbackCodes = normalizedCodes.filter((code) => !foundCodes.has(code) && /^\d{6}$/.test(code));

  if (fallbackCodes.length === 0) {
    return naverResult;
  }

  if (naverResult.items.length > 0) {
    return naverResult;
  }

  const krxResult = await getKrxCurrentQuotes(fallbackCodes, {
    tradeDate: options.tradeDate,
    krxTradeDateResolver: options.krxTradeDateResolver,
    krxSnapshotFetcher: options.krxSnapshotFetcher,
    krExchangeProductTypeResolver: options.krExchangeProductTypeResolver,
    krExchangeProductQuoteFetcher: options.krExchangeProductQuoteFetcher,
  });
  const nonFallbackMissing = naverResult.missing.filter((item) => !/^\d{6}$/.test(String(item.code || '')));

  return {
    asOf: naverResult.asOf ?? krxResult.asOf,
    items: [...naverResult.items, ...krxResult.items],
    missing: [...krxResult.missing, ...nonFallbackMissing],
  };
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
    getKrCurrentQuotes(codes, {
      tradeDate,
      naverQuoteFetcher: options.naverQuoteFetcher,
      naverFetchImpl: options.naverFetchImpl,
      fetchImpl: options.fetchImpl,
      naverCurrentQuotesTimeoutMs: options.naverCurrentQuotesTimeoutMs,
      naverCurrentQuotesConcurrency: options.naverCurrentQuotesConcurrency,
      krxTradeDateResolver: options.krxTradeDateResolver,
      krxSnapshotFetcher: options.krxSnapshotFetcher,
      krExchangeProductTypeResolver: options.krExchangeProductTypeResolver,
      krExchangeProductQuoteFetcher: options.krExchangeProductQuoteFetcher,
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
