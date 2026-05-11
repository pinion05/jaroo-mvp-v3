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
