const test = require('node:test');
const assert = require('node:assert/strict');

const krxClient = require('../src/crawlers/krx-client.cjs');
const { runTriggerBatch, __test } = krxClient;

test.afterEach(() => {
  __test.resetCachedTrigger();
});

test('normalizeDateValue recognizes yyyy-mm-dd and yyyymmdd strings', () => {
  assert.equal(__test.normalizeDateValue('2026-04-14'), '2026-04-14');
  assert.equal(__test.normalizeDateValue('20260414'), '2026-04-14');
  assert.equal(__test.normalizeDateValue('not-a-date'), 'not-a-date');
});

test('runTriggerBatch forwards requested mode to trigger batch and metadata', async () => {
  const calls = [];
  __test.setCachedTrigger({
    async runBatch(mode, logLevel, _unused, injectedFunctions) {
      calls.push({ mode, logLevel, injectedKeys: Object.keys(injectedFunctions).sort() });
      return {
        metadata: {
          trigger_mode: 'morning',
          run_time: '2026-04-14T10:00:00.000Z',
        },
        gainers: [
          { code: '005930', name: '삼성전자' },
        ],
      };
    },
    async getSnapshot() {
      return [];
    },
  });

  const result = await runTriggerBatch('closing', { logLevel: 'DEBUG' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'closing');
  assert.equal(calls[0].logLevel, 'DEBUG');
  assert.deepEqual(calls[0].injectedKeys, [
    'getNearestBusinessDayFn',
    'getPreviousSnapshotFn',
    'getSnapshotFn',
  ]);
  assert.equal(result.raw_data.metadata.trigger_mode, 'closing');
  assert.deepEqual(result.stocks, [
    { code: '005930', name: '삼성전자' },
  ]);
});
