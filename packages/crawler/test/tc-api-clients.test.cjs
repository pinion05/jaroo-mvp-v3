const test = require('node:test');
const assert = require('node:assert/strict');

// TC-CRW-037/038 — src/crawlers/api-clients.js (미국주식 공통 API 클라이언트) 커버리지 갭 테스트.
// api-clients는 US 크롤러 전체(polygon/fmp/finnhub/secEdgar)의 관문이지만 기존 테스트가 전무했다.
// globalThis.fetch를 스텁해 외부 네트워크 없이 캐시/429/쿨다운 동작을 검증한다.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubFetch(handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const target = new URL(String(url));
    calls.push(target.hostname + target.pathname);
    return handler(target, options ?? {});
  };
  return {
    getCalls: async () => [...calls],
    restore: async () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: () => null },
  };
}

function errorResponse(status, headersGet = () => null) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    headers: { get: headersGet },
  };
}

test('TC-CRW-037 apiFetch in-memory 캐시: TTL 내 재호출은 fetch 1회, TTL 만료 후 재fetch, 민감 쿼리 파라미터는 캐시 키에서 마스킹된다', async () => {
  const { apiFetch, clearCache, getCacheStats } = await import('../src/crawlers/api-clients.js');
  clearCache();

  const stub = stubFetch(async () => jsonResponse({ value: 1 }));

  try {
    const opts = {
      apiName: 'secEdgar',
      baseUrl: 'https://data.sec.gov',
      path: '/submissions/tc-cache-a.json?apiKey=sk-secret-123',
      timeout: 2000,
      cacheTTL: 60_000,
    };

    // 1) 최초 호출은 fetch 1회
    const first = await apiFetch(opts);
    assert.deepEqual(first, { value: 1 });

    // 2) TTL 내 동일 URL 재호출은 캐시 적중 — fetch 횟수 불변
    const second = await apiFetch(opts);
    assert.deepEqual(second, { value: 1 });
    let calls = await stub.getCalls();
    assert.equal(calls.filter((call) => call.includes('/submissions/tc-cache-a.json')).length, 1,
      'TTL 내 재호출은 네트워크 fetch 없이 캐시로 답해야 한다');

    // 3) 민감 쿼리 파라미터(apiKey)는 getCacheStats 키에서 [redacted] 마스킹
    const statsAfterHit = getCacheStats();
    const cacheKey = statsAfterHit.keys.find((key) => key.includes('/submissions/tc-cache-a.json'));
    assert.ok(cacheKey, '캐시 키가 getCacheStats에 노출되어야 한다');
    assert.ok(cacheKey.includes('apiKey=%5Bredacted%5D'), `apiKey 파라미터가 마스킹되어야 한다: ${cacheKey}`);
    assert.ok(!JSON.stringify(statsAfterHit.keys).includes('sk-secret-123'), '원본 키 값이 캐시 키 통계에 유출되면 안 된다');

    // 4) TTL 만료 후 재호출은 다시 fetch한다 (TTL 30ms + 60ms 대기)
    const ttlOpts = {
      apiName: 'secEdgar',
      baseUrl: 'https://data.sec.gov',
      path: '/submissions/tc-cache-ttl.json',
      timeout: 2000,
      cacheTTL: 30,
    };
    await apiFetch(ttlOpts);
    await sleep(60);
    await apiFetch(ttlOpts);
    calls = await stub.getCalls();
    assert.equal(calls.filter((call) => call.includes('/submissions/tc-cache-ttl.json')).length, 2,
      'TTL 만료 후에는 캐시를 버리고 다시 fetch해야 한다');

    // 5) clearCache로 전체 비움
    clearCache();
    assert.equal(getCacheStats().size, 0);
  } finally {
    clearCache();
    await stub.restore();
  }
});

test('TC-CRW-038 apiFetch 429 처리: Retry-After 재시도로 회복하고, 쿨다운 프로바이더(fmp)는 즉시 null + 상태 exhausted 이후 fetch를 안 한다', async () => {
  const { apiFetch, getProviderStatus, getProviderCooldownRemaining } = await import('../src/crawlers/api-clients.js');

  // 1) finnhub: 첫 응답 429(Retry-After: 0) → 재시도에서 200. 쿨다운 없는 프로바이더는 재시도로 회복.
  let retryAttempts = 0;
  const finnhubStub = stubFetch(async (target) => {
    assert.equal(target.hostname, 'finnhub.io');
    retryAttempts += 1;
    if (retryAttempts === 1) {
      return errorResponse(429, (name) => (String(name).toLowerCase() === 'retry-after' ? '0' : null));
    }
    return jsonResponse({ recovered: true });
  });

  try {
    const recovered = await apiFetch({
      apiName: 'finnhub',
      baseUrl: 'https://finnhub.io/api/v1',
      path: '/stock/tc-retry-a?token=x',
      timeout: 2000,
    });
    assert.deepEqual(recovered, { recovered: true }, '429 이후 Retry-After 재시도로 데이터를 회복해야 한다');
    const calls = await finnhubStub.getCalls();
    assert.equal(calls.length, 2, '재시도 포함 정확히 2회 호출이어야 한다');
  } finally {
    await finnhubStub.restore();
  }

  // 2) fmp: 429 → PROVIDER_COOLDOWN_MS(10분) 쿨다운 세팅 후 즉시 null(재시도 없음)
  const fmpStub = stubFetch(async (target) => {
    assert.equal(target.hostname, 'financialmodelingprep.com');
    return errorResponse(429, () => '60');
  });

  try {
    const blocked = await apiFetch({
      apiName: 'fmp',
      baseUrl: 'https://financialmodelingprep.com',
      path: '/stable/tc-cooldown-b?apikey=x',
      timeout: 2000,
    });
    assert.equal(blocked, null, '쿨다운 프로바이더의 429는 null로 우아하게 저하되어야 한다');
    let calls = await fmpStub.getCalls();
    assert.equal(calls.length, 1, '쿨다운 프로바이더는 429 이후 재시도하지 않아야 한다');

    const status = getProviderStatus('fmp');
    assert.equal(status.exhausted, true, '429 쿨다운 후 provider status는 exhausted여야 한다');
    assert.equal(status.available, false, '쿨다운 중에는 available이 false여야 한다');
    assert.ok(status.cooldownRemainingMs > 0, 'cooldownRemainingMs가 남아 있어야 한다');
    assert.ok(
      getProviderCooldownRemaining('fmp') > 9 * 60 * 1000,
      'fmp 쿨다운은 10분으로 기록되어야 한다',
    );

    // 3) 쿨다운 활성 중 재호출은 fetch 없이 즉시 null (쇼트서킷)
    const shortCircuited = await apiFetch({
      apiName: 'fmp',
      baseUrl: 'https://financialmodelingprep.com',
      path: '/stable/tc-cooldown-c?apikey=x',
      timeout: 2000,
    });
    assert.equal(shortCircuited, null, '쿨다운 중 재호출은 캐시/fetch 전에 null이어야 한다');
    calls = await fmpStub.getCalls();
    assert.equal(calls.length, 1, '쿨다운 쇼트서킷에서는 fetch가 발생하면 안 된다');
  } finally {
    await fmpStub.restore();
  }
});
