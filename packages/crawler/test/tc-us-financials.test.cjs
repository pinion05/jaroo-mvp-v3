const test = require('node:test');
const assert = require('node:assert/strict');

// TC-CRW-039 — src/crawlers/us-financials.js (US 재무제표/지표) 커버리지 갭 테스트.
// us-financials는 기존 자동화 테스트가 전무했다. finnhub financials-reported 응답을
// 스텁해(외부 네트워크 없음) US-GAAP concept → canonical 키 정규화와
// FMP 미설정 시 finnhub metric 폴백 파생(earningsYield = 1/pe 등)을 검증한다.

// api-clients.js가 모듈 로드 시점에 API 키를 캡처하므로, 동적 import 전에 환경을 고정한다.
process.env.FINNHUB_API_KEY = 'tc-test-finnhub-token';
delete process.env.FMP_API_KEY;
delete process.env.POLYGON_API_KEY;

const ANNUAL_YEARS = [2024, 2023, 2022, 2021, 2020];

function annualEntry(year, { revenues, netIncome, operatingIncome } = {}) {
  return {
    year,
    quarter: 0,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    report: {
      ic: [
        { concept: 'us-gaap_Revenues', value: revenues ?? (100_000_000_000 + (2024 - year) * 5_000_000_000) },
        { concept: 'us-gaap_NetIncomeLoss', value: netIncome ?? 20_000_000_000 },
        { concept: 'us-gaap_OperatingIncomeLoss', value: operatingIncome ?? 30_000_000_000 },
      ],
      bs: year === 2024
        ? [
            { concept: 'us-gaap_Assets', value: 364_980_000_000 },
            { concept: 'us-gaap_Liabilities', value: 308_030_000_000 },
            { concept: 'us-gaap_StockholdersEquity', value: 56_950_000_000 },
          ]
        : [{ concept: 'us-gaap_Assets', value: 300_000_000_000 }],
      cf: year === 2024
        ? [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: 118_254_000_000 }]
        : [],
    },
  };
}

function quarterlyEntry(quarter, revenues) {
  return {
    year: 2024,
    quarter,
    startDate: '2024-04-01',
    endDate: '2024-06-30',
    report: {
      ic: [{ concept: 'us-gaap_Revenues', value: revenues }],
      bs: [],
      cf: [],
    },
  };
}

function stubFinnhub() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    calls.push(target.pathname + target.search);
    assert.equal(target.hostname, 'finnhub.io', '테스트는 finnhub 외부 호스트를 호출하면 안 된다');

    if (target.pathname === '/api/v1/stock/financials-reported') {
      return {
        ok: true,
        json: async () => ({
          data: [
            ...ANNUAL_YEARS.map((year) => annualEntry(year)),
            // annual 필터에서 제외되어야 하는 분기 행 (quarter>0)
            quarterlyEntry(2, 90_000_000_000),
            quarterlyEntry(1, 85_000_000_000),
          ],
        }),
      };
    }
    if (target.pathname === '/api/v1/stock/metric') {
      return {
        ok: true,
        json: async () => ({
          metric: {
            marketCapitalization: 3_500_000,
            peTTM: 33.5,
            pbQuarterly: 45.2,
            currentDividendYieldTTM: 0.45,
            roeTTM: 147.26,
            roaTTM: 28.29,
            'totalDebt/totalEquityQuarterly': 38.5,
            currentRatioQuarterly: 0.87,
            quickRatioQuarterly: 0.71,
            grossMarginTTM: 46.2,
            operatingMarginTTM: 29.8,
            netProfitMarginTTM: 23.97,
          },
        }),
      };
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };

  return async () => {
    globalThis.fetch = originalFetch;
    return calls;
  };
}

test('TC-CRW-039 finnhub 재무제표는 US-GAAP concept을 canonical 키로 정규화하고 연간/분기 필터·limit을 적용하며, metric 폴백은 finnhub 지표에서 파생된다', async () => {
  const { getFinancialStatementsFinnhub, getKeyMetrics, getFinancialRatios } = await import('../src/crawlers/us-financials.js');
  const restore = stubFinnhub();

  try {
    // 1) 연간 재무제표: annual(quarter===0) 필터 + 최대 4개 행
    const statements = await getFinancialStatementsFinnhub('AAPL', { timeframe: 'annual' });
    assert.equal(statements.ticker, 'AAPL');
    assert.equal(statements.timeframe, 'annual');
    assert.equal(statements.source, 'finnhub-financials-reported');
    assert.equal(statements.incomeStatements.length, 4, '연간 행만 최대 4개까지여야 한다(5개 연간 + 1개 분기 입력)');
    assert.deepEqual(
      statements.incomeStatements.map((row) => row.fiscalYear),
      [2024, 2023, 2022, 2021],
      '입력 순서(최신 우선)를 유지해야 한다',
    );

    const latestIncome = statements.incomeStatements[0];
    assert.equal(latestIncome.fiscalYear, 2024);
    assert.equal(latestIncome.fiscalPeriod, 'FY', '연간 행의 fiscalPeriod는 FY로 정규화되어야 한다');
    assert.equal(latestIncome.revenues, 100_000_000_000, 'us-gaap_Revenues → revenues 매핑');
    assert.equal(latestIncome.net_income, 20_000_000_000, 'us-gaap_NetIncomeLoss → net_income 매핑');
    assert.equal(latestIncome.operating_income, 30_000_000_000, 'us-gaap_OperatingIncomeLoss → operating_income 매핑');
    assert.equal(latestIncome.source, 'finnhub-financials-reported');

    const latestBalance = statements.balanceSheets[0];
    assert.equal(latestBalance.total_assets, 364_980_000_000, 'us-gaap_Assets → total_assets 매핑');
    assert.equal(latestBalance.total_liabilities, 308_030_000_000, 'us-gaap_Liabilities → total_liabilities 매핑');
    assert.equal(latestBalance.total_equity, 56_950_000_000, 'us-gaap_StockholdersEquity → total_equity 매핑');

    assert.equal(statements.cashFlows[0].operating_cash_flow, 118_254_000_000, 'us-gaap operating activities → operating_cash_flow 매핑');

    // 2) 분기 재무제표: quarterly 필터는 quarter>0 행만 남긴다 (같은 URL이라 캐시가 서빙)
    const quarterly = await getFinancialStatementsFinnhub('AAPL', { timeframe: 'quarterly', limit: 2 });
    assert.equal(quarterly.incomeStatements.length, 2, 'quarter===0 연간 행은 분기 조회에서 제외되어야 한다');
    assert.deepEqual(
      quarterly.incomeStatements.map((row) => row.fiscalPeriod),
      ['Q2', 'Q1'],
      '분기 행은 Q 접두로 정규화되고 입력 순서를 유지한다',
    );
    assert.equal(quarterly.incomeStatements[0].fiscalYear, 2024);
    assert.equal(quarterly.incomeStatements[0].revenues, 90_000_000_000);

    // 3) 핵심 지표: FMP 미설정 → finnhub metric 폴백 파생
    const [keyMetrics] = await getKeyMetrics('AAPL');
    assert.equal(keyMetrics.source, 'finnhub-metric');
    assert.equal(keyMetrics.marketCap, 3_500_000, 'marketCapitalization → marketCap 파생');
    assert.equal(keyMetrics.peRatio, 33.5, 'peTTM → peRatio 파생');
    assert.equal(keyMetrics.pbRatio, 45.2, 'pbQuarterly → pbRatio 파생');
    assert.equal(keyMetrics.roe, 147.26, 'roeTTM → roe 파생');
    assert.equal(keyMetrics.debtToEquity, 38.5, 'totalDebt/totalEquityQuarterly → debtToEquity 파생');

    // 4) 재무 비율: finnhub metric에서 파생, earningsYield = 1/pe
    const [ratios] = await getFinancialRatios('AAPL');
    assert.equal(ratios.source, 'finnhub-metric');
    assert.equal(ratios.currentRatio, 0.87);
    assert.equal(ratios.quickRatio, 0.71);
    assert.equal(ratios.grossProfitMargin, 46.2, 'grossMarginTTM → grossProfitMargin 파생');
    assert.equal(ratios.operatingProfitMargin, 29.8);
    assert.equal(ratios.netProfitMargin, 23.97);
    assert.ok(
      Math.abs(ratios.earningsYield - 1 / 33.5) < 1e-9,
      'earningsYield는 pe의 역수(1/33.5)로 파생되어야 한다',
    );

    // 5) 네트워크 호출은 finnhub 2회뿐 — financials-reported(annual/quarterly 같은 URL → 캐시 적중 1회),
    //    metric(metrics+ratios 같은 URL → 캐시 적중 1회)
    const calls = await restore();
    assert.deepEqual(
      calls.map((call) => call.split('?')[0]),
      ['/api/v1/stock/financials-reported', '/api/v1/stock/metric'],
      'URL 기반 캐시로 financials-reported와 metric은 각 1회만 fetch해야 한다',
    );
  } finally {
    await restore();
  }
});
