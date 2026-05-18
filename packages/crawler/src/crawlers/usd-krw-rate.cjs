/**
 * USD/KRW 환율 수집기
 * Oracle OCI에서 Investing Cloudflare 차단이 재현되어 Yahoo chart를 1차 원천으로 사용하고,
 * Yahoo 실패 시 공개 환율 API(open.er-api.com)를 보조 원천으로 사용한다.
 */

const USD_KRW_YAHOO_CHART_URLS = [
  'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?range=5d&interval=1d',
  'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d',
];
const USD_KRW_OPEN_ER_API_URL = 'https://open.er-api.com/v6/latest/USD';
const USD_KRW_FETCH_TIMEOUT_MS = 3000;
const USD_KRW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const USD_KRW_REDIS_CACHE_KEY = 'crawler:usd-krw-rate';

const JSON_HEADERS = {
  accept: 'application/json,text/plain,*/*',
  'user-agent': 'Mozilla/5.0 (compatible; JarooCrawler/1.0; +https://jaroo.local)',
};

let sharedRedisClientPromise = null;
let sharedRedisClientUrl = null;

function logUsdKrwRedisWarning(stage, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[usd-krw-rate] Redis cache ${stage} failed:`, message);
}

function isCacheableUsdKrwRate(data) {
  return Boolean(data) && Number.isFinite(data.rate);
}

function toNumber(value) {
  if (value == null) {
    return null;
  }

  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toIsoTimestamp(value) {
  if (Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}

async function fetchJsonWithTimeout(url, { fetcher = fetch, timeoutMs = USD_KRW_FETCH_TIMEOUT_MS } = {}) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetcher(url, {
      headers: JSON_HEADERS,
      cache: 'no-store',
      signal: abortController.signal,
    });

    if (!response || !response.ok) {
      const status = response?.status ? `HTTP ${response.status}` : 'no response';
      throw new Error(`USD/KRW upstream failed: ${status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function findLatestFiniteClose(closes) {
  if (!Array.isArray(closes)) {
    return { value: null, index: -1 };
  }

  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const value = toNumber(closes[index]);
    if (Number.isFinite(value)) {
      return { value, index };
    }
  }

  return { value: null, index: -1 };
}

function findPreviousFiniteClose(closes, beforeIndex) {
  if (!Array.isArray(closes)) {
    return null;
  }

  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const value = toNumber(closes[index]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function parseYahooUsdKrwChart(payload, sourceUrl = USD_KRW_YAHOO_CHART_URLS[0]) {
  const result = payload?.chart?.result?.[0];
  if (!result) {
    throw new Error('Yahoo USD/KRW chart result not found');
  }

  const meta = result.meta || {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const latestClose = findLatestFiniteClose(closes);
  const rate = toNumber(meta.regularMarketPrice) ?? latestClose.value;

  if (!Number.isFinite(rate)) {
    throw new Error('Yahoo USD/KRW rate not found');
  }

  const previousClose = toNumber(meta.previousClose) ?? findPreviousFiniteClose(closes, latestClose.index);
  const change = Number.isFinite(previousClose) ? roundTo(rate - previousClose, 4) : null;
  const changePercent = Number.isFinite(previousClose) && previousClose !== 0
    ? roundTo((change / previousClose) * 100, 4)
    : null;
  const timestamp = toIsoTimestamp(meta.regularMarketTime ?? timestamps[latestClose.index]);

  return {
    rate: roundTo(rate, 4),
    change,
    changePercent,
    timestamp,
    source: 'yahoo-chart',
    sourceUrl,
  };
}

function parseOpenExchangeUsdKrwRate(payload, { sourceUrl = USD_KRW_OPEN_ER_API_URL } = {}) {
  const rate = toNumber(payload?.rates?.KRW);
  if (!Number.isFinite(rate)) {
    throw new Error('open.er-api USD/KRW rate not found');
  }

  return {
    rate: roundTo(rate, 4),
    change: null,
    changePercent: null,
    timestamp: toIsoTimestamp(payload?.time_last_update_unix ?? payload?.time_last_update_utc),
    source: 'open-er-api',
    sourceUrl,
  };
}

async function fetchUsdKrwRateFromSource({ fetcher = fetch, timeoutMs = USD_KRW_FETCH_TIMEOUT_MS } = {}) {
  const errors = [];

  for (const sourceUrl of USD_KRW_YAHOO_CHART_URLS) {
    try {
      const payload = await fetchJsonWithTimeout(sourceUrl, { fetcher, timeoutMs });
      return parseYahooUsdKrwChart(payload, sourceUrl);
    } catch (error) {
      errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const payload = await fetchJsonWithTimeout(USD_KRW_OPEN_ER_API_URL, { fetcher, timeoutMs });
    return parseOpenExchangeUsdKrwRate(payload);
  } catch (error) {
    errors.push(`${USD_KRW_OPEN_ER_API_URL}: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`USD/KRW source lookup failed (${errors.join('; ')})`);
}

async function getRedisClientFromEnv() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  if (!sharedRedisClientPromise || sharedRedisClientUrl !== redisUrl) {
    sharedRedisClientUrl = redisUrl;
    sharedRedisClientPromise = (async () => {
      try {
        const { createClient } = require('redis');
        const client = createClient({
          url: redisUrl,
          socket: {
            connectTimeout: 1000,
          },
        });
        client.on('error', (error) => {
          logUsdKrwRedisWarning('client error', error);
        });
        await client.connect();
        return client;
      } catch (error) {
        sharedRedisClientPromise = null;
        logUsdKrwRedisWarning('initialization', error);
        return null;
      }
    })();
  }

  return sharedRedisClientPromise;
}

async function resolveRedisClient(getRedisClient) {
  if (typeof getRedisClient !== 'function') {
    return null;
  }

  try {
    return await getRedisClient();
  } catch (error) {
    logUsdKrwRedisWarning('resolution', error);
    return null;
  }
}

async function readUsdKrwRateFromRedis({ client, cacheKey }) {
  if (!client || typeof client.get !== 'function') {
    return null;
  }

  try {
    const cachedValue = await client.get(cacheKey);
    if (!cachedValue) {
      return null;
    }

    const parsed = JSON.parse(cachedValue);
    return isCacheableUsdKrwRate(parsed) ? parsed : null;
  } catch (error) {
    logUsdKrwRedisWarning('read', error);
    return null;
  }
}

async function writeUsdKrwRateToRedis({ client, cacheKey, data, ttlSeconds }) {
  if (!client || !isCacheableUsdKrwRate(data)) {
    return;
  }

  const serialized = JSON.stringify(data);

  try {
    if (typeof client.setEx === 'function') {
      await client.setEx(cacheKey, ttlSeconds, serialized);
      return;
    }

    if (typeof client.set === 'function') {
      await client.set(cacheKey, serialized, { EX: ttlSeconds });
    }
  } catch (error) {
    logUsdKrwRedisWarning('write', error);
  }
}

function createUsdKrwRateFetcher({
  fetcher = fetchUsdKrwRateFromSource,
  now = Date.now,
  ttlMs = USD_KRW_CACHE_TTL_MS,
  getRedisClient = getRedisClientFromEnv,
  redisCacheKey = USD_KRW_REDIS_CACHE_KEY,
} = {}) {
  let cache = null;

  return async function fetchUsdKrwRate() {
    if (cache && (now() - cache.cachedAt) < ttlMs) {
      return cache.data;
    }

    const redisClient = await resolveRedisClient(getRedisClient);
    const redisCachedData = await readUsdKrwRateFromRedis({
      client: redisClient,
      cacheKey: redisCacheKey,
    });

    if (redisCachedData) {
      cache = {
        data: redisCachedData,
        cachedAt: now(),
      };
      return redisCachedData;
    }

    const data = await fetcher();

    if (isCacheableUsdKrwRate(data)) {
      cache = {
        data,
        cachedAt: now(),
      };

      await writeUsdKrwRateToRedis({
        client: redisClient,
        cacheKey: redisCacheKey,
        data,
        ttlSeconds: Math.max(1, Math.floor(ttlMs / 1000)),
      });
    }

    return data;
  };
}

const fetchUsdKrwRate = createUsdKrwRateFetcher();

function formatRateData(data) {
  if (!data || !Number.isFinite(data.rate)) {
    return '환율 데이터를 가져올 수 없습니다.';
  }

  const hasChange = Number.isFinite(data.change) && Number.isFinite(data.changePercent);
  const changeLine = hasChange
    ? (() => {
        const direction = data.change >= 0 ? '▲' : '▼';
        const sign = data.change >= 0 ? '+' : '';
        return `변동: ${direction} ${sign}${data.change.toFixed(2)} (${sign}${data.changePercent.toFixed(2)}%)`;
      })()
    : '변동: 보조 원천에서 제공되지 않음';
  const sourceLine = data.source ? `원천: ${data.source}` : null;

  return [
    'USD/KRW 환율 정보',
    '================',
    `현재 환율: ${data.rate.toLocaleString()} 원`,
    changeLine,
    `기준 시각: ${data.timestamp}`,
    sourceLine,
  ].filter(Boolean).join('\n');
}

if (require.main === module) {
  fetchUsdKrwRate()
    .then(data => {
      console.log(formatRateData(data));
      console.log('\n--- Raw Data ---');
      console.log(JSON.stringify(data, null, 2));
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  USD_KRW_CACHE_TTL_MS,
  USD_KRW_FETCH_TIMEOUT_MS,
  USD_KRW_OPEN_ER_API_URL,
  USD_KRW_YAHOO_CHART_URLS,
  createUsdKrwRateFetcher,
  fetchUsdKrwRate,
  fetchUsdKrwRateFromSource,
  formatRateData,
  parseOpenExchangeUsdKrwRate,
  parseYahooUsdKrwChart,
};
