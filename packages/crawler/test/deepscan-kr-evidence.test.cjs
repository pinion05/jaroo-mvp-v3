const test = require('node:test');
const assert = require('node:assert/strict');

test('buildDeepScanKrEvidencePacket assembles deterministic KR evidence from nested input, slim pages, quotes aggregate, package result, and public API re-export', async () => {
  const service = await import('../src/services/deepscan-kr-evidence.js');
  const publicApi = await import('../src/index.js');

  assert.equal(publicApi.buildDeepScanKrEvidencePacket, service.buildDeepScanKrEvidencePacket);

  const packet = service.buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '005930',
        name: '삼성전자',
      },
      holding: {
        shares: '12',
        averagePrice: '71000',
        evaluationAmount: '1022400',
      },
    },
    {
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
          {
            market: 'KR',
            code: '000660',
            price: 201000,
            currency: 'KRW',
            asOf: '2026-04-14',
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
    },
  );

  assert.deepEqual(packet.instrument, {
    code: '005930',
    name: '삼성전자',
    market: 'KOSPI',
  });
  assert.deepEqual(packet.holding, {
    shares: 12,
    averagePrice: 71000,
    evaluationAmount: 1022400,
    hasHoldingContext: true,
    hasFullSellNowInputs: true,
  });
  assert.deepEqual(packet.currentQuote, {
    price: 85200,
    currency: 'KRW',
    asOf: '2026-04-14',
    source: 'krx',
    status: 'ok',
  });
  assert.deepEqual(packet.marketSnapshot, {
    currentPrice: 85200,
    currency: 'KRW',
    averagePriceGapPct: 20,
    evaluationPnL: 170400,
    evaluationPnLPct: 20,
  });
  assert.equal(packet.pageCoverage.totalKnownPages, publicApi.WISEREPORT_KR_PAGES.length);
  assert.deepEqual(packet.pageCoverage.availablePageIds, [
    'company-overview',
    'consensus',
    'recent-reports',
    'relative-return',
    'opinion',
    'style-analysis',
  ]);
  assert.deepEqual(packet.pageCoverage.missingPageIds, [
    'financial-analysis',
    'investment-indicators',
    'shareholding',
    'fnguide-finance',
  ]);
  assert.equal(packet.pageCoverage.availableCount, 6);
  assert.deepEqual(packet.sourceCoverage, {
    hasCurrentQuote: true,
    hasHolding: true,
    hasPackageResult: true,
    availableReportPages: [
      'company-overview',
      'consensus',
      'recent-reports',
      'relative-return',
      'opinion',
      'style-analysis',
    ],
  });
  assert.deepEqual(packet.reportSignals, {
    consensusAvailable: true,
    opinionAvailable: true,
    recentReportsAvailable: true,
    relativeReturnAvailable: true,
    styleAnalysisAvailable: true,
    recentReportCount: 2,
  });
  assert.deepEqual(packet.consensusSnapshot, {
    targetPrice: 100000,
    targetGapPct: ((100000 - 85200) / 85200) * 100,
    recommendation: 'BUY',
    recommendationCounts: null,
    revisionDirection: 'unknown',
    revisionPct: null,
  });
  assert.deepEqual(packet.valuationSnapshot, {
    per: null,
    pbr: null,
    roe: null,
    evEbitda: null,
  });
  assert.deepEqual(packet.styleAnalysisSnapshot, {
    factorScores: [{ name: '성장', value: 95 }],
  });
  assert.deepEqual(packet.packageContext, {
    available: true,
    summaryFacts: ['ok'],
    marketView: null,
    boardHighlights: [],
  });
  assert.deepEqual(packet.missingSources, []);
  assert.deepEqual(packet.topFacts, [
    '현재가 85200 KRW 확인',
    '보유 12주 / 평단 71000 확인',
    'KR 리포트 페이지 6/10 확보',
  ]);
  assert.deepEqual(packet.topRisks, ['미확보 KR 페이지 4건']);
});

test('buildDeepScanKrEvidencePacket accepts flat normalized-ish input and a direct quote item while keeping safe defaults for missing sources', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      code: '005930',
      name: '삼성전자',
      market: 'KR',
      shares: '5',
      averagePrice: 'bad-price',
    },
    {
      quotes: {
        market: 'KR',
        code: '005930',
        price: 90000,
        currency: 'KRW',
        asOf: '2026-04-15',
        source: 'fixture',
        status: 'ok',
      },
    },
  );

  assert.deepEqual(packet.instrument, {
    code: '005930',
    name: '삼성전자',
    market: 'KR',
  });
  assert.deepEqual(packet.holding, {
    shares: 5,
    averagePrice: null,
    evaluationAmount: null,
    hasHoldingContext: true,
    hasFullSellNowInputs: false,
  });
  assert.deepEqual(packet.currentQuote, {
    price: 90000,
    currency: 'KRW',
    asOf: '2026-04-15',
    source: 'fixture',
    status: 'ok',
  });
  assert.deepEqual(packet.marketSnapshot, {
    currentPrice: 90000,
    currency: 'KRW',
    averagePriceGapPct: null,
    evaluationPnL: null,
    evaluationPnLPct: null,
  });
  assert.equal(packet.pageCoverage.availableCount, 0);
  assert.equal(packet.pageCoverage.totalKnownPages, 10);
  assert.equal(packet.pageCoverage.availablePageIds.length, 0);
  assert.equal(packet.pageCoverage.missingPageIds.length, 10);
  assert.deepEqual(packet.sourceCoverage, {
    hasCurrentQuote: true,
    hasHolding: true,
    hasPackageResult: false,
    availableReportPages: [],
  });
  assert.deepEqual(packet.reportSignals, {
    consensusAvailable: false,
    opinionAvailable: false,
    recentReportsAvailable: false,
    relativeReturnAvailable: false,
    styleAnalysisAvailable: false,
    recentReportCount: null,
  });
  assert.equal(packet.packageContext.available, false);
  assert.deepEqual(packet.packageContext.summaryFacts, []);
  assert.deepEqual(packet.missingSources, ['slim']);
  assert.deepEqual(packet.topFacts, [
    '현재가 90000 KRW 확인',
    '보유 맥락 일부 확인',
  ]);
  assert.deepEqual(packet.topRisks, [
    'sell-now 입력 불완전',
    'KR 리포트 페이지 근거 없음',
  ]);
});

test('buildDeepScanKrEvidencePacket ignores unknown slim page keys, counts recent reports from row-like payloads, and reports missing quote/holding sources deterministically', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '005930',
        name: '삼성전자',
      },
    },
    {
      slim: {
        code: '005930',
        pages: {
          'recent-reports': {
            rows: [{ title: 'report-1' }],
          },
          opinion: {},
          'unknown-page': {
            shouldBeIgnored: true,
          },
        },
      },
      quotes: {
        items: [
          {
            market: 'KR',
            code: '000660',
            price: 201000,
            currency: 'KRW',
            asOf: '2026-04-14',
            source: 'krx',
            status: 'ok',
          },
        ],
        missing: [{ market: 'KR', code: '005930', reason: 'not-found' }],
        asOf: { kr: '2026-04-14', us: null },
      },
    },
  );

  assert.equal(packet.currentQuote, null);
  assert.deepEqual(packet.pageCoverage.availablePageIds, ['recent-reports']);
  assert.equal(packet.pageCoverage.availableCount, 1);
  assert.equal(packet.pageCoverage.missingPageIds.length, 9);
  assert.deepEqual(packet.sourceCoverage, {
    hasCurrentQuote: false,
    hasHolding: false,
    hasPackageResult: false,
    availableReportPages: ['recent-reports'],
  });
  assert.deepEqual(packet.reportSignals, {
    consensusAvailable: false,
    opinionAvailable: false,
    recentReportsAvailable: true,
    relativeReturnAvailable: false,
    styleAnalysisAvailable: false,
    recentReportCount: 1,
  });
  assert.deepEqual(packet.missingSources, ['current-quote', 'holding']);
  assert.deepEqual(packet.topFacts, [
    'KR 리포트 페이지 1/10 확보',
    '최근 리포트 1건 확인',
  ]);
  assert.deepEqual(packet.topRisks, [
    '현재가 근거 없음',
    'KR 보유 맥락 없음',
    '미확보 KR 페이지 9건',
  ]);
});

test('buildDeepScanKrEvidencePacket parses display-formatted holding strings from the deepscan handoff', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '005930',
        name: '삼성전자',
      },
      holding: {
        shares: '12주',
        averagePrice: '71,000원',
        evaluationAmount: '1,022,400원',
      },
    },
    {
      quotes: {
        items: [
          {
            market: 'KR',
            code: '005930',
            price: 85200,
            currency: 'KRW',
            asOf: '2026-04-14',
            source: 'krx',
            status: 'ok',
          },
        ],
      },
    },
  );

  assert.deepEqual(packet.holding, {
    shares: 12,
    averagePrice: 71000,
    evaluationAmount: 1022400,
    hasHoldingContext: true,
    hasFullSellNowInputs: true,
  });
  assert.deepEqual(packet.topFacts, [
    '현재가 85200 KRW 확인',
    '보유 12주 / 평단 71000 확인',
  ]);
  assert.deepEqual(packet.topRisks, [
    'KR 리포트 페이지 근거 없음',
  ]);
});
