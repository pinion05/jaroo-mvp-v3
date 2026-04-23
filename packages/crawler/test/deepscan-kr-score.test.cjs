const test = require('node:test');
const assert = require('node:assert/strict');

function createStrongEvidencePacket() {
  return {
    instrument: {
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
    },
    holding: {
      shares: 12,
      averagePrice: 71000,
      evaluationAmount: 1022400,
      hasHoldingContext: true,
      hasFullSellNowInputs: true,
    },
    currentQuote: {
      price: 85200,
      currency: 'KRW',
      asOf: '2026-04-14',
      source: 'krx',
      status: 'ok',
    },
    pageCoverage: {
      totalKnownPages: 10,
      availablePageIds: [
        'company-overview',
        'consensus',
        'recent-reports',
        'relative-return',
        'opinion',
        'style-analysis',
      ],
      missingPageIds: [
        'financial-analysis',
        'investment-indicators',
        'shareholding',
        'fnguide-finance',
      ],
      availableCount: 6,
    },
    sourceCoverage: {
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
    },
    reportSignals: {
      consensusAvailable: true,
      opinionAvailable: true,
      recentReportsAvailable: true,
      relativeReturnAvailable: true,
      styleAnalysisAvailable: true,
      recentReportCount: 2,
    },
    missingSources: [],
    topFacts: [
      '현재가 85200 KRW 확인',
      '보유 12주 / 평단 71000 확인',
      'KR 리포트 페이지 6/10 확보',
    ],
    topRisks: ['미확보 KR 페이지 4건'],
  };
}

test('scoreDeepScanKrEvidence scores strong evidence deterministically and is publicly re-exported', async () => {
  const service = await import('../src/services/deepscan-kr-score.js');
  const publicApi = await import('../src/index.js');

  assert.equal(publicApi.scoreDeepScanKrEvidence, service.scoreDeepScanKrEvidence);

  const scored = service.scoreDeepScanKrEvidence(createStrongEvidencePacket());

  assert.deepEqual(scored, {
    committee: {
      businessQuality: {
        score: 65,
        profitability: 56,
        valuation: 80,
        ownershipStability: 60,
      },
      marketTiming: {
        score: 83,
        trend: 90,
        consensusMomentum: 81,
        priceLocation: 75,
      },
      positionFit: {
        score: 84,
        avgPriceGap: 80,
        upsideBuffer: 85,
        holdingCompleteness: 90,
      },
    },
    hero: {
      score: 76,
      scoreLabel: 'strong',
      statusText: '우세',
      penalties: [],
    },
    sellNow: {
      available: true,
      decisionBand: 'hold',
      currentPrice: 85200,
      averagePrice: 71000,
      evaluationPnL: 170400,
      evaluationPnLPct: 20,
    },
    portfolioSimulation: {
      available: true,
      beforeScore: 82,
      afterScore: 84,
      delta: 2,
      deltaLabel: 'hold:+2',
    },
  });
});

test('scoreDeepScanKrEvidence no longer awards hidden package-presence-only numeric bonuses', async () => {
  const { scoreDeepScanKrEvidence } = await import('../src/services/deepscan-kr-score.js');

  const withPackage = scoreDeepScanKrEvidence(createStrongEvidencePacket());
  const withoutPackage = scoreDeepScanKrEvidence({
    ...createStrongEvidencePacket(),
    sourceCoverage: {
      ...createStrongEvidencePacket().sourceCoverage,
      hasPackageResult: false,
    },
  });

  assert.deepEqual(withPackage.committee, withoutPackage.committee);
  assert.deepEqual(withPackage.hero, withoutPackage.hero);
});

test('scoreDeepScanKrEvidence applies missing-data penalties and blocks sell-now/simulation without quote and coverage', async () => {
  const { scoreDeepScanKrEvidence } = await import('../src/services/deepscan-kr-score.js');

  const scored = scoreDeepScanKrEvidence({
    instrument: {
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
    },
    holding: {
      shares: null,
      averagePrice: null,
      evaluationAmount: null,
      hasHoldingContext: false,
      hasFullSellNowInputs: false,
    },
    currentQuote: null,
    pageCoverage: {
      totalKnownPages: 10,
      availablePageIds: [],
      missingPageIds: [
        'company-overview',
        'consensus',
        'recent-reports',
        'relative-return',
        'opinion',
        'style-analysis',
        'financial-analysis',
        'investment-indicators',
        'shareholding',
        'fnguide-finance',
      ],
      availableCount: 0,
    },
    sourceCoverage: {
      hasCurrentQuote: false,
      hasHolding: false,
      hasPackageResult: false,
      availableReportPages: [],
    },
    reportSignals: {
      consensusAvailable: false,
      opinionAvailable: false,
      recentReportsAvailable: false,
      relativeReturnAvailable: false,
      styleAnalysisAvailable: false,
      recentReportCount: null,
    },
  });

  assert.deepEqual(scored, {
    committee: {
      businessQuality: {
        score: 20,
        profitability: 20,
        valuation: 20,
        ownershipStability: 20,
      },
      marketTiming: {
        score: 18,
        trend: 20,
        consensusMomentum: 15,
        priceLocation: 20,
      },
      positionFit: {
        score: 22,
        avgPriceGap: 20,
        upsideBuffer: 25,
        holdingCompleteness: 20,
      },
    },
    hero: {
      score: 2,
      scoreLabel: 'caution',
      statusText: '경계',
      penalties: [
        'missing-current-quote',
        'missing-analyst-coverage',
        'missing-recent-reports',
      ],
    },
    sellNow: {
      available: false,
      decisionBand: 'blocked',
      currentPrice: null,
      averagePrice: null,
      evaluationPnL: null,
      evaluationPnLPct: null,
    },
    portfolioSimulation: {
      available: false,
      beforeScore: null,
      afterScore: null,
      delta: null,
      deltaLabel: null,
    },
  });
});

test('scoreDeepScanKrEvidence sends underwater weak holdings into a deterministic exit-now path', async () => {
  const { scoreDeepScanKrEvidence } = await import('../src/services/deepscan-kr-score.js');

  const scored = scoreDeepScanKrEvidence({
    instrument: {
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
    },
    holding: {
      shares: 10,
      averagePrice: 70000,
      evaluationAmount: 610000,
      hasHoldingContext: true,
      hasFullSellNowInputs: true,
    },
    currentQuote: {
      price: 61000,
      currency: 'KRW',
      asOf: '2026-04-14',
      source: 'fixture',
      status: 'ok',
    },
    pageCoverage: {
      totalKnownPages: 10,
      availablePageIds: ['company-overview'],
      missingPageIds: [
        'consensus',
        'recent-reports',
        'relative-return',
        'opinion',
        'style-analysis',
        'financial-analysis',
        'investment-indicators',
        'shareholding',
        'fnguide-finance',
      ],
      availableCount: 1,
    },
    sourceCoverage: {
      hasCurrentQuote: true,
      hasHolding: true,
      hasPackageResult: false,
      availableReportPages: ['company-overview'],
    },
    reportSignals: {
      consensusAvailable: false,
      opinionAvailable: false,
      recentReportsAvailable: false,
      relativeReturnAvailable: false,
      styleAnalysisAvailable: false,
      recentReportCount: null,
    },
  });

  assert.deepEqual(scored, {
    committee: {
      businessQuality: {
        score: 35,
        profitability: 40,
        valuation: 30,
        ownershipStability: 35,
      },
      marketTiming: {
        score: 28,
        trend: 30,
        consensusMomentum: 15,
        priceLocation: 42,
      },
      positionFit: {
        score: 45,
        avgPriceGap: 31,
        upsideBuffer: 30,
        holdingCompleteness: 90,
      },
    },
    hero: {
      score: 25,
      scoreLabel: 'caution',
      statusText: '경계',
      penalties: [
        'missing-analyst-coverage',
        'missing-recent-reports',
      ],
    },
    sellNow: {
      available: true,
      decisionBand: 'exit-now',
      currentPrice: 61000,
      averagePrice: 70000,
      evaluationPnL: -90000,
      evaluationPnLPct: -12.86,
    },
    portfolioSimulation: {
      available: true,
      beforeScore: 39,
      afterScore: 51,
      delta: 12,
      deltaLabel: 'exit-now:+12',
    },
  });
});
