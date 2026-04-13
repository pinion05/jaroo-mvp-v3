const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

let createTickerSearchServer;
try {
  ({ createTickerSearchServer } = require('../src/ko-fuzzy-http-server'));
} catch {
  createTickerSearchServer = null;
}

function createServer(overrides = {}) {
  return createTickerSearchServer({
    krStockMapPath: path.join(repoRoot, 'data/kr/kr-stock-name-to-code.json'),
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
    ...overrides,
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

test('exports createTickerSearchServer', () => {
  assert.equal(typeof createTickerSearchServer, 'function');
});

test('HTTP endpoint returns ticker candidates for Korean typo query', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ticker-search?q=${encodeURIComponent('파란티어')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.query, '파란티어');
    assert.equal(payload.topN, 3);
    assert.ok(Array.isArray(payload.results));
    assert.ok(payload.results.some((item) => item.ticker === 'PLTR'));
  } finally {
    await closeServer(server);
  }
});

test('통합 엔드포인트는 한국 주식명을 코드로 반환한다', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stock-search?q=${encodeURIComponent('삼성전자')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.query, '삼성전자');
    assert.equal(payload.topN, 3);
    assert.deepEqual(payload.kr, {
      matched: true,
      matchedBy: 'exact',
      name: '삼성전자',
      code: '005930',
    });
    assert.deepEqual(payload.us.results, []);
  } finally {
    await closeServer(server);
  }
});

test('통합 엔드포인트는 해외 주식 한글 오타를 퍼지 티커 후보로 반환한다', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stock-search?q=${encodeURIComponent('파란티어')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.deepEqual(payload.kr, {
      matched: false,
      matchedBy: null,
      name: null,
      code: null,
    });
    assert.ok(Array.isArray(payload.us.results));
    assert.ok(payload.us.results.some((item) => item.ticker === 'PLTR'));
  } finally {
    await closeServer(server);
  }
});

test('통합 엔드포인트는 compact 충돌이 있는 한국 주식명은 보수적으로 미매칭 처리한다', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stock-search?q=${encodeURIComponent('S T C')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.deepEqual(payload.kr, {
      matched: false,
      matchedBy: null,
      name: null,
      code: null,
    });
  } finally {
    await closeServer(server);
  }
});

test('통합 엔드포인트는 compact exact 매칭 성공 케이스를 반환한다', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stock-search?q=${encodeURIComponent('CJCGV')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.deepEqual(payload.kr, {
      matched: true,
      matchedBy: 'compact',
      name: 'CJ CGV',
      code: '079160',
    });
    assert.deepEqual(payload.us.results, []);
  } finally {
    await closeServer(server);
  }
});

test('잘못된 KR 맵 경로가 있어도 기존 해외주식 티커 엔드포인트는 동작한다', async () => {
  const server = createTickerSearchServer({
    krStockMapPath: path.join(repoRoot, 'data/kr/not-found.json'),
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ticker-search?q=${encodeURIComponent('파란티어')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.ok(payload.results.some((item) => item.ticker === 'PLTR'));
  } finally {
    await closeServer(server);
  }
});

test('잘못된 KR 맵 경로여도 통합 엔드포인트는 해외주식 퍼지 결과로 degrade 한다', async () => {
  const server = createTickerSearchServer({
    krStockMapPath: path.join(repoRoot, 'data/kr/not-found.json'),
    koMapPath: path.join(repoRoot, 'data/us/us-stock-name-ko-to-ticker-coverage100.json'),
    tickerInfoPath: path.join(repoRoot, 'data/us/us-stock-ticker-to-ko-en-coverage100.json'),
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/stock-search?q=${encodeURIComponent('파란티어')}&topN=3`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.deepEqual(payload.kr, {
      matched: false,
      matchedBy: null,
      name: null,
      code: null,
    });
    assert.ok(payload.us.results.some((item) => item.ticker === 'PLTR'));
  } finally {
    await closeServer(server);
  }
});

test('HTTP server normalizes custom route paths before matching', async () => {
  const server = createServer({
    endpointPath: 'api/custom-search/',
    unifiedEndpointPath: 'api/custom-stock-search/',
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const tickerResponse = await fetch(`http://127.0.0.1:${address.port}/api/custom-search?q=${encodeURIComponent('파란티어')}&topN=3`);
    assert.equal(tickerResponse.status, 200);
    const tickerPayload = await tickerResponse.json();
    assert.ok(tickerPayload.results.some((item) => item.ticker === 'PLTR'));

    const unifiedResponse = await fetch(`http://127.0.0.1:${address.port}/api/custom-stock-search?q=${encodeURIComponent('삼성전자')}&topN=3`);
    assert.equal(unifiedResponse.status, 200);
    const unifiedPayload = await unifiedResponse.json();
    assert.equal(unifiedPayload.kr.code, '005930');
  } finally {
    await closeServer(server);
  }
});

test('HTTP endpoint rejects empty query with 400', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ticker-search`);
    assert.equal(response.status, 400);

    const payload = await response.json();
    assert.equal(payload.error, 'query is required');
  } finally {
    await closeServer(server);
  }
});

test('HTTP handler returns 400 for malformed request URLs instead of throwing', () => {
  const server = createServer();

  const response = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };

  assert.doesNotThrow(() => {
    server.emit('request', { method: 'GET', url: 'http://%' }, response);
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'invalid url' });
});

test('HTTP server CLI rejects missing numeric value for --port', () => {
  const cliPath = path.join(repoRoot, 'bin/ko-fuzzy-http-server.js');
  const result = spawnSync(process.execPath, [cliPath, '--port', '--host', '127.0.0.1'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--port requires a numeric argument/);
});

test('HTTP server CLI rejects missing values for path flags', () => {
  const cliPath = path.join(repoRoot, 'bin/ko-fuzzy-http-server.js');
  const result = spawnSync(process.execPath, [cliPath, '--kr-stock-map'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--kr-stock-map requires a path argument/);
});

test('HTTP server rejects colliding endpoint paths before startup', () => {
  assert.throws(() => {
    createServer({
      endpointPath: '/api/shared',
      unifiedEndpointPath: '/api/shared',
    });
  }, /endpoint paths must be distinct/i);
});
