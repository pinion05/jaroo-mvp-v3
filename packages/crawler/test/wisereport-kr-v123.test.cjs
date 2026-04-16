const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compactHeaderParts,
  formatHeaderLabel,
  recordsFromTable,
} = require('../src/crawlers/wisereport-kr/helpers.cjs');
const {
  selectPreferredCandidate,
  finalizeNormalizedPayload,
} = require('../src/crawlers/wisereport-kr/crawler_v3.cjs');
const {
  runCrawlerV1Stage,
  waitForPageReady,
} = require('../src/crawlers/wisereport-kr/crawler_v1.cjs');

test('compactHeaderParts removes consecutive duplicates and blanks', () => {
  assert.deepEqual(compactHeaderParts([' 회계연도 ', '회계연도', '', ' (남) ', '(남)', '2025/12']), ['회계연도', '(남)', '2025/12']);
});

test('recordsFromTable builds stable headers from multi-row header matrix', () => {
  const table = {
    id: 'workforce',
    className: 'gHead',
    rows: [
      ['회계연도', '회계연도', '인원(남)', '인원(여)'],
      ['회계연도', '2025/12', '인원', '인원'],
      ['정규직', '120', '80', '40'],
    ],
  };

  const result = recordsFromTable(table, 2);

  assert.deepEqual(result.headers, ['회계연도', '회계연도(2025/12)', '인원(남)', '인원(여)']);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows[0], {
    '회계연도': '정규직',
    '회계연도(2025/12)': '120',
    '인원(남)': '80',
    '인원(여)': '40',
  });
});

test('recordsFromTable keeps headers aligned with row keys when duplicate or blank labels are uniquified', () => {
  const table = {
    id: 'dup-headers',
    className: 'gHead',
    rows: [
      ['구분', '구분', ''],
      ['매출', '100', '비고'],
    ],
  };

  const result = recordsFromTable(table);

  assert.deepEqual(result.headers, ['구분', '구분_2', 'column_3']);
  assert.deepEqual(Object.keys(result.rows[0]), result.headers);
  assert.deepEqual(result.rows[0], {
    '구분': '매출',
    '구분_2': '100',
    'column_3': '비고',
  });
});

test('waitForPageReady waits for fallback selectors in parallel and returns the first matched selector', async () => {
  const seenSelectors = [];
  const page = {
    waitForSelector: async (selector) => {
      seenSelectors.push(selector);
    },
    $: async (selector) => (selector === '#fallback' ? { id: 'fallback' } : null),
  };

  const readySelector = await waitForPageReady(page, {
    waitForSelectors: ['#primary', '#fallback'],
  }, 1234);

  assert.deepEqual(seenSelectors, ['#primary, #fallback']);
  assert.equal(readySelector, '#fallback');
});

test('runCrawlerV1Stage waits for async response captures and preserves arrival order', async () => {
  const responseHandlers = [];
  const mainFrame = { id: 'main-frame' };
  let routePattern = null;
  const responseText = {
    first: Promise.resolve('first-body'),
    second: new Promise((resolve) => setTimeout(() => resolve('second-body'), 20)),
  };
  const page = {
    route: async (pattern) => {
      routePattern = pattern;
    },
    on: (event, handler) => {
      if (event === 'response') {
        responseHandlers.push(handler);
      }
    },
    goto: async () => {
      responseHandlers[0]({
        url: () => 'https://example.com/company/ajax/slow',
        status: () => 200,
        headers: () => ({ 'content-type': 'text/plain' }),
        request: () => ({ resourceType: () => 'xhr' }),
        text: async () => responseText.second,
        json: async () => {
          throw new Error('not json');
        },
      });
      responseHandlers[0]({
        url: () => 'https://example.com/company/ajax/fast',
        status: () => 200,
        headers: () => ({ 'content-type': 'text/plain' }),
        request: () => ({ resourceType: () => 'xhr' }),
        text: async () => responseText.first,
        json: async () => {
          throw new Error('not json');
        },
      });
    },
    waitForSelector: async () => {},
    $: async () => null,
    waitForTimeout: async () => {},
    frames: () => [mainFrame],
    mainFrame: () => mainFrame,
    evaluate: async () => ({
      title: '삼성전자 - WiseReport',
      finalUrl: 'https://example.com/final',
      company: { code: '005930', name: '삼성전자', headerText: '삼성전자 헤더' },
      removedNoise: [],
      bodyTextHead: '헤더',
      bodyTextLength: 10,
      tables: [],
      tableCapture: { totalCount: 0, capturedCount: 0, truncated: false },
      chartAssets: [],
      scriptEvidence: [],
      rootBlocks: [],
      spec: { id: 'company-overview', sourceKey: 'wisereport기업개요', sourceType: 'wisereport' },
    }),
    close: async () => {},
  };
  const context = {
    newPage: async () => page,
  };

  const result = await runCrawlerV1Stage(context, '005930', {
    id: 'company-overview',
    sourceKey: 'wisereport기업개요',
    sourceType: 'wisereport',
    url: (code) => `https://example.com/${code}`,
    waitForSelectors: [],
  }, {
    waitAfterLoadMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(routePattern, '**/*');
  assert.equal(result.source.capturedResponses.length, 2);
  assert.deepEqual(result.source.capturedResponses.map((item) => item.url), [
    'https://example.com/company/ajax/slow',
    'https://example.com/company/ajax/fast',
  ]);
  assert.deepEqual(result.source.capturedResponses.map((item) => item.bodyText), ['second-body', 'first-body']);
});

test('selectPreferredCandidate prioritizes network over dom and iframe', () => {
  const selected = selectPreferredCandidate([
    { source: 'iframe', completeness: 10, value: { a: 1 } },
    { source: 'dom', completeness: 5, value: { a: 2 } },
    { source: 'network', completeness: 3, value: { a: 3 } },
  ]);

  assert.equal(selected.source, 'network');
  assert.deepEqual(selected.value, { a: 3 });
});

test('finalizeNormalizedPayload preserves fields and reports provenance', () => {
  const result = finalizeNormalizedPayload({
    spec: { id: 'relative-return', sourceKey: 'fnguide상대수익률', sourceType: 'fnguide' },
    code: '042660',
    v2: {
      base: { company: { code: '042660', name: '한화오션' }, sourceType: 'fnguide', sourceKey: 'fnguide상대수익률', bodyTextHead: '요약' },
      candidates: {
        chartJson: [
          { field: 'chartJson', source: 'dom', completeness: 1, value: { source: 'dom' } },
          { field: 'chartJson', source: 'network', completeness: 1, value: { source: 'network' } },
        ],
        popupTable: [
          { field: 'popupTable', source: 'dom', completeness: 2, value: { rows: [{ value: 1 }] } },
        ],
      },
      extractionMeta: { candidateFieldCount: 2 },
    },
    v1: {
      source: { requestLog: [1, 2], capturedResponses: [1], iframes: [] },
      capture: { tables: [1], chartAssets: [], removedNoise: [], bodyTextLength: 100 },
    },
  });

  assert.equal(result.normalized.chartJson.source, 'network');
  assert.equal(result.provenance.chartJson.selectedSource, 'network');
  assert.equal(result.stages.crawler_v2.candidateFieldCount, 2);
  assert.equal(result.stages.crawler_v3.selectedFieldCount, 2);
});


test('buildWiseReportKrSlimPayload keeps only business payload for slim aggregate route', async () => {
  const { buildWiseReportKrSlimPayload } = await import('../src/server.js');

  const slim = buildWiseReportKrSlimPayload({
    pages: {
      'company-overview': {
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '기업개요 | 삼성전자',
            headerText: '삼성전자 005930 헤더',
          },
          sourceType: 'wisereport',
          sourceKey: 'wisereport기업개요',
          bodyTextHead: '헤더 텍스트',
          summary: {
            market: 'KOSPI',
            marketCap: '100',
          },
          salesComposition: {
            tableId: 'cTB206',
            className: 'gHead01 all-width',
            headerRows: [['구분', '비중']],
            rowCount: 2,
            dataAvailability: {
              status: 'present',
              note: 'kept',
            },
            rows: [
              { item: '반도체', value: '100%' },
            ],
          },
        },
        source: {
          requestLog: [{ url: 'https://example.com' }],
          capturedResponses: [{ status: 200 }],
        },
        capture: {
          bodyTextHead: 'drop me',
        },
        provenance: {
          summary: { selectedSource: 'dom' },
        },
        quality: {
          ok: true,
        },
        stages: {
          crawler_v3: { selectedFieldCount: 2 },
        },
      },
      'relative-return': {
        normalized: {
          company: {
            code: '005930',
            name: '삼성전자',
            title: '상세보기 : 삼성전자',
            headerText: 'drop this title metadata',
          },
          factorScores: {
            CHART_H: [{ ID: 'VAL1', NAME: '삼성전자' }],
            CHART_D: [{ NM: '베타', VAL1: '0.05', VAL2: '-0.56' }],
          },
          popupTable: {
            tableId: 'popup',
            className: 'us_table_ty2',
            headerRows: [['팩터명', '삼성전자']],
            rows: [{ '팩터명': '베타', '삼성전자': '0.05' }],
            rowCount: 1,
          },
          ajaxEvidence: {
            url: 'https://example.com/chart.json',
          },
          pagination: {
            page: 1,
          },
          headers: ['팩터명', '삼성전자'],
        },
      },
    },
  }, '005930');

  assert.deepEqual(slim, {
    code: '005930',
    company: {
      code: '005930',
      name: '삼성전자',
    },
    pages: {
      'company-overview': {
        summary: {
          market: 'KOSPI',
          marketCap: '100',
        },
        salesComposition: {
          status: 'present',
          note: 'kept',
          rows: [
            { item: '반도체', value: '100%' },
          ],
        },
      },
      'financial-analysis': null,
      'investment-indicators': null,
      consensus: null,
      shareholding: null,
      'recent-reports': null,
      'fnguide-finance': null,
      'relative-return': {
        factorScores: {
          CHART_H: [{ ID: 'VAL1', NAME: '삼성전자' }],
          CHART_D: [{ NM: '베타', VAL1: '0.05', VAL2: '-0.56' }],
        },
        headers: ['팩터명', '삼성전자'],
      },
      opinion: null,
      'style-analysis': null,
    },
  });
});

test('slim route definitions return raw JSON success without the standard envelope', async () => {
  const { endpointDefinitions } = await import('../src/server.js');

  const definitionV1 = endpointDefinitions.find((item) => item.id === 'wisereport-kr-slim-v1');
  const definitionV11 = endpointDefinitions.find((item) => item.id === 'wisereport-kr-slim-v1.1');

  assert.ok(definitionV1);
  assert.equal(definitionV1.primaryPath, '/api/wisereport/kr/:code/slim/v1');
  assert.equal(definitionV1.rawSuccess, true);
  assert.equal(definitionV1.resource, 'wisereport.kr.aggregate.slim.v1');

  assert.ok(definitionV11);
  assert.equal(definitionV11.primaryPath, '/api/wisereport/kr/:code/slim/v1.1');
  assert.equal(definitionV11.rawSuccess, true);
  assert.equal(definitionV11.resource, 'wisereport.kr.aggregate.slim.v1.1');
});
