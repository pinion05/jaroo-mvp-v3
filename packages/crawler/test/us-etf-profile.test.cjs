const test = require('node:test');
const assert = require('node:assert/strict');

// us-etf-profile — Yahoo 내부 API 3종 + Polygon 일봉 조합의 순수 계약.
// 라이브 의존 없이 fetchImpl 주입으로 검증한다 (etf-profile.test.cjs와 같은 패턴).

const polygonOhlcFixture = {
  ticker: 'VOO',
  provider: 'polygon',
  series: [
    { date: '2026-09-11', open: 700.1, high: 702.0, low: 698.2, close: 701.5, volume: 3_100_000 },
    { date: '2026-09-12', open: 701.6, high: 705.0, low: 700.9, close: 704.07, volume: 3_400_000 },
    { date: '2026-09-14', open: 703.0, high: 703.5, low: 696.72, close: 699.3, volume: 6_801_322 },
  ],
  meta: { status: 'ok' },
};

const detailsFixture = {
  results: { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'ETF', currency_name: 'usd', active: true },
};

const quoteSummaryFixture = {
  quoteSummary: {
    result: [
      {
        fundProfile: {
          family: 'Vanguard',
          categoryName: 'Large Blend',
          feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.0003, fmt: '0.03%' } },
        },
        topHoldings: {
          holdings: [
            { symbol: 'NVDA', holdingName: 'NVIDIA Corp', holdingPercent: { raw: 0.075487, fmt: '7.55%' } },
            { symbol: 'AAPL', holdingName: 'Apple Inc', holdingPercent: { raw: 0.0704422, fmt: '7.04%' } },
          ],
          cashPosition: { raw: 0.0006 },
        },
        summaryDetail: {
          yield: { raw: 0.0104, fmt: '1.04%' },
          navPrice: { raw: 702.62, fmt: '702.62' },
        },
        defaultKeyStatistics: {
          totalAssets: { raw: 1_756_880_437_248, longFmt: '1,756,880,437,248' },
        },
      },
    ],
  },
};

function createYahooFetchImpl({ quoteSummary = quoteSummaryFixture } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://fc.yahoo.com')) {
      return { ok: true, headers: { getSetCookie: () => ['A3=d=fake; Path=/; Domain=.yahoo.com'] } };
    }
    if (String(url).includes('/v1/test/getcrumb')) {
      return { ok: true, json: async () => 'not-json-crumb', text: async () => 'fakecrumb' };
    }
    if (String(url).includes('/v10/finance/quoteSummary')) {
      return { ok: true, json: async () => quoteSummary };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { impl, calls };
}

test('extractPolygonSeries derives daily(오름차순)·price·previousClose from polygon ohlc', async () => {
  const { extractPolygonSeries } = await import('../src/crawlers/us-etf-profile.js');
  const series = extractPolygonSeries(polygonOhlcFixture);
  assert.equal(series.daily.length, 3);
  assert.equal(series.daily[0].date, '2026-09-11');
  assert.equal(series.price, 699.3);
  assert.equal(series.previousClose, 704.07);
});

test('buildUsEtfProfile maps polygon+yahoo onto jaroo-etf-profile-v1 (market us·USD)', async () => {
  const { buildUsEtfProfile, extractPolygonSeries, extractPolygonTickerDetails } = await import('../src/crawlers/us-etf-profile.js');
  const profile = buildUsEtfProfile({
    symbol: 'voo',
    polygon: extractPolygonSeries(polygonOhlcFixture),
    details: extractPolygonTickerDetails(detailsFixture),
    quoteSummary: quoteSummaryFixture.quoteSummary.result[0],
  });

  assert.equal(profile.schemaVersion, 'jaroo-etf-profile-v1');
  assert.equal(profile.code, 'VOO');
  assert.equal(profile.name, 'Vanguard S&P 500 ETF');
  assert.equal(profile.market, 'us');
  assert.equal(profile.currency, 'USD');
  // (699.3 / 704.07 − 1) × 100 ≈ −0.68%
  assert.ok(Math.abs(profile.quote.changePct - (-0.6774)) < 0.01);
  // 보수 비율(0.0003)은 퍼센트(0.03)로 환산
  assert.ok(Math.abs(profile.product.totalFeePct - 0.03) < 1e-9);
  assert.equal(profile.product.issuerName, 'Vanguard');
  assert.equal(profile.product.baseIndexName, null); // categoryName은 스타일 박스 — 기준지수 아님
  assert.equal(profile.product.aum, 1_756_880_437_248);
  assert.equal(profile.product.nav, 702.62);
  const [firstHolding, secondHolding] = profile.holdings;
  assert.equal(firstHolding.code, 'NVDA');
  assert.ok(Math.abs(firstHolding.weightPct - 7.5487) < 1e-6);
  assert.equal(secondHolding.code, 'AAPL');
  assert.ok(Math.abs(secondHolding.weightPct - 7.04422) < 1e-6);
  assert.equal(profile.holdings[0].rank, 1);
  assert.equal(profile.daily.length, 3);
});

test('fetchUsEtfProfile merges polygon ohlc+details+quoteSummary and tolerates quoteSummary failure', async () => {
  const { fetchUsEtfProfile } = await import('../src/crawlers/us-etf-profile.js');
  const yahoo = createYahooFetchImpl();

  const profile = await fetchUsEtfProfile('VOO', {
    fetchImpl: yahoo.impl,
    fetchOhlc: async () => polygonOhlcFixture,
    fetchTickerDetails: async () => detailsFixture,
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.code, 'VOO');
  assert.equal(profile.product.issuerName, 'Vanguard');
  assert.equal(profile.holdings.length, 2);

  // quoteSummary 전체 실패 — 일봉·판별은 살고 상품/구성만 내려간다
  const degraded = createYahooFetchImpl({ quoteSummary: { quoteSummary: { result: [] } } });
  const profile2 = await fetchUsEtfProfile('VOO', {
    fetchImpl: degraded.impl,
    fetchOhlc: async () => polygonOhlcFixture,
    fetchTickerDetails: async () => detailsFixture,
  });
  assert.equal(profile2.ok, true);
  assert.equal(profile2.name, 'Vanguard S&P 500 ETF'); // polygon details는 살아있음
  assert.equal(profile2.product.issuerName, null);
  assert.equal(profile2.holdings, null);
});

test('fetchUsEtfProfile rejects non-ETF instrument types from polygon details (NotAnEtfError)', async () => {
  const { fetchUsEtfProfile } = await import('../src/crawlers/us-etf-profile.js');
  const yahoo = createYahooFetchImpl();
  const stockDetails = { results: { ticker: 'AAPL', name: 'Apple Inc', type: 'CS', currency_name: 'usd' } };

  await assert.rejects(
    () => fetchUsEtfProfile('AAPL', {
      fetchImpl: yahoo.impl,
      fetchOhlc: async () => polygonOhlcFixture,
      fetchTickerDetails: async () => stockDetails,
    }),
    (error) => error.code === 'NOT_ETF' && error.name === 'NotAnEtfError',
  );
});

test('extractPolygonTickerDetails normalizes type·name·currency and tolerates missing results', async () => {
  const { extractPolygonTickerDetails } = await import('../src/crawlers/us-etf-profile.js');
  const details = extractPolygonTickerDetails(detailsFixture);
  assert.deepEqual(details, { instrumentType: 'ETF', name: 'Vanguard S&P 500 ETF', currency: 'USD' });
  assert.equal(extractPolygonTickerDetails({ results: null }), null);
  assert.equal(extractPolygonTickerDetails(null), null);
});

test('fetchUsEtfProfile throws when polygon daily is unavailable', async () => {
  const { fetchUsEtfProfile } = await import('../src/crawlers/us-etf-profile.js');
  const yahoo = createYahooFetchImpl();

  await assert.rejects(
    () => fetchUsEtfProfile('VOO', {
      fetchImpl: yahoo.impl,
      fetchOhlc: async () => ({ series: [], meta: { status: 'missing' } }),
      fetchTickerDetails: async () => detailsFixture,
    }),
    /polygon daily missing/,
  );
});
