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

test('catalog endpoint definition omits alias metadata', async () => {
  const { endpointDefinitions } = await import('../src/server.js');
  const definition = endpointDefinitions.find((item) => item.id === 'catalog');

  assert.ok(definition);
  assert.equal(definition.primaryPath, '/api/source/system/catalog');
  assert.equal('aliases' in definition, false);
  assert.deepEqual(definition.dataSources, ['system']);
});

test('GET /api/source/system/catalog returns endpoint entries with explicit data sources', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/source/system/catalog`);
    assert.equal(response.status, 200);
    return response.json();
  });

  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.data.endpoints));
  assert.ok(body.data.endpoints.length > 0);
  assert.equal('aliases' in body.data.endpoints[0], false);
  assert.ok(Array.isArray(body.data.endpoints[0].dataSources));
});

test('GET /api/catalog returns not found after source-path migration', async () => {
  const { app } = await import('../src/server.js');

  const body = await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/catalog`);
    assert.equal(response.status, 404);
    return response.json();
  });

  assert.equal(body.ok, false);
  assert.equal(body.error.message, 'not found');
});
