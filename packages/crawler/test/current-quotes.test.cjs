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
  assert.deepEqual(definition.dataSources, ['naver-finance', 'krx-js-client', 'polygon', 'fmp']);
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

test('getNaverCurrentQuotes maps Naver mobile stock basic payloads to KR quote items', async () => {
  const { getNaverCurrentQuotes } = await import('../src/crawlers/current-quotes.js');
  const requestedUrls = [];

  const result = await getNaverCurrentQuotes(['005930.KS'], {
    naverCurrentQuotesTimeoutMs: null,
    naverFetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify({
        itemCode: '005930',
        closePrice: '85,200',
        localTradedAt: '2026-04-30T15:30:00+09:00',
      }));
    },
  });

  assert.deepEqual(requestedUrls, ['https://m.stock.naver.com/api/stock/005930/basic']);
  assert.deepEqual(result.items, [{
    market: 'KR',
    code: '005930',
    ticker: null,
    price: 85200,
    currency: 'KRW',
    asOf: '2026-04-30T15:30:00+09:00',
    source: 'naver-finance',
    status: 'ok',
  }]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.asOf, '2026-04-30T15:30:00+09:00');
});

test('getNaverCurrentQuotes default timeout tolerates OCI-class Naver latency', async () => {
  const { getNaverCurrentQuotes } = await import('../src/crawlers/current-quotes.js');
  const originalTimeout = process.env.NAVER_CURRENT_QUOTES_TIMEOUT_MS;
  delete process.env.NAVER_CURRENT_QUOTES_TIMEOUT_MS;

  try {
    const result = await getNaverCurrentQuotes(['003720'], {
      naverFetchImpl: async (_url, init = {}) => {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 1_350);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(Object.assign(new Error('synthetic abort'), { name: 'AbortError' }));
          }, { once: true });
        });

        return new Response(JSON.stringify({
          itemCode: '003720',
          closePrice: '12,500',
          localTradedAt: '2026-05-04T16:10:17+09:00',
        }));
      },
    });

    assert.deepEqual(result.items, [{
      market: 'KR',
      code: '003720',
      ticker: null,
      price: 12500,
      currency: 'KRW',
      asOf: '2026-05-04T16:10:17+09:00',
      source: 'naver-finance',
      status: 'ok',
    }]);
    assert.deepEqual(result.missing, []);
  } finally {
    if (originalTimeout === undefined) {
      delete process.env.NAVER_CURRENT_QUOTES_TIMEOUT_MS;
    } else {
      process.env.NAVER_CURRENT_QUOTES_TIMEOUT_MS = originalTimeout;
    }
  }
});

test('getNaverCurrentQuotes limits concurrent Naver mobile quote fetches', async () => {
  const { getNaverCurrentQuotes } = await import('../src/crawlers/current-quotes.js');
  let inFlight = 0;
  let maxInFlight = 0;

  const result = await getNaverCurrentQuotes(['000001', '000002', '000003', '000004', '000005'], {
    naverCurrentQuotesConcurrency: 2,
    naverQuoteFetcher: async (code) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          market: 'KR',
          code,
          ticker: null,
          price: Number(code),
          currency: 'KRW',
          asOf: '2026-04-30T15:30:00+09:00',
          source: 'naver-finance',
          status: 'ok',
        };
      } finally {
        inFlight -= 1;
      }
    },
  });

  assert.equal(maxInFlight, 2);
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.missing, []);
});

test('getCurrentQuotes uses Naver KR quotes first without blocking on KRX snapshot', async () => {
  const { getCurrentQuotes } = await import('../src/crawlers/current-quotes.js');
  let krxCalled = false;

  const result = await getCurrentQuotes({ codes: ['005930'] }, {
    naverQuoteFetcher: async (code) => ({
      market: 'KR',
      code,
      ticker: null,
      price: 85200,
      currency: 'KRW',
      asOf: '2026-04-30T15:30:00+09:00',
      source: 'naver-finance',
      status: 'ok',
    }),
    krxSnapshotFetcher: async () => {
      krxCalled = true;
      return [];
    },
  });

  assert.equal(krxCalled, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].code, '005930');
  assert.equal(result.items[0].price, 85200);
  assert.equal(result.items[0].source, 'naver-finance');
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.asOf, { kr: '2026-04-30T15:30:00+09:00', us: null });
});

test('getCurrentQuotes returns partial Naver KR hits without waiting for KRX fallback', async () => {
  const { getCurrentQuotes } = await import('../src/crawlers/current-quotes.js');
  let krxCalled = false;

  const result = await getCurrentQuotes({ codes: ['005930', '000000'] }, {
    naverQuoteFetcher: async (code) => (code === '005930'
      ? {
        market: 'KR',
        code,
        ticker: null,
        price: 85200,
        currency: 'KRW',
        asOf: '2026-04-30T15:30:00+09:00',
        source: 'naver-finance',
        status: 'ok',
      }
      : null),
    krxSnapshotFetcher: async () => {
      krxCalled = true;
      return [{ code: '000000', 종가: '1' }];
    },
  });

  assert.equal(krxCalled, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].code, '005930');
  assert.equal(result.items[0].source, 'naver-finance');
  assert.deepEqual(result.missing, [{
    market: 'KR',
    code: '000000',
    ticker: null,
    reason: 'not-found',
  }]);
  assert.deepEqual(result.asOf, { kr: '2026-04-30T15:30:00+09:00', us: null });
});

test('getCurrentQuotes falls back to KRX when Naver KR quote is missing', async () => {
  const { getCurrentQuotes } = await import('../src/crawlers/current-quotes.js');

  const result = await getCurrentQuotes({ codes: ['005930'] }, {
    naverQuoteFetcher: async () => null,
    krxTradeDateResolver: async () => '20260416',
    krxSnapshotFetcher: async () => [{ code: '005930', 종가: '85200' }],
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
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.asOf, { kr: '2026-04-16', us: null });
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
    naverQuoteFetcher: async () => null,
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

test('getKrxCurrentQuotes falls back to WiseReport ETF quotes when KRX snapshot misses an ETF code', async () => {
  const { getKrxCurrentQuotes } = await import('../src/crawlers/current-quotes.js');

  const result = await getKrxCurrentQuotes(['102110'], {
    krxTradeDateResolver: async () => '20260423',
    krxSnapshotFetcher: async () => [{ code: '005930', 종가: '85200' }],
    krExchangeProductTypeResolver: (code) => (code === '102110' ? 'ETF' : null),
    krExchangeProductQuoteFetcher: async (code, productType, tradeDate) => ({
      market: 'KR',
      code,
      ticker: null,
      price: 43000,
      currency: 'KRW',
      asOf: '2026-04-23',
      source: productType === 'ETF' ? 'wisereport-etf' : 'wisereport-etn',
      status: 'ok',
      tradeDate,
    }),
  });

  assert.deepEqual(result.items, [{
    market: 'KR',
    code: '102110',
    ticker: null,
    price: 43000,
    currency: 'KRW',
    asOf: '2026-04-23',
    source: 'wisereport-etf',
    status: 'ok',
    tradeDate: '20260423',
  }]);
  assert.deepEqual(result.missing, []);
});

test('getKrxCurrentQuotes falls back to WiseReport ETN quotes when KRX snapshot misses an ETN code', async () => {
  const { getKrxCurrentQuotes } = await import('../src/crawlers/current-quotes.js');

  const result = await getKrxCurrentQuotes(['530092'], {
    krxTradeDateResolver: async () => '20260423',
    krxSnapshotFetcher: async () => [{ code: '005930', 종가: '85200' }],
    krExchangeProductTypeResolver: (code) => (code === '530092' ? 'ETN' : null),
    krExchangeProductQuoteFetcher: async (code, productType) => ({
      market: 'KR',
      code,
      ticker: null,
      price: 4145,
      currency: 'KRW',
      asOf: '2026-04-23',
      source: productType === 'ETN' ? 'wisereport-etn' : 'wisereport-etf',
      status: 'ok',
    }),
  });

  assert.deepEqual(result.items, [{
    market: 'KR',
    code: '530092',
    ticker: null,
    price: 4145,
    currency: 'KRW',
    asOf: '2026-04-23',
    source: 'wisereport-etn',
    status: 'ok',
  }]);
  assert.deepEqual(result.missing, []);
});
