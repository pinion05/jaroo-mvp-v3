const test = require('node:test');
const assert = require('node:assert/strict');

function createGlobalDomainFixture() {
  return {
    ticker: 'NVDA',
    cmpCode: 'NVDA-US',
    routes: {
      'company-snap': {
        category: 'Company',
        name: 'Snap',
        items: {
          'news-company-1': {
            scope: 'company',
            data: {
              Data: [
                {
                  PUBLISHTIME: '/Date(1775617200000)/',
                  STORYID: 'story-1',
                  TEXT: 'English title',
                  T_TEXT: '한글 제목',
                  BODY: 'drop me',
                  HTMLBODY: '<p>drop me</p>',
                },
              ],
            },
          },
          'news-company-2': {
            scope: 'company',
            data: {
              Data: [
                {
                  PUBLISHTIME: '/Date(1775617200000)/',
                  M_STORYID: 'story-1',
                  TEXT: 'English title',
                  T_TEXT: '한글 제목',
                },
              ],
            },
          },
          'snap-band-1': {
            scope: 'company',
            data: {
              Data1: [
                { TRD_DT: '2025/04/04', ADJ_PRC: 94.31, DATA1: 21.31, DATA2: 15.61, DATA3: 9.91, DATA4: 4.2 },
              ],
              Data2: { P1: 112.1, P2: 82.1, P3: 52.1, P4: 22.1, CURRENCY: 'USD' },
            },
          },
          'snap-band-2': {
            scope: 'company',
            data: {
              Data1: [
                { TRD_DT: '2025/04/11', ADJ_PRC: 110.93, DATA1: 25.0, DATA2: 20.0, DATA3: 15.0, DATA4: 10.0 },
              ],
              Data2: { P1: 120.0, P2: 90.0, P3: 60.0, P4: 30.0, CURRENCY: 'USD' },
            },
          },
          'snap-financial-summary': {
            scope: 'company',
            data: {
              Data1: { YYMM1: '202301', YYMM2: '202401' },
              Data2: [
                {
                  ITEM_NM: '시가총액',
                  ITEM_SMB: 'M705500',
                  LVL: 2,
                  UNIT: '<p class="unit">[단위: USD mn]</p>',
                  VAL1: 480610.2,
                  VAL2: 1519716.9,
                },
              ],
            },
          },
          'snap-summary-chart': {
            scope: 'company',
            data: {
              Data1: {
                CMP_NM: 'NVIDIA',
                MKT_NM: 'NASDAQ',
                KRX_NM: 'NASDAQ',
                CURRENCY: 'USD',
              },
              Data2: [
                { TRD_DT: '2025/04/04', CMP_CLS: 94.31, CMP_KOSPI: 0, TRD_QTY: 532273.81, TRD_AMT: 50198.74 },
              ],
            },
          },
          'snap-esg-json': {
            scope: 'company',
            data: {
              Data1: [{ YYMM1: '2022', YYMM2: '2023', YYMM3: '2024' }],
              Data2: [
                { ITEM: 'ESG 통합등급', ITEM_ENG: 'ESG Grade', DATA1: 'B+', DATA2: 'A-', DATA3: 'B+' },
              ],
            },
          },
          'snap-esg-chart': {
            scope: 'company',
            data: {
              Data1: [{ COMP_NM: 'NVIDIA', ESG_SCORE: 72.5, E_SCORE: 65.1, S_SCORE: 70.2, G_SCORE: 82.4 }],
              Data2: [
                { SEC_CD: 'AI', SEC_TYP: 'Industry', YYYY: '2024', ESG_AVG: 60.0, ESG_MIN: 40.0, ESG_MAX: 90.0 },
              ],
            },
          },
        },
      },
      'company-finance': {
        category: 'Company',
        name: 'Finance',
        items: {
          'fin-statement': {
            scope: 'company',
            data: {
              HeaderData: { YYMM1: '202301', YYMM2: '202401' },
              BodyData: [
                { ACCODE: 1, ACC_NM: '매출액(수익)', LVL: 1, DATA1: 26914, DATA2: 26974, DATAQ1: 39331, QOQ_COMMENT: 'noise' },
              ],
            },
          },
          'fin-balance-sheet': {
            scope: 'company',
            data: {
              HeaderData: { YYMM1: '202301', YYMM2: '202401' },
              BodyData: [
                { ACCODE: 2, ACC_NM: '자산총계', LVL: 1, DATA1: 100, DATA2: 200 },
              ],
            },
          },
          'fin-cash-flow': {
            scope: 'company',
            data: {
              HeaderData: { YYMM1: '202301', YYMM2: '202401' },
              BodyData: [
                { ACCODE: 3, ACC_NM: '영업활동현금흐름', LVL: 1, DATA1: 10, DATA2: 20 },
              ],
            },
          },
          'fin-chart': {
            scope: 'company',
            data: {
              chartData1: {
                title: '주요재무항목',
                categories: { YYMM: ['202301', '202401'] },
                yAxis_title: ['%', 'USD mn'],
                series: [
                  { name: '매출액(좌)', type: 'column', unit: 'USD mn', yAxis: 1, data: [26914, 26974] },
                ],
              },
            },
          },
        },
      },
      'company-invest': {
        category: 'Company',
        name: 'Invest',
        items: {
          'invest-statement': {
            scope: 'company',
            data: {
              HeaderData: { YYMM1: '202301', YYMM2: '202401' },
              BodyData: [
                { ACCODE: 10, ACC_NM: '매출총이익률', LVL: 1, DATA1: 67.329, DATA2: 59.513 },
              ],
            },
          },
          'invest-chart': {
            scope: 'company',
            data: {
              chartData1: {
                title: '투자지표',
                categories: { YYMM: ['202301', '202401'] },
                yAxis_title: ['%', '%'],
                series: [
                  { name: '매출총이익률', type: 'line', unit: '%', yAxis: 1, data: [67.329, 59.513] },
                ],
              },
            },
          },
        },
      },
      'company-consensus': {
        category: 'Company',
        name: 'Consensus',
        items: {
          'consensus-trend-chart': {
            scope: 'company',
            data: {
              Data1: { YYMM1: '202701', YYMM2: 'Fwd.12M', CURRENCY: 'USD' },
              Data2: [
                { TRD_DT: '2026/04/08', YYMM: '202701', VAL1: 182.08, VAL2: 366226.17, VAL3: 0 },
              ],
            },
          },
        },
      },
      'company-analysis': {
        category: 'Company',
        name: 'Analysis',
        items: {
          'compare-list': {
            scope: 'peer-group',
            data: {
              data: [
                { TICKER: 'NVDA-US', PROPER_NAME: 'NVIDIA', EX_NM: 'NASDAQ', ISO_CD: 'US' },
                { TICKER: 'MU-US', PROPER_NAME: 'Micron Technology', EX_NM: 'NASDAQ', ISO_CD: 'US' },
              ],
            },
          },
          'metric-chart': {
            scope: 'peer-group',
            data: {
              data: [
                { CMP_CD: 'NVDA-US', CMP_NM: 'NVIDIA', PER: 40.8646, EPS_GW: 146.236, PBR: 37.04859, ROE: 119.177, EPS: 2.93824 },
              ],
            },
          },
          'return-list': {
            scope: 'peer-group',
            data: {
              data: [
                { CMP_CD: 'NVDA-US', CMP_NM: 'NVIDIA', VAL_1D: 2.2346, VAL_1W: 3.6017, VAL_3M: -1.5997, VAL_6M: -3.7175, VAL_1Y: 89.0758, VAL_3Y: 573.4474 },
              ],
            },
          },
        },
      },
      'earnings-breaking-news': {
        category: 'Earnings',
        name: 'Breaking News',
        items: {
          'breaking-news-list': {
            scope: 'market',
            data: { data: [{ headline: 'out-of-scope' }] },
          },
        },
      },
    },
  };
}

function collectKeyHits(value, forbiddenKeys, path = '$', hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeyHits(item, forbiddenKeys, `${path}[${index}]`, hits));
    return hits;
  }

  if (!value || typeof value !== 'object') {
    return hits;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      hits.push(`${path}.${key}`);
    }
    collectKeyHits(nested, forbiddenKeys, `${path}.${key}`, hits);
  }

  return hits;
}

test('buildWiseReportGlobalSlimPayloadV1 returns KR v1.1-style raw aggregate shape', async () => {
  const { buildWiseReportGlobalSlimPayloadV1 } = await import('../src/server.js');
  const payload = buildWiseReportGlobalSlimPayloadV1(createGlobalDomainFixture(), 'NVDA');

  assert.equal(payload.ticker, 'NVDA');
  assert.equal(payload.cmpCode, 'NVDA-US');
  assert.deepEqual(Object.keys(payload.pages), ['snap', 'finance', 'invest', 'consensus', 'analysis']);
  assert.equal(payload.company.name, 'NVIDIA');
  assert.equal(payload.company.exchange, 'NASDAQ');
  assert.equal(payload.company.market, 'US');
  assert.equal(payload.company.currency, 'USD');

  assert.deepEqual(payload.pages.snap.news, [
    {
      publishedAt: '2026-04-08T03:00:00.000Z',
      storyId: 'story-1',
      title: 'English title',
      titleKo: '한글 제목',
    },
  ]);
  assert.deepEqual(payload.pages.snap.band1.history[0], {
    date: '2025-04-04',
    price: 94.31,
    p1: 21.31,
    p2: 15.61,
    p3: 9.91,
    p4: 4.2,
  });
  assert.deepEqual(payload.pages.snap.financialSummary.rows[0], {
    label: '시가총액',
    key: 'M705500',
    level: 2,
    unit: '[단위: USD mn]',
    values: {
      '202301': 480610.2,
      '202401': 1519716.9,
    },
  });
  assert.deepEqual(payload.pages.finance.incomeStatement.rows[0], {
    label: '매출액(수익)',
    key: 1,
    level: 1,
    values: {
      '202301': 26914,
      '202401': 26974,
    },
  });
  assert.deepEqual(payload.pages.consensus.rows[0], {
    date: '2026-04-08',
    period: '202701',
    values: {
      val1: 182.08,
      val2: 366226.17,
      val3: 0,
    },
  });
  assert.deepEqual(payload.pages.analysis.peers[0], {
    ticker: 'NVDA-US',
    name: 'NVIDIA',
    exchange: 'NASDAQ',
    market: 'US',
  });
  assert.deepEqual(payload.pages.analysis.returns[0], {
    ticker: 'NVDA-US',
    name: 'NVIDIA',
    '1d': 2.2346,
    '1w': 3.6017,
    '3m': -1.5997,
    '6m': -3.7175,
    '1y': 89.0758,
    '3y': 573.4474,
  });
});

test('buildWiseReportGlobalSlimPayloadV1 strips wrappers, noise, and non-company routes', async () => {
  const { buildWiseReportGlobalSlimPayloadV1 } = await import('../src/server.js');
  const payload = buildWiseReportGlobalSlimPayloadV1(createGlobalDomainFixture(), 'NVDA');

  const forbiddenKeys = new Set([
    'ok',
    'data',
    'count',
    'request',
    'meta',
    'category',
    'items',
    'scope',
    'Data',
    'Data1',
    'Data2',
    'HeaderData',
    'BodyData',
    'chartData1',
    'chartData2',
    'BODY',
    'HTMLBODY',
    'QOQ_COMMENT',
  ]);

  assert.deepEqual(collectKeyHits(payload, forbiddenKeys), []);
  assert.equal('earnings' in payload.pages, false);
});

test('wisereport-global-slim-v1 endpoint is registered as raw JSON route', async () => {
  const { endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'wisereport-global-slim-v1');

  assert.ok(definition);
  assert.equal(definition.resource, 'wisereport.global.company.slim.v1');
  assert.equal(definition.primaryPath, '/api/source/wisereport-global/us/companies/:ticker/slim/v1');
  assert.equal(definition.rawSuccess, true);
  assert.deepEqual(definition.dataSources, ['wisereport-global']);
});

test('buildWiseReportGlobalSlimPayloadV1 dedupes storyless news by title', async () => {
  const { buildWiseReportGlobalSlimPayloadV1 } = await import('../src/server.js');
  const fixture = createGlobalDomainFixture();
  fixture.routes['company-snap'].items['news-company-1'].data.Data.push({
    PUBLISHTIME: '/Date(1775703600000)/',
    TEXT: 'Storyless duplicate',
    T_TEXT: '스토리 없는 중복',
  });
  fixture.routes['company-snap'].items['news-company-2'].data.Data.push({
    PUBLISHTIME: '/Date(1775703600000)/',
    TEXT: 'Storyless duplicate',
    T_TEXT: '스토리 없는 중복',
  });

  const payload = buildWiseReportGlobalSlimPayloadV1(fixture, 'NVDA');

  assert.deepEqual(payload.pages.snap.news.filter((item) => item.title === 'Storyless duplicate'), [
    {
      publishedAt: '2026-04-09T03:00:00.000Z',
      title: 'Storyless duplicate',
      titleKo: '스토리 없는 중복',
    },
  ]);
});

test('buildWiseReportGlobalSlimPayloadV11 reuses parsed analysis routes when building peer group', async () => {
  const { buildWiseReportGlobalSlimPayloadV11 } = await import('../src/server.js');
  const fixture = createGlobalDomainFixture();
  const accessCounts = {};
  const originalItems = fixture.routes['company-analysis'].items;

  fixture.routes['company-analysis'].items = new Proxy(originalItems, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && Object.hasOwn(target, prop)) {
        accessCounts[prop] = (accessCounts[prop] || 0) + 1;
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  buildWiseReportGlobalSlimPayloadV11(fixture, 'NVDA');

  assert.equal(accessCounts['compare-list'], 2);
  assert.equal(accessCounts['metric-chart'], 1);
  assert.equal(accessCounts['return-list'], 1);
});

test('global slim payload builders avoid dynamic RegExp allocation for default prefix scans', async () => {
  const { buildWiseReportGlobalSlimPayloadV1, buildWiseReportGlobalSlimPayloadV11 } = await import('../src/server.js');
  const OriginalRegExp = globalThis.RegExp;
  let allocations = 0;

  function CountingRegExp(...args) {
    allocations += 1;
    return Reflect.construct(OriginalRegExp, args, new.target || OriginalRegExp);
  }

  CountingRegExp.prototype = OriginalRegExp.prototype;
  Object.setPrototypeOf(CountingRegExp, OriginalRegExp);
  globalThis.RegExp = CountingRegExp;

  try {
    buildWiseReportGlobalSlimPayloadV1(createGlobalDomainFixture(), 'NVDA');
    buildWiseReportGlobalSlimPayloadV11(createGlobalDomainFixture(), 'NVDA');
  } finally {
    globalThis.RegExp = OriginalRegExp;
  }

  assert.equal(allocations, 0);
});

test('buildWiseReportGlobalSlimPayloadV11 trims orphan columns and keeps null-only metric rows', async () => {
  const { buildWiseReportGlobalSlimPayloadV11 } = await import('../src/server.js');
  const fixture = createGlobalDomainFixture();
  fixture.routes['company-finance'].items['fin-statement'].data.HeaderData = {
    YYMM1: '202601',
    YYMM2: '202601',
    YYMM3: '202602',
  };
  fixture.routes['company-finance'].items['fin-statement'].data.BodyData = [
    { ACCODE: 99, ACC_NM: '감가상각비', LVL: 2, DATA1: null, DATA2: null, DATA3: null },
    { ACCODE: 1, ACC_NM: '매출액(수익)', LVL: 1, DATA1: 26914, DATA2: 78473.995, DATA3: null },
  ];
  fixture.routes['company-snap'].items['snap-financial-summary'].data.Data1 = {
    YYMM1: '202301',
    YYMM2: '202401',
    YYMM3: '202501',
  };
  fixture.routes['company-snap'].items['snap-financial-summary'].data.Data2 = [
    {
      ITEM_NM: '주가 및 규모',
      ITEM_SMB: null,
      LVL: 1,
      POINT_CNT: -1,
      UNIT: '<p class="unit">[단위: USD mn]</p>',
      VAL1: null,
      VAL2: null,
      VAL3: null,
    },
    {
      ITEM_NM: '시가총액',
      ITEM_SMB: 'M705500',
      LVL: 2,
      POINT_CNT: 0,
      UNIT: '<p class="unit">[단위: USD mn]</p>',
      VAL1: 480610.2,
      VAL2: 1519716.9,
      VAL3: null,
    },
  ];

  const payload = buildWiseReportGlobalSlimPayloadV11(fixture, 'NVDA');

  assert.equal(payload.schemaVersion, '1.1');
  assert.equal(payload.company.securityId, 'NVDA-US');
  assert.equal(payload.company.ticker, 'NVDA');
  assert.equal(payload.company.exchange, 'NASDAQ');
  assert.equal(payload.pages.finance.statements.income.columns.length, 2);
  assert.deepEqual(
    payload.pages.finance.statements.income.columns.map((column) => column.label),
    ['202601', '202601'],
  );
  assert.notEqual(
    payload.pages.finance.statements.income.columns[0].id,
    payload.pages.finance.statements.income.columns[1].id,
  );
  assert.equal(payload.pages.finance.statements.income.rows.length, 2);
  assert.equal(payload.pages.finance.statements.income.sectionRows, undefined);
  assert.deepEqual(payload.pages.finance.statements.income.rows[0], {
    rowId: '99',
    label: '감가상각비',
    meta: {
      rowType: 'metric',
      level: 2,
      unit: null,
    },
    cells: {},
  });
  assert.deepEqual(payload.pages.finance.statements.income.rows[1].cells, {
    'period:202601': 26914,
    'period:202601:2': 78473.995,
  });
  assert.equal(payload.pages.snap.financialSummary.columns.length, 2);
  assert.equal(payload.pages.snap.financialSummary.rows.length, 1);
  assert.deepEqual(payload.pages.snap.financialSummary.sectionRows, [
    {
      rowId: 'row:1',
      label: '주가 및 규모',
      meta: {
        rowType: 'section',
        level: 1,
        unit: '[단위: USD mn]',
        pointCount: -1,
      },
      cells: {},
    },
  ]);
  assert.deepEqual(payload.pages.snap.news[0], {
    id: 'story-1',
    publishedAt: '2026-04-08T03:00:00.000Z',
    titles: {
      en: 'English title',
      ko: '한글 제목',
    },
  });
  assert.equal(payload.pages.snap.valuationBands.primary.bandDefinitions[0].semanticStatus, 'source-opaque');
  assert.equal(payload.pages.finance.charts.chartData1.id, 'chartData1');
});

test('buildWiseReportGlobalSlimPayloadV11 provides consensus definitions and join-free peer group', async () => {
  const { buildWiseReportGlobalSlimPayloadV11 } = await import('../src/server.js');
  const payload = buildWiseReportGlobalSlimPayloadV11(createGlobalDomainFixture(), 'NVDA');

  assert.deepEqual(payload.pages.consensus.metricDefinitions, [
    { id: 'val1', sourceField: 'VAL1', label: null },
    { id: 'val2', sourceField: 'VAL2', label: null },
    { id: 'val3', sourceField: 'VAL3', label: null },
  ]);
  assert.deepEqual(payload.pages.consensus.observations[0], {
    asOfDate: '2026-04-08',
    targetPeriodId: 'period:202701',
    targetPeriodLabel: '202701',
    metrics: {
      val1: 182.08,
      val2: 366226.17,
      val3: 0,
    },
  });
  assert.deepEqual(payload.pages.analysis.peerGroup.members[0], {
    company: {
      securityId: 'NVDA-US',
      ticker: 'NVDA',
      exchange: 'NASDAQ',
      market: 'US',
      name: 'NVIDIA',
    },
    metrics: {
      per: 40.8646,
      epsGw: 146.236,
      pbr: 37.04859,
      roe: 119.177,
      eps: 2.93824,
      evEbitda: null,
    },
    returns: {
      return1dPct: 2.2346,
      return1wPct: 3.6017,
      return3mPct: -1.5997,
      return6mPct: -3.7175,
      return1yPct: 89.0758,
      return3yPct: 573.4474,
    },
  });
});

test('wisereport-global-slim-v1.1 endpoint is registered as raw JSON route', async () => {
  const { endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'wisereport-global-slim-v1.1');

  assert.ok(definition);
  assert.equal(definition.resource, 'wisereport.global.company.slim.v1.1');
  assert.equal(definition.primaryPath, '/api/source/wisereport-global/us/companies/:ticker/slim/v1.1');
  assert.equal(definition.rawSuccess, true);
  assert.deepEqual(definition.dataSources, ['wisereport-global']);
});
