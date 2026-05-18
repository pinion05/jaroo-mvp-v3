const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUsdKrwRateFetcher,
  USD_KRW_CACHE_TTL_MS,
} = require('../src/crawlers/usd-krw-rate.cjs');

test('fetchUsdKrwRate caches successful results for 24 hours', async () => {
  let fetchCount = 0;
  const nowValues = [1_000, 2_000];
  const fetcher = async () => {
    fetchCount += 1;
    return {
      rate: 1350.5,
      change: 1.2,
      changePercent: 0.09,
      timestamp: '2026-04-14T10:00:00.000Z',
    };
  };

  const fetchUsdKrwRate = createUsdKrwRateFetcher({
    fetcher,
    now: () => nowValues.shift() ?? 2_000,
    getRedisClient: async () => null,
  });

  const first = await fetchUsdKrwRate();
  const second = await fetchUsdKrwRate();

  assert.equal(fetchCount, 1);
  assert.strictEqual(second, first);
});

test('fetchUsdKrwRate refreshes cache after 24 hour TTL expires', async () => {
  let fetchCount = 0;
  const nowValues = [10_000, 10_000 + USD_KRW_CACHE_TTL_MS + 1];
  const fetchUsdKrwRate = createUsdKrwRateFetcher({
    fetcher: async () => ({
      rate: 1300 + ++fetchCount,
      change: 0,
      changePercent: 0,
      timestamp: `2026-04-14T10:00:0${fetchCount}.000Z`,
    }),
    now: () => nowValues.shift() ?? (10_000 + USD_KRW_CACHE_TTL_MS + 1),
    getRedisClient: async () => null,
  });

  const first = await fetchUsdKrwRate();
  const second = await fetchUsdKrwRate();

  assert.equal(fetchCount, 2);
  assert.notStrictEqual(second, first);
  assert.equal(first.rate, 1301);
  assert.equal(second.rate, 1302);
});

test('fetchUsdKrwRate does not cache failed fetch attempts', async () => {
  let fetchCount = 0;
  const nowValues = [50_000, 50_100, 50_200];
  const fetchUsdKrwRate = createUsdKrwRateFetcher({
    fetcher: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new Error('upstream failed');
      }

      return {
        rate: 1345.1,
        change: -2.4,
        changePercent: -0.18,
        timestamp: '2026-04-14T11:00:00.000Z',
      };
    },
    now: () => nowValues.shift() ?? 50_200,
    getRedisClient: async () => null,
  });

  await assert.rejects(() => fetchUsdKrwRate(), /upstream failed/);
  const result = await fetchUsdKrwRate();
  const cached = await fetchUsdKrwRate();

  assert.equal(fetchCount, 2);
  assert.equal(result.rate, 1345.1);
  assert.strictEqual(cached, result);
});

test('fetchUsdKrwRate reads from Redis cache before live fetch when memory cache is cold', async () => {
  let fetchCount = 0;
  let redisGetCount = 0;
  const redisPayload = {
    rate: 1337.7,
    change: 0.5,
    changePercent: 0.04,
    timestamp: '2026-04-14T12:00:00.000Z',
  };

  const fetchUsdKrwRate = createUsdKrwRateFetcher({
    fetcher: async () => {
      fetchCount += 1;
      return {
        rate: 9999,
        change: 0,
        changePercent: 0,
        timestamp: '2026-04-14T12:01:00.000Z',
      };
    },
    now: () => 75_000,
    getRedisClient: async () => ({
      get: async () => {
        redisGetCount += 1;
        return JSON.stringify(redisPayload);
      },
      setEx: async () => {
        throw new Error('setEx should not be called on Redis cache hit');
      },
    }),
  });

  const first = await fetchUsdKrwRate();
  const second = await fetchUsdKrwRate();

  assert.equal(fetchCount, 0);
  assert.equal(redisGetCount, 1);
  assert.deepEqual(first, redisPayload);
  assert.strictEqual(second, first);
});

test('fetchUsdKrwRate keeps Redis default reconnect behavior enabled', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const originalRedisUrl = process.env.REDIS_URL;
  let createClientOptions = null;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'redis') {
      return {
        createClient(options) {
          createClientOptions = options;
          return {
            on() {},
            async connect() {},
            async get() {
              return null;
            },
            async setEx() {},
          };
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  process.env.REDIS_URL = 'redis://unit-test-default-reconnect';

  try {
    const fetchUsdKrwRate = createUsdKrwRateFetcher({
      fetcher: async () => ({
        rate: 1351.3,
        change: 0.1,
        changePercent: 0.01,
        timestamp: '2026-04-15T01:50:00.000Z',
      }),
      now: () => 80_000,
    });

    await fetchUsdKrwRate();

    assert.ok(createClientOptions);
    assert.equal(createClientOptions.url, 'redis://unit-test-default-reconnect');
    assert.equal(createClientOptions.socket?.connectTimeout, 1000);
    assert.equal(createClientOptions.socket?.reconnectStrategy, undefined);
  } finally {
    Module._load = originalLoad;
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  }
});

test('fetchUsdKrwRate writes successful live fetches to Redis with a 24 hour TTL', async () => {
  const redisWrites = [];
  const livePayload = {
    rate: 1360.2,
    change: 2.1,
    changePercent: 0.15,
    timestamp: '2026-04-14T13:00:00.000Z',
  };

  const fetchUsdKrwRate = createUsdKrwRateFetcher({
    fetcher: async () => livePayload,
    now: () => 90_000,
    getRedisClient: async () => ({
      get: async () => null,
      setEx: async (key, ttlSeconds, value) => {
        redisWrites.push({ key, ttlSeconds, value });
      },
    }),
  });

  const result = await fetchUsdKrwRate();

  assert.deepEqual(result, livePayload);
  assert.equal(redisWrites.length, 1);
  assert.equal(redisWrites[0].ttlSeconds, USD_KRW_CACHE_TTL_MS / 1000);
  assert.deepEqual(JSON.parse(redisWrites[0].value), livePayload);
});

test('fetchUsdKrwRate fails open when Redis read or write fails', async () => {
  let fetchCount = 0;
  const nowValues = [120_000, 120_100, 120_200];
  const fetchUsdKrwRate = createUsdKrwRateFetcher({
    fetcher: async () => {
      fetchCount += 1;
      return {
        rate: 1349.8,
        change: -0.8,
        changePercent: -0.06,
        timestamp: '2026-04-14T14:00:00.000Z',
      };
    },
    now: () => nowValues.shift() ?? 120_200,
    getRedisClient: async () => ({
      get: async () => {
        throw new Error('redis read failed');
      },
      setEx: async () => {
        throw new Error('redis write failed');
      },
    }),
  });

  const first = await fetchUsdKrwRate();
  const second = await fetchUsdKrwRate();

  assert.equal(fetchCount, 1);
  assert.equal(first.rate, 1349.8);
  assert.strictEqual(second, first);
});

test('parseYahooUsdKrwChart maps Yahoo chart closes to a USD/KRW snapshot', () => {
  const { parseYahooUsdKrwChart } = require('../src/crawlers/usd-krw-rate.cjs');
  const result = parseYahooUsdKrwChart({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: 1476.45,
          previousClose: 1472.5,
          regularMarketTime: 1779062400,
        },
        timestamp: [1778976000, 1779062400],
        indicators: { quote: [{ close: [1472.5, 1476.45] }] },
      }],
    },
  }, 'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?range=5d&interval=1d');

  assert.deepEqual(result, {
    rate: 1476.45,
    change: 3.95,
    changePercent: 0.2683,
    timestamp: '2026-05-18T00:00:00.000Z',
    source: 'yahoo-chart',
    sourceUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?range=5d&interval=1d',
  });
});

test('fetchUsdKrwRateFromSource falls back to open.er-api.com when Yahoo chart is unavailable', async () => {
  const {
    fetchUsdKrwRateFromSource,
    USD_KRW_OPEN_ER_API_URL,
    USD_KRW_YAHOO_CHART_URLS,
  } = require('../src/crawlers/usd-krw-rate.cjs');
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(url);
    if (url !== USD_KRW_OPEN_ER_API_URL) {
      return { ok: false, status: 403, async json() { return {}; } };
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          time_last_update_unix: 1779062400,
          rates: { KRW: 1478.12345 },
        };
      },
    };
  };

  const result = await fetchUsdKrwRateFromSource({ fetcher, timeoutMs: 100 });

  assert.deepEqual(requestedUrls, [...USD_KRW_YAHOO_CHART_URLS, USD_KRW_OPEN_ER_API_URL]);
  assert.equal(result.rate, 1478.1235);
  assert.equal(result.change, null);
  assert.equal(result.changePercent, null);
  assert.equal(result.source, 'open-er-api');
});
