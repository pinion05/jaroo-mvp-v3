const test = require('node:test');
const assert = require('node:assert/strict');

const TOP_LEVEL_KEYS = [
  'committee',
  'hero',
  'input',
  'insights',
  'metadata',
  'portfolioSimulation',
  'sellNow',
  'strategy',
];

const MAJOR_BLOCK_KEYS = [
  'hero',
  'committee',
  'insights',
  'strategy',
  'sellNow',
  'portfolioSimulation',
];

function assertBlockMeta(block, expectedState) {
  assert.equal(block.blockState, expectedState);
  assert.ok(Array.isArray(block.sourceRefs));
  assert.ok(Object.prototype.hasOwnProperty.call(block, 'fallback'));
  assert.ok(Object.prototype.hasOwnProperty.call(block, 'error'));
}

function getExpectedBlockStatus(payload) {
  return Object.fromEntries(MAJOR_BLOCK_KEYS.map((key) => [key, payload[key].blockState]));
}

function assertCanonicalPayloadShape(payload) {
  assert.deepEqual(Object.keys(payload).sort(), TOP_LEVEL_KEYS);
  assert.deepEqual(payload.metadata.blockStatus, getExpectedBlockStatus(payload));
}

test('buildJarooDeepScanPayload returns input-invalid payload when code/ticker missing', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const rawInput = {
    instrument: { name: '삼성전자' },
    selectedAt: '2026-04-15T09:00:00.000Z',
  };

  const payload = await buildJarooDeepScanPayload(rawInput);
  rawInput.instrument.name = '변경된 입력';

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.generatedAt, '2026-04-15T09:00:00.000Z');
  assert.equal(payload.metadata.inputValidity.valid, false);
  assert.equal(payload.metadata.errorCode, 'input-invalid');
  assert.deepEqual(payload.metadata.inputValidity.missing, ['instrument.code', 'instrument.ticker']);
  assert.notEqual(payload.metadata.inputValidity.raw, rawInput);
  assert.equal(payload.metadata.inputValidity.raw.instrument.name, '삼성전자');

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'blocked');
    assert.equal(payload.metadata.blockStatus[key], 'blocked');
  }
});

test('buildJarooDeepScanPayload returns deterministic baseline payload for valid input and is re-exported from the crawler public API', async () => {
  const service = await import('../src/services/deepscan-payload.js');
  const publicApi = await import('../src/index.js');

  assert.equal(publicApi.buildJarooDeepScanPayload, service.buildJarooDeepScanPayload);

  const rawInput = {
    instrument: {
      name: '삼성전자',
      code: '005930',
      market: 'KR',
    },
    holding: {
      shares: '12',
      averagePrice: '71000',
      evaluationAmount: '1022400',
    },
    selectedAt: '2026-04-14T00:00:00.000Z',
    sourceContext: {
      from: 'holding',
      sessionKey: 'session-1',
      appliedAt: '2026-04-15T00:00:00.000Z',
    },
  };

  const payload = await publicApi.buildJarooDeepScanPayload(rawInput);
  rawInput.holding.shares = '999';

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.generatedAt, '2026-04-15T00:00:00.000Z');
  assert.equal(payload.metadata.inputValidity.valid, true);
  assert.equal(payload.metadata.errorCode, undefined);
  assert.equal(payload.metadata.degraded, true);
  assert.notEqual(payload.metadata.inputValidity.raw, rawInput);
  assert.equal(payload.metadata.inputValidity.raw.holding.shares, '12');
  assert.equal(payload.hero.headline, '삼성전자 baseline DeepScan summary');
  assert.equal(payload.hero.fallback?.reason, 'baseline-placeholder');
  assert.equal(payload.committee.axes.length, 3);
  assert.equal(payload.insights.summaryTags.length, 3);
  assert.equal(payload.strategy.otherScenarios.length, 2);
  assert.equal(payload.sellNow.rows.length, 3);
  assert.equal(payload.portfolioSimulation.deltaLabel, '+6p');

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'ok');
    assert.equal(payload.metadata.blockStatus[key], 'ok');
  }
});

test('buildJarooDeepScanPayload returns canonical internal-service-error payload on unexpected failures', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js');
  const rawInput = {
    selectedAt: '2026-04-16T00:00:00.000Z',
  };

  Object.defineProperty(rawInput, 'instrument', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });

  const payload = await buildJarooDeepScanPayload(rawInput);

  assertCanonicalPayloadShape(payload);
  assert.equal(payload.metadata.generatedAt, '2026-04-16T00:00:00.000Z');
  assert.equal(payload.metadata.errorCode, 'internal-service-error');
  assert.equal(payload.metadata.inputValidity.valid, false);
  assert.equal(payload.hero.fallback?.reason, 'internal-service-error');
  assert.equal(payload.hero.error?.code, 'internal-service-error');

  for (const key of MAJOR_BLOCK_KEYS) {
    assertBlockMeta(payload[key], 'error');
    assert.equal(payload.metadata.blockStatus[key], 'error');
    assert.equal(payload[key].error?.code, 'internal-service-error');
  }
});
