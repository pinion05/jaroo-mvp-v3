const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');

const VALID_INPUT = Object.freeze({
  stockCode: '005930',
  holdingQty: '12',
  avgPrice: '71000',
});

const VALID_RUNTIME_OPTIONS = Object.freeze({
  sshHost: 'tester@example.com',
  identityPath: '/tmp/test-identity',
  knownHostsPath: '/tmp/test-known-hosts',
  remoteDir: '/tmp/jaroo-report-package',
  nodeBin: '/opt/node/bin/node',
});

function createValidPayload(overrides = {}) {
  return {
    stockCode: '005930',
    reportContent: 'final',
    boardAnalysis: {
      boardOpinions: [],
    },
    marketScoreSnapshot: {
      totalScore: 73,
    },
    listingMarket: 'KOSPI',
    timestamp: '2026-04-15T12:00:00.000Z',
    ...overrides,
  };
}

async function withEnv(overrides, run) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('buildDeepScanKrPackageCommand requires env or option SSH/runtime config, applies overrides, and is re-exported from the crawler public API', async () => {
  const service = await import('../src/services/deepscan-kr-package-adapter.js');
  const publicApi = await import('../src/index.js');

  assert.equal(publicApi.buildDeepScanKrPackageCommand, service.buildDeepScanKrPackageCommand);
  assert.equal(publicApi.invokeDeepScanKrPackage, service.invokeDeepScanKrPackage);
  assert.equal(publicApi.parseDeepScanKrPackageStdout, service.parseDeepScanKrPackageStdout);

  await withEnv(
    {
      DEEPSCAN_KR_PACKAGE_SSH_HOST: undefined,
      DEEPSCAN_KR_PACKAGE_SSH_IDENTITY: undefined,
      DEEPSCAN_KR_PACKAGE_SSH_KNOWN_HOSTS: undefined,
      DEEPSCAN_KR_PACKAGE_REMOTE_DIR: undefined,
      DEEPSCAN_KR_PACKAGE_NODE_BIN: undefined,
      DEEPSCAN_KR_PACKAGE_NODE_PATH: undefined,
    },
    async () => {
      const missingConfig = service.buildDeepScanKrPackageCommand(VALID_INPUT, {
        timeoutMs: 4321,
      });

      assert.equal(missingConfig.ok, false);
      assert.equal(missingConfig.error.code, 'invalid-input');
      assert.deepEqual([...missingConfig.error.details].sort(), [
        'identityPath must be a non-empty absolute path string',
        'knownHostsPath must be a non-empty absolute path string',
        'remoteDir must be a non-empty absolute POSIX path string',
        'sshHost must be a non-empty ssh destination without whitespace or option-like prefixes',
      ].sort());
    },
  );

  await withEnv(
    {
      DEEPSCAN_KR_PACKAGE_SSH_HOST: VALID_RUNTIME_OPTIONS.sshHost,
      DEEPSCAN_KR_PACKAGE_SSH_IDENTITY: VALID_RUNTIME_OPTIONS.identityPath,
      DEEPSCAN_KR_PACKAGE_SSH_KNOWN_HOSTS: VALID_RUNTIME_OPTIONS.knownHostsPath,
      DEEPSCAN_KR_PACKAGE_REMOTE_DIR: VALID_RUNTIME_OPTIONS.remoteDir,
      DEEPSCAN_KR_PACKAGE_NODE_BIN: VALID_RUNTIME_OPTIONS.nodeBin,
    },
    async () => {
      const result = service.buildDeepScanKrPackageCommand(VALID_INPUT, {
        timeoutMs: 4321,
      });

      assert.equal(result.ok, true);
      assert.equal(result.command, 'ssh');
      assert.equal(result.input.stockCode, '005930');
      assert.equal(result.input.holdingQty, '12');
      assert.equal(result.input.avgPrice, '71000');
      assert.equal(result.timeoutMs, 4321);
      assert.equal(result.ssh.host, VALID_RUNTIME_OPTIONS.sshHost);
      assert.equal(result.ssh.remoteDir, VALID_RUNTIME_OPTIONS.remoteDir);
      assert.equal(result.ssh.nodeBin, VALID_RUNTIME_OPTIONS.nodeBin);
      assert.equal(result.execFileOptions.timeout, 4321);
      assert.ok(result.args.includes(VALID_RUNTIME_OPTIONS.sshHost));
      assert.match(result.remoteCommand, /generateInvestmentReport/);
      assert.match(result.remoteCommand, /src\/package\.js/);
      assert.match(result.remoteCommand, /base64/);
    },
  );
});

test('buildDeepScanKrPackageCommand rejects option-like ssh host values', async () => {
  const { buildDeepScanKrPackageCommand } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = buildDeepScanKrPackageCommand(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    sshHost: '-oProxyCommand=evil',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-input');
  assert.ok(result.error.details.includes('sshHost must be a non-empty ssh destination without whitespace or option-like prefixes'));
});

test('buildDeepScanKrPackageCommand validates runtime path and executable config before ssh invocation', async () => {
  const { buildDeepScanKrPackageCommand } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = buildDeepScanKrPackageCommand(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    remoteDir: 'relative/remote-dir',
    nodeBin: 'node --inspect',
    identityPath: 'relative-identity',
    knownHostsPath: 'relative-known-hosts',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-input');
  assert.deepEqual([...result.error.details].sort(), [
    'identityPath must be a non-empty absolute path string',
    'knownHostsPath must be a non-empty absolute path string',
    'nodeBin must be a non-empty executable name or absolute path string',
    'remoteDir must be a non-empty absolute POSIX path string',
  ].sort());
});

test('buildDeepScanKrPackageCommand validates local cache and snapshot directory config before path joins', async () => {
  const { buildDeepScanKrPackageCommand } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = buildDeepScanKrPackageCommand(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    cacheDir: 1,
    snapshotDir: 'relative-snapshots',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-input');
  assert.deepEqual([...result.error.details].sort(), [
    'cacheDir must be a non-empty absolute path string when provided',
    'snapshotDir must be a non-empty absolute path string when provided',
  ].sort());
});

test('buildDeepScanKrPackageCommand returns structured validation errors for invalid KR package input', async () => {
  const { buildDeepScanKrPackageCommand } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = buildDeepScanKrPackageCommand(
    {
      stockCode: '5930',
      holdingQty: '0',
      avgPrice: '-10',
    },
    {
      ...VALID_RUNTIME_OPTIONS,
      timeoutMs: 0,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-input');
  assert.deepEqual([...result.error.details].sort(), [
    'stockCode must be a 6-digit KR stock code string',
    'holdingQty must be a positive numeric string or number',
    'avgPrice must be a positive numeric string or number',
    'timeoutMs must be a positive integer when provided',
  ].sort());
});

test('parseDeepScanKrPackageStdout extracts the final JSON payload from noisy stdout', async () => {
  const { parseDeepScanKrPackageStdout } = await import('../src/services/deepscan-kr-package-adapter.js');

  const stdout = [
    '[deepscan] booting',
    '```json',
    '{"level":"info"}',
    '```',
    '[deepscan] finished',
    JSON.stringify(createValidPayload()),
  ].join('\n');

  const result = parseDeepScanKrPackageStdout(stdout);

  assert.equal(result.ok, true);
  assert.equal(result.data.reportContent, 'final');
  assert.equal(result.data.marketScoreSnapshot.totalScore, 73);
  assert.equal(result.jsonText.includes('"reportContent":"final"'), true);
});

test('parseDeepScanKrPackageStdout rejects unrelated JSON objects', async () => {
  const { parseDeepScanKrPackageStdout } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = parseDeepScanKrPackageStdout('{"level":"info","message":"done"}');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'parse-failed');
});

test('parseDeepScanKrPackageStdout rejects payloads missing required package fields', async () => {
  const { parseDeepScanKrPackageStdout } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = parseDeepScanKrPackageStdout('{"stockCode":"005930","reportContent":"partial","timestamp":"2026-04-15T12:00:00.000Z"}');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'parse-failed');
});

test('parseDeepScanKrPackageStdout rejects null or empty placeholders for structured payload fields', async () => {
  const { parseDeepScanKrPackageStdout } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = parseDeepScanKrPackageStdout(JSON.stringify(createValidPayload({
    boardAnalysis: null,
    marketScoreSnapshot: {},
  })));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'parse-failed');
});

test('parseDeepScanKrPackageStdout rejects malformed scalar payload fields', async () => {
  const { parseDeepScanKrPackageStdout } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = parseDeepScanKrPackageStdout(JSON.stringify(createValidPayload({
    reportContent: '',
    timestamp: 'not-a-date',
    listingMarket: { bad: true },
  })));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'parse-failed');
});

test('invokeDeepScanKrPackage retries once, parses stdout, forwards timeout to execFile, and redacts raw output by default', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  const calls = [];
  const execFile = async (command, args, options) => {
    calls.push({ command, args, options });

    if (calls.length === 1) {
      const error = new Error('ssh handshake failed');
      error.stderr = 'Connection reset';
      throw error;
    }

    return {
      stdout: `INFO before payload\n${JSON.stringify(createValidPayload({
        reportContent: 'ok',
        boardAnalysis: { boardOpinions: [{ name: 'A' }] },
        marketScoreSnapshot: { totalScore: 80 },
      }))}`,
      stderr: '',
    };
  };

  const result = await invokeDeepScanKrPackage(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    execFile,
    timeoutMs: 9876,
    maxRetries: 1,
    retryDelayMs: 0,
    enableCache: false,
    enableSnapshots: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.listingMarket, 'KOSPI');
  assert.equal(result.meta.attemptCount, 2);
  assert.equal(result.meta.timeoutMs, 9876);
  assert.equal(result.meta.ssh, undefined);
  assert.equal(Object.hasOwn(result, 'stdout'), false);
  assert.equal(Object.hasOwn(result, 'stderr'), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'ssh');
  assert.equal(calls[0].options.timeout, 9876);
});

test('invokeDeepScanKrPackage returns a structured timeout error after exhausting retries without leaking raw diagnostics', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  let attemptCount = 0;
  const execFile = async () => {
    attemptCount += 1;
    const error = new Error('Command failed: ssh');
    error.killed = true;
    error.signal = 'SIGTERM';
    error.code = null;
    error.stdout = 'debug stdout';
    error.stderr = 'timed out';
    throw error;
  };

  const result = await invokeDeepScanKrPackage(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    execFile,
    timeoutMs: 111,
    maxRetries: 1,
    retryDelayMs: 0,
    enableCache: false,
    enableSnapshots: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'timeout');
  assert.equal(result.error.retryable, true);
  assert.equal(result.error.details, undefined);
  assert.equal(result.meta.attemptCount, 2);
  assert.equal(result.meta.ssh, undefined);
  assert.equal(Object.hasOwn(result, 'stdout'), false);
  assert.equal(Object.hasOwn(result, 'stderr'), false);
  assert.equal(attemptCount, 2);
});

test('invokeDeepScanKrPackage marks auth failures as non-retryable and redacts ssh/runtime diagnostics by default', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  let attemptCount = 0;
  const execFile = async () => {
    attemptCount += 1;
    const error = new Error('Command failed: ssh');
    error.code = 255;
    error.stdout = 'sensitive stdout';
    error.stderr = 'Permission denied (publickey,password,keyboard-interactive).';
    throw error;
  };

  const result = await invokeDeepScanKrPackage(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    execFile,
    timeoutMs: 222,
    maxRetries: 3,
    retryDelayMs: 0,
    enableCache: false,
    enableSnapshots: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'remote-invocation-failed');
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.details, undefined);
  assert.equal(result.meta.ssh, undefined);
  assert.equal(Object.hasOwn(result, 'stdout'), false);
  assert.equal(Object.hasOwn(result, 'stderr'), false);
  assert.equal(attemptCount, 1);
});

test('invokeDeepScanKrPackage parse failures redact raw stdout and ssh metadata by default', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = await invokeDeepScanKrPackage(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    execFile: async () => ({ stdout: '{"level":"info"}', stderr: 'raw stderr' }),
    maxRetries: 0,
    enableCache: false,
    enableSnapshots: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'parse-failed');
  assert.equal(result.meta.ssh, undefined);
  assert.equal(Object.hasOwn(result, 'stdout'), false);
  assert.equal(Object.hasOwn(result, 'stderr'), false);
});

test('invokeDeepScanKrPackage rejects mismatched stock codes from the remote payload', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  const result = await invokeDeepScanKrPackage(VALID_INPUT, {
    ...VALID_RUNTIME_OPTIONS,
    execFile: async () => ({
      stdout: JSON.stringify(createValidPayload({
        stockCode: '000660',
        reportContent: 'wrong-stock',
      })),
      stderr: '',
    }),
    maxRetries: 0,
    enableCache: false,
    enableSnapshots: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'stock-code-mismatch');
  assert.equal(result.error.retryable, false);
});

test('invokeDeepScanKrPackage caches successful results without persisting raw stdout or stderr', async () => {
  const service = await import('../src/services/deepscan-kr-package-adapter.js');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepscan-kr-cache-test-'));
  const cacheDir = path.join(tempRoot, 'cache');
  const snapshotDir = path.join(tempRoot, 'snapshots');
  let attemptCount = 0;

  try {
    const execFile = async () => {
      attemptCount += 1;
      return {
        stdout: JSON.stringify(createValidPayload({
          reportContent: 'cached',
        })),
        stderr: 'should-not-persist',
      };
    };

    const first = await service.invokeDeepScanKrPackage(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      execFile,
      cacheDir,
      snapshotDir,
      maxRetries: 0,
    });
    const second = await service.invokeDeepScanKrPackage(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      execFile,
      cacheDir,
      snapshotDir,
      maxRetries: 0,
    });
    const command = service.buildDeepScanKrPackageCommand(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      cacheDir,
      snapshotDir,
    });
    const cached = JSON.parse(await readFile(command.cache.filePath, 'utf8'));

    assert.equal(first.ok, true);
    assert.equal(first.meta.cache.hit, false);
    assert.equal(second.ok, true);
    assert.equal(second.meta.cache.hit, true);
    assert.equal(second.meta.ssh, undefined);
    assert.equal(Object.hasOwn(second, 'stdout'), false);
    assert.equal(Object.hasOwn(second, 'stderr'), false);
    assert.equal(attemptCount, 1);
    assert.equal(cached.ok, true);
    assert.deepEqual(cached.data, first.data);
    assert.equal(Object.hasOwn(cached, 'stdout'), false);
    assert.equal(Object.hasOwn(cached, 'stderr'), false);
    assert.equal(Object.hasOwn(cached, 'jsonText'), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('invokeDeepScanKrPackage ignores poisoned cache entries with mismatched stockCode', async () => {
  const service = await import('../src/services/deepscan-kr-package-adapter.js');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepscan-kr-cache-poison-test-'));
  const cacheDir = path.join(tempRoot, 'cache');
  const snapshotDir = path.join(tempRoot, 'snapshots');
  let attemptCount = 0;

  try {
    const command = service.buildDeepScanKrPackageCommand(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      cacheDir,
      snapshotDir,
    });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(command.cache.filePath, JSON.stringify({
      ok: true,
      data: createValidPayload({
        stockCode: '000660',
        reportContent: 'poisoned',
      }),
      cachedAt: '2026-04-16T00:00:00.000Z',
    }, null, 2));

    const result = await service.invokeDeepScanKrPackage(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      cacheDir,
      snapshotDir,
      maxRetries: 0,
      execFile: async () => {
        attemptCount += 1;
        return {
          stdout: JSON.stringify(createValidPayload({
            reportContent: 'fresh',
          })),
          stderr: '',
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.meta.cache.hit, false);
    assert.equal(result.data.stockCode, '005930');
    assert.equal(attemptCount, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('invokeDeepScanKrPackage writes success snapshots without persisting raw stdout or stderr', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepscan-kr-snapshot-test-'));
  const cacheDir = path.join(tempRoot, 'cache');
  const snapshotDir = path.join(tempRoot, 'snapshots');

  try {
    const result = await invokeDeepScanKrPackage(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      execFile: async () => ({
        stdout: `banner\n${JSON.stringify(createValidPayload({ reportContent: 'snapshot' }))}`,
        stderr: 'should-not-persist',
      }),
      cacheDir,
      snapshotDir,
      maxRetries: 0,
    });

    assert.equal(result.ok, true);
    const snapshotFiles = await readdir(snapshotDir);
    assert.equal(snapshotFiles.length, 1);
    const snapshotText = await readFile(path.join(snapshotDir, snapshotFiles[0]), 'utf8');
    const snapshot = JSON.parse(snapshotText);
    assert.equal(snapshot.kind, 'success');
    assert.equal(snapshot.parsedData.reportContent, 'snapshot');
    assert.equal(Object.hasOwn(snapshot, 'stdout'), false);
    assert.equal(Object.hasOwn(snapshot, 'stderr'), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('invokeDeepScanKrPackage treats cache and snapshot persistence as best-effort', async () => {
  const { invokeDeepScanKrPackage } = await import('../src/services/deepscan-kr-package-adapter.js');

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepscan-kr-best-effort-test-'));
  const blockedPath = path.join(tempRoot, 'blocked.json');

  try {
    await writeFile(blockedPath, 'not-a-dir');

    const result = await invokeDeepScanKrPackage(VALID_INPUT, {
      ...VALID_RUNTIME_OPTIONS,
      execFile: async () => ({
        stdout: JSON.stringify(createValidPayload({
          reportContent: 'best-effort',
        })),
        stderr: '',
      }),
      cacheDir: blockedPath,
      snapshotDir: blockedPath,
      maxRetries: 0,
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.reportContent, 'best-effort');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
