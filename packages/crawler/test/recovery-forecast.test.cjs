const test = require('node:test');
const assert = require('node:assert/strict');

function createRecoveryHistory() {
  const start = new Date('2025-01-01T00:00:00.000Z');
  const points = [];
  for (let index = 0; index < 180; index += 1) {
    let close;
    if (index < 40) close = 120 - index;
    else if (index < 80) close = 80 + ((index - 40) * 0.4);
    else if (index < 120) close = 110 - ((index - 80) * 0.8);
    else close = 78 + ((index - 120) * 0.35);
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    points.push({ date: date.toISOString().slice(0, 10), close: Math.round(close * 100) / 100 });
  }
  return points;
}

test('calculateLogReturns converts adjacent prices to log returns', async () => {
  const { calculateLogReturns } = await import('../src/services/recovery-forecast.js');

  const returns = calculateLogReturns([
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-02', close: 110 },
    { date: '2026-01-03', close: 99 },
  ]);

  assert.equal(returns.length, 2);
  assert.equal(Math.round(returns[0] * 1000) / 1000, 0.095);
  assert.equal(Math.round(returns[1] * 1000) / 1000, -0.105);
});

test('calculateReboundParameters uses the post-low rebound segment', async () => {
  const { calculateReboundParameters } = await import('../src/services/recovery-forecast.js');

  const params = calculateReboundParameters([
    { close: 100 },
    { close: 80 },
    { close: 84 },
    { close: 88 },
  ]);

  assert.equal(params.lowIndex, 1);
  assert.equal(params.returns.length, 2);
  assert.equal(typeof params.mu, 'number');
  assert.equal(typeof params.sigma, 'number');
});

test('splitJumpDiffusionReturns separates outlier jumps from diffusion returns', async () => {
  const { splitJumpDiffusionReturns } = await import('../src/services/recovery-forecast.js');

  const split = splitJumpDiffusionReturns([0.01, 0.012, 0.009, 0.011, 0.01, 0.012, 0.009, 0.011, 0.01, 0.5]);

  assert.equal(split.jumpReturns.length, 1);
  assert.equal(split.diffusionReturns.length, 9);
  assert.equal(split.lambda, 0.1);
});

test('sampleSimilarPatterns finds independent drawdown recovery samples', async () => {
  const { sampleSimilarPatterns } = await import('../src/services/recovery-forecast.js');

  const samples = sampleSimilarPatterns({
    history: createRecoveryHistory(),
    averagePrice: 100,
    currentPrice: 80,
    lookbackDays: 20,
    tolerancePct: 18,
    spacingDays: 10,
  });

  assert.equal(samples.length > 0, true);
  assert.equal(samples.some((sample) => sample.recovered), true);
});

test('buildRecoveryForecast returns deterministic model comparison and consensus', async () => {
  const { buildRecoveryForecast, RECOVERY_FORECAST_DISCLAIMER } = await import('../src/services/recovery-forecast.js');

  const forecast = buildRecoveryForecast({
    averagePrice: 100,
    currentPrice: 80,
    priceHistory: createRecoveryHistory(),
    seed: 42,
    paths: 400,
  });

  assert.equal(['ok', 'low_confidence'].includes(forecast.status), true);
  assert.equal(typeof forecast.expectedRecoveryDays, 'number');
  assert.equal(typeof forecast.probabilityWithinOneYear, 'number');
  assert.equal(forecast.models.map((model) => model.id).join(','), 'similarPattern,gbm,jumpDiffusion');
  assert.equal(forecast.models.find((model) => model.id === 'gbm')?.sampleCount, 400);
  assert.equal(forecast.disclaimer, RECOVERY_FORECAST_DISCLAIMER);
});

test('calculateRecoveryConfidence follows divergence thresholds', async () => {
  const { calculateRecoveryConfidence } = await import('../src/services/recovery-forecast.js');

  assert.equal(calculateRecoveryConfidence([57, 58, 60]).confidence, 'high');
  assert.equal(calculateRecoveryConfidence([57, 96, 60]).confidence, 'medium');
  assert.equal(calculateRecoveryConfidence([30, 120, 300]).confidence, 'low');
  assert.equal(calculateRecoveryConfidence([58]).confidence, 'low');
});

test('buildRecoveryForecast returns unavailable when required inputs are missing or not loss-making', async () => {
  const { buildRecoveryForecast } = await import('../src/services/recovery-forecast.js');

  const missing = buildRecoveryForecast({ averagePrice: 100, currentPrice: 80, priceHistory: [] });
  assert.equal(missing.status, 'unavailable');
  assert.deepEqual(missing.dataQuality.missingInputs, ['priceHistory']);

  const notLoss = buildRecoveryForecast({ averagePrice: 100, currentPrice: 110, priceHistory: createRecoveryHistory() });
  assert.equal(notLoss.status, 'unavailable');
  assert.match(notLoss.dataQuality.notes[0], /평단 이상/);
});
