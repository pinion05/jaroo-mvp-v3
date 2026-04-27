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

const EXPECTED_ARCHIVED_IDS = [
  'wisereport-kr',
  'wisereport-kr-slim-v1',
  'wisereport-kr-company-overview',
  'wisereport-kr-financial-analysis',
  'wisereport-kr-investment-indicators',
  'wisereport-kr-consensus',
  'wisereport-kr-shareholding',
  'wisereport-kr-recent-reports',
  'wisereport-kr-fnguide-finance',
  'wisereport-kr-relative-return',
  'wisereport-kr-opinion',
  'wisereport-kr-style-analysis',
  'wisereport-global',
  'wisereport-global-domain',
  'wisereport-global-slim-v1',
];

test('only current WiseReport slim endpoints remain active', async () => {
  const { endpointDefinitions, archivedEndpointDefinitions } = await import('../src/server.js');

  const activeWiseReportIds = endpointDefinitions
    .map((definition) => definition.id)
    .filter((id) => id.startsWith('wisereport-'));
  const archivedWiseReportIds = archivedEndpointDefinitions
    .map((definition) => definition.id)
    .filter((id) => id.startsWith('wisereport-'));

  assert.deepEqual(activeWiseReportIds.sort(), [
    'wisereport-global-slim-v1.1',
    'wisereport-kr-slim-v1.1',
    'wisereport-kr-slim-v1.2',
  ]);
  assert.deepEqual(archivedWiseReportIds.sort(), [...EXPECTED_ARCHIVED_IDS].sort());
});

test('archived WiseReport routes return 404', async () => {
  const { app } = await import('../src/server.js');

  await withServer(app, async (baseUrl) => {
    for (const path of [
      '/api/source/wisereport-fnguide/kr/companies/005930',
      '/api/source/wisereport/kr/companies/005930/company-overview',
      '/api/source/fnguide/kr/companies/005930/opinion',
      '/api/source/wisereport-global/us/companies/NVDA',
      '/api/source/wisereport-global/us/companies/NVDA/domain',
      '/api/source/wisereport-global/us/companies/NVDA/slim/v1',
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 404, path);
    }
  });
});
