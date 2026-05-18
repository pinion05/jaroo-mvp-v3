const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOURCES,
  parseYahooVixChart,
  fetchUsVix,
} = require('../src/crawlers/market-indicators.cjs');

test('parseYahooVixChart maps Yahoo chart payload to US VIX indicator shape', () => {
  const result = parseYahooVixChart({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: 18.53,
          previousClose: 19.25,
          regularMarketTime: 1779062400,
        },
        timestamp: [1778976000, 1779062400],
        indicators: { quote: [{ close: [19.25, 18.53] }] },
      }],
    },
  }, SOURCES.usVix);

  assert.deepEqual(result, {
    name: 'CBOE Volatility Index (VIX)',
    symbol: 'VIX',
    value: 18.53,
    change: -0.72,
    changePercent: -3.74,
    status: 'yahoo-chart',
    asOf: '2026-05-18T00:00:00.000Z',
    source: 'yahoo-chart',
    sourceUrl: SOURCES.usVix,
  });
});

test('fetchUsVix uses Yahoo chart JSON instead of Investing browser scraping', async () => {
  const requested = [];
  const result = await fetchUsVix({
    timeoutMs: 100,
    fetcher: async (url) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            chart: {
              result: [{
                meta: {
                  regularMarketPrice: 20,
                  previousClose: 18,
                  regularMarketTime: 1779062400,
                },
                timestamp: [1779062400],
                indicators: { quote: [{ close: [20] }] },
              }],
            },
          };
        },
      };
    },
  });

  assert.deepEqual(requested, [SOURCES.usVix]);
  assert.equal(result.value, 20);
  assert.equal(result.changePercent, 11.11);
  assert.equal(result.source, 'yahoo-chart');
});
