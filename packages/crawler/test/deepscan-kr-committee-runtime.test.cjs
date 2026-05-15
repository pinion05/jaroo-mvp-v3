const test = require('node:test');
const assert = require('node:assert/strict');

test('KR committee LLM uses an extended default timeout for first attempts', async () => {
  const {
    DEFAULT_KR_LLM_TIMEOUT_MS,
    scoreDeepScanKrCommitteeFromDump,
  } = await import('../src/services/deepscan-kr-committee-runtime.js');
  const originalFetch = global.fetch;
  const originalAbortTimeout = AbortSignal.timeout;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalKrTimeout = process.env.DEEPSCAN_KR_LLM_TIMEOUT_MS;
  const originalSharedTimeout = process.env.DEEPSCAN_LLM_TIMEOUT_MS;
  const capturedTimeouts = [];

  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.DEEPSCAN_KR_LLM_TIMEOUT_MS;
  delete process.env.DEEPSCAN_LLM_TIMEOUT_MS;

  AbortSignal.timeout = (timeoutMs) => {
    capturedTimeouts.push(timeoutMs);
    return originalAbortTimeout.call(AbortSignal, 30_000);
  };

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score: 70,
            reason: `${memberKey} reason`,
            confidence: 'medium',
          }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const result = await scoreDeepScanKrCommitteeFromDump({}, {
      instrument: {
        code: '005930',
        name: '삼성전자',
        market: 'KR',
      },
      sourceContext: {},
    }, {
      instrument: {
        code: '005930',
        name: '삼성전자',
        market: 'KR',
      },
      pageCoverage: {
        totalKnownPages: 0,
        availablePageIds: [],
        missingPageIds: [],
        availableCount: 0,
      },
      sourceCoverage: {
        hasCurrentQuote: false,
        hasHolding: false,
        hasPackageResult: false,
        availableReportPages: [],
      },
      reportSignals: {},
      missingSources: [],
      sourceLimitations: [],
      topFacts: [],
      topRisks: [],
    }, {});

    assert.equal(DEFAULT_KR_LLM_TIMEOUT_MS, 180_000);
    assert.equal(Object.keys(result.results).length, 9);
    assert.equal(capturedTimeouts.length, 9);
    assert.deepEqual([...new Set(capturedTimeouts)], [180_000]);
  } finally {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalAbortTimeout;
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
    if (originalKrTimeout === undefined) {
      delete process.env.DEEPSCAN_KR_LLM_TIMEOUT_MS;
    } else {
      process.env.DEEPSCAN_KR_LLM_TIMEOUT_MS = originalKrTimeout;
    }
    if (originalSharedTimeout === undefined) {
      delete process.env.DEEPSCAN_LLM_TIMEOUT_MS;
    } else {
      process.env.DEEPSCAN_LLM_TIMEOUT_MS = originalSharedTimeout;
    }
  }
});

test('KR committee LLM default model is isolated from OCR_MODEL', async () => {
  const {
    DEFAULT_KR_LLM_MODEL,
    scoreDeepScanKrCommitteeFromDump,
  } = await import('../src/services/deepscan-kr-committee-runtime.js');
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalKrModel = process.env.DEEPSCAN_KR_LLM_MODEL;
  const originalSharedModel = process.env.DEEPSCAN_LLM_MODEL;
  const originalOcrModel = process.env.OCR_MODEL;
  const capturedModels = [];

  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.DEEPSCAN_KR_LLM_MODEL;
  delete process.env.DEEPSCAN_LLM_MODEL;
  process.env.OCR_MODEL = 'qwen/qwen3.5-flash-02-23';

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    capturedModels.push(body.model);
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score: 70,
            reason: `${memberKey} reason`,
            confidence: 'medium',
          }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    await scoreDeepScanKrCommitteeFromDump({}, {
      instrument: {
        code: '005930',
        name: '삼성전자',
        market: 'KR',
      },
      sourceContext: {},
    }, {
      instrument: {
        code: '005930',
        name: '삼성전자',
        market: 'KR',
      },
      pageCoverage: {
        totalKnownPages: 0,
        availablePageIds: [],
        missingPageIds: [],
        availableCount: 0,
      },
      sourceCoverage: {
        hasCurrentQuote: false,
        hasHolding: false,
        hasPackageResult: false,
        availableReportPages: [],
      },
      reportSignals: {},
      missingSources: [],
      sourceLimitations: [],
      topFacts: [],
      topRisks: [],
    }, {});

    assert.equal(DEFAULT_KR_LLM_MODEL, 'x-ai/grok-4.1-fast');
    assert.equal(capturedModels.length, 9);
    assert.deepEqual([...new Set(capturedModels)], [DEFAULT_KR_LLM_MODEL]);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
    if (originalKrModel === undefined) {
      delete process.env.DEEPSCAN_KR_LLM_MODEL;
    } else {
      process.env.DEEPSCAN_KR_LLM_MODEL = originalKrModel;
    }
    if (originalSharedModel === undefined) {
      delete process.env.DEEPSCAN_LLM_MODEL;
    } else {
      process.env.DEEPSCAN_LLM_MODEL = originalSharedModel;
    }
    if (originalOcrModel === undefined) {
      delete process.env.OCR_MODEL;
    } else {
      process.env.OCR_MODEL = originalOcrModel;
    }
  }
});

test('KR committee axes render pending members and score completed members only', async () => {
  const { buildKrCommitteeAxesFromLlmResults } = await import('../src/services/deepscan-kr-committee-runtime.js');

  const shape = buildKrCommitteeAxesFromLlmResults(null, {
    profitability: { score: 80, reason: '수익성 reason', confidence: 'medium' },
    valuation: { score: 60, reason: '밸류 reason', confidence: 'medium' },
  }, [], ['ownershipStability', 'trend', 'consensusMomentum', 'priceLocation', 'avgPriceGap', 'upsideBuffer', 'holdingCompleteness']);

  const businessAxis = shape.axes.find((axis) => axis.label === '사업 품질');
  const marketAxis = shape.axes.find((axis) => axis.label === '시장 타이밍');

  assert.equal(shape.hasPendingMembers, true);
  assert.equal(shape.committeeScores, null);
  assert.equal(businessAxis.score, 70);
  assert.match(businessAxis.axisStatusText, /2\/3명 반영 · 1명 고민중/);
  assert.deepEqual(businessAxis.members.map((member) => member.status), ['success', 'success', 'pending']);
  assert.equal(businessAxis.members[2].scoreLabel, '고민중...');
  assert.equal(marketAxis.score, null);
  assert.match(marketAxis.axisStatusText, /LLM 위원 응답 대기 중/);
});

test('KR committee LLM prompt omits unavailable source-limitations data from model context', async () => {
  const { scoreDeepScanKrCommitteeFromDump } = await import('../src/services/deepscan-kr-committee-runtime.js');
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalEnabled = process.env.DEEPSCAN_KR_LLM_ENABLE;
  const capturedBodies = [];

  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.DEEPSCAN_KR_LLM_ENABLE = '1';

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    capturedBodies.push(body);
    const userMessage = Array.isArray(body?.messages)
      ? body.messages.find((message) => message.role === 'user')
      : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const memberKey = content.match(/"member":"([^"]+)"/)?.[1] ?? 'unknown';

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score: 70,
            reason: `${memberKey} reason`,
            confidence: 'medium',
          }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    await scoreDeepScanKrCommitteeFromDump({}, {
      instrument: {
        code: '100840',
        name: 'SNT에너지',
        market: 'KR',
      },
      sourceContext: {},
    }, {
      instrument: {
        code: '100840',
        name: 'SNT에너지',
        market: 'KR',
      },
      ownershipSnapshot: {
        majorHolderPct: 52.32,
        foreignOwnershipPct: 2.53,
        institutionalOwnershipPct: null,
        sourceLimitations: [{
          fact: 'institutionalOwnershipPct',
          message: 'WiseReport/FnGuide KR 원본 덤프에는 기관 전체 보유율 aggregate가 없고 운용사별 보유/5% 이상 보유자/변동 내역만 있습니다.',
        }],
      },
      pageCoverage: {
        totalKnownPages: 0,
        availablePageIds: [],
        missingPageIds: [],
        availableCount: 0,
      },
      sourceCoverage: {
        hasCurrentQuote: false,
        hasHolding: false,
        hasPackageResult: false,
        availableReportPages: [],
      },
      reportSignals: {},
      missingSources: [],
      sourceLimitations: [{
        fact: 'institutionalOwnershipPct',
        message: 'WiseReport/FnGuide KR 원본 덤프에는 기관 전체 보유율 aggregate가 없습니다.',
      }],
      topFacts: [],
      topRisks: [],
    }, {});

    assert.equal(capturedBodies.length, 9);

    const serializedBodies = JSON.stringify(capturedBodies);
    const serializedSystemPrompts = JSON.stringify(
      capturedBodies.flatMap((body) => body.messages ?? [])
        .filter((message) => message.role === 'system')
        .map((message) => message.content),
    );

    assert.doesNotMatch(serializedSystemPrompts, /sourceLimitations|missing-data warnings|WiseReport source dump/);
    assert.doesNotMatch(serializedBodies, /institutionalOwnershipPct|기관 전체 보유율|sourceLimitations/);
    assert.match(serializedBodies, /majorHolderPct/);
    assert.match(serializedBodies, /foreignOwnershipPct/);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
    if (originalEnabled === undefined) {
      delete process.env.DEEPSCAN_KR_LLM_ENABLE;
    } else {
      process.env.DEEPSCAN_KR_LLM_ENABLE = originalEnabled;
    }
  }
});
