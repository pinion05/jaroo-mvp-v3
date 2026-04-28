const test = require('node:test');
const assert = require('node:assert/strict');

const {
  crawlWiseReportKrPage,
  clearWiseReportKrCache,
  getWiseReportKrCacheStats,
} = require('../src/crawlers/wisereport-kr.cjs');
const {
  createReadThroughCache,
} = require('../src/crawlers/wisereport-cache.cjs');

function createResponse(html) {
  return {
    ok: true,
    status: 200,
    url: 'https://compglobal.wisereport.co.kr/company/fake',
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => html,
  };
}

test('WiseReport read-through cache reuses fresh values and exposes cache metadata', async () => {
  let now = 10_000;
  let loads = 0;
  const cache = createReadThroughCache({ name: 'unit', now: () => now });

  const first = await cache.readThrough('key:a', async () => ({ value: ++loads }), { cacheTtlMs: 1000 });
  const second = await cache.readThrough('key:a', async () => ({ value: ++loads }), { cacheTtlMs: 1000 });
  now += 1001;
  const third = await cache.readThrough('key:a', async () => ({ value: ++loads }), { cacheTtlMs: 1000 });

  assert.equal(loads, 2);
  assert.equal(first.value, 1);
  assert.equal(first.cache.status, 'miss');
  assert.equal(second.value, 1);
  assert.equal(second.cache.status, 'hit');
  assert.equal(third.value, 2);
  assert.equal(third.cache.status, 'miss');
  assert.deepEqual(cache.getStats(), {
    name: 'unit',
    size: 1,
    hits: 1,
    misses: 2,
    staleHits: 0,
    sets: 2,
    bypasses: 0,
    refreshes: 0,
    errors: 0,
  });
});

test('WiseReport cache supports force refresh, bypass, and stale fallback', async () => {
  let now = 100;
  let loads = 0;
  const cache = createReadThroughCache({ name: 'unit', now: () => now });

  await cache.readThrough('key:b', async () => ({ value: ++loads }), { cacheTtlMs: 50 });
  const refreshed = await cache.readThrough('key:b', async () => ({ value: ++loads }), { cacheTtlMs: 50, forceRefresh: true });
  const bypassed = await cache.readThrough('key:b', async () => ({ value: ++loads }), { cacheTtlMs: 50, cache: false });
  now += 51;
  const stale = await cache.readThrough('key:b', async () => {
    throw new Error('upstream down');
  }, { cacheTtlMs: 50 });

  assert.equal(refreshed.value, 2);
  assert.equal(refreshed.cache.status, 'refresh');
  assert.equal(bypassed.value, 3);
  assert.equal(bypassed.cache.status, 'bypass');
  assert.equal(bypassed.cache.cachedAt, null);
  assert.equal(stale.value, 2);
  assert.equal(stale.cache.status, 'stale');
  assert.match(stale.cache.staleReason, /upstream down/);
  assert.equal(cache.getStats().refreshes, 1);
  assert.equal(cache.getStats().bypasses, 1);
  assert.equal(cache.getStats().staleHits, 1);
});

test('KR WiseReport page crawl uses cache key by code and page', async () => {
  clearWiseReportKrCache();
  let pipelineCalls = 0;
  let contextCreates = 0;
  let contextCloses = 0;
  let browserCloses = 0;

  const createBrowserContext = async () => {
    contextCreates += 1;
    return {
      context: { close: async () => { contextCloses += 1; } },
      browser: { close: async () => { browserCloses += 1; } },
    };
  };
  const runPagePipeline = async (_context, code, spec) => ({
    id: spec.id,
    sourceKey: spec.sourceKey,
    legacyKey: spec.legacyKey,
    code,
    normalized: { company: { code } },
    quality: { warnings: [] },
    stages: {
      crawler_v1: { ok: true },
      crawler_v2: { ok: true, candidateFieldCount: 1 },
      crawler_v3: { ok: true, confidence: 'high' },
    },
    sequence: ++pipelineCalls,
  });

  const options = { createBrowserContext, runPagePipeline, cacheTtlMs: 60_000 };
  const first = await crawlWiseReportKrPage('005930', 'company-overview', options);
  const second = await crawlWiseReportKrPage('005930', 'company-overview', options);
  const third = await crawlWiseReportKrPage('000660', 'company-overview', options);
  const refreshed = await crawlWiseReportKrPage('005930', 'company-overview', { ...options, forceRefresh: true });

  assert.equal(first.sequence, 1);
  assert.equal(first.cache.status, 'miss');
  assert.equal(second.sequence, 1);
  assert.equal(second.cache.status, 'hit');
  assert.equal(third.sequence, 2);
  assert.equal(third.cache.status, 'miss');
  assert.equal(refreshed.sequence, 3);
  assert.equal(refreshed.cache.status, 'refresh');
  assert.equal(contextCreates, 3);
  assert.equal(contextCloses, 3);
  assert.equal(browserCloses, 3);
  assert.equal(getWiseReportKrCacheStats().hits, 1);
});

test('Global WiseReport crawl uses cache key by ticker, routes, and options', async () => {
  const {
    crawlWiseReportGlobal,
    clearWiseReportGlobalCache,
    getWiseReportGlobalCacheStats,
  } = await import('../src/crawlers/wisereport-global.js');

  clearWiseReportGlobalCache();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return createResponse(`<html><head><title>NVDA</title></head><body>NVDA company page ${fetchCalls}</body></html>`);
  };
  const options = {
    cookieHeader: 'session=ok',
    fetchImpl,
    routes: ['company-snap'],
    includeAuxiliary: false,
    cacheTtlMs: 60_000,
  };

  const first = await crawlWiseReportGlobal('NVDA', options);
  const second = await crawlWiseReportGlobal('NVDA', options);
  const withHtml = await crawlWiseReportGlobal('NVDA', { ...options, includeHtml: true });

  assert.equal(fetchCalls, 2);
  assert.equal(first.cache.status, 'miss');
  assert.equal(second.cache.status, 'hit');
  assert.equal(second.pages['company-snap'].text, first.pages['company-snap'].text);
  assert.equal(withHtml.cache.status, 'miss');
  assert.equal(getWiseReportGlobalCacheStats().hits, 1);
});
