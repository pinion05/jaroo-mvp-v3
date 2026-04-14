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
