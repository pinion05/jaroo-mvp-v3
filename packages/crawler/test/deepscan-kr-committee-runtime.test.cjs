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

    assert.equal(DEFAULT_KR_LLM_MODEL, 'deepseek/deepseek-v4-flash');
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

test('KR ETF committee axes use exchange-product labels without changing member keys', async () => {
  const { buildKrCommitteeAxesFromLlmResults } = await import('../src/services/deepscan-kr-committee-runtime.js');

  const shape = buildKrCommitteeAxesFromLlmResults({
    instrument: {
      code: '226490',
      name: 'KODEX 코스피',
      market: 'ETF',
    },
  }, {
    profitability: { score: 70, reason: 'ETF 구조 reason', confidence: 'medium' },
    valuation: { score: 65, reason: 'ETF 가격 reason', confidence: 'medium' },
    ownershipStability: { score: 55, reason: 'ETF 분산 reason', confidence: 'medium' },
    trend: { score: 60, reason: 'ETF 흐름 reason', confidence: 'medium' },
    consensusMomentum: { score: 50, reason: 'ETF 정보 reason', confidence: 'medium' },
    priceLocation: { score: 80, reason: 'ETF 위치 reason', confidence: 'medium' },
    avgPriceGap: { score: 85, reason: '평단 reason', confidence: 'medium' },
    upsideBuffer: { score: 60, reason: '여지 reason', confidence: 'medium' },
    holdingCompleteness: { score: 90, reason: '입력 reason', confidence: 'medium' },
  });

  assert.deepEqual(shape.axes.map((axis) => axis.label), ['ETF 구조 품질', '지수/가격 흐름', '내 포지션 적합도']);
  assert.deepEqual(shape.axes[0].members.map((member) => member.title), ['상품 구조/운용 품질', '가격/NAV 단서', '구성/분산 안정성']);
  assert.deepEqual(shape.axes[1].members.map((member) => member.title), ['지수/가격 흐름', '시장 신호/정보 밀도', '가격 위치']);
  assert.match(shape.axes[0].subtitle, /추종지수·구성·유동성/);
  assert.equal(shape.hasMemberErrors, false);
});

test('KR ETF committee axes honor etf kind even when market is generic KR', async () => {
  const { buildKrCommitteeAxesFromLlmResults } = await import('../src/services/deepscan-kr-committee-runtime.js');

  const shape = buildKrCommitteeAxesFromLlmResults({
    instrument: {
      code: '226490',
      name: 'KODEX 코스피',
      market: 'KR',
      kind: 'etf',
    },
  }, {
    profitability: { score: 70, reason: 'ETF 구조 reason', confidence: 'medium' },
    valuation: { score: 65, reason: 'ETF 가격 reason', confidence: 'medium' },
    ownershipStability: { score: 55, reason: 'ETF 분산 reason', confidence: 'medium' },
    trend: { score: 60, reason: 'ETF 흐름 reason', confidence: 'medium' },
    consensusMomentum: { score: 50, reason: 'ETF 정보 reason', confidence: 'medium' },
    priceLocation: { score: 80, reason: 'ETF 위치 reason', confidence: 'medium' },
    avgPriceGap: { score: 85, reason: '평단 reason', confidence: 'medium' },
    upsideBuffer: { score: 60, reason: '여지 reason', confidence: 'medium' },
    holdingCompleteness: { score: 90, reason: '입력 reason', confidence: 'medium' },
  });

  assert.deepEqual(shape.axes.map((axis) => axis.label), ['ETF 구조 품질', '지수/가격 흐름', '내 포지션 적합도']);
  assert.deepEqual(shape.axes[0].members.map((member) => member.title), ['상품 구조/운용 품질', '가격/NAV 단서', '구성/분산 안정성']);
});

test('KR ETF committee prompts forbid stock-only missing-data interpretations', async () => {
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

  try {
    await scoreDeepScanKrCommitteeFromDump({}, {
      instrument: {
        code: '226490',
        name: 'KODEX 코스피',
        market: 'ETF',
      },
      sourceContext: {},
    }, {
      instrument: {
        code: '226490',
        name: 'KODEX 코스피',
        market: 'ETF',
      },
      currentQuote: {
        price: 79870,
        currency: 'KRW',
      },
      holding: {
        shares: 35,
        averagePrice: 58828.75,
        hasHoldingContext: true,
        hasFullSellNowInputs: true,
      },
      marketSnapshot: {
        averagePriceGapPct: 35.77,
      },
      consensusSnapshot: {},
      valuationSnapshot: {},
      pageCoverage: {
        totalKnownPages: 14,
        availablePageIds: ['current-quote'],
        missingPageIds: [],
        availableCount: 1,
      },
      sourceCoverage: {
        hasCurrentQuote: true,
        hasHolding: true,
        hasPackageResult: false,
        hasEtfSnapshot: true,
        availableReportPages: [],
      },
      etfProductSnapshot: {
        product: {
          baseIndexName: '코스피지수',
          issuerName: '삼성자산운용(주)',
          totalFeePct: 0.15,
        },
        marketStatus: {
          returns: { oneMonthPct: 18.52 },
          avgTradingVolume20: 596968,
        },
        constituents: {
          top10WeightPct: 57.12,
          top10: [
            { rank: 1, name: '삼성전자', weightPct: 29.6 },
            { rank: 2, name: 'SK하이닉스', weightPct: 22.72 },
          ],
        },
      },
      reportSignals: {},
      missingSources: [],
      sourceLimitations: [],
      topFacts: [],
      topRisks: [],
    }, {});

    assert.equal(capturedBodies.length, 9);
    const systemPrompts = capturedBodies.flatMap((body) => body.messages ?? [])
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    const serializedBodies = JSON.stringify(capturedBodies);

    assert.match(systemPrompts, /treat the instrument as an exchange-traded product/);
    assert.match(systemPrompts, /PER, PBR, ROE, corporate profitability, shareholder stability, analyst recommendation, or target price/);
    assert.match(systemPrompts, /never infer low risk or high stability from missing shareholder or constituent data/);
    assert.match(serializedBodies, /KODEX 코스피/);
    assert.match(serializedBodies, /ETF/);
    assert.match(serializedBodies, /코스피지수/);
    assert.match(serializedBodies, /삼성전자/);
    assert.match(serializedBodies, /SK하이닉스/);
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

test('KR committee event scanner prompt and member dump prioritize OpenDART disclosures', async () => {
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
      consensusSnapshot: {
        targetPrice: 426000,
        targetGapPct: 27.83,
      },
      reportSignals: {
        consensusAvailable: true,
        opinionAvailable: true,
        recentReportsAvailable: true,
        recentReportCount: 14,
      },
      disclosureAnalysis: {
        available: true,
        source: 'opendart',
        totalCount: 23,
        count: 23,
        periodFrom: '2026-05-12',
        periodTo: '2026-06-12',
        latestReceiptDate: '2026-06-08',
        ownershipCount: 16,
        correctionCount: 3,
        dilutionCount: 0,
        materialEventCount: 0,
        riskCount: 0,
        mediumRiskCount: 3,
        topReportTypes: [{ reportName: '임원ㆍ주요주주특정증권등소유상황보고서', count: 14 }],
        latestFilings: [{ receiptDate: '2026-06-08', reportName: '최대주주등소유주식변동신고서', riskLabel: '지분 변동' }],
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
      missingSources: [],
      sourceLimitations: [],
      topFacts: ['최근 OpenDART 공시 23건 / 지분공시 16건 확인'],
      topRisks: ['정정 공시 3건 확인'],
    }, {
      disclosures: {
        documentDump: {
          available: true,
          source: 'opendart-document',
          policy: 'skip_gte_max_chars_then_take_first_limit',
          maxCharsPerFiling: 15000,
          limit: 20,
          includedCount: 2,
          skippedTooLongCount: 1,
          totalCharCount: 52,
          combinedText: '[1] 2026-06-08 · 최대주주등소유주식변동신고서\n최대주주 관련 짧은 공시 본문\n\n---\n\n[2] 2026-06-02 · 정정 지분공시\n정정 사유가 포함된 짧은 공시 본문',
          filings: [
            { rceptNo: '20260608800918', reportName: '최대주주등소유주식변동신고서', receiptDate: '2026-06-08', charCount: 24 },
            { rceptNo: '20260602000421', reportName: '[기재정정]임원ㆍ주요주주특정증권등소유상황보고서', receiptDate: '2026-06-02', charCount: 28 },
          ],
          skipped: [
            { rceptNo: '20260601000172', reportName: '대규모기업집단현황공시', receiptDate: '2026-06-01', reason: 'too_long', charCount: 650710 },
          ],
        },
      },
    });

    assert.equal(capturedBodies.length, 9);
    const eventBody = capturedBodies.find((body) => {
      const userMessage = body.messages?.find((message) => message.role === 'user');
      return typeof userMessage?.content === 'string' && userMessage.content.includes('"member":"consensusMomentum"');
    });

    assert.ok(eventBody);
    const systemPrompt = eventBody.messages.find((message) => message.role === 'system')?.content ?? '';
    const userContent = eventBody.messages.find((message) => message.role === 'user')?.content ?? '';

    assert.match(systemPrompt, /이벤트 스캐너 persona/);
    assert.match(systemPrompt, /prioritize OpenDART disclosures before generic consensus/);
    assert.match(userContent, /eventScannerContext/);
    assert.match(userContent, /opendart_disclosures/);
    assert.match(userContent, /"totalCount":23/);
    assert.match(userContent, /"ownershipCount":16/);
    assert.match(userContent, /"correctionCount":3/);
    assert.match(userContent, /documentDump/);
    assert.match(userContent, /최대주주 관련 짧은 공시 본문/);
    assert.match(userContent, /"skippedTooLongCount":1/);
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
