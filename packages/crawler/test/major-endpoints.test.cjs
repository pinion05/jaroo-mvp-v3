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

test('major endpoints are registered on /api/major paths', async () => {
  const { endpointDefinitions } = await import('../src/server.js');

  assert.equal(
    endpointDefinitions.find((item) => item.id === 'market-fx-usd-krw')?.primaryPath,
    '/api/major/market/fx/usd-krw',
  );
  assert.equal(
    endpointDefinitions.find((item) => item.id === 'wisereport-kr-slim-v1.1')?.primaryPath,
    '/api/major/wisereport-fnguide/kr/companies/:code/slim/v1.1',
  );
  assert.equal(
    endpointDefinitions.find((item) => item.id === 'wisereport-kr-slim-v1.2')?.primaryPath,
    '/api/major/wisereport-fnguide/kr/companies/:code/slim/v1.2',
  );
  assert.equal(
    endpointDefinitions.find((item) => item.id === 'wisereport-global-slim-v1.1')?.primaryPath,
    '/api/major/wisereport-global/us/companies/:ticker/slim/v1.1',
  );
});

test('old source USD/KRW path returns not found after major-path migration', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/source/investing/market/fx/usd-krw`);
    assert.equal(response.status, 404);
    return response.json();
  });

  assert.equal(body.ok, false);
  assert.equal(body.error.message, 'not found');
});
