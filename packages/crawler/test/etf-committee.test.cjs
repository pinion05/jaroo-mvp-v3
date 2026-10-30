const test = require('node:test');
const assert = require('node:assert/strict');

const ETF_SOURCES = {
  quotes: {
    items: [{ code: '226490', price: 77540, currency: 'KRW', asOf: '2026-06-08T14:42:22+09:00', source: 'fixture', status: 'ok' }],
  },
  etfSnapshot: {
    code: '226490',
    asOf: '2026-06-08',
    product: { baseIndexName: '코스피지수', issuerName: '삼성자산운용(주)', totalFeePct: '0.150' },
    marketStatus: { closePrice: '77,540', returns: { oneMonthPct: '2.16' }, avgTradingVolume20: '858,000' },
    constituents: {
      top10WeightPct: '65.0',
      top10: [
        { rank: 1, name: '삼성전자', weightPct: '29.60' },
        { rank: 2, name: 'SK하이닉스', weightPct: '22.72' },
      ],
    },
  },
};

function installMockCommitteeLlm(capturedMemberKeys, memberScores = {}) {
  const originalFetch = global.fetch;
  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';
    capturedMemberKeys.push(memberKey);

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score: memberScores[memberKey] ?? 70,
            reason: `${memberKey} ETF reason`,
            confidence: 'medium',
          }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  return () => {
    global.fetch = originalFetch;
  };
}

function withEnv(overrides, run) {
  const backup = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    backup.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return run().finally(() => {
    for (const [key, value] of backup.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test('buildEtfMarketCommitteeSnapshot runs only the ETF page trend member for ETF sources', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const capturedMemberKeys = [];
  const restoreFetch = installMockCommitteeLlm(capturedMemberKeys);

  try {
    await withEnv({ OPENROUTER_API_KEY: 'test-key', DEEPSCAN_KR_LLM_ENABLE: '1' }, async () => {
      const snapshot = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'KR', kind: 'etf' },
        holding: { shares: '35', averagePrice: '58828.75' },
        selectedAt: '2026-06-08T14:42:22+09:00',
        sources: ETF_SOURCES,
      });

      assert.equal(snapshot.ok, true);
      assert.equal(snapshot.code, '226490');
      assert.equal(snapshot.status, 'complete');
      assert.deepEqual(snapshot.memberKeys, ['trend']);
      assert.deepEqual([...capturedMemberKeys], ['trend']);
      assert.ok(snapshot.requestId);
      assert.deepEqual(snapshot.axes.map((axis) => axis.label), ['지수/가격 흐름']);
      assert.deepEqual(
        snapshot.axes[0].members.map((member) => member.title),
        ['지수/가격 흐름'],
      );
      assert.deepEqual(snapshot.axes[0].members.map((member) => member.status), ['success']);
      // 단일 위원 축 점수는 가중합(trend×0.4)이 아니라 그 위원 점수 그대로(평균)다.
      assert.equal(snapshot.axes[0].score, 70);
      assert.equal(snapshot.cache, null);
      const allStrings = JSON.stringify(snapshot);
      assert.doesNotMatch(allStrings, /사업 품질|내 포지션 적합도|시장 신호|가격 위치 위원|수익성\/기본체력|밸류에이션/);
    });
  } finally {
    restoreFetch();
  }
});

test('buildEtfMarketCommitteeSnapshot rejects non-ETF evidence and malformed codes without LLM calls', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const capturedMemberKeys = [];
  const restoreFetch = installMockCommitteeLlm(capturedMemberKeys);

  try {
    await withEnv({ OPENROUTER_API_KEY: undefined, DEEPSCAN_KR_LLM_ENABLE: undefined }, async () => {
      const stockCode = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: '삼성전자', code: '005930', market: 'KR' },
        sources: {},
      });
      assert.equal(stockCode.ok, false);
      assert.equal(stockCode.error.code, 'not_an_etf_code');

      const usTicker = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'VOO', ticker: 'VOO', market: 'US' },
        sources: {},
      });
      assert.equal(usTicker.ok, false);
      assert.equal(usTicker.error.code, 'input-invalid');

      assert.equal(capturedMemberKeys.length, 0);
    });
  } finally {
    restoreFetch();
  }
});

test('buildEtfMarketCommitteeSnapshot serves a fresh cached snapshot without invoking the LLM', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const cachedSnapshot = {
    ok: true,
    code: '226490',
    memberKeys: ['trend', 'consensusMomentum', 'priceLocation'],
    requestId: 'cached-request',
    status: 'complete',
    axes: [{ label: '지수/가격 흐름', members: [{ title: '지수/가격 흐름' }] }],
    results: {},
    errors: [],
    pending: [],
    generatedAt: '2026-06-08T14:42:22.000Z',
    cache: null,
  };
  const cacheClient = {
    readPayload: async () => ({ status: 'fresh', payload: cachedSnapshot, created_at: '2026-06-08T15:00:00.000Z' }),
    upsertPayload: async () => {
      throw new Error('fresh hit must not write');
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('LLM must not be invoked on a fresh cache hit');
  };

  try {
    await withEnv({ OPENROUTER_API_KEY: 'test-key', DEEPSCAN_KR_LLM_ENABLE: '1' }, async () => {
      const snapshot = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      });

      assert.equal(snapshot.status, 'complete');
      assert.equal(snapshot.requestId, 'cached-request');
      assert.deepEqual(snapshot.cache, { hit: true, scannedAt: '2026-06-08T15:00:00.000Z' });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildEtfMarketCommitteeSnapshot writes only complete snapshots to the cache', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const upsertedEntries = [];
  const cacheClient = {
    readPayload: async () => null,
    upsertPayload: async (entry) => {
      upsertedEntries.push(entry);
      return { id: 1 };
    },
  };
  const capturedMemberKeys = [];
  const restoreFetch = installMockCommitteeLlm(capturedMemberKeys);

  try {
    await withEnv({ OPENROUTER_API_KEY: 'test-key', DEEPSCAN_KR_LLM_ENABLE: '1' }, async () => {
      const complete = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      });
      assert.equal(complete.status, 'complete');
      assert.equal(upsertedEntries.length, 1);
      assert.equal(upsertedEntries[0].payload.status, 'complete');
      assert.equal(upsertedEntries[0].payload.cache, null);
      assert.equal(upsertedEntries[0].route, 'etf-market-committee');
    });
  } finally {
    restoreFetch();
  }
});

test('buildEtfMarketCommitteeSnapshot cache key separates snapshots per holding values', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const readKeys = [];
  const upsertedEntries = [];
  const cacheClient = {
    readPayload: async (cacheKey) => {
      readKeys.push(cacheKey);
      return null;
    },
    upsertPayload: async (entry) => {
      upsertedEntries.push(entry);
      return { id: 1 };
    },
  };
  const capturedMemberKeys = [];
  const restoreFetch = installMockCommitteeLlm(capturedMemberKeys);

  try {
    await withEnv({ OPENROUTER_API_KEY: 'test-key', DEEPSCAN_KR_LLM_ENABLE: '1' }, async () => {
      const base = {
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      };

      // 같은 ETF 코드라도 보유 수량·평단이 다르면 위원 스냅샷(평단격차·평가손익)이 달라진다 —
      // 캐시 키도 보유값별로 분리되어야 한다(hasHolding 1/0 비트만으론 부족).
      await buildEtfMarketCommitteeSnapshot({ ...base, holding: { shares: '35', averagePrice: '58828.75' } });
      await buildEtfMarketCommitteeSnapshot({ ...base, holding: { shares: '10', averagePrice: '58828.75' } });
      await buildEtfMarketCommitteeSnapshot({ ...base, holding: { shares: '35', averagePrice: '70,000' } });
      // 같은 값의 표기 변형(쉼표·소수 자릿수)은 같은 키를 쓴다 — 불필요한 캐시 미스 방지.
      await buildEtfMarketCommitteeSnapshot({ ...base, holding: { shares: '35.0000', averagePrice: '70000.00' } });
      await buildEtfMarketCommitteeSnapshot({ ...base });

      assert.equal(readKeys.length, 5);
      assert.equal(upsertedEntries.length, 5);

      // 35/58828.75 · 10/58828.75 · 35/70000(×2 동일) · 보유 없음 → 서로 다른 4개 키.
      assert.equal(new Set(readKeys).size, 4);
      assert.equal(readKeys[2], readKeys[3]);
      assert.notEqual(readKeys[0], readKeys[1]);
      assert.notEqual(readKeys[0], readKeys[2]);
      assert.notEqual(readKeys[0], readKeys[4]);
    });
  } finally {
    restoreFetch();
  }
});

test('buildEtfMarketCommitteeSnapshot skips cache writes for soft-deadline partial shells', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const upsertedEntries = [];
  const cacheClient = {
    readPayload: async () => null,
    upsertPayload: async (entry) => {
      upsertedEntries.push(entry);
      return { id: 1 };
    },
  };
  const originalFetch = global.fetch;
  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';
    // 유일한 위원(trend)이 늦게 응답 — 소프트데드라인(1ms)에 걸려 partial 셸이 반환된다.
    if (memberKey === 'trend') {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ score: 70, reason: `${memberKey} ETF reason`, confidence: 'medium' }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    await withEnv({
      OPENROUTER_API_KEY: 'test-key',
      DEEPSCAN_KR_LLM_ENABLE: '1',
      DEEPSCAN_ETF_LLM_SOFT_DEADLINE_MS: '1',
    }, async () => {
      const snapshot = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      });

      assert.equal(snapshot.status, 'partial');
      assert.ok(snapshot.requestId);
      assert.equal(upsertedEntries.length, 0);
      // 백그라운드 잔여 위원이 마무리될 시간을 준다(테스트 프로세스 클린업 안정화).
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
  } finally {
    global.fetch = originalFetch;
  }
});

// ─── 재계안 폭주 방지 — 단일비행·stale 폴백·백오프 ───────────────────────────

// LLM 응답을 외부에서 푸는 게이트로 지연시킨다 — 두 호출이 동시에 진행 중임을 보장해
// 단일비행 병합을 결정적으로 검증한다.
function installGatedCommitteeLlm(capturedMemberKeys) {
  const originalFetch = global.fetch;
  let releaseLlm;
  const llmGate = new Promise((resolve) => {
    releaseLlm = resolve;
  });

  global.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';
    capturedMemberKeys.push(memberKey);
    await llmGate;

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ score: 70, reason: `${memberKey} ETF reason`, confidence: 'medium' }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    releaseLlm,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

// fresh는 아니지만 staleTtl 이내(fresh 지나 + 만료 전)인 complete 캐시 행.
// 행 타임스탬프는 실제 시계 기준으로 만든다 — stale 판정은 now와 비교하기 때문.
function createStaleCompleteRow() {
  const now = Date.now();
  return {
    status: 'stale',
    stale_after: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 24 * 60 * 60_000).toISOString(),
    created_at: new Date(now - 3 * 60 * 60_000).toISOString(),
    payload: {
      ok: true,
      code: '226490',
      memberKeys: ['trend'],
      requestId: 'stale-request',
      status: 'complete',
      axes: [{ label: '지수/가격 흐름', members: [{ title: '지수/가격 흐름', status: 'success' }] }],
      results: {},
      errors: [],
      pending: [],
      generatedAt: '2026-06-08T14:42:22.000Z',
      cache: null,
    },
  };
}

function installDelayedPartialCommitteeLlm(llmCallCount) {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    llmCallCount.value += 1;
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';
    // 유일한 위원(trend)이 늦게 응답 — 소프트데드라인(1ms)에 걸려 partial이 된다.
    if (memberKey === 'trend') {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ score: 70, reason: `${memberKey} ETF reason`, confidence: 'medium' }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return () => {
    global.fetch = originalFetch;
  };
}

test('buildEtfMarketCommitteeSnapshot merges concurrent recomputes into a single LLM load', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const capturedMemberKeys = [];
  const upsertedEntries = [];
  const cacheClient = {
    readPayload: async () => null,
    upsertPayload: async (entry) => {
      upsertedEntries.push(entry);
      return { id: 1 };
    },
  };
  const { releaseLlm, restore } = installGatedCommitteeLlm(capturedMemberKeys);

  try {
    await withEnv({ OPENROUTER_API_KEY: 'test-key', DEEPSCAN_KR_LLM_ENABLE: '1' }, async () => {
      const request = {
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        holding: { shares: '21', averagePrice: '60000' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      };
      const first = buildEtfMarketCommitteeSnapshot(request);
      const second = buildEtfMarketCommitteeSnapshot({ ...request });
      // 두 호출 모두 캐시 읽기를 지나 단일비행 게이트에 도달한 뒤 LLM을 푼다.
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseLlm();
      const [a, b] = await Promise.all([first, second]);

      // 동시 호출 2개가 위원 LLM load를 1회만 실행한다.
      assert.equal(capturedMemberKeys.length, 1);
      assert.equal(a.status, 'complete');
      assert.equal(b.status, 'complete');
      assert.equal(b.requestId, a.requestId);
      assert.equal(upsertedEntries.length, 1);
    });
  } finally {
    restore();
  }
});

test('buildEtfMarketCommitteeSnapshot falls back to a stale complete snapshot when recompute is partial', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const staleRow = createStaleCompleteRow();
  const upsertedEntries = [];
  const cacheClient = {
    readPayload: async () => staleRow,
    upsertPayload: async (entry) => {
      upsertedEntries.push(entry);
      return { id: 1 };
    },
  };
  const llmCallCount = { value: 0 };
  const restoreFetch = installDelayedPartialCommitteeLlm(llmCallCount);

  try {
    await withEnv({
      OPENROUTER_API_KEY: 'test-key',
      DEEPSCAN_KR_LLM_ENABLE: '1',
      DEEPSCAN_ETF_LLM_SOFT_DEADLINE_MS: '1',
    }, async () => {
      const snapshot = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        holding: { shares: '7', averagePrice: '50000' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      });

      // 재계산은 시도됐지만(1회) partial로 끝났고 → stale complete 캐시로 폴백한다.
      assert.equal(llmCallCount.value, 1);
      assert.equal(snapshot.status, 'complete');
      assert.equal(snapshot.requestId, 'stale-request');
      assert.deepEqual(snapshot.cache, { hit: true, stale: true, scannedAt: staleRow.created_at });
      // partial 결과를 캐시에 덮어쓰지 않는다.
      assert.equal(upsertedEntries.length, 0);
      // 백그라운드 잔여 위원이 마무리될 시간을 준다(테스트 프로세스 클린업 안정화).
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
  } finally {
    restoreFetch();
  }
});

test('buildEtfMarketCommitteeSnapshot returns the partial snapshot as-is when no stale complete cache exists', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const upsertedEntries = [];
  const cacheClient = {
    readPayload: async () => null,
    upsertPayload: async (entry) => {
      upsertedEntries.push(entry);
      return { id: 1 };
    },
  };
  const llmCallCount = { value: 0 };
  const restoreFetch = installDelayedPartialCommitteeLlm(llmCallCount);

  try {
    await withEnv({
      OPENROUTER_API_KEY: 'test-key',
      DEEPSCAN_KR_LLM_ENABLE: '1',
      DEEPSCAN_ETF_LLM_SOFT_DEADLINE_MS: '1',
    }, async () => {
      const snapshot = await buildEtfMarketCommitteeSnapshot({
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        holding: { shares: '3', averagePrice: '48000' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      });

      // 폴백할 stale 캐시가 없으면 partial을 그대로 반환한다.
      assert.equal(snapshot.ok, true);
      assert.equal(snapshot.status, 'partial');
      assert.ok(snapshot.requestId);
      assert.equal(snapshot.cache, null);
      assert.equal(upsertedEntries.length, 0);
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
  } finally {
    restoreFetch();
  }
});

test('buildEtfMarketCommitteeSnapshot skips recompute inside the failure backoff window', async () => {
  const { buildEtfMarketCommitteeSnapshot } = await import('../src/services/deepscan-payload.js');
  const cacheClient = {
    readPayload: async () => null,
    upsertPayload: async () => ({ id: 1 }),
  };
  const llmCallCount = { value: 0 };
  const restoreFetch = installDelayedPartialCommitteeLlm(llmCallCount);

  try {
    await withEnv({
      OPENROUTER_API_KEY: 'test-key',
      DEEPSCAN_KR_LLM_ENABLE: '1',
      DEEPSCAN_ETF_LLM_SOFT_DEADLINE_MS: '1',
    }, async () => {
      const request = {
        instrument: { name: 'KODEX 코스피', code: '226490', market: 'ETF', kind: 'etf' },
        holding: { shares: '9', averagePrice: '51000' },
        sources: ETF_SOURCES,
        crawlerCache: { client: cacheClient },
      };

      const first = await buildEtfMarketCommitteeSnapshot(request);
      assert.equal(first.status, 'partial');
      assert.equal(llmCallCount.value, 1);

      // 직전 재계산이 60s 백오프 창 안에서 실패했다 — 재요청은 캐시 조회만 하고
      // 위원 LLM을 다시 부르지 않는다(크레딧 나선 방지).
      const second = await buildEtfMarketCommitteeSnapshot({ ...request });
      assert.equal(llmCallCount.value, 1);
      assert.equal(second.ok, false);
      assert.equal(second.error.code, 'committee-recompute-backoff');
      assert.equal(second.status, 'error');

      // bypassCache(웹 새로고침 → crawlerCacheBypass=1)는 명시적 재시도라 백오프를 우회한다.
      const forced = await buildEtfMarketCommitteeSnapshot({
        ...request,
        crawlerCache: { client: cacheClient, bypassCache: true },
      });
      assert.equal(llmCallCount.value, 2);
      assert.equal(forced.status, 'partial');
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
  } finally {
    restoreFetch();
  }
});
