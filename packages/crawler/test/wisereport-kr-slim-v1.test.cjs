const test = require('node:test');
const assert = require('node:assert/strict');

const FORBIDDEN_KEYS = new Set([
  'source',
  'capture',
  'provenance',
  'quality',
  'stages',
  'requestLog',
  'capturedResponses',
  'bodyTextHead',
  'sourceType',
  'sourceKey',
  'ajaxEvidence',
  'pagination',
  'popupTable',
  'tableId',
  'className',
  'headerRows',
  'rowCount',
]);

function collectForbiddenKeyHits(value, path = '$', hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeyHits(item, `${path}[${index}]`, hits));
    return hits;
  }

  if (!value || typeof value !== 'object') {
    return hits;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      hits.push(`${path}.${key}`);
    }
    collectForbiddenKeyHits(nested, `${path}.${key}`, hits);
  }

  return hits;
}

function createAggregateFixture() {
  return {
    pages: {
      'company-overview': {
        id: 'company-overview',
        source: { requestLog: [{ url: 'https://example.test' }], capturedResponses: [{ id: 1 }] },
        capture: { removedNoise: [] },
        quality: { warnings: [] },
        stages: { crawler_v3: { ok: true } },
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '기업개요',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport기업개요',
          bodyTextHead: 'debug text',
          profile: [
            { key: '홈페이지', value: 'https://www.samsung.com/sec' },
          ],
          recentHistory: {
            tableId: 'recent',
            className: 'gHead',
            headerRows: [['일자', '이벤트']],
            headers: ['일자', '이벤트'],
            rows: [{ 일자: '2025/01/01', 이벤트: '예시' }],
            rowCount: 1,
          },
          salesComposition: {
            tableId: 'cTB206',
            className: 'gHead01 cb all-width',
            headerRows: [['매출유형', '제품명']],
            headers: ['매출유형', '제품명'],
            rows: [{ 매출유형: '기타', 제품명: '메모리 반도체' }],
            rowCount: 1,
            dataAvailability: {
              status: 'source-empty',
              note: 'The salesComposition value cells were empty in the upstream source.',
            },
          },
        },
      },
      consensus: {
        id: 'consensus',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '컨센서스',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport컨센서스',
          bodyTextHead: 'debug text',
          consensusSummary: {
            tableId: 'summary',
            className: 'gHead',
            headerRows: [['항목', '값']],
            headers: ['항목', '값'],
            rows: [{ 항목: '목표주가', 값: '100000' }],
            rowCount: 1,
          },
          ajaxEvidence: [{ source: 'network' }],
        },
      },
      'relative-return': {
        id: 'relative-return',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '상대수익률',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide상대수익률',
          bodyTextHead: 'debug text',
          chartJson: {
            CHART: [{ TRD_DT: '2025/01/01', J_PRC: '70000' }],
          },
          popupTable: {
            headers: ['일자', '전일종가'],
            rows: [{ 일자: '2025/01/01', 전일종가: '70000' }],
          },
        },
      },
      'style-analysis': {
        id: 'style-analysis',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '스타일분석',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide스타일분석',
          bodyTextHead: 'debug text',
          factorScores: {
            CHART_H: [{ NM: '성장', VAL: '95' }],
          },
          popupTable: {
            headers: ['요인', '점수'],
            rows: [{ 요인: '성장', 점수: '95' }],
          },
        },
      },
      'fnguide-snapshot': {
        id: 'fnguide-snapshot',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자(A005930) | Snapshot | 기업정보 | Company Guide',
            headerText: '스냅샷',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide스냅샷',
          bodyTextHead: 'debug text',
          marketSnapshot: {
            rows: [
              { key: '수익률(1M/ 3M/ 6M/ 1Y)', value: '+16.48/ +44.36/ +12.72/ +54.42' },
              { key: '외국인 지분율', value: '2.73' },
              { key: '유동주식수/비율(보통주)', value: '8,941,029 / 43.23' },
            ],
          },
          assetManagerHoldings: {
            rows: [
              {
                운용사명: '삼성자산운용',
                보유수량: '248.81',
                시가평가액: '91.06',
                상장주식수내비중: '1.20',
                운용사내비중: '0.01',
              },
              {
                운용사명: '신영자산운용',
                보유수량: '221.11',
                시가평가액: '80.93',
                상장주식수내비중: '1.07',
                운용사내비중: '0.11',
              },
            ],
          },
          snapshotMajorShareholders: {
            rows: [
              { 항목: 'SNT홀딩스(외 1인)', 보통주: '10,820,079', 지분율: '52.32', 최종변동일: '2026/04/06' },
              { 항목: '국민연금공단', 보통주: '1,071,914', 지분율: '5.18', 최종변동일: '2026/03/30' },
            ],
          },
          shareholderCategories: {
            rows: [
              { 주주구분: '최대주주등 (본인+특별관계자)', 대표주주수: '1', 보통주: '10,820,079', 지분율: '52.32', 최종변동일: '2026/04/06' },
              { 주주구분: '5%이상주주 (본인+특별관계자)', 대표주주수: '1', 보통주: '1,071,914', 지분율: '5.18', 최종변동일: '2026/03/30' },
            ],
          },
        },
      },
      'fnguide-shareanalysis': {
        id: 'fnguide-shareanalysis',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자(A005930) | 지분분석 | 기업정보 | Company Guide',
            headerText: '지분분석',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide지분분석',
          bodyTextHead: 'debug text',
          shareholderDetailsJson: {
            comp: [
              {
                SHER_GB_1: '30',
                MAJ_SHER_NM: '국민연금공단',
                SHER_NM: '국민연금공단',
                MAJ_REL_NM: '본인',
                COMM_STK_QTY: '1,071,914',
                SHER_RT: '5.18',
                CHG_DT: '2026/03/30',
                COMM_STK_QTY_SUM: '1,071,914',
                SHER_RT_SUM: '5.18',
                MAX_CHG_DT: '2026/03/30',
              },
            ],
          },
          shareholderChangesJson: {
            comp: [
              {
                주주구분: '주요주주',
                대표주주: '국민연금공단',
                변동주주: '국민연금공단',
                변동일: '2026.03.30',
                변동사유: '기타(+)',
                주식종류: '보통주',
                변동전주: '0',
                증감주: '1,071,914',
                변동후주: '1,071,914',
                지분율: '5.18',
              },
            ],
          },
        },
      },
      'fnguide-foreign-ownership-chart': {
        id: 'fnguide-foreign-ownership-chart',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '외국인 지분율, 시가총액 상세보기 : 삼성전자',
            headerText: '외국인 지분율 차트',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide외국인지분율차트',
          bodyTextHead: 'debug text',
          chartJson: {
            CHART: [
              { TRD_DT: '2026/04/23', J_PRC: '54300', MKT_CAP: '11227', FRG_RT: '2.81' },
              { TRD_DT: '2026/04/24', J_PRC: '57600', MKT_CAP: '11912', FRG_RT: '2.73' },
            ],
          },
        },
      },
    },
  };
}

function createAggregateFixtureV11() {
  return {
    pages: {
      ...createAggregateFixture().pages,
      'financial-analysis': {
        id: 'financial-analysis',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '재무분석',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport재무분석',
          bodyTextHead: 'debug text',
          statementTabs: {
            headers: ['연간', '분기'],
            rows: [],
          },
          financialStatements: {
            headers: ['항목', '2025/12 (IFRS연결) 연간컨센서스보기', 'column_10', '2026/03(E)(최근분기) 분기컨센서스닫기'],
            rows: [
              {
                항목: '펼치기 매출액(수익)',
                '2025/12 (IFRS연결) 연간컨센서스보기': '100',
                column_10: '',
                '2026/03(E)(최근분기) 분기컨센서스닫기': '10',
              },
              {
                항목: '펼치기 영업이익',
                '2025/12 (IFRS연결) 연간컨센서스보기': '20',
                '2026/12(E) (IFRS연결) 연간컨센서스닫기': '25',
              },
              {
                항목: '펼치기 당기순이익',
                '2025/12 (IFRS연결) 연간컨센서스보기': '15',
                '2026/12(E) (IFRS연결) 연간컨센서스닫기': '18',
              },
            ],
            rowCount: 1,
          },
        },
      },
      'investment-indicators': {
        id: 'investment-indicators',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '투자지표',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport투자지표',
          bodyTextHead: 'debug text',
          indicatorTabs: {
            headers: ['수익성', '성장성'],
            rows: [],
          },
          metrics: [
            {
              headers: ['항목', '2025/12 (IFRS연결) 연간컨센서스보기', 'column_10'],
              rows: [
                {
                  항목: '펼치기매출총이익률',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '1.2',
                  column_10: '',
                },
                {
                  항목: '펼치기영업이익률',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '20.0',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '25.0',
                },
                {
                  항목: '펼치기순이익률',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '15.0',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '18.0',
                },
                {
                  항목: '펼치기ROE',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '11.0',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '12.0',
                },
                {
                  항목: '펼치기PER',
                  '2025/12 (IFRS연결) 연간컨센서스보기': '9.0',
                  '2026/12(E) (IFRS연결) 연간컨센서스닫기': '10.0',
                },
              ],
              rowCount: 1,
            },
          ],
        },
      },
      'shareholding': {
        id: 'shareholding',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '지분현황',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport지분현황',
          bodyTextHead: 'debug text',
          ownershipTabs: {
            headers: ['최대주주', '10%이상주주'],
            rows: [],
          },
          ownershipSummary: {
            headers: ['구분', '지분율'],
            rows: [{
              '최대주주(보유지분)': '10,820,079주 (52.32%)',
              '5%이상주주(보유지분)': '1,071,914주 (5.18%)',
              '유동주식(유동주식수)': '8,941,029주',
              '유동주식(유동주식비율)': '43.23%',
            }],
            rowCount: 1,
          },
          majorShareholders: {
            headers: ['대표주주', '보고자', '보유주식수', '보유지분 (%)'],
            rows: [{
              대표주주: '삼성생명',
              보고자: '삼성생명',
              보유주식수: '500,000',
              '보유지분 (%)': '8.50',
            }],
          },
          shareholderChanges: {
            headers: ['거래일', '주주명', '변동후 보유지분율(%)'],
            rows: [{
              거래일: '26/03/30',
              주주명: '국민연금공단',
              '변동후 보유지분율(%)': '5.18',
              '변동후 보유주식수': '1,071,914',
              '지분 변동율(%)': '5.18',
            }],
          },
        },
      },
      consensus: {
        id: 'consensus',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '컨센서스',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport컨센서스',
          bodyTextHead: 'debug text',
          annualOrQuarterly: {
            headers: ['연간', '분기'],
            rows: [],
          },
          consensusSummary: {
            tableId: 'summary',
            className: 'gHead',
            headerRows: [['항목', '값']],
            headers: ['항목', '값'],
            rows: [{ 항목: '목표주가', 값: '100000' }],
            rowCount: 1,
          },
          ajaxEvidence: [{ source: 'network' }],
        },
      },
      opinion: {
        id: 'opinion',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '투자의견',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide투자의견',
          bodyTextHead: 'debug text',
          analystOpinions: {
            headers: ['추정기관', '적정주가'],
            rows: [{
              추정기관: 'Consensus',
              적정주가: '100,000',
              '적정주가(직전 적정주가)': '90,000',
              '적정주가(증감율)': '11.11',
              투자의견: '4.00',
            }],
          },
        },
      },
      'recent-reports': {
        id: 'recent-reports',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '최근리포트',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport최근리포트',
          bodyTextHead: 'debug text',
          recentReports: {
            rows: [{ 일자: '26/04/14', 제목: 'fixture report' }],
          },
        },
      },
      'style-analysis': {
        id: 'style-analysis',
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '삼성전자',
            headerText: '스타일분석',
          },
          sourceType: 'fnguide',
          sourceKey: 'fnguide스타일분석',
          bodyTextHead: 'debug text',
          factorScores: {
            CHART_H: [
              { ID: 'VAL1', NAME: '삼성전자' },
              { ID: 'VAL2', NAME: '반도체(업종)' },
            ],
            CHART_D: [{ NM: '베타', VAL1: '0.50', VAL2: '0.40' }],
          },
        },
      },
    },
  };
}

function createEtfAggregateFixtureV11() {
  const fixture = JSON.parse(JSON.stringify(createAggregateFixtureV11()));
  for (const page of Object.values(fixture.pages)) {
    if (page?.normalized?.company) {
      page.normalized.company.name = 'KODEX 200 ETF';
      page.normalized.company.title = 'KODEX 200 ETF';
    }
  }
  return fixture;
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('buildWiseReportKrSlimPayload keeps only slim business fields', async () => {
  const { buildWiseReportKrSlimPayload } = await import('../src/server.js');
  const slim = buildWiseReportKrSlimPayload(createAggregateFixture(), '005930');

  assert.equal(slim.code, '005930');
  assert.deepEqual(slim.company, { code: '005930', name: '삼성전자' });
  assert.deepEqual(Object.keys(slim.pages), [
    'company-overview',
    'financial-analysis',
    'investment-indicators',
    'consensus',
    'shareholding',
    'recent-reports',
    'fnguide-finance',
    'relative-return',
    'opinion',
    'style-analysis',
  ]);

  assert.deepEqual(slim.pages['company-overview'], {
    profile: [
      { key: '홈페이지', value: 'https://www.samsung.com/sec' },
    ],
    recentHistory: {
      rows: [{ 일자: '2025/01/01', 이벤트: '예시' }],
    },
    salesComposition: {
      status: 'source-empty',
      note: 'The salesComposition value cells were empty in the upstream source.',
      rows: [{ 매출유형: '기타', 제품명: '메모리 반도체' }],
    },
  });

  assert.deepEqual(slim.pages.consensus, {
    consensusSummary: {
      rows: [{ 항목: '목표주가', 값: '100000' }],
    },
  });
  assert.deepEqual(slim.pages['relative-return'], {
    chartJson: {
      CHART: [{ TRD_DT: '2025/01/01', J_PRC: '70000' }],
    },
  });
  assert.deepEqual(slim.pages['style-analysis'], {
    factorScores: {
      CHART_H: [{ NM: '성장', VAL: '95' }],
    },
  });
  assert.equal(slim.pages['financial-analysis'], null);

  assert.deepEqual(collectForbiddenKeyHits(slim), []);
});

test('GET explicit-source KR slim v1 path is disabled after archive', async () => {
  const { app, endpointDefinitions, archivedEndpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((entry) => entry.id === 'wisereport-kr-slim-v1');
  const archivedDefinition = archivedEndpointDefinitions.find((entry) => entry.id === 'wisereport-kr-slim-v1');

  assert.equal(definition, undefined);
  assert.ok(archivedDefinition);

  const responseBody = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/source/wisereport-fnguide/kr/companies/005930/slim/v1`);
    assert.equal(response.status, 404);
    return response.json();
  });

  assert.equal(responseBody.ok, false);
  assert.equal(responseBody.error.message, 'not found');
});

test('buildWiseReportKrSlimPayloadV11 removes parser artifacts but preserves genuine source-empty annotations', async () => {
  const { buildWiseReportKrSlimPayloadV11 } = await import('../src/server.js');
  const slim = buildWiseReportKrSlimPayloadV11(createAggregateFixtureV11(), '005930');

  assert.equal(slim.code, '005930');
  assert.deepEqual(slim.company, { code: '005930', name: '삼성전자' });

  assert.deepEqual(Object.keys(slim.pages['financial-analysis']), ['financialStatements']);
  assert.deepEqual(Object.keys(slim.pages['investment-indicators']), ['metrics']);
  assert.deepEqual(Object.keys(slim.pages.consensus), ['consensusSummary']);
  assert.deepEqual(Object.keys(slim.pages.shareholding), ['ownershipSummary', 'majorShareholders', 'shareholderChanges']);

  const financialRow = slim.pages['financial-analysis'].financialStatements.rows[0];
  assert.equal(financialRow.항목, '매출액(수익)');
  assert.equal(financialRow['2025/12 (IFRS연결) 연간컨센서스'], '100');
  assert.equal(financialRow['2026/03(E)(최근분기) 분기컨센서스'], '10');
  assert.equal(Object.hasOwn(financialRow, 'column_10'), false);

  const metricRow = slim.pages['investment-indicators'].metrics[0].rows[0];
  assert.equal(metricRow.항목, '매출총이익률');
  assert.equal(metricRow['2025/12 (IFRS연결) 연간컨센서스'], '1.2');
  assert.equal(Object.hasOwn(metricRow, 'column_10'), false);

  assert.deepEqual(slim.pages['company-overview'].salesComposition, {
    status: 'source-empty',
    note: 'The salesComposition value cells were empty in the upstream source.',
    rows: [{ 매출유형: '기타', 제품명: '메모리 반도체' }],
  });

  assert.deepEqual(collectForbiddenKeyHits(slim), []);
});

test('buildWiseReportKrSlimPayloadV12 adds DeepScan krFacts with explicit investor-flow missing semantics', async () => {
  const { buildWiseReportKrSlimPayloadV12 } = await import('../src/server.js');
  const slim = buildWiseReportKrSlimPayloadV12(createAggregateFixtureV11(), '005930');

  assert.equal(slim.schemaVersion, 'wisereport-kr-slim-v1.2');
  assert.equal(slim.market, 'KR');
  assert.equal(slim.company.instrumentKind, 'stock');
  assert.equal(slim.sourceCoverage.pageCoverage.totalKnownPages, 13);
  assert.equal(slim.sourceCoverage.pageCoverage.availableCount, 12);
  assert.deepEqual(slim.sourceCoverage.pageCoverage.missingPageIds, ['fnguide-finance']);
  assert.equal(slim.krFacts.consensus.targetPrice.value, 100000);
  assert.equal(slim.krFacts.consensus.previousTargetPrice.value, 90000);
  assert.equal(slim.krFacts.consensus.targetRevisionPct.value, 11.11);
  assert.equal(slim.krFacts.profitability.operatingMarginLatest.value, 25);
  assert.equal(slim.krFacts.profitability.netMarginLatest.value, 18);
  assert.equal(slim.krFacts.valuation.per.value, 10);
  assert.equal(slim.krFacts.ownership.majorHolderPct.value, 52.32);
  assert.equal(slim.krFacts.ownership.freeFloatPct.value, 43.23);
  assert.equal(slim.krFacts.ownership.knownInstitutionalMajorHolders.value[0].name, '국민연금공단');

  assert.equal(slim.pages['fnguide-snapshot'].marketSnapshot.rows[1].key, '외국인 지분율');
  assert.equal(slim.krFacts.investorFlow.foreignOwnershipPct.value, 2.73);
  assert.equal(slim.krFacts.investorFlow.foreignOwnershipPct.availability, 'present');
  assert.equal(slim.krFacts.investorFlow.foreignOwnershipPct.source.pageId, 'fnguide-foreign-ownership-chart');
  assert.equal(slim.krFacts.investorFlow.foreignOwnershipPct.asOf, '2026-04-24');
  assert.equal(slim.krFacts.investorFlow.foreignOwnershipHistory.value.length, 2);
  assert.equal(slim.krFacts.investorFlow.assetManagerOwnershipPctSum.availability, 'partial');
  assert.equal(slim.krFacts.investorFlow.assetManagerOwnershipPctSum.value, 2.27);
  assert.equal(slim.krFacts.investorFlow.institutionalOwnershipPct.availability, 'missing');
  assert.match(slim.krFacts.investorFlow.institutionalOwnershipPct.message, /aggregate로 대체하지 않습니다/);
  assert.equal(slim.krFacts.investorFlow.foreignNetBuy.availability, 'missing');
  assert.equal(slim.krFacts.investorFlow.foreignNetBuy.reasonCode, 'investor_net_buy_not_provided_by_wisereport_fnguide');
  assert.equal(slim.krFacts.styleFactors.factors.value[0].name, '베타');
});

test('buildWiseReportKrSlimPayloadV12 marks ETF corporate financial facts as not_applicable', async () => {
  const { buildWiseReportKrSlimPayloadV12 } = await import('../src/server.js');
  const slim = buildWiseReportKrSlimPayloadV12(createEtfAggregateFixtureV11(), '069500');

  assert.equal(slim.company.name, 'KODEX 200 ETF');
  assert.equal(slim.company.instrumentKind, 'etf');
  assert.equal(slim.krFacts.profitability.revenueLatest.availability, 'not_applicable');
  assert.equal(slim.krFacts.profitability.revenueLatest.reasonCode, 'corporate_financials_not_applicable');
  assert.equal(slim.krFacts.valuation.per.availability, 'not_applicable');
  assert.ok(slim.krFacts.sourceLimitations.some((limitation) => limitation.factPath === 'profitability.*'));
});

test('GET explicit-source KR slim v1.1 path returns raw json without envelope', async () => {
  const { app, endpointDefinitions, buildWiseReportKrSlimPayloadV11 } = await import('../src/server.js');
  const fixture = buildWiseReportKrSlimPayloadV11(createAggregateFixtureV11(), '005930');
  const definition = endpointDefinitions.find((entry) => entry.id === 'wisereport-kr-slim-v1.1');

  assert.ok(definition, 'slim v1.1 endpoint definition should exist');

  const originalHandler = definition.handler;
  definition.handler = async () => fixture;

  try {
    const responseBody = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.1`);
      assert.equal(response.status, 200);
      return response.json();
    });

    assert.deepEqual(responseBody, fixture);
    assert.equal(Object.hasOwn(responseBody, 'ok'), false);
    assert.equal(Object.hasOwn(responseBody, 'data'), false);
    assert.equal(Object.hasOwn(responseBody, 'meta'), false);
  } finally {
    definition.handler = originalHandler;
  }
});

test('GET explicit-source KR slim v1.2 path returns raw json without envelope', async () => {
  const { app, endpointDefinitions, buildWiseReportKrSlimPayloadV12 } = await import('../src/server.js');
  const fixture = buildWiseReportKrSlimPayloadV12(createAggregateFixtureV11(), '005930');
  const definition = endpointDefinitions.find((entry) => entry.id === 'wisereport-kr-slim-v1.2');

  assert.ok(definition, 'slim v1.2 endpoint definition should exist');

  const originalHandler = definition.handler;
  definition.handler = async () => fixture;

  try {
    const responseBody = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.2`);
      assert.equal(response.status, 200);
      return response.json();
    });

    assert.deepEqual(responseBody, fixture);
    assert.equal(responseBody.schemaVersion, 'wisereport-kr-slim-v1.2');
    assert.equal(Object.hasOwn(responseBody, 'ok'), false);
    assert.equal(Object.hasOwn(responseBody, 'data'), false);
    assert.equal(Object.hasOwn(responseBody, 'meta'), false);
  } finally {
    definition.handler = originalHandler;
  }
});

test('GET old source KR slim v1.1 path returns not found after major-path migration', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/source/wisereport-fnguide/kr/companies/005930/slim/v1.1`);
    assert.equal(response.status, 404);
    return response.json();
  });

  assert.equal(body.ok, false);
  assert.equal(body.error.message, 'not found');
});
