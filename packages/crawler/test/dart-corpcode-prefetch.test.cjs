const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CORP_CODE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>삼성전자</corp_name>
    <stock_code>005930</stock_code>
    <modify_date>20240101</modify_date>
  </list>
</result>`;

const DART_KEY_ENV_NAMES = ['DART_KEY', 'DART_API_KEY', 'OPENDART_API_KEY', 'OPEN_DART_API_KEY', 'API_K_DART'];

function withoutDartEnv(run) {
  const saved = {};
  for (const name of DART_KEY_ENV_NAMES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test('runDartCorpCodePrefetch downloads corpCode and writes the disk cache', async () => {
  const { runDartCorpCodePrefetch } = await import('../src/services/dart-corpcode-prefetch.js');
  const { clearDartCaches } = await import('../src/crawlers/dart-filings.js');
  const diskDir = mkdtempSync(join(tmpdir(), 'dart-prefetch-ok-'));
  const logs = [];
  clearDartCaches();

  const result = await runDartCorpCodePrefetch({
    apiKey: 'prefetch-key',
    corpCodeDiskDir: diskDir,
    fetchImpl: async () => new Response(CORP_CODE_XML, { status: 200 }),
    log: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  });

  assert.equal(result.ok, true);
  assert.equal(result.entries, 1);
  assert.equal(existsSync(join(diskDir, 'corpCode-prefetch.zip')), true, '프리페치가 디스크 캐시를 채워야 한다');
  assert.ok(logs.some((line) => line.includes('[dart-corpcode-prefetch] start')));
  assert.ok(logs.some((line) => line.includes('[dart-corpcode-prefetch] ok') && line.includes('entries=1')));
});

test('runDartCorpCodePrefetch reports failure without throwing', async () => {
  const { runDartCorpCodePrefetch } = await import('../src/services/dart-corpcode-prefetch.js');
  const warnings = [];

  const result = await runDartCorpCodePrefetch({
    apiKey: 'prefetch-key',
    corpCodeDiskDir: mkdtempSync(join(tmpdir(), 'dart-prefetch-fail-')),
    fetchImpl: async () => new Response('boom', { status: 500 }),
    log: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(result.ok, false);
  assert.ok(String(result.error).includes('HTTP 500'));
  assert.ok(warnings.some((line) => line.includes('[dart-corpcode-prefetch] failed')));
});

test('runDartCorpCodePrefetch skips when DART key is unconfigured', async () => {
  const { runDartCorpCodePrefetch } = await import('../src/services/dart-corpcode-prefetch.js');

  const result = await withoutDartEnv(() => runDartCorpCodePrefetch({
    fetchImpl: async () => { throw new Error('network must not be called'); },
    log: () => {},
    warn: () => {},
  }));

  assert.deepEqual(result, { ok: false, skipped: 'dart-key-unconfigured' });
});

test('scheduler start/stop respects enable flag and key presence', async () => {
  const { startDartCorpCodePrefetchScheduler, isDartCorpCodePrefetchDisabled } = await import('../src/services/dart-corpcode-prefetch.js');

  // 비활성 플래그 → no-op 핸들
  const savedEnable = process.env.DART_CORP_CODE_PREFETCH_ENABLE;
  process.env.DART_CORP_CODE_PREFETCH_ENABLE = '0';
  assert.equal(isDartCorpCodePrefetchDisabled(), true);
  const stopped = startDartCorpCodePrefetchScheduler({ apiKey: 'k' });
  stopped.stop();
  process.env.DART_CORP_CODE_PREFETCH_ENABLE = savedEnable;
  assert.equal(isDartCorpCodePrefetchDisabled(), false);

  // 키 없음 → no-op 핸들
  const skipped = withoutDartEnv(() => startDartCorpCodePrefetchScheduler({}));
  skipped.stop();

  // 키 있음 + 즉시 stop → 타이머가 실행되지 않고 정리된다.
  const handle = startDartCorpCodePrefetchScheduler({
    apiKey: 'k',
    startupDelayMs: 60_000,
    fetchImpl: async () => new Response(CORP_CODE_XML, { status: 200 }),
  });
  handle.stop();
  assert.equal(typeof handle.stop, 'function');
});
