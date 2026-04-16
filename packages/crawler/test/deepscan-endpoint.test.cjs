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
  assert.equal('aliases' in definition, false);
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

test('GET /api/deepscan returns raw input-invalid payload with HTTP 400 on the primary path', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const params = new URLSearchParams({
      name: '삼성전자',
      from: 'holding',
    });
    const response = await fetch(`${baseUrl}/api/deepscan?${params.toString()}`);

    assert.equal(response.status, 400);
    return response.json();
  });

  assert.equal(Object.prototype.hasOwnProperty.call(body, 'ok'), false);
  assert.equal(body.metadata.errorCode, 'input-invalid');
  assert.equal(body.metadata.inputValidity.valid, false);
  assert.deepEqual(body.metadata.inputValidity.missing, ['instrument.code', 'instrument.ticker']);
  assert.equal(body.hero.blockState, 'blocked');
});

test('GET /crawl/deepscan returns not found after alias removal', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/crawl/deepscan?code=005930`);

    assert.equal(response.status, 404);
    return response.json();
  });

  assert.equal(body.ok, false);
  assert.equal(body.error.message, 'not found');
});

test('GET /api/deepscan maps thrown errors to a raw canonical internal service error payload', async () => {
  const { app, endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'deepscan-canonical');

  assert.ok(definition);

  const originalHandler = definition.handler;
  definition.handler = async () => {
    throw new Error('boom');
  };

  try {
    const body = await withServer(app, async (baseUrl) => {
      const params = new URLSearchParams({
        name: '삼성전자',
        from: 'holding',
      });
      const response = await fetch(`${baseUrl}/api/deepscan?${params.toString()}`);

      assert.equal(response.status, 500);
      return response.json();
    });

    assert.equal(Object.prototype.hasOwnProperty.call(body, 'ok'), false);
    assert.equal(body.metadata.errorCode, 'internal-service-error');
    assert.equal(body.metadata.inputValidity.valid, false);
    assert.equal(body.metadata.inputValidity.reason, 'internal payload assembly failure');
    assert.equal(body.hero.blockState, 'error');
    assert.equal(body.hero.headline, 'DeepScan payload 생성 중 오류가 발생했습니다');
    assert.equal(body.hero.body, 'Crawler 서비스 내부 오류로 canonical error payload를 반환했습니다.');
    assert.equal(body.hero.statusText, '서비스 오류');
    assert.deepEqual(body.committee.axes, []);
    assert.equal(body.insights.sectionLabel, '서비스 오류');
    assert.deepEqual(body.insights.items, []);
    assert.equal(body.strategy.weekSignal, 'Unavailable');
    assert.equal(body.strategy.scenarioCondition, '내부 오류로 전략 시나리오를 계산할 수 없습니다.');
    assert.equal(body.sellNow.realizedText, '내부 오류로 sell-now canonical block을 만들 수 없습니다.');
    assert.equal(body.portfolioSimulation.caption, '내부 오류로 포트폴리오 시뮬레이션을 계산할 수 없습니다.');
    assert.equal(body.input.instrument.name, '삼성전자');
    assert.equal(body.input.sourceContext.from, 'holding');
  } finally {
    definition.handler = originalHandler;
  }
});
