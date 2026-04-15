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

test('deepscan-canonical endpoint definition is registered', async () => {
  const { endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'deepscan-canonical');

  assert.ok(definition);
  assert.equal(definition.primaryPath, '/api/deepscan');
  assert.deepEqual(definition.aliases, ['/crawl/deepscan']);
  assert.deepEqual(definition.query, [
    'market(optional)',
    'code(optional)',
    'ticker(optional)',
    'name(optional)',
    'shares(optional)',
    'averagePrice(optional)',
    'evaluationAmount(optional)',
    'selectedAt(optional)',
    'from(optional)',
  ]);
});

test('GET /api/deepscan returns raw canonical payload and builds input from query params', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const params = new URLSearchParams({
      market: 'KR',
      code: '005930',
      name: '삼성전자',
      shares: '12',
      averagePrice: '71000',
      evaluationAmount: '1022400',
      selectedAt: '2026-04-15T09:00:00.000Z',
      from: 'holding',
    });
    const response = await fetch(`${baseUrl}/api/deepscan?${params.toString()}`);

    assert.equal(response.status, 200);
    return response.json();
  });

  assert.equal(Object.prototype.hasOwnProperty.call(body, 'ok'), false);
  assert.equal(body.metadata.errorCode, undefined);
  assert.equal(body.input.instrument.market, 'KR');
  assert.equal(body.input.instrument.code, '005930');
  assert.equal(body.input.instrument.name, '삼성전자');
  assert.equal(body.input.holding.shares, '12');
  assert.equal(body.input.holding.averagePrice, '71000');
  assert.equal(body.input.holding.evaluationAmount, '1022400');
  assert.equal(body.input.selectedAt, '2026-04-15T09:00:00.000Z');
  assert.equal(body.input.sourceContext.from, 'holding');
});

test('GET /crawl/deepscan returns raw input-invalid payload with HTTP 400', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const params = new URLSearchParams({
      name: '삼성전자',
      from: 'holding',
    });
    const response = await fetch(`${baseUrl}/crawl/deepscan?${params.toString()}`);

    assert.equal(response.status, 400);
    return response.json();
  });

  assert.equal(Object.prototype.hasOwnProperty.call(body, 'ok'), false);
  assert.equal(body.metadata.errorCode, 'input-invalid');
  assert.equal(body.metadata.inputValidity.valid, false);
  assert.deepEqual(body.metadata.inputValidity.missing, ['instrument.code', 'instrument.ticker']);
  assert.equal(body.hero.blockState, 'blocked');
});

test('GET /api/deepscan maps canonical internal service error payloads to HTTP 500', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const { app, endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'deepscan-canonical');

  assert.ok(definition);

  const rawInput = {
    selectedAt: '2026-04-16T00:00:00.000Z',
  };

  Object.defineProperty(rawInput, 'instrument', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });

  const fixture = await buildJarooDeepScanPayload(rawInput);
  const originalHandler = definition.handler;
  definition.handler = async () => fixture;

  try {
    const body = await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/deepscan`);

      assert.equal(response.status, 500);
      return response.json();
    });

    assert.equal(Object.prototype.hasOwnProperty.call(body, 'ok'), false);
    assert.equal(body.metadata.errorCode, 'internal-service-error');
    assert.equal(body.hero.blockState, 'error');
  } finally {
    definition.handler = originalHandler;
  }
});
