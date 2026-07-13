const test = require('node:test');
const assert = require('node:assert/strict');
const { WISEREPORT_KR_V12_PAGES } = require('../src/crawlers/wisereport-kr/page-specs.cjs');

process.env.DEEPSCAN_KR_LLM_ENABLE = 'false';

const TOP_LEVEL_KEYS = [
  'committee',
  'hero',
  'input',
  'insights',
  'metadata',
  'portfolioSimulation',
  'recoveryForecastRaw',
  'sellNow',
  'strategy',
];

const MAJOR_BLOCK_KEYS = [
  'hero',
  'committee',
  'insights',
  'strategy',
  'sellNow',
  'portfolioSimulation',
];

function assertBlockMeta(block, expectedState) {
  assert.equal(block.blockState, expectedState);
  assert.ok(Array.isArray(block.sourceRefs));
  assert.ok(Object.prototype.hasOwnProperty.call(block, 'fallback'));
  assert.ok(Object.prototype.hasOwnProperty.call(block, 'error'));
}

function getExpectedBlockStatus(payload) {
  return Object.fromEntries(MAJOR_BLOCK_KEYS.map((key) => [key, payload[key].blockState]));
}

function assertCanonicalPayloadShape(payload) {
  assert.deepEqual(Object.keys(payload).sort(), TOP_LEVEL_KEYS);
  assert.deepEqual(payload.metadata.blockStatus, getExpectedBlockStatus(payload));
}

function createStrongKrSources() {
  return {
    slim: {
      code: '005930',
      company: {
        code: '005930',
        name: '삼성전자',
      },
      pages: {
        'company-status': {
          performanceComment: {
            title: '기업실적코멘트',
            asOf: '2026-04-10',
            text: '2025년 결산 전년동기 대비 연결기준 매출액은 10.9% 증가, 영업이익은 33.2% 증가. AI 인프라 경쟁으로 서버향 메모리 수요가 공급량을 초과하여 실적이 개선됨.',
            sentences: [
              '2025년 결산 전년동기 대비 연결기준 매출액은 10.9% 증가, 영업이익은 33.2% 증가.',
              'AI 인프라 경쟁으로 서버향 메모리 수요가 공급량을 초과하여 실적이 개선됨.',
            ],
          },
        },
        'company-overview': {
          summary: {
            market: 'KOSPI',
          },
        },
        consensus: {
          consensusSummary: {
            rows: [{ 항목: '목표주가', 값: '100000' }],
          },
        },
        'recent-reports': {
          recentReports: [
            { title: 'report-1' },
            { title: 'report-2' },
          ],
        },
        'relative-return': {
          chartJson: {
            CHART: [{ TRD_DT: '2026/04/14', J_PRC: '85200' }],
          },
        },
        opinion: {
          performanceAndConsensus: {
            rows: [{ 의견: 'BUY' }],
          },
        },
        'style-analysis': {
          factorScores: {
            CHART_H: [{ NM: '성장', VAL: '95' }],
          },
        },
      },
    },
    quotes: {
      items: [
        {
          market: 'KR',
          code: '005930',
          price: 85200,
          currency: 'KRW',
          volume: 1234567,
          asOf: null,
          source: 'krx',
          status: 'ok',
        },
      ],
      missing: [],
      asOf: {
        kr: '2026-04-14',
        us: null,
      },
      providerStatus: {
        polygon: { ok: true },
      },
    },
    packageResult: {
      stockCode: '005930',
      listingMarket: 'KOSPI',
      timestamp: '2026-04-15T12:00:00.000Z',
      reportContent: 'ok',
      marketScoreSnapshot: { totalScore: 80 },
      boardAnalysis: { boardOpinions: [] },
    },
  };
}

function createFullCoverageKrSources() {
  const pages = Object.fromEntries(
    WISEREPORT_KR_V12_PAGES.map((page) => [page.id, { status: 'ok', note: 'reached' }]),
  );

  return {
    slim: {
      schemaVersion: 'wisereport-kr-slim-v1.2',
      code: '003720',
      company: {
        code: '003720',
        name: '삼영화학공업',
      },
      pages,
    },
    quotes: {
      items: [{
        market: 'KR',
        code: '003720',
        price: 8880,
        currency: 'KRW',
        volume: 1326000,
        asOf: '2026-06-02T14:31:18+09:00',
        source: 'fixture',
        status: 'ok',
      }],
    },
  };
}

function collectStrings(value, bucket = []) {
  if (typeof value === 'string') {
    bucket.push(value);
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, bucket);
    }
    return bucket;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectStrings(nested, bucket);
    }
  }

  return bucket;
}

test('buildJarooDeepScanPayload returns input-invalid payload when code/ticker missing', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const rawInput = {
    instrument: { name: '삼성전자' },
    selectedAt: '2026-04-15T09:00:00.000Z',
  };

  const payload = await buildJarooDeepScanPayload(rawInput);
  rawInput.instrument.name = '변경된 입력';

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.generatedAt, '2026-04-15T09:00:00.000Z');
  assert.equal(payload.metadata.inputValidity.valid, false);
  assert.equal(payload.metadata.errorCode, 'input-invalid');
  assert.deepEqual(payload.metadata.inputValidity.missing, ['instrument.code', 'instrument.ticker']);
  assert.notEqual(payload.metadata.inputValidity.raw, rawInput);
  assert.equal(payload.metadata.inputValidity.raw.instrument.name, '삼성전자');

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'blocked');
    assert.equal(payload.metadata.blockStatus[key], 'blocked');
  }
});

test('buildJarooDeepScanPayload normalizes home-handoff sourceContext to holding', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: { name: '삼성전자' },
    selectedAt: '2026-04-15T09:00:00.000Z',
    sourceContext: {
      from: 'home-handoff',
      sessionKey: 'session-1',
      appliedAt: '2026-04-15T10:00:00.000Z',
    },
  });

  assert.equal(payload.input.sourceContext.from, 'holding');
  assert.equal(payload.metadata.sourceRefs[0]?.type, 'holding');
});

test('buildJarooDeepScanPayload returns KR evidence-driven payload for valid input and is re-exported from the crawler public API', async () => {
  const service = await import('../src/services/deepscan-payload.js');
  const publicApi = await import('../src/index.js');

  assert.equal(publicApi.buildJarooDeepScanPayload, service.buildJarooDeepScanPayload);

  const rawInput = {
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '12',
      averagePrice: '71000',
      evaluationAmount: '1022400',
    },
    selectedAt: '2026-04-14T00:00:00.000Z',
    sourceContext: {
      from: 'holding',
      sessionKey: 'session-1',
      appliedAt: '2026-04-15T00:00:00.000Z',
    },
    sources: createStrongKrSources(),
  };

  const payload = await publicApi.buildJarooDeepScanPayload(rawInput);
  rawInput.holding.shares = '999';

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.generatedAt, '2026-04-15T00:00:00.000Z');
  assert.equal(payload.metadata.inputValidity.valid, true);
  assert.equal(payload.metadata.errorCode, undefined);
  assert.equal(payload.metadata.degraded, false);
  assert.notEqual(payload.metadata.inputValidity.raw, rawInput);
  assert.equal(payload.metadata.inputValidity.raw.holding.shares, '12');
  assert.equal(payload.hero.score, 76);
  assert.equal(payload.hero.statusText, '우세');
  assert.match(payload.hero.headline, /삼성전자/);
  assert.match(payload.hero.headline, /76/);
  assert.match(payload.hero.body, /현재가 85200 KRW 확인/);
  assert.equal(payload.hero.fallback, null);
  assert.equal(payload.committee.axes.length, 3);
  assert.equal(payload.committee.axes[0].score, 65);
  assert.equal(payload.committee.axes[1].score, 83);
  assert.equal(payload.committee.axes[2].score, 84);
  assert.deepEqual(payload.insights.summaryTags, ['점수 76', '리포트 7/11', '판단 보유 유지']);
  assert.deepEqual(
    payload.insights.items.find((item) => item.sourceLabel === '거래량'),
    {
      sourceType: 'market',
      sourceLabel: '거래량',
      date: '2026-04-14',
      label: '거래량',
      title: '삼성전자 거래량',
      body: '거래량 1234567주 확인',
    },
  );
  assert.deepEqual(
    payload.insights.items.find((item) => item.sourceLabel === '기업실적코멘트'),
    {
      sourceType: 'report',
      sourceLabel: '기업실적코멘트',
      date: '2026-04-10',
      label: '실적',
      title: '기업실적코멘트 쉽게 보기',
      body: '2025년 기준, 매출은 10.9% 늘었어요.\n본업 이익은 33.2% 늘었어요.\nAI 인프라 경쟁으로 서버용 메모리 수요가 물건이 모자랄 만큼 많아져 실적이 좋아졌어요.',
      sourceBody: '2025년 결산 전년동기 대비 연결기준 매출액은 10.9% 증가, 영업이익은 33.2% 증가. AI 인프라 경쟁으로 서버향 메모리 수요가 공급량을 초과하여 실적이 개선됨.',
    },
  );
  assert.deepEqual(
    payload.insights.items.find((item) => item.sourceLabel === '증권사 의견'),
    {
      sourceType: 'report',
      sourceLabel: '증권사 의견',
      date: '2026-04-14',
      label: '컨센서스',
      title: '삼성전자 증권사 컨센서스',
      body: '평균 목표가 100000 KRW · 현재가 대비 +17.37% · 매수 의견이 우세해요 · 투자의견 BUY',
      consensus: {
        targetPrice: 100000,
        targetGapPct: 17.370892018779344,
        analystCount: null,
        recommendation: 'BUY',
        recommendationScore: null,
        highestTargetPrice: null,
        lowestTargetPrice: null,
        opinionSummary: '매수 의견이 우세해요',
        currency: 'KRW',
      },
    },
  );
  assert.equal(payload.strategy.weekSignal, '관찰 지속');
  assert.equal(payload.strategy.currentPriceText, '85200 KRW');
  assert.equal(payload.strategy.targetPriceText, '100000 KRW');
  assert.equal(payload.sellNow.realizedText, '현재가 기준 평가손익 +170400 KRW (+20%). 즉시 매도 판단은 보유 유지입니다.');
  assert.equal(payload.sellNow.rows.length, 4);
  assert.equal(payload.portfolioSimulation.beforeScore, 82);
  assert.equal(payload.portfolioSimulation.afterScore, 84);
  assert.equal(payload.portfolioSimulation.deltaLabel, '보유:+2');

  const allStrings = collectStrings(payload).join('\n');
  assert.doesNotMatch(allStrings, /baseline|placeholder|deterministic placeholder|integration pending/i);

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'ok');
    assert.equal(payload.metadata.blockStatus[key], 'ok');
  }
});

test('buildJarooDeepScanPayload adds OpenDART disclosure analysis to KR DeepScan insights and source refs', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const sources = createStrongKrSources();
  sources.disclosures = {
    source: 'opendart',
    requested: { from: '2026-05-12', to: '2026-06-12' },
    summary: { totalCount: 3, latestReceiptDate: '20260608' },
    filings: [
      {
        rceptNo: '20260608800918',
        reportName: '최대주주등소유주식변동신고서',
        receiptDate: '20260608',
        disclosureType: 'D',
        disclosureTypeLabel: '지분공시',
        filerName: '삼성전자',
      },
      {
        rceptNo: '20260601000001',
        reportName: '임원ㆍ주요주주특정증권등소유상황보고서',
        receiptDate: '20260601',
        disclosureType: 'D',
        disclosureTypeLabel: '지분공시',
        filerName: '하지훈',
      },
      {
        rceptNo: '20260515000001',
        reportName: '분기보고서 (2026.03)',
        receiptDate: '20260515',
        disclosureType: 'A',
        disclosureTypeLabel: '정기공시',
        filerName: '삼성전자',
      },
    ],
  };

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '12',
      averagePrice: '71000',
      evaluationAmount: '1022400',
    },
    selectedAt: '2026-06-12T00:00:00.000Z',
    sourceContext: {
      from: 'holding',
      sessionKey: 'session-1',
      appliedAt: '2026-06-12T00:00:00.000Z',
    },
    sources,
  });

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.degraded, false);
  assert.match(payload.hero.body, /OpenDART 공시 3건/);
  assert.equal(payload.metadata.sourceRefs.some((ref) => ref.id === 'opendart-disclosures:005930'), true);
  assert.equal(payload.insights.summaryTags.includes('공시 3건'), true);
  const eventScannerMember = payload.committee.axes
    .flatMap((axis) => axis.members)
    .find((member) => member.memberKey === 'consensusMomentum');
  assert.equal(eventScannerMember.title, '이벤트 스캐너');
  assert.match(eventScannerMember.reason, /OpenDART 공시 3건/);
  assert.match(eventScannerMember.reason, /지분공시 2건/);
  assert.deepEqual(
    payload.insights.items.find((item) => item.sourceLabel === '공시 분석'),
    {
      sourceType: 'report',
      sourceLabel: '공시 분석',
      date: '2026-06-08',
      label: '공시',
      title: '삼성전자 최근 OpenDART 공시 흐름',
      body: '2026-05-12~2026-06-12 공시 3건 · 최대주주등소유주식변동신고서 1건 · 지분/주요주주 2건 · 정기보고서 1건 · 주요 리스크 공시 없음',
      sourceBody: [
        '2026-06-08 · 최대주주등소유주식변동신고서 · 제출:삼성전자 · 지분 변동',
        '2026-06-01 · 임원ㆍ주요주주특정증권등소유상황보고서 · 제출:하지훈 · 지분 변동',
        '2026-05-15 · 분기보고서 (2026.03) · 제출:삼성전자 · 일반',
      ].join('\n'),
    },
  );
});

test('buildJarooDeepScanPayload omits risk-recheck scenario when KR coverage and core inputs are complete', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: '삼영화학공업',
      code: '003720',
      market: 'KR',
    },
    holding: {
      shares: '85',
      averagePrice: '6958.3427',
    },
    selectedAt: '2026-06-02T14:31:18+09:00',
    sources: createFullCoverageKrSources(),
  });

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.strategy.scenarioCondition, '추가 리스크 없음');
  assert.equal(payload.strategy.otherScenarios.some((scenario) => scenario.label === '리스크 재점검'), false);
  assert.equal(payload.strategy.otherScenarios.length, 1);
});

test('buildJarooDeepScanPayload separates source-provided missing target price from source lookup failure', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const noDataPayload = await buildJarooDeepScanPayload({
    instrument: {
      name: '한미반도체',
      code: '042700',
      market: 'KR',
    },
    selectedAt: '2026-05-18T00:00:00.000Z',
    sources: {
      slim: {
        code: '042700',
        pages: {
          consensus: {
            consensusTrend: {
              rows: [{ 구분: '투자의견(점수)', '2026/05/18': '', '3개월전': '4.00' }],
            },
          },
          opinion: {
            analystOpinions: {
              rows: [{
                추정기관: '데이타가 존재하지 않습니다.',
                적정주가: '데이타가 존재하지 않습니다.',
                투자의견: '데이타가 존재하지 않습니다.',
              }],
            },
            reportSummaries: {
              rows: [{ 투자의견: '데이타가 존재하지 않습니다.', 목표주가: '데이타가 존재하지 않습니다.' }],
            },
          },
          'recent-reports': {
            recentReports: {
              rows: [{ 일자: '26/01/27', 투자의견: 'BUY', 목표주가: '230,000' }],
            },
          },
        },
      },
      quotes: {
        items: [{
          market: 'KR',
          code: '042700',
          price: 286500,
          currency: 'KRW',
          asOf: '2026-05-18',
          source: 'fixture',
          status: 'ok',
        }],
      },
    },
  });

  assert.equal(noDataPayload.strategy.targetPriceText, '목표가 미제공');
  assert.equal(noDataPayload.insights.items.some((item) => item.sourceLabel === '증권사 의견'), false);
  assert.doesNotMatch(collectStrings({
    insights: noDataPayload.insights,
    strategy: noDataPayload.strategy,
    committee: noDataPayload.committee,
  }).join('\n'), /데이타가 존재하지 않습니다/);

  const failurePayload = await buildJarooDeepScanPayload({
    instrument: {
      name: '한미반도체',
      code: '042700',
      market: 'KR',
    },
    selectedAt: '2026-05-18T00:00:00.000Z',
    sources: {
      quotes: {
        items: [{
          market: 'KR',
          code: '042700',
          price: 286500,
          currency: 'KRW',
          asOf: '2026-05-18',
          source: 'fixture',
          status: 'ok',
        }],
      },
    },
  });

  assert.equal(failurePayload.strategy.targetPriceText, '목표가 조회 실패');
  assert.match(collectStrings(failurePayload).join('\n'), /missing-source:slim|slim/);
});


test('buildJarooDeepScanPayload uses LLM to simplify WiseReport performance comment into three numeric-preserving lines', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalSummaryEnable = process.env.DEEPSCAN_COMMENTARY_SUMMARY_ENABLE;
  const originalKrLlmEnable = process.env.DEEPSCAN_KR_LLM_ENABLE;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.DEEPSCAN_COMMENTARY_SUMMARY_ENABLE = 'true';
  process.env.DEEPSCAN_KR_LLM_ENABLE = 'false';

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    assert.equal(body.response_format?.json_schema?.name, 'jaroo_performance_comment_summary');
    const userMessage = Array.isArray(body?.messages) ? body.messages.find((message) => message.role === 'user') : null;
    assert.match(String(userMessage?.content ?? ''), /10.9%/);

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            lines: [
              '2025년 매출은 10.9% 늘었어요.',
              '본업 이익은 33.2% 늘었어요.',
              '서버 메모리가 부족할 만큼 수요가 많았어요.',
            ],
          }),
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const payload = await buildJarooDeepScanPayload({
      instrument: {
        name: '삼성전자',
        code: '005930',
        market: 'KR',
      },
      selectedAt: '2026-04-14T00:00:00.000Z',
      sourceContext: {
        from: 'holding',
        sessionKey: 'session-1',
        appliedAt: '2026-04-15T00:00:00.000Z',
      },
      sources: createStrongKrSources(),
    });

    const commentInsight = payload.insights.items.find((item) => item.sourceLabel === '기업실적코멘트');
    assert.equal(
      commentInsight?.body,
      '2025년 매출은 10.9% 늘었어요.\n본업 이익은 33.2% 늘었어요.\n서버 메모리가 부족할 만큼 수요가 많았어요.',
    );
    assert.match(commentInsight?.sourceBody ?? '', /매출액은 10\.9% 증가/);
  } finally {
    global.fetch = originalFetch;
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    if (originalSummaryEnable) {
      process.env.DEEPSCAN_COMMENTARY_SUMMARY_ENABLE = originalSummaryEnable;
    } else {
      delete process.env.DEEPSCAN_COMMENTARY_SUMMARY_ENABLE;
    }
    process.env.DEEPSCAN_KR_LLM_ENABLE = originalKrLlmEnable ?? 'false';
  }
});

test('buildJarooDeepScanPayload degrades with real missing-source messaging for KR input instead of placeholder copy', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '5',
    },
    selectedAt: '2026-04-14T00:00:00.000Z',
    sources: {},
  });

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.inputValidity.valid, true);
  assert.equal(payload.metadata.degraded, true);
  assert.equal(payload.hero.score, 6);
  assert.equal(payload.hero.statusText, '경계');
  assert.match(payload.hero.body, /현재가 근거 없음/);
  assert.match(payload.hero.body, /국내 리포트 페이지 근거 없음/);
  assert.equal(payload.committee.axes.length, 3);
  assert.doesNotMatch(payload.committee.axes[0].members[0].reason, /package-result 없음/);
  assert.deepEqual(payload.insights.summaryTags, ['점수 6', '리포트 0/11', '판단 보류']);
  assert.match(payload.strategy.currentPriceText, /현재가 근거 없음/);
  assert.match(payload.sellNow.realizedText, /즉시 매도 판단을 계산하지 못했습니다/);
  assert.equal(payload.portfolioSimulation.beforeScore, 0);
  assert.equal(payload.portfolioSimulation.afterScore, 0);
  assert.equal(payload.portfolioSimulation.deltaLabel, 'N/A');
  assert.match(payload.portfolioSimulation.caption, /포트폴리오 시뮬레이션을 계산할 수 없습니다/);

  const allStrings = collectStrings(payload).join('\n');
  assert.doesNotMatch(allStrings, /baseline|placeholder|deterministic placeholder|integration pending/i);

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'ok');
    assert.equal(payload.metadata.blockStatus[key], 'ok');
  }
});

test('buildJarooDeepScanPayload keeps position-fit evidence when the handoff uses display-formatted holding strings', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '12주',
      averagePrice: '71,000원',
      evaluationAmount: '1,022,400원',
    },
    selectedAt: '2026-04-14T00:00:00.000Z',
    sources: createStrongKrSources(),
  });

  const positionFitAxis = payload.committee.axes.find((axis) => axis.label === '포지션 적합도');
  assert.ok(positionFitAxis);
  assert.equal(positionFitAxis.score, 84);
  assert.match(positionFitAxis.members[0].reason, /현재가 85200 대비 평단 71000/);
  assert.equal(positionFitAxis.members[2].reason, '보유 수량, 평단, 현재가가 모두 확인되어 즉시 매도 계산이 가능합니다.');
  assert.match(payload.sellNow.realizedText, /\+170400 KRW/);
});

test('buildJarooDeepScanPayload uses package-derived KR committee wording when available', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '12',
      averagePrice: '71000',
      evaluationAmount: '1022400',
    },
    selectedAt: '2026-04-14T00:00:00.000Z',
    sources: {
      ...createStrongKrSources(),
      packageResult: {
        stockCode: '005930',
        listingMarket: 'KOSPI',
        timestamp: '2026-04-15T12:00:00.000Z',
        reportContent: '패키지 요약: 메모리 수요와 서버 투자 확대가 실적 체력을 지지합니다.',
        marketScoreSnapshot: {
          totalScore: 81,
          summary: '밸류에이션은 과열보다 재평가 구간에 가깝습니다.',
        },
        boardAnalysis: {
          boardOpinions: [
            { analyst: 'A', summary: '재무 구조와 현금창출력이 안정적이라 downside가 제한적입니다.' },
            { analyst: 'B', summary: 'HBM 증설과 AI 수요가 성장 가시성을 높여줍니다.' },
            { analyst: 'C', summary: '기관 수급은 변동성이 있지만 추세 훼손 신호는 아직 약합니다.' },
          ],
          boardMarketEvaluation: '평단 대비 현재가는 부담이 크지 않고 시나리오 대응 여지가 남아 있습니다.',
        },
      },
    },
  });

  const reasons = payload.committee.axes.flatMap((axis) => axis.members.map((member) => member.reason));
  assert.ok(reasons.some((reason) => reason.includes('재무 구조와 현금창출력')))
  assert.ok(reasons.some((reason) => reason.includes('HBM 증설과 AI 수요')))
  assert.ok(reasons.some((reason) => reason.includes('기관 수급은 변동성이 있지만')))
  assert.doesNotMatch(reasons[0], /최근 리포트 2건 기준입니다/)
  const marketTimingAxis = payload.committee.axes.find((axis) => axis.label === '시장 타이밍');
  assert.ok(marketTimingAxis);
  assert.match(marketTimingAxis.members[2].reason, /현재가 85200 KRW와 평단 71000 비교 기준/)
  const positionFitAxis = payload.committee.axes.find((axis) => axis.label === '포지션 적합도');
  assert.ok(positionFitAxis);
  assert.equal(positionFitAxis.members[2].reason, '보유 수량, 평단, 현재가가 모두 확인되어 즉시 매도 계산이 가능합니다.');
});

test('buildJarooDeepScanPayload can surface dump-backed KR LLM committee scores and reasons', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalEnable = process.env.DEEPSCAN_KR_LLM_ENABLE;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.DEEPSCAN_KR_LLM_ENABLE = 'true';

  const memberScores = {
    profitability: 77,
    valuation: 72,
    ownershipStability: 65,
    trend: 81,
    consensusMomentum: 74,
    priceLocation: 68,
    avgPriceGap: 59,
    upsideBuffer: 66,
    holdingCompleteness: 88,
  };

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages) ? body.messages.find((message) => message.role === 'user') : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const match = content.match(/\"member\":\"([^\"]+)\"/);
    const memberKey = match?.[1];
    const score = memberScores[memberKey];
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score,
            reason: `${memberKey} 덤프 근거를 반영한 한국어 이유입니다.`,
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
    const payload = await buildJarooDeepScanPayload({
      instrument: {
        name: '삼성전자',
        code: '005930',
        market: 'KR',
      },
      holding: {
        shares: '12',
        averagePrice: '71000',
        evaluationAmount: '1022400',
      },
      selectedAt: '2026-04-14T00:00:00.000Z',
      sourceContext: {
        from: 'holding',
        sessionKey: 'session-1',
        appliedAt: '2026-04-15T00:00:00.000Z',
      },
      sources: createStrongKrSources(),
    });

    assert.equal(payload.committee.blockState, 'ok');
    assert.equal(payload.committee.axes.length, 3);
    assert.equal(payload.committee.axes[0].members[0].reason.includes('덤프 근거'), true);
    assert.equal(payload.committee.axes[0].score, 72);
    assert.equal(payload.committee.axes[1].score, 75);
    assert.equal(payload.committee.axes[2].score, 68);
    assert.equal(payload.hero.score, 72);
    assert.equal(payload.metadata.degraded, false);
    assert.equal(payload.metadata.sourceRefs.some((ref) => ref.id.startsWith('kr-llm:')), true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    process.env.DEEPSCAN_KR_LLM_ENABLE = originalEnable ?? 'false';
  }
});

test('buildJarooDeepScanPayload preserves 9 committee slots and marks failed members after retry exhaustion', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalEnable = process.env.DEEPSCAN_KR_LLM_ENABLE;
  const originalRetryDelay = process.env.DEEPSCAN_LLM_EMPTY_RETRY_DELAY_MS;
  const originalRetryCount = process.env.DEEPSCAN_LLM_RETRY_COUNT;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.DEEPSCAN_KR_LLM_ENABLE = 'true';
  process.env.DEEPSCAN_LLM_EMPTY_RETRY_DELAY_MS = '1';
  process.env.DEEPSCAN_LLM_RETRY_COUNT = '3';

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages) ? body.messages.find((message) => message.role === 'user') : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const match = content.match(/\"member\":\"([^\"]+)\"/);
    const memberKey = match?.[1];

    if (['profitability', 'valuation', 'ownershipStability'].includes(memberKey)) {
      return new Response(JSON.stringify({ error: { message: 'axis failed', code: 502 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
    const payload = await buildJarooDeepScanPayload({
      instrument: {
        name: '삼성전자',
        code: '005930',
        market: 'KR',
      },
      holding: {
        shares: '12',
        averagePrice: '71000',
        evaluationAmount: '1022400',
      },
      selectedAt: '2026-04-14T00:00:00.000Z',
      sourceContext: {
        from: 'holding',
        sessionKey: 'session-1',
        appliedAt: '2026-04-15T00:00:00.000Z',
      },
      sources: createStrongKrSources(),
    });

    assert.equal(payload.committee.axes.length, 3);
    const businessAxis = payload.committee.axes.find((axis) => axis.label === '사업 품질');
    assert.ok(businessAxis);
    assert.equal(businessAxis.score, null);
    assert.equal(businessAxis.scoreText, 'N/A');
    assert.match(businessAxis.axisStatusText, /LLM 0\/3 · 오류 3\/3/);
    assert.equal(businessAxis.members.length, 3);
    assert.deepEqual(businessAxis.members.map((member) => member.status), ['error', 'error', 'error']);
    assert.deepEqual(businessAxis.members.map((member) => member.score), [null, null, null]);
    assert.equal(businessAxis.members[0].error.errorKind ?? businessAxis.members[0].error.kind, 'llm-upstream-error');
    assert.equal(businessAxis.members[0].error.attempts, 4);
    assert.equal(businessAxis.members[0].error.retryable, false);
    const marketAxis = payload.committee.axes.find((axis) => axis.label === '시장 타이밍');
    assert.ok(marketAxis);
    assert.equal(marketAxis.members.every((member) => member.status === 'success'), true);
    assert.equal(typeof marketAxis.score, 'number');
    assert.equal(payload.committee.blockState, 'ok');
    assert.equal(payload.hero.blockState, 'ok');
    assert.equal(payload.hero.scoreLabel, 'N/A');
    assert.equal(payload.hero.statusText, '부분 오류');
    assert.equal(payload.strategy.blockState, 'ok');
    assert.equal(payload.sellNow.blockState, 'ok');
    assert.equal(payload.portfolioSimulation.blockState, 'ok');
    assert.equal(payload.metadata.degraded, true);
  } finally {
    global.fetch = originalFetch;
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    process.env.DEEPSCAN_KR_LLM_ENABLE = originalEnable ?? 'false';
    if (originalRetryDelay) {
      process.env.DEEPSCAN_LLM_EMPTY_RETRY_DELAY_MS = originalRetryDelay;
    } else {
      delete process.env.DEEPSCAN_LLM_EMPTY_RETRY_DELAY_MS;
    }
    if (originalRetryCount) {
      process.env.DEEPSCAN_LLM_RETRY_COUNT = originalRetryCount;
    } else {
      delete process.env.DEEPSCAN_LLM_RETRY_COUNT;
    }
  }
});

test('buildJarooDeepScanPayload returns partial pending committee at soft deadline', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalEnable = process.env.DEEPSCAN_KR_LLM_ENABLE;
  const originalSoftDeadline = process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS;
  const originalConcurrency = process.env.DEEPSCAN_KR_LLM_CONCURRENCY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.DEEPSCAN_KR_LLM_ENABLE = 'true';
  process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS = '10';
  process.env.DEEPSCAN_KR_LLM_CONCURRENCY = '9';

  global.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const userMessage = Array.isArray(body?.messages) ? body.messages.find((message) => message.role === 'user') : null;
    const content = typeof userMessage?.content === 'string' ? userMessage.content : '';
    const match = content.match(/\"member\":\"([^\"]+)\"/);
    const memberKey = match?.[1];
    if (memberKey === 'profitability') {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            score: memberKey === 'valuation' ? 60 : 70,
            reason: `${memberKey} partial reason`,
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
    const startedAt = Date.now();
    const payload = await buildJarooDeepScanPayload({
      instrument: {
        name: '삼성전자',
        code: '005930',
        market: 'KR',
      },
      holding: {
        shares: '12',
        averagePrice: '71000',
        evaluationAmount: '1022400',
      },
      selectedAt: '2026-04-14T00:00:00.000Z',
      sourceContext: {
        from: 'holding',
      },
      sources: createStrongKrSources(),
    });

    assert.ok(Date.now() - startedAt < 70);
    assert.equal(payload.committee.blockState, 'ok');
    assert.equal(payload.metadata.degraded, true);
    assert.equal(payload.metadata.llmCommittee.status, 'partial');
    assert.equal(payload.metadata.llmCommittee.pending, 1);
    const businessAxis = payload.committee.axes.find((axis) => axis.label === '사업 품질');
    assert.ok(businessAxis);
    assert.equal(businessAxis.members.length, 3);
    assert.equal(businessAxis.members[0].status, 'pending');
    assert.equal(businessAxis.members[0].scoreLabel, '고민중...');
    assert.match(businessAxis.axisStatusText, /고민중/);
    assert.doesNotMatch(payload.hero.headline, /재시도 필요/);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    global.fetch = originalFetch;
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    process.env.DEEPSCAN_KR_LLM_ENABLE = originalEnable ?? 'false';
    if (originalSoftDeadline) {
      process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS = originalSoftDeadline;
    } else {
      delete process.env.DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS;
    }
    if (originalConcurrency) {
      process.env.DEEPSCAN_KR_LLM_CONCURRENCY = originalConcurrency;
    } else {
      delete process.env.DEEPSCAN_KR_LLM_CONCURRENCY;
    }
  }
});

test('buildKrPackageInvocationInput converts deepscan holding handoff strings into package input fields', async () => {
  const { buildKrPackageInvocationInput } = await import('../src/services/deepscan-payload.js');

  const packageInput = buildKrPackageInvocationInput({
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '12주',
      averagePrice: '71,000원',
      evaluationAmount: '1,022,400원',
    },
    sourceContext: {
      from: 'holding',
    },
  });

  assert.deepEqual(packageInput, {
    stockCode: '005930',
    holdingQty: '12',
    avgPrice: '71000',
  });
});

test('maybeResolveKrPackageResult auto-invokes the KR package when runtime config and holding inputs are present', async () => {
  const { maybeResolveKrPackageResult } = await import('../src/services/deepscan-payload.js');

  const packagePayload = {
    stockCode: '005930',
    reportContent: 'supplemental report',
    timestamp: '2026-04-16T03:30:00.000Z',
    listingMarket: 'KOSPI',
    marketScoreSnapshot: { totalScore: 81 },
    boardAnalysis: { boardOpinions: [{ analyst: 'A', stance: 'hold' }] },
  };
  const calls = [];

  const result = await maybeResolveKrPackageResult(
    {
      packageOptions: {
        sshHost: 'agent@macbook.local',
        identityPath: '/tmp/test-id_rsa',
        knownHostsPath: '/tmp/test-known_hosts',
        remoteDir: '/Users/agent/jaroo-report-package',
        nodeBin: 'node',
        enableCache: false,
        enableSnapshots: false,
        execFile: async (command, args) => {
          calls.push({ command, args });
          return {
            stdout: `${JSON.stringify(packagePayload)}\n`,
            stderr: '',
          };
        },
      },
    },
    {
      instrument: {
        name: '삼성전자',
        code: '005930',
        market: 'KR',
      },
      holding: {
        shares: '12주',
        averagePrice: '71,000원',
      },
      sourceContext: {
        from: 'holding',
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    value: packagePayload,
    issue: null,
  });
});

test('buildJarooDeepScanPayload returns canonical internal-service-error payload on unexpected failures', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const rawInput = {
    selectedAt: '2026-04-16T00:00:00.000Z',
  };

  Object.defineProperty(rawInput, 'instrument', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });

  const payload = await buildJarooDeepScanPayload(rawInput);

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.generatedAt, '2026-04-16T00:00:00.000Z');
  assert.equal(payload.metadata.errorCode, 'internal-service-error');
  assert.equal(payload.metadata.inputValidity.valid, false);
  assert.equal(payload.hero.fallback?.reason, 'internal-service-error');
  assert.equal(payload.hero.error?.code, 'internal-service-error');

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'error');
    assert.equal(payload.metadata.blockStatus[key], 'error');
    assert.equal(payload[key].error?.code, 'internal-service-error');
  }
});

test('buildJarooDeepScanPayload normalizes KR strategy scenario percentages to 100 with risk scenario', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: 'KODEX 코스피',
      code: '226490',
      market: 'ETF',
      kind: 'etf',
    },
    holding: {
      shares: '35',
      averagePrice: '58828.75',
    },
    selectedAt: '2026-06-08T14:42:22+09:00',
    sources: {
      quotes: {
        items: [{ code: '226490', price: 77540, currency: 'KRW', asOf: '2026-06-08T14:42:22+09:00', source: 'fixture', status: 'ok' }],
      },
      etfSnapshot: {
        code: '226490',
        asOf: '2026-06-08',
        product: { baseIndexName: '코스피지수', issuerName: '삼성자산운용(주)', totalFeePct: '0.150' },
        marketStatus: { closePrice: '77,540', returns: { oneMonthPct: '2.16' }, avgTradingVolume20: '858,000' },
        constituents: {
          asOf: '2026-06-08',
          top10WeightPct: '65.0',
          top10: [
            { rank: 1, name: '삼성전자', shares: '3,778', weightPct: '29.60' },
            { rank: 2, name: 'SK하이닉스', shares: 461, weightPct: 22.72 },
          ],
        },
      },
    },
  });

  const percentages = [payload.strategy.scenarioProbability, ...payload.strategy.otherScenarios.map((scenario) => scenario.probability)]
    .map((value) => Number(String(value).replace(/[^0-9.-]/g, '')));
  assert.equal(percentages.reduce((sum, value) => sum + value, 0), 100);
  assert.equal(payload.strategy.targetPriceText, 'NAV·기초지수·구성종목 기준');

  const allStrings = collectStrings(payload).join('\n');
  assert.doesNotMatch(allStrings, /목표가 미제공|증권사 목표가|기업 실적|EPS|PER|PBR/);
});

test('buildJarooDeepScanPayload uses ETF-native payload when kind is etf and market remains KR', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');

  const payload = await buildJarooDeepScanPayload({
    instrument: {
      name: 'KODEX 코스피',
      code: '226490',
      market: 'KR',
      kind: 'etf',
    },
    holding: {
      shares: '35',
      averagePrice: '58828.75',
    },
    selectedAt: '2026-06-08T14:42:22+09:00',
    sources: {
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
            { rank: 1, name: '삼성전자', shares: '3,778', weightPct: '29.60' },
            { rank: 2, name: 'SK하이닉스', shares: 461, weightPct: 22.72 },
          ],
        },
      },
    },
  });

  assert.equal(payload.input.instrument.market, 'KR');
  assert.equal(payload.input.instrument.kind, 'etf');
  assert.equal(payload.strategy.targetPriceText, 'NAV·기초지수·구성종목 기준');
  assert.deepEqual(payload.committee.axes.map((axis) => axis.label), ['ETF 구조 품질', '지수/가격 흐름', '내 포지션 적합도']);

  const allStrings = collectStrings(payload).join('\n');
  assert.doesNotMatch(allStrings, /목표가 조회 실패|사업 품질|밸류에이션|기업 실적|PER|PBR/);
});
