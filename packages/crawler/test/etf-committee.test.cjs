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

test('buildEtfMarketCommitteeSnapshot completes the market-timing subset for ETF sources', async () => {
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
      assert.deepEqual(snapshot.memberKeys, ['trend', 'consensusMomentum', 'priceLocation']);
      assert.deepEqual([...capturedMemberKeys].sort(), ['consensusMomentum', 'priceLocation', 'trend']);
      assert.ok(snapshot.requestId);
      assert.deepEqual(snapshot.axes.map((axis) => axis.label), ['지수/가격 흐름']);
      assert.deepEqual(
        snapshot.axes[0].members.map((member) => member.title),
        ['지수/가격 흐름', '시장 신호/정보 밀도', '가격 위치'],
      );
      assert.deepEqual(snapshot.axes[0].members.map((member) => member.status), ['success', 'success', 'success']);
      assert.equal(snapshot.cache, null);
      const allStrings = JSON.stringify(snapshot);
      assert.doesNotMatch(allStrings, /사업 품질|내 포지션 적합도|수익성\/기본체력|밸류에이션/);
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
    // priceLocation만 늦게 응답 — 소프트데드라인(1ms)에 걸려 partial 셸이 반환된다.
    if (memberKey === 'priceLocation') {
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
