const test = require('node:test');
const assert = require('node:assert/strict');

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('quotes-current endpoint definition is registered', async () => {
  const { endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'quotes-current');

  assert.ok(definition);
  assert.equal(definition.primaryPath, '/api/source/krx-polygon-fmp/market/quotes/current');
  assert.equal('aliases' in definition, false);
  assert.deepEqual(definition.dataSources, ['krx-js-client', 'polygon', 'fmp']);
  assert.ok(definition.query.includes('codes(optional, csv)'));
  assert.ok(definition.query.includes('tickers(optional, csv)'));
});

test('GET explicit-source quotes path returns standard success envelope with item-based count', async () => {
  const { app, endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'quotes-current');
  assert.ok(definition);

  const fixture = {
    requested: { codes: ['005930'], tickers: ['AAPL'] },
    items: [
      { market: 'KR', code: '005930', ticker: null, price: 85200, currency: 'KRW', asOf: '2026-04-14', source: 'krx', status: 'ok' },
      { market: 'US', code: null, ticker: 'AAPL', price: 259.2, currency: 'USD', asOf: '2026-04-14T20:00:00Z', source: 'polygon', status: 'ok' },
    ],
    missing: [],
  };

  const originalHandler = definition.handler;
  definition.handler = async () => fixture;

  try {
    const body = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/source/krx-polygon-fmp/market/quotes/current?codes=005930&tickers=AAPL`);
      assert.equal(response.status, 200);
      return response.json();
    });

    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.deepEqual(body.data, fixture);
    assert.equal(body.meta.routeId, 'quotes-current');
  } finally {
    definition.handler = originalHandler;
  }
});

test('GET explicit-source quotes path rejects empty query', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/source/krx-polygon-fmp/market/quotes/current`);
    assert.equal(response.status, 400);
    return response.json();
  });

  assert.equal(body.ok, false);
  assert.equal(body.error.message, 'missing query: codes_or_tickers');
});

test('GET /api/quotes/current returns not found after source-path migration', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/quotes/current?codes=005930`);
    assert.equal(response.status, 404);
    return response.json();
  });

  assert.equal(body.ok, false);
  assert.equal(body.error.message, 'not found');
});


test('getKrxCurrentQuotes returns dependency-unavailable when krx dependency cannot be loaded', async () => {
  const { getKrxCurrentQuotes } = await import('../src/crawlers/current-quotes.js');

  const result = await getKrxCurrentQuotes(['005930'], {
    krxTradeDateResolver: async () => '20260416',
    krxSnapshotFetcher: async () => {
      const error = new Error("Cannot find package 'krx-js-client' imported from test");
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    },
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.asOf, null);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].market, 'KR');
  assert.equal(result.missing[0].code, '005930');
  assert.equal(result.missing[0].reason, 'dependency-unavailable');
  assert.match(result.missing[0].message, /krx-js-client/i);
});

test('getUsCurrentQuotes returns provider-not-configured when polygon and fmp are unavailable', async () => {
  const { getUsCurrentQuotes } = await import('../src/crawlers/current-quotes.js');

  const result = await getUsCurrentQuotes(['AAPL'], {
    providerStatus: {
      polygon: { apiName: 'polygon', configured: false, available: false, cooldownRemainingMs: 0, exhausted: false },
      fmp: { apiName: 'fmp', configured: false, available: false, cooldownRemainingMs: 0, exhausted: false },
    },
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.missing.length, 1);
  assert.deepEqual(result.missing[0], {
    market: 'US',
    code: null,
    ticker: 'AAPL',
    reason: 'provider-not-configured',
    providers: ['polygon', 'fmp'],
    message: 'polygon, fmp providers are not configured',
  });
});

test('getCurrentQuotes preserves KR success while reporting explicit US provider-not-configured failures', async () => {
  const { getCurrentQuotes } = await import('../src/crawlers/current-quotes.js');

  const result = await getCurrentQuotes({ codes: ['005930'], tickers: ['AAPL'] }, {
    krxTradeDateResolver: async () => '20260416',
    krxSnapshotFetcher: async () => [{ code: '005930', 종가: '85200' }],
    providerStatus: {
      polygon: { apiName: 'polygon', configured: false, available: false, cooldownRemainingMs: 0, exhausted: false },
      fmp: { apiName: 'fmp', configured: false, available: false, cooldownRemainingMs: 0, exhausted: false },
    },
  });

  assert.deepEqual(result.requested, {
    codes: ['005930'],
    tickers: ['AAPL'],
    tradeDate: null,
  });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    market: 'KR',
    code: '005930',
    ticker: null,
    price: 85200,
    currency: 'KRW',
    asOf: '2026-04-16',
    source: 'krx',
    status: 'ok',
  });
  assert.deepEqual(result.missing, [{
    market: 'US',
    code: null,
    ticker: 'AAPL',
    reason: 'provider-not-configured',
    providers: ['polygon', 'fmp'],
    message: 'polygon, fmp providers are not configured',
  }]);
  assert.deepEqual(result.asOf, { kr: '2026-04-16', us: null });
  assert.deepEqual(result.providerStatus, {
    polygon: { apiName: 'polygon', configured: false, available: false, cooldownRemainingMs: 0, exhausted: false },
    fmp: { apiName: 'fmp', configured: false, available: false, cooldownRemainingMs: 0, exhausted: false },
  });
});
