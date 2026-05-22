const test = require('node:test');
const assert = require('node:assert/strict');

function createFreshRow(payload, overrides = {}) {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    cache_key: overrides.cacheKey ?? 'cache-key',
    payload,
    status: overrides.status ?? 'fresh',
    stale_after: overrides.staleAfter ?? '2099-01-01T00:00:00.000Z',
    expires_at: overrides.expiresAt ?? '2099-01-02T00:00:00.000Z',
  };
}

test('default Supabase crawler cache client is disabled unless runtime credentials are configured', async () => {
  const { getDefaultSupabaseCrawlerCacheClient } = await import('../src/services/supabase-crawler-cache.js');
  const env = {
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  };

  assert.equal(getDefaultSupabaseCrawlerCacheClient({ env }), null);
  assert.equal(getDefaultSupabaseCrawlerCacheClient({ env: { ...env, CRAWLER_SUPABASE_CACHE_ENABLE: 'false' } }), null);
});

test('Supabase crawler cache client calls public service-role RPC endpoints', async () => {
  const { createSupabaseCrawlerCacheClient } = await import('../src/services/supabase-crawler-cache.js');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify([{ id: 'row-1', payload: { ok: true }, status: 'fresh' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createSupabaseCrawlerCacheClient({
    supabaseUrl: 'https://example.supabase.co/',
    serviceRoleKey: 'service-role-key',
    fetchImpl,
  });

  const row = await client.readPayload('cache-1');

  assert.equal(row.id, 'row-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/get_crawler_cache_payload');
  assert.equal(calls[0].body.p_cache_key, 'cache-1');
  assert.equal(calls[0].init.headers.apikey, 'service-role-key');
  assert.equal(calls[0].init.headers.authorization, 'Bearer service-role-key');
});

test('readThroughCrawlerCache returns fresh Supabase hits before calling the crawler loader', async () => {
  const { readThroughCrawlerCache } = await import('../src/services/supabase-crawler-cache.js');
  const events = [];
  let loaderCalls = 0;
  const cacheClient = {
    readPayload: async () => createFreshRow({ from: 'supabase' }),
    upsertPayload: async () => assert.fail('fresh hit must not write'),
    recordEvent: async (event) => events.push(event),
  };

  const result = await readThroughCrawlerCache({
    cacheClient,
    descriptor: {
      source: 'wisereport',
      market: 'KR',
      targetIdentifier: '005930',
      route: 'wisereport-kr-v12-slim',
      routeVersion: 'v12',
      schemaVersion: 'test-v1',
      request: { code: '005930' },
    },
    load: async () => {
      loaderCalls += 1;
      return { from: 'crawler' };
    },
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.deepEqual(result.value, { from: 'supabase' });
  assert.equal(result.cache.hit, true);
  assert.equal(result.cache.freshness, 'fresh');
  assert.equal(loaderCalls, 0);
  assert.deepEqual(events.map((event) => event.eventType), ['hit']);
});

test('readThroughCrawlerCache does not wait for slow best-effort cache event logging', async () => {
  const { readThroughCrawlerCache } = await import('../src/services/supabase-crawler-cache.js');
  const startedAt = Date.now();
  const cacheClient = {
    readPayload: async () => createFreshRow({ from: 'supabase' }),
    upsertPayload: async () => assert.fail('fresh hit must not write'),
    recordEvent: async () => new Promise(() => {}),
  };

  const result = await readThroughCrawlerCache({
    cacheClient,
    descriptor: {
      source: 'wisereport',
      market: 'KR',
      targetIdentifier: '005930',
      route: 'wisereport-kr-v12-slim',
      routeVersion: 'v12',
      schemaVersion: 'test-v1',
      request: { code: '005930' },
    },
    load: async () => assert.fail('fresh hit must not call loader'),
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.equal(result.cache.hit, true);
  assert.ok(Date.now() - startedAt < 50);
});

test('readThroughCrawlerCache loads and upserts on miss or stale entry', async () => {
  const { readThroughCrawlerCache } = await import('../src/services/supabase-crawler-cache.js');
  const events = [];
  const writes = [];
  let loaderCalls = 0;
  const cacheClient = {
    readPayload: async () => createFreshRow({ from: 'old' }, {
      staleAfter: '2026-05-06T00:00:00.000Z',
      expiresAt: '2099-01-02T00:00:00.000Z',
    }),
    upsertPayload: async (entry) => {
      writes.push(entry);
      return [{ id: 'written-row' }];
    },
    recordEvent: async (event) => events.push(event),
  };

  const result = await readThroughCrawlerCache({
    cacheClient,
    descriptor: {
      source: 'wisereport',
      market: 'KR',
      targetIdentifier: '005930',
      targetDisplayName: '삼성전자',
      targetKind: 'stock',
      route: 'wisereport-kr-v12-slim',
      routeVersion: 'v12',
      schemaVersion: 'test-v1',
      request: { code: '005930' },
    },
    load: async () => {
      loaderCalls += 1;
      return { from: 'crawler' };
    },
    now: new Date('2026-05-07T00:00:00.000Z'),
    freshTtlMs: 1_000,
    staleTtlMs: 2_000,
  });

  assert.deepEqual(result.value, { from: 'crawler' });
  assert.equal(result.cache.hit, false);
  assert.equal(result.cache.freshness, 'loaded');
  assert.equal(result.cache.payloadId, 'written-row');
  assert.equal(loaderCalls, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].source, 'wisereport');
  assert.equal(writes[0].targetIdentifier, '005930');
  assert.deepEqual(writes[0].payload, { from: 'crawler' });
  assert.equal(writes[0].staleAfter, '2026-05-07T00:00:01.000Z');
  assert.equal(writes[0].expiresAt, '2026-05-07T00:00:02.000Z');
  assert.deepEqual(events.map((event) => event.eventType), ['miss', 'write']);
  assert.equal(events[0].metadata.reason, 'stale');
});

test('readThroughCrawlerCache serves stale Supabase data when the crawler loader fails', async () => {
  const { readThroughCrawlerCache } = await import('../src/services/supabase-crawler-cache.js');
  const events = [];
  const writes = [];
  const cacheClient = {
    readPayload: async () => createFreshRow({ from: 'stale-supabase' }, {
      id: 'stale-row',
      staleAfter: '2026-05-06T00:00:00.000Z',
      expiresAt: '2099-01-02T00:00:00.000Z',
    }),
    upsertPayload: async (entry) => {
      writes.push(entry);
      return [{ id: 'error-fallback-row' }];
    },
    recordEvent: async (event) => events.push(event),
  };

  const result = await readThroughCrawlerCache({
    cacheClient,
    descriptor: {
      source: 'wisereport',
      market: 'KR',
      targetIdentifier: '005930',
      route: 'wisereport-kr-v12-slim',
      routeVersion: 'v12',
      schemaVersion: 'test-v1',
      request: { code: '005930' },
    },
    load: async () => {
      throw new Error('crawler failed');
    },
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.deepEqual(result.value, { from: 'stale-supabase' });
  assert.equal(result.cache.hit, true);
  assert.equal(result.cache.freshness, 'stale');
  assert.equal(result.cache.payloadId, 'error-fallback-row');
  assert.match(result.cache.upstreamError, /crawler failed/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'error_fallback');
  assert.match(writes[0].upstreamError.message, /crawler failed/);
  assert.deepEqual(events.map((event) => event.eventType), ['miss', 'error', 'stale_hit']);
});

test('loadWiseReportKrSlimSource reads cached WiseReport slim payload before invoking the crawler', async () => {
  const { loadWiseReportKrSlimSource } = await import('../src/services/deepscan-payload.js');
  const cachedSlim = {
    code: '005930',
    company: { code: '005930', name: '삼성전자' },
    pages: {
      'company-overview': {
        summary: { market: 'KOSPI' },
      },
    },
  };
  let loaderCalls = 0;
  const cacheClient = {
    readPayload: async () => createFreshRow(cachedSlim),
    upsertPayload: async () => assert.fail('fresh hit must not write'),
    recordEvent: async () => {},
  };

  const slim = await loadWiseReportKrSlimSource({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
  }, {
    cacheClient,
    loadAggregate: async () => {
      loaderCalls += 1;
      return { pages: {} };
    },
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.equal(loaderCalls, 0);
  assert.deepEqual(slim.company, { code: '005930', name: '삼성전자' });
  assert.equal(slim.pages['company-overview'].summary.market, 'KOSPI');
});


test('loadWiseReportKrSlimSource writes slim payloads instead of raw WiseReport aggregates', async () => {
  const { loadWiseReportKrSlimSource } = await import('../src/services/deepscan-payload.js');
  const writes = [];
  let loaderCalls = 0;
  const rawAggregate = {
    pages: {
      'company-overview': {
        normalized: {
          company: { code: '005930', name: '삼성전자' },
          sourceType: 'wisereport',
          sourceKey: 'wisereport기업개요',
          bodyTextHead: 'large parser-only text that must not be cached for DeepScan',
          summary: { market: 'KOSPI' },
        },
      },
    },
  };
  const cacheClient = {
    readPayload: async () => null,
    upsertPayload: async (entry) => {
      writes.push(entry);
      return [{ id: 'written-slim-row' }];
    },
    recordEvent: async () => {},
  };

  const slim = await loadWiseReportKrSlimSource({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
  }, {
    cacheClient,
    loadAggregate: async () => {
      loaderCalls += 1;
      return rawAggregate;
    },
    freshTtlMs: 1_000,
    staleTtlMs: 2_000,
    now: new Date('2026-05-07T00:00:00.000Z'),
  });

  assert.equal(loaderCalls, 1);
  assert.deepEqual(slim.company, { code: '005930', name: '삼성전자' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].route, 'wisereport-kr-v12-slim');
  assert.equal(writes[0].schemaVersion, 'wisereport-kr-v12-slim-v1');
  assert.equal(writes[0].metadata.payloadShape, 'slim');
  assert.equal(writes[0].payload.company.name, '삼성전자');
  assert.equal(writes[0].payload.pages['company-overview'].summary.market, 'KOSPI');
  assert.equal(writes[0].payload.pages['company-overview'].company, undefined);
  assert.equal(writes[0].payload.pages['company-overview'].bodyTextHead, undefined);
});


test('buildCrawlerCachePayloadEntry hashes the exact canonical JSON payload sent to Supabase', async () => {
  const { buildCrawlerCachePayloadEntry, sha256Hex, stableStringify } = await import('../src/services/supabase-crawler-cache.js');
  const entry = buildCrawlerCachePayloadEntry({
    source: 'wisereport',
    market: 'KR',
    targetIdentifier: '005930',
    route: 'wisereport-kr-v12-slim',
    routeVersion: 'v12',
    schemaVersion: 'test-v1',
    request: { code: '005930', omitted: undefined },
  }, {
    keep: 'yes',
    omitted: undefined,
    when: new Date('2026-05-08T00:00:00.000Z'),
    arr: [undefined, new Date('2026-05-08T00:00:01.000Z')],
  }, {
    now: '2026-05-08T00:00:02.000Z',
  });

  assert.deepEqual(entry.payload, {
    arr: [null, '2026-05-08T00:00:01.000Z'],
    keep: 'yes',
    when: '2026-05-08T00:00:00.000Z',
  });
  const wireJson = JSON.stringify(entry.payload);
  assert.equal(entry.payloadHash, sha256Hex(wireJson));
  assert.equal(entry.payloadSizeBytes, Buffer.byteLength(wireJson, 'utf8'));
  assert.equal(stableStringify({ b: 1, a: undefined }), '{"b":1}');
});

test('readThroughCrawlerCache normalizes string now values on the read path', async () => {
  const { readThroughCrawlerCache } = await import('../src/services/supabase-crawler-cache.js');
  const cacheClient = {
    readPayload: async () => createFreshRow({ from: 'supabase' }, {
      staleAfter: '2026-05-08T01:00:00.000Z',
      expiresAt: '2026-05-09T00:00:00.000Z',
    }),
    upsertPayload: async () => assert.fail('fresh hit must not write'),
    recordEvent: async () => {},
  };

  const result = await readThroughCrawlerCache({
    cacheClient,
    descriptor: {
      source: 'wisereport',
      market: 'KR',
      targetIdentifier: '005930',
      route: 'wisereport-kr-v12-slim',
      routeVersion: 'v12',
      schemaVersion: 'test-v1',
      request: { code: '005930' },
    },
    load: async () => assert.fail('fresh hit must not call loader'),
    now: '2026-05-08T00:30:00.000Z',
  });

  assert.equal(result.cache.hit, true);
  assert.deepEqual(result.value, { from: 'supabase' });
});

test('readThroughCrawlerCache supports force refresh and bypass controls', async () => {
  const { readThroughCrawlerCache } = await import('../src/services/supabase-crawler-cache.js');
  const events = [];
  const writes = [];
  let reads = 0;
  let loads = 0;
  const descriptor = {
    source: 'wisereport',
    market: 'KR',
    targetIdentifier: '005930',
    route: 'wisereport-kr-v12-slim',
    routeVersion: 'v12',
    schemaVersion: 'test-v1',
    request: { code: '005930' },
  };
  const cacheClient = {
    readPayload: async () => {
      reads += 1;
      return createFreshRow({ from: 'supabase' });
    },
    upsertPayload: async (entry) => {
      writes.push(entry);
      return [{ id: 'refresh-row' }];
    },
    recordEvent: async (event) => events.push(event),
  };

  const refreshed = await readThroughCrawlerCache({
    cacheClient,
    descriptor,
    forceRefresh: true,
    load: async () => {
      loads += 1;
      return { from: 'crawler' };
    },
  });

  assert.equal(reads, 0);
  assert.equal(loads, 1);
  assert.equal(refreshed.cache.hit, false);
  assert.deepEqual(refreshed.value, { from: 'crawler' });
  assert.deepEqual(events.map((event) => event.eventType), ['refresh', 'write']);
  assert.equal(writes.length, 1);

  const bypassed = await readThroughCrawlerCache({
    cacheClient,
    descriptor,
    bypassCache: true,
    load: async () => {
      loads += 1;
      return { from: 'bypass' };
    },
  });

  assert.equal(reads, 0);
  assert.equal(loads, 2);
  assert.equal(bypassed.cache.bypassed, true);
  assert.deepEqual(bypassed.value, { from: 'bypass' });
});

test('createSupabaseCrawlerCacheClient handles malformed JSON errors and exposes invalidate RPC', async () => {
  const { createSupabaseCrawlerCacheClient } = await import('../src/services/supabase-crawler-cache.js');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (url.endsWith('/get_crawler_cache_payload')) {
      return new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' });
    }
    return new Response(JSON.stringify([{ invalidated_count: 1 }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createSupabaseCrawlerCacheClient({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-role-key',
    fetchImpl,
  });

  await assert.rejects(() => client.readPayload('cache-key'), /Bad Gateway/);
  const result = await client.invalidatePayload({ source: 'wisereport', targetIdentifier: '005930', route: 'wisereport-kr-v12-slim' });
  assert.deepEqual(result, [{ invalidated_count: 1 }]);
  assert.equal(calls[1].url, 'https://example.supabase.co/rest/v1/rpc/invalidate_crawler_cache_payload');
  assert.equal(calls[1].body.p_source, 'wisereport');
  assert.equal(calls[1].body.p_target_identifier, '005930');
});

test('getCrawlerCacheClientFromRawInput honors string disable tokens even when a client is provided', async () => {
  const { getCrawlerCacheClientFromRawInput, getCrawlerCacheOptions } = await import('../src/services/deepscan-payload.js');

  assert.equal(getCrawlerCacheClientFromRawInput({ crawlerCache: { enabled: 'false', client: {} } }), null);
  assert.equal(getCrawlerCacheClientFromRawInput({ supabaseCrawlerCache: { enabled: '0', client: {} } }), null);
  assert.deepEqual(getCrawlerCacheOptions({ crawlerCache: { forceRefresh: 'true', bypassCache: 'off' } }), {
    freshTtlMs: 21600000,
    staleTtlMs: 604800000,
    forceRefresh: true,
    bypassCache: false,
  });
});
