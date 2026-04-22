/**
 * USD/KRW 환율 크롤러
 * investing.com에서 오늘 환율과 변동률 추출
 */

function getPlaywrightChromium() {
  return require('playwright').chromium;
}

const USD_KRW_URL = 'https://kr.investing.com/currencies/usd-krw';
const USD_KRW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const USD_KRW_REDIS_CACHE_KEY = 'crawler:usd-krw-rate';

let sharedRedisClientPromise = null;
let sharedRedisClientUrl = null;

function logUsdKrwRedisWarning(stage, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[usd-krw-rate] Redis cache ${stage} failed:`, message);
}

function isCacheableUsdKrwRate(data) {
  return Boolean(data) && Number.isFinite(data.rate);
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

/**
 * USD/KRW 환율 데이터 원본 추출
 * @returns {Promise<{rate: number, change: number, changePercent: number, timestamp: string}>}
 */
async function fetchUsdKrwRateFromSource() {
  let browser;
  try {
    const chromium = getPlaywrightChromium();
    browser = await chromium.launch({
      headless: true
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    await page.goto(USD_KRW_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // 데이터 로딩 대기
    await page.waitForSelector('[data-test="instrument-price-last"]', { timeout: 10000 });

    // 환율 데이터 추출
    const data = await page.evaluate(() => {
      const rateEl = document.querySelector('[data-test="instrument-price-last"]');
      const changeEl = document.querySelector('[data-test="instrument-price-change"]');
      const changePercentEl = document.querySelector('[data-test="instrument-price-change-percent"]');
      const timeEl = document.querySelector('[data-test="trading-time-label"]');

      const parseNumber = (str) => {
        if (!str) return null;
        // 괄호, 쉼표, +, % 제거하고 숫자로 변환
        return parseFloat(str.replace(/[(),+%]/g, '').replace(/,/g, ''));
      };

      return {
        rate: parseNumber(rateEl?.textContent || ''),
        change: parseNumber(changeEl?.textContent || ''),
        changePercent: parseNumber(changePercentEl?.textContent || ''),
        timestamp: timeEl?.getAttribute('datetime') || new Date().toISOString(),
        raw: {
          rate: rateEl?.textContent?.trim(),
          change: changeEl?.textContent?.trim(),
          changePercent: changePercentEl?.textContent?.trim()
        }
      };
    });

    return data;
  } catch (error) {
    console.error('환율 데이터 추출 실패:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
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

/**
 * 환율 데이터 포맷팅
 */
function formatRateData(data) {
  if (!data.rate) {
    return '환율 데이터를 가져올 수 없습니다.';
  }

  const direction = data.change >= 0 ? '▲' : '▼';
  const sign = data.change >= 0 ? '+' : '';

  return `
USD/KRW 환율 정보
================
현재 환율: ${data.rate.toLocaleString()} 원
변동: ${direction} ${sign}${data.change.toFixed(2)} (${sign}${data.changePercent.toFixed(2)}%)
기준 시각: ${data.timestamp}
`.trim();
}

// CLI 실행
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
  createUsdKrwRateFetcher,
  fetchUsdKrwRate,
  fetchUsdKrwRateFromSource,
  formatRateData,
};
