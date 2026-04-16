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
            rows: [{ 구분: '최대주주', 지분율: '20.0' }],
            rowCount: 1,
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
    },
  };
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

test('GET explicit-source KR slim v1 path returns raw json without envelope', async () => {
  const { app, endpointDefinitions, buildWiseReportKrSlimPayload } = await import('../src/server.js');
  const fixture = buildWiseReportKrSlimPayload(createAggregateFixture(), '005930');
  const definition = endpointDefinitions.find((entry) => entry.id === 'wisereport-kr-slim-v1');

  assert.ok(definition, 'slim endpoint definition should exist');

  const originalHandler = definition.handler;
  definition.handler = async () => fixture;

  try {
    const responseBody = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/source/wisereport-fnguide/kr/companies/005930/slim/v1`);
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

test('buildWiseReportKrSlimPayloadV11 removes parser artifacts but preserves genuine source-empty annotations', async () => {
  const { buildWiseReportKrSlimPayloadV11 } = await import('../src/server.js');
  const slim = buildWiseReportKrSlimPayloadV11(createAggregateFixtureV11(), '005930');

  assert.equal(slim.code, '005930');
  assert.deepEqual(slim.company, { code: '005930', name: '삼성전자' });

  assert.deepEqual(Object.keys(slim.pages['financial-analysis']), ['financialStatements']);
  assert.deepEqual(Object.keys(slim.pages['investment-indicators']), ['metrics']);
  assert.deepEqual(Object.keys(slim.pages.consensus), ['consensusSummary']);
  assert.deepEqual(Object.keys(slim.pages.shareholding), ['ownershipSummary']);

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

test('GET explicit-source KR slim v1.1 path returns raw json without envelope', async () => {
  const { app, endpointDefinitions, buildWiseReportKrSlimPayloadV11 } = await import('../src/server.js');
  const fixture = buildWiseReportKrSlimPayloadV11(createAggregateFixtureV11(), '005930');
  const definition = endpointDefinitions.find((entry) => entry.id === 'wisereport-kr-slim-v1.1');

  assert.ok(definition, 'slim v1.1 endpoint definition should exist');

  const originalHandler = definition.handler;
  definition.handler = async () => fixture;

  try {
    const responseBody = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/source/wisereport-fnguide/kr/companies/005930/slim/v1.1`);
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
