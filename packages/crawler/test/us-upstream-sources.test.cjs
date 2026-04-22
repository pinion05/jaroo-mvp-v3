const test = require('node:test');
const assert = require('node:assert/strict');

test('US ownership-flow and OHLC endpoint definitions are registered', async () => {
  const { endpointDefinitions } = await import('../src/server.js');

  const ownershipDefinition = endpointDefinitions.find((item) => item.id === 'us-stock-ownership-flow');
  const ohlcDefinition = endpointDefinitions.find((item) => item.id === 'us-stock-ohlc');

  assert.ok(ownershipDefinition);
  assert.equal(ownershipDefinition.primaryPath, '/api/source/sec-edgar/us/stocks/:ticker/ownership-flow');
  assert.deepEqual(ownershipDefinition.dataSources, ['sec-edgar']);
  assert.ok(ownershipDefinition.query.includes('limit(optional, default=12)'));
  assert.ok(ownershipDefinition.query.includes('recentDays(optional, default=180)'));

  assert.ok(ohlcDefinition);
  assert.equal(ohlcDefinition.primaryPath, '/api/source/polygon/us/stocks/:ticker/ohlc');
  assert.deepEqual(ohlcDefinition.dataSources, ['polygon']);
  assert.ok(ohlcDefinition.query.includes('limit(optional, default=252)'));

  const { getUSOhlc } = await import('../src/crawlers/us-ohlc.js');
  const missingTicker = await getUSOhlc('');
  assert.equal(missingTicker.provider, 'polygon');
  assert.equal(missingTicker.source, 'polygon-v2-aggs-ticker-range-day');
});

test('summarizeOwnershipFlowFromFilings reports direct filing activity without proxy semantics', async () => {
  const { summarizeOwnershipFlowFromFilings } = await import('../src/crawlers/us-ownership-flow.js');

  const summary = summarizeOwnershipFlowFromFilings([
    { type: '4', filedDate: '2026-04-20', title: 'Form 4', url: 'https://sec.example/4' },
    { type: 'SC 13D', filedDate: '2026-04-18', title: '13D', url: 'https://sec.example/13d' },
    { type: '8-K', filedDate: '2026-04-10', title: 'Ignore me', url: 'https://sec.example/8k' },
  ], {
    now: '2026-04-21T00:00:00Z',
    recentDays: 30,
  });

  assert.equal(summary.source, 'sec-submissions');
  assert.equal(summary.signal.status, 'active');
  assert.equal(summary.signal.direction, 'mixed-direct-flow');
  assert.equal(summary.counts.totalDirectEvents, 2);
  assert.equal(summary.counts.insiderForms, 1);
  assert.equal(summary.counts.beneficialOwnershipForms, 1);
  assert.equal(summary.latestDates.latestEvent, '2026-04-20');
  assert.equal(summary.filings.length, 2);
});

test('normalizeFmpOhlcSeries preserves newest-first OHLC points and applies limits', async () => {
  const { normalizeFmpOhlcSeries } = await import('../src/crawlers/us-ohlc.js');

  const defaultLimited = normalizeFmpOhlcSeries(Array.from({ length: 300 }, (_, index) => ({
    symbol: 'AAPL',
    date: `2026-04-${String((index % 30) + 1).padStart(2, '0')}`,
    open: index + 1,
    high: index + 2,
    low: index,
    close: index + 1.5,
    volume: index + 1000,
  })));
  assert.equal(defaultLimited.length, 252);

  const series = normalizeFmpOhlcSeries([
    { symbol: 'AAPL', date: '2026-04-20', open: '270.33', high: 274.275, low: 270.29, close: 273.05, volume: '34667241', change: '2.72', changePercent: '1.00618', vwap: '272.54' },
    { symbol: 'AAPL', date: '2026-04-17', open: 266.96, high: 272.3, low: 266.72, close: 270.23, volume: 61436228, change: 3.27, changePercent: 1.22, vwap: 269.0525 },
  ], 1);

  assert.deepEqual(series, [
    {
      symbol: 'AAPL',
      date: '2026-04-20',
      open: 270.33,
      high: 274.275,
      low: 270.29,
      close: 273.05,
      volume: 34667241,
      change: 2.72,
      changePercent: 1.00618,
      vwap: 272.54,
    },
  ]);
});
