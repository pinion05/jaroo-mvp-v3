const test = require('node:test');
const assert = require('node:assert/strict');

const TOP_LEVEL_KEYS = [
  'committee',
  'hero',
  'input',
  'insights',
  'metadata',
  'portfolioSimulation',
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
  assert.equal(payload.hero.score, 79);
  assert.equal(payload.hero.statusText, '우세');
  assert.match(payload.hero.headline, /삼성전자/);
  assert.match(payload.hero.headline, /79/);
  assert.match(payload.hero.body, /현재가 85200 KRW 확인/);
  assert.equal(payload.hero.fallback, null);
  assert.equal(payload.committee.axes.length, 3);
  assert.equal(payload.committee.axes[0].score, 70);
  assert.equal(payload.committee.axes[1].score, 85);
  assert.equal(payload.committee.axes[2].score, 84);
  assert.deepEqual(payload.insights.summaryTags, ['score:79', 'reports:6/10', 'decision:hold']);
  assert.equal(payload.strategy.weekSignal, '관찰 지속');
  assert.equal(payload.strategy.currentPriceText, '85200 KRW');
  assert.equal(payload.strategy.targetPriceText, '컨센서스/패키지 보조 근거 확인');
  assert.equal(payload.sellNow.realizedText, '현재가 기준 평가손익 +170400 KRW (+20%). 즉시 매도 판단은 hold 입니다.');
  assert.equal(payload.sellNow.rows.length, 4);
  assert.equal(payload.portfolioSimulation.beforeScore, 83);
  assert.equal(payload.portfolioSimulation.afterScore, 85);
  assert.equal(payload.portfolioSimulation.deltaLabel, 'hold:+2');

  const allStrings = collectStrings(payload).join('\n');
  assert.doesNotMatch(allStrings, /baseline|placeholder|deterministic placeholder|integration pending/i);

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'ok');
    assert.equal(payload.metadata.blockStatus[key], 'ok');
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
  assert.match(payload.hero.body, /KR 리포트 페이지 근거 없음/);
  assert.equal(payload.committee.axes.length, 3);
  assert.doesNotMatch(payload.committee.axes[0].members[0].reason, /package-result 없음/);
  assert.deepEqual(payload.insights.summaryTags, ['score:6', 'reports:0/10', 'decision:blocked']);
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

  const positionFitAxis = payload.committee.axes.find((axis) => axis.label === 'Position Fit');
  assert.ok(positionFitAxis);
  assert.equal(positionFitAxis.score, 84);
  assert.match(positionFitAxis.members[0].reason, /현재가 85200 대비 평단 71000/);
  assert.equal(positionFitAxis.members[2].reason, '보유 수량, 평단, 현재가가 모두 확인되어 sell-now 계산이 가능합니다.');
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
  const marketTimingAxis = payload.committee.axes.find((axis) => axis.label === 'Market Timing');
  assert.ok(marketTimingAxis);
  assert.match(marketTimingAxis.members[2].reason, /현재가 85200 KRW와 평단 71000 비교 기준/)
  const positionFitAxis = payload.committee.axes.find((axis) => axis.label === 'Position Fit');
  assert.ok(positionFitAxis);
  assert.equal(positionFitAxis.members[2].reason, '보유 수량, 평단, 현재가가 모두 확인되어 sell-now 계산이 가능합니다.');
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
