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
    recent30dReportCount: null,
  });
  assert.deepEqual(packet.consensusSnapshot, {
    targetPrice: 100000,
    previousTargetPrice: null,
    targetGapPct: ((100000 - 85200) / 85200) * 100,
    recommendation: 'BUY',
    recommendationScore: null,
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
    recent30dReportCount: null,
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

test('buildDeepScanKrEvidencePacket promotes KR WiseReport raw facts into structured snapshots instead of losing them behind global-shaped fields', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '100840',
        name: 'SNT에너지',
        market: 'KR',
      },
      holding: {
        shares: '32',
        averagePrice: '49,256.7334',
      },
      selectedAt: '2026-04-27T00:00:00.000Z',
    },
    {
      quotes: {
        items: [{
          market: 'KR',
          code: '100840',
          price: 57100,
          currency: 'KRW',
          asOf: '2026-04-27',
          source: 'krx',
          status: 'ok',
        }],
      },
      slim: {
        code: '100840',
        company: {
          code: '100840',
          name: 'SNT에너지',
        },
        pages: {
          opinion: {
            analystOpinions: {
              rows: [{
                추정기관: 'Consensus',
                적정주가: '66,000',
                '적정주가(직전 적정주가)': '60,000',
                '적정주가(증감율)': '10.00',
                투자의견: '4.00',
              }],
            },
          },
          'financial-analysis': {
            financialStatements: {
              rows: [
                {
                  항목: '펼치기 매출액(수익)',
                  '2024/12 (IFRS연결)': '2,942.6',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '6,061.2',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '6,318.0',
                },
                {
                  항목: '펼치기 영업이익',
                  '2024/12 (IFRS연결)': '222.4',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '1,113.1',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '1,247.8',
                },
                {
                  항목: '펼치기 당기순이익',
                  '2024/12 (IFRS연결)': '346.4',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '843.7',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '1,006.5',
                },
              ],
            },
          },
          'investment-indicators': {
            metrics: {
              0: {
                rows: [
                  {
                    항목: '펼치기영업이익률',
                    '2025/12 (IFRS연결) 연간컨센서스보기': '18.37',
                    '2026/12(E) (IFRS연결) 연간컨센서스닫기': '19.75',
                  },
                  {
                    항목: '펼치기순이익률',
                    '2025/12 (IFRS연결) 연간컨센서스보기': '13.92',
                    '2026/12(E) (IFRS연결) 연간컨센서스닫기': '15.93',
                  },
                  {
                    항목: '펼치기ROE',
                    '2025/12 (IFRS연결) 연간컨센서스보기': '25.15',
                    '2026/12(E) (IFRS연결) 연간컨센서스닫기': '24.85',
                  },
                  {
                    항목: '펼치기PER',
                    '2025/12 (IFRS연결) 연간컨센서스보기': '8.97',
                    '2026/12(E) (IFRS연결) 연간컨센서스닫기': '11.84',
                  },
                  {
                    항목: '펼치기PBR',
                    '2025/12 (IFRS연결) 연간컨센서스보기': '1.98',
                    '2026/12(E) (IFRS연결) 연간컨센서스닫기': '2.56',
                  },
                  {
                    항목: '펼치기EV/EBITDA',
                    '2025/12 (IFRS연결) 연간컨센서스보기': '5.51',
                    '2026/12(E) (IFRS연결) 연간컨센서스닫기': '8.10',
                  },
                ],
              },
            },
          },
          shareholding: {
            ownershipSummary: {
              rows: [{
                '최대주주(보유지분)': '10,820,079주 (52.32%)',
                '5%이상주주(보유지분)': '1,071,914주 (5.18%)',
                '유동주식(유동주식수)': '8,941,029주',
                '유동주식(유동주식비율)': '43.23%',
              }],
            },
            majorShareholders: {
              rows: [{
                대표주주: 'SNT홀딩스',
                보고자: 'SNT홀딩스',
                보유주식수: '9,920,079',
                '보유지분 (%)': '47.97',
                최종거래일: '26/04/06',
                변동주식수: '-96,829',
                '변동지분 (%)': '-0.47',
                변동사유: '교환(-)',
              }],
            },
            shareholderChanges: {
              rows: [{
                거래일: '26/03/30',
                주주명: '국민연금공단',
                '지분 변동율(%)': '5.18',
                '변동후 보유지분율(%)': '5.18',
                '변동후 보유주식수': '1,071,914',
                변동사유: '기타(+)',
              }],
            },
          },
          'style-analysis': {
            factorScores: {
              CHART_H: [
                { ID: 'VAL1', NAME: 'SNT에너지' },
                { ID: 'VAL2', NAME: '에너지(업종)' },
              ],
              CHART_D: [
                { NM: '베타', VAL1: '-0.23', VAL2: '-0.89' },
                { NM: '배당성', VAL1: '0.82', VAL2: '-0.37' },
                { NM: '기업규모', VAL1: '-2.31', VAL2: '-2.20' },
              ],
            },
          },
          'recent-reports': {
            recentReports: {
              rows: [
                { 일자: '26/04/14', 제목: '상반기 흐린 뒤 하반기 맑음' },
                { 일자: '26/04/06', 제목: '미국 수주 확대로 밸류에이션 리레이팅 될 듯' },
                { 일자: '26/04/03', 제목: '흐린 뒤 맑음' },
                { 일자: '26/04/02', 제목: '견조한 업황 대비 매력적인 밸류에이션' },
                { 일자: '26/03/20', 제목: 'LNG 생산자, LNG 발전사 모두가 수요처' },
              ],
            },
          },
        },
      },
    },
  );

  assert.equal(packet.consensusSnapshot.targetPrice, 66000);
  assert.equal(packet.consensusSnapshot.previousTargetPrice, 60000);
  assert.equal(packet.consensusSnapshot.revisionPct, 10);
  assert.equal(packet.consensusSnapshot.revisionDirection, 'up');
  assert.equal(Math.round(packet.consensusSnapshot.targetGapPct * 100) / 100, 15.59);
  assert.equal(packet.financialSnapshot.revenueLatest, 6318);
  assert.equal(packet.financialSnapshot.revenuePrev, 6061.2);
  assert.equal(Math.round(packet.financialSnapshot.revenueYoY * 100) / 100, 4.24);
  assert.equal(packet.financialSnapshot.operatingMarginLatest, 19.75);
  assert.equal(packet.financialSnapshot.netMarginLatest, 15.93);
  assert.deepEqual(packet.valuationSnapshot, {
    per: 11.84,
    pbr: 2.56,
    roe: 24.85,
    evEbitda: 8.1,
  });
  assert.equal(packet.ownershipSnapshot.majorHolderPct, 52.32);
  assert.equal(packet.ownershipSnapshot.majorHolderShares, 10820079);
  assert.equal(packet.ownershipSnapshot.freeFloatPct, 43.23);
  assert.equal(packet.ownershipSnapshot.freeFloatShares, 8941029);
  assert.equal(packet.ownershipSnapshot.foreignOwnershipPct, null);
  assert.equal(packet.ownershipSnapshot.institutionalOwnershipPct, null);
  assert.deepEqual(packet.ownershipSnapshot.knownInstitutionalMajorHolders[0], {
    name: '국민연금공단',
    pct: 5.18,
    shares: 1071914,
    lastTradeDate: '2026-03-30',
    changePct: 5.18,
    changeReason: '기타(+)',
  });
  assert.deepEqual(packet.styleAnalysisSnapshot.factorScores[0], {
    name: '베타',
    value: -0.23,
    peerValue: -0.89,
  });
  assert.equal(packet.styleAnalysisSnapshot.factorScores.length, 3);
  assert.equal(packet.reportSignals.recentReportCount, 5);
  assert.equal(packet.reportSignals.recent30dReportCount, 4);
  assert.equal(packet.sourceLimitations.some((limitation) => limitation.fact === 'foreignOwnershipPct'), true);
  assert.equal(packet.sourceLimitations.some((limitation) => limitation.fact === 'institutionalOwnershipPct'), true);
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
    recent30dReportCount: null,
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
