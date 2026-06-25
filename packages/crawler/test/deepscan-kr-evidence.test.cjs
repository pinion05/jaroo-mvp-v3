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
            volume: 1234567,
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
    volume: 1234567,
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
    'company-status',
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
    consensusSourceStatus: 'loaded',
    recentReportsAvailable: true,
    relativeReturnAvailable: true,
    styleAnalysisAvailable: true,
    performanceCommentAvailable: false,
    recentReportCount: 2,
    recent30dReportCount: null,
    performanceCommentAsOf: null,
  });
  assert.deepEqual(packet.consensusSnapshot, {
    targetPrice: 100000,
    targetPriceStatus: 'present',
    previousTargetPrice: null,
    targetGapPct: ((100000 - 85200) / 85200) * 100,
    recommendation: 'BUY',
    recommendationStatus: 'present',
    recommendationScore: null,
    recommendationCounts: null,
    analystCount: null,
    highestTargetPrice: null,
    lowestTargetPrice: null,
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
    'KR 리포트 페이지 6/11 확보',
  ]);
  assert.deepEqual(packet.topRisks, ['미확보 KR 페이지 5건']);
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
  assert.equal(packet.pageCoverage.totalKnownPages, 11);
  assert.equal(packet.pageCoverage.availablePageIds.length, 0);
  assert.equal(packet.pageCoverage.missingPageIds.length, 11);
  assert.deepEqual(packet.sourceCoverage, {
    hasCurrentQuote: true,
    hasHolding: true,
    hasPackageResult: false,
    availableReportPages: [],
  });
  assert.deepEqual(packet.reportSignals, {
    consensusAvailable: false,
    opinionAvailable: false,
    consensusSourceStatus: 'unavailable',
    recentReportsAvailable: false,
    relativeReturnAvailable: false,
    styleAnalysisAvailable: false,
    performanceCommentAvailable: false,
    recentReportCount: null,
    recent30dReportCount: null,
    performanceCommentAsOf: null,
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

test('buildDeepScanKrEvidencePacket promotes OpenDART disclosures into structured analysis facts and risks', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '005930',
        name: '삼성전자',
        market: 'KR',
      },
      holding: {
        shares: '12',
        averagePrice: '71000',
      },
    },
    {
      quotes: {
        items: [{
          market: 'KR',
          code: '005930',
          price: 85200,
          currency: 'KRW',
          asOf: '2026-06-12',
          source: 'fixture',
          status: 'ok',
        }],
      },
      disclosures: {
        source: 'opendart',
        requested: { from: '20260512', to: '20260612' },
        summary: { totalCount: 4, latestReceiptDate: '20260608' },
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
            rceptNo: '20260605000586',
            reportName: '[기재정정]임원ㆍ주요주주특정증권등소유상황보고서',
            receiptDate: '20260605',
            disclosureType: 'D',
            disclosureTypeLabel: '지분공시',
            filerName: '윤장현',
          },
          {
            rceptNo: '20260604000077',
            reportName: '주요사항보고서(유상증자결정)',
            receiptDate: '20260604',
            disclosureType: 'B',
            disclosureTypeLabel: '주요사항보고',
            filerName: '삼성전자',
          },
          {
            rceptNo: '20260603000077',
            reportName: '소송등의제기ㆍ신청',
            receiptDate: '20260603',
            disclosureType: 'B',
            disclosureTypeLabel: '주요사항보고',
            filerName: '삼성전자',
          },
        ],
      },
    },
  );

  assert.equal(packet.disclosureAnalysis.available, true);
  assert.equal(packet.disclosureAnalysis.totalCount, 4);
  assert.equal(packet.disclosureAnalysis.latestReceiptDate, '2026-06-08');
  assert.equal(packet.disclosureAnalysis.periodFrom, '2026-05-12');
  assert.equal(packet.disclosureAnalysis.periodTo, '2026-06-12');
  assert.equal(packet.disclosureAnalysis.ownershipCount, 2);
  assert.equal(packet.disclosureAnalysis.correctionCount, 1);
  assert.equal(packet.disclosureAnalysis.dilutionCount, 1);
  assert.equal(packet.disclosureAnalysis.riskCount, 1);
  assert.equal(packet.disclosureAnalysis.latestFilings[0].riskLabel, '지분 변동');
  assert.deepEqual(packet.sourceCoverage, {
    hasCurrentQuote: true,
    hasHolding: true,
    hasPackageResult: false,
    hasDisclosures: true,
    availableReportPages: [],
  });
  assert.equal(packet.reportSignals.disclosureAvailable, true);
  assert.equal(packet.reportSignals.disclosureCount, 4);
  assert.equal(packet.reportSignals.disclosureRiskCount, 1);
  assert.deepEqual(packet.topFacts, [
    '현재가 85200 KRW 확인',
    '보유 12주 / 평단 71000 확인',
    '최근 OpenDART 공시 4건 / 주요 리스크 1건 확인',
  ]);
  assert.deepEqual(packet.topRisks, [
    '주의 공시 1건: 소송등의제기ㆍ신청',
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

test('buildDeepScanKrEvidencePacket treats WiseReport/FnGuide no-data target rows as source-provided missing values, not present recommendations', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '042700',
        name: '한미반도체',
        market: 'KR',
      },
    },
    {
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
              rows: [{
                일자: '데이타가 존재하지 않습니다.',
                목표주가: '데이타가 존재하지 않습니다.',
                투자의견: '데이타가 존재하지 않습니다.',
              }],
            },
          },
          'recent-reports': {
            recentReports: {
              rows: [{ 일자: '26/01/27', 투자의견: 'BUY', 목표주가: '230,000' }],
            },
          },
        },
      },
    },
  );

  assert.equal(packet.reportSignals.consensusSourceStatus, 'loaded');
  assert.equal(packet.reportSignals.consensusAvailable, false);
  assert.equal(packet.reportSignals.opinionAvailable, false);
  assert.equal(packet.consensusSnapshot.targetPrice, null);
  assert.equal(packet.consensusSnapshot.targetPriceStatus, 'not_provided');
  assert.equal(packet.consensusSnapshot.recommendation, null);
  assert.equal(packet.consensusSnapshot.recommendationScore, null);
  assert.equal(packet.consensusSnapshot.recommendationStatus, 'not_provided');
  assert.equal(packet.reportSignals.recentReportCount, 1);
});

test('buildDeepScanKrEvidencePacket uses v1.2 FnGuide ownership pages when present', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '100840',
        name: 'SNT에너지',
      },
    },
    {
      slim: {
        schemaVersion: 'wisereport-kr-slim-v1.2',
        code: '100840',
        pages: {
          shareholding: {
            ownershipSummary: {
              rows: [
                { 항목: '최대주주 보유지분', 보유지분: '52.32%' },
              ],
            },
          },
          'fnguide-snapshot': {
            marketSnapshot: {
              rows: [
                { key: '외국인 지분율', value: '2.70' },
              ],
            },
            assetManagerHoldings: {
              rows: [
                { 운용사명: '삼성자산운용', 상장주식수내비중: '1.20' },
                { 운용사명: '신영자산운용', 상장주식수내비중: '1.07' },
              ],
            },
          },
          'fnguide-shareanalysis': {
            shareholderDetailsJson: {
              comp: [
                {
                  MAJ_SHER_NM: '국민연금공단',
                  SHER_NM: '국민연금공단',
                  COMM_STK_QTY: '1,071,914',
                  SHER_RT: '5.18',
                },
              ],
            },
          },
          'fnguide-foreign-ownership-chart': {
            chartJson: {
              CHART: [
                { TRD_DT: '2026/04/23', FRG_RT: '2.81' },
                { TRD_DT: '2026/04/24', FRG_RT: '2.73' },
              ],
            },
          },
        },
      },
    },
  );

  assert.equal(packet.pageCoverage.totalKnownPages, 14);
  assert.equal(packet.pageCoverage.availableCount, 4);
  assert.equal(packet.ownershipSnapshot.foreignOwnershipPct, 2.73);
  assert.equal(packet.ownershipSnapshot.foreignOwnershipAsOf, '2026-04-24');
  assert.equal(packet.ownershipSnapshot.foreignOwnershipHistory.length, 2);
  assert.equal(packet.ownershipSnapshot.assetManagerOwnershipPctSum, 2.27);
  assert.equal(packet.sourceLimitations.some((limitation) => limitation.fact === 'foreignOwnershipPct'), false);
  assert.equal(packet.sourceLimitations.some((limitation) => limitation.fact === 'institutionalOwnershipPct'), true);
  assert.deepEqual(packet.topFacts, [
    'KR 리포트 페이지 4/14 확보',
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
  assert.equal(packet.pageCoverage.missingPageIds.length, 10);
  assert.deepEqual(packet.sourceCoverage, {
    hasCurrentQuote: false,
    hasHolding: false,
    hasPackageResult: false,
    availableReportPages: ['recent-reports'],
  });
  assert.deepEqual(packet.reportSignals, {
    consensusAvailable: false,
    opinionAvailable: false,
    consensusSourceStatus: 'loaded',
    recentReportsAvailable: true,
    relativeReturnAvailable: false,
    styleAnalysisAvailable: false,
    performanceCommentAvailable: false,
    recentReportCount: 1,
    recent30dReportCount: null,
    performanceCommentAsOf: null,
  });
  assert.deepEqual(packet.missingSources, ['current-quote', 'holding']);
  assert.deepEqual(packet.topFacts, [
    'KR 리포트 페이지 1/11 확보',
    '최근 리포트 1건 확인',
  ]);
  assert.deepEqual(packet.topRisks, [
    '현재가 근거 없음',
    'KR 보유 맥락 없음',
    '미확보 KR 페이지 10건',
  ]);
});

test('buildDeepScanKrEvidencePacket counts reached KR pages even when recent report rows are empty', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket(
    {
      instrument: {
        code: '100840',
        name: 'SNT에너지',
      },
    },
    {
      slim: {
        schemaVersion: 'wisereport-kr-slim-v1.2',
        code: '100840',
        pages: {
          'recent-reports': {
            recentReports: {
              rows: [],
            },
            ajaxEvidence: [],
          },
        },
      },
    },
  );

  assert.equal(packet.pageCoverage.totalKnownPages, 14);
  assert.deepEqual(packet.pageCoverage.availablePageIds, ['recent-reports']);
  assert.equal(packet.pageCoverage.availableCount, 1);
  assert.equal(packet.pageCoverage.missingPageIds.includes('recent-reports'), false);
  assert.equal(packet.reportSignals.recentReportsAvailable, false);
  assert.equal(packet.reportSignals.recentReportCount, 0);
  assert.deepEqual(packet.topFacts, ['KR 리포트 페이지 1/14 확보']);
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

test('buildDeepScanKrEvidencePacket promotes ETF constituent snapshot into facts and source coverage', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket({
    instrument: {
      code: '226490',
      name: 'KODEX 코스피',
      market: 'ETF',
      kind: 'etf',
    },
    holding: {
      shares: '35',
      averagePrice: '58828.75',
    },
  }, {
    quotes: {
      items: [{ code: '226490', price: 84235, currency: 'KRW', asOf: '2026-06-05', source: 'wisereport-etf', status: 'ok' }],
    },
    etfSnapshot: {
      code: '226490',
      asOf: '2026-06-05',
      product: {
        baseIndexName: '코스피지수',
        issuerName: '삼성자산운용(주)',
        totalFeePct: '0.150',
      },
      marketStatus: {
        closePrice: '84,235',
        returns: { oneMonthPct: '18.52' },
        avgTradingVolume20: '596,968',
      },
      constituents: {
        asOf: '2026-06-05',
        top10WeightPct: '57.12',
        top10: [
          { rank: 1, name: '삼성전자', shares: '3,778', weightPct: '29.60' },
          { rank: 2, name: 'SK하이닉스', shares: 461, weightPct: 22.72 },
        ],
        rows: [
          { rank: 1, name: '삼성전자', shares: '3,778', weightPct: '29.60' },
          { rank: 2, name: 'SK하이닉스', shares: 461, weightPct: 22.72 },
        ],
      },
      liquidity: { avgTradingVolume: '450' },
    },
  });

  assert.equal(packet.instrument.market, 'ETF');
  assert.equal(packet.instrument.kind, 'etf');
  assert.equal(packet.sourceCoverage.hasEtfSnapshot, true);
  assert.equal(packet.etfProductSnapshot.product.baseIndexName, '코스피지수');
  assert.equal(packet.etfProductSnapshot.product.totalFeePct, 0.15);
  assert.equal(packet.etfProductSnapshot.constituents.top10[0].name, '삼성전자');
  assert.equal(packet.etfProductSnapshot.constituents.top10WeightPct, 57.12);
  assert.deepEqual(packet.missingSources, ['slim']);
  assert.deepEqual(packet.topFacts, [
    '현재가 84235 KRW 확인',
    '보유 35주 / 평단 58828.75 확인',
    'ETF 기초지수 코스피지수 / 상위 구성 삼성전자·SK하이닉스 확인',
  ]);
  assert.deepEqual(packet.topRisks, ['KR 리포트 페이지 근거 없음']);
});

test('buildDeepScanKrEvidencePacket preserves ETF kind even when market is generic KR', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket({
    instrument: {
      code: '226490',
      name: 'KODEX 코스피',
      market: 'KR',
      kind: 'etf',
    },
  }, {
    etfSnapshot: {
      product: { baseIndexName: '코스피지수' },
      marketStatus: { closePrice: '77,540' },
      constituents: { top10: [{ name: '삼성전자', weightPct: '29.60' }] },
    },
  });

  assert.equal(packet.instrument.market, 'KR');
  assert.equal(packet.instrument.kind, 'etf');
  assert.equal(packet.sourceCoverage.hasEtfSnapshot, true);
});

test('buildDeepScanKrEvidencePacket uses ETF snapshot close price as a quote fallback when quote crawler is unavailable', async () => {
  const { buildDeepScanKrEvidencePacket } = await import('../src/services/deepscan-kr-evidence.js');

  const packet = buildDeepScanKrEvidencePacket({
    instrument: { code: '226490', name: 'KODEX 코스피', market: 'ETF', kind: 'etf' },
    holding: { shares: '35', averagePrice: '58828.75' },
  }, {
    etfSnapshot: {
      source: 'wisereport-etf',
      asOf: '2026-06-05',
      product: { baseIndexName: '코스피지수' },
      marketStatus: { closePrice: '84,235', tradingVolume: '543,884' },
      constituents: { top10: [{ name: '삼성전자', weightPct: '29.60' }] },
    },
  });

  assert.deepEqual(packet.currentQuote, {
    price: 84235,
    currency: 'KRW',
    volume: 543884,
    asOf: '2026-06-05',
    source: 'wisereport-etf',
    status: 'ok',
  });
  assert.equal(packet.sourceCoverage.hasCurrentQuote, true);
  assert.equal(packet.marketSnapshot.averagePriceGapPct, ((84235 - 58828.75) / 58828.75) * 100);
  assert.equal(packet.missingSources.includes('current-quote'), false);
});
