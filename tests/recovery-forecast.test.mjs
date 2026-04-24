import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRecoveryForecastFromPriceSeries,
  calculateSimilarPatternRecovery,
  calculateRecoveryLogReturns,
  calculateRecoveryForecastConfidence,
  createRecoverySeededRandom,
  deriveRecoveryReturnParameters,
  DEFAULT_RECOVERY_FORECAST_MODEL_WEIGHTS,
  extractRecoveryReboundWindow,
  findRecoveryLowPoint,
  normalizeRecoveryPriceSeries,
  simulateGbmRecovery,
  simulateJumpDiffusionRecovery,
  summarizeRecoveryForecast,
} from '../packages/deepscan-runtime-core/src/recovery-forecast.js'

const closeTo = (actual, expected, delta = 0.0001) => {
  assert.equal(typeof actual, 'number')
  assert.ok(Math.abs(actual - expected) <= delta, `${actual} is not within ${delta} of ${expected}`)
}

const buildPriceSeriesFromReturns = (returns, initialClose = 100) => {
  const points = [{ date: '2026-01-01', close: initialClose }]
  let close = initialClose

  returns.forEach((logReturn, index) => {
    close *= Math.exp(logReturn)
    points.push({
      date: `2026-01-${String(index + 2).padStart(2, '0')}`,
      close,
    })
  })

  return points
}

test('summarizeRecoveryForecast combines three model medians and probabilities with default weights', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 60.3, sampleSize: 63 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
    jumpDiffusion: { medianRecoveryDays: 60, recoveryProbabilityPct: 63.9 },
  })

  assert.equal(forecast.status, 'available')
  assert.equal(forecast.consensus.expectedRecoveryDays, 74)
  assert.equal(forecast.consensus.recoveryProbabilityPct, 60.8)
  assert.deepEqual(forecast.consensus.weights, DEFAULT_RECOVERY_FORECAST_MODEL_WEIGHTS)
  assert.equal(forecast.consensus.confidence.level, 'medium')
  closeTo(forecast.consensus.confidence.deviationRatio, 0.5493)
  assert.equal(forecast.models.similarPattern.sampleSize, 63)
})

test('calculateRecoveryForecastConfidence reports high confidence when model medians cluster tightly', () => {
  const confidence = calculateRecoveryForecastConfidence([57, 60, 62])

  assert.equal(confidence.level, 'high')
  closeTo(confidence.deviationRatio, 0.0838)
  assert.equal(confidence.averageMedianDays, 59.7)
  assert.equal(confidence.minMedianDays, 57)
  assert.equal(confidence.maxMedianDays, 62)
})

test('summarizeRecoveryForecast returns low_confidence when model medians diverge too much', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 10, recoveryProbabilityPct: 45 },
    gbm: { medianRecoveryDays: 120, recoveryProbabilityPct: 55 },
    jumpDiffusion: { medianRecoveryDays: 50, recoveryProbabilityPct: 50 },
  })

  assert.equal(forecast.status, 'low_confidence')
  assert.equal(forecast.consensus.confidence.level, 'low')
  assert.match(forecast.reason, /낮은 신뢰도/)
})

test('summarizeRecoveryForecast returns unavailable when a required model result is missing', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 60.3 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
  })

  assert.equal(forecast.status, 'unavailable')
  assert.equal(forecast.consensus, null)
  assert.match(forecast.reason, /jumpDiffusion result is missing/)
})

test('summarizeRecoveryForecast rejects invalid recovery probabilities', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 101 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
    jumpDiffusion: { medianRecoveryDays: 60, recoveryProbabilityPct: 63.9 },
  })

  assert.equal(forecast.status, 'unavailable')
  assert.match(forecast.reason, /between 0 and 100/)
})

test('normalizeRecoveryPriceSeries sorts dated KRX-like rows ascending and parses formatted close values', () => {
  const series = normalizeRecoveryPriceSeries([
    { tradeDate: '20260103', close: '11,000원' },
    { tradeDate: '20260101', closePrice: '10,000' },
    { tradeDate: '20260102', price: '10,500' },
  ])

  assert.deepEqual(series, [
    { date: '2026-01-01', close: 10000 },
    { date: '2026-01-02', close: 10500 },
    { date: '2026-01-03', close: 11000 },
  ])
})

test('calculateRecoveryLogReturns uses normalized chronological close prices', () => {
  const returns = calculateRecoveryLogReturns([
    { date: '2026-01-02', close: 121 },
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-03', close: 133.1 },
  ])

  assert.equal(returns.length, 2)
  closeTo(returns[0].logReturn, Math.log(121 / 100))
  closeTo(returns[1].logReturn, Math.log(133.1 / 121))
})

test('extractRecoveryReboundWindow starts at the lowest close point', () => {
  const rebound = extractRecoveryReboundWindow([
    { date: '2026-01-01', close: 130 },
    { date: '2026-01-02', close: 80 },
    { date: '2026-01-03', close: 95 },
    { date: '2026-01-04', close: 120 },
  ])

  assert.deepEqual(findRecoveryLowPoint(rebound.points), {
    index: 0,
    date: '2026-01-02',
    close: 80,
  })
  assert.deepEqual(rebound.lowPoint, {
    index: 1,
    date: '2026-01-02',
    close: 80,
  })
  assert.deepEqual(rebound.points.map((point) => point.close), [80, 95, 120])
})

test('deriveRecoveryReturnParameters estimates rise and jump/diffusion parameters from the rebound window', () => {
  const series = buildPriceSeriesFromReturns([0.01, 0.01, 0.3, 0.01])
  const parameters = deriveRecoveryReturnParameters(series)

  assert.equal(parameters.status, 'available')
  assert.equal(parameters.returnCount, 4)
  assert.equal(parameters.jumpCount, 1)
  assert.equal(parameters.diffusionCount, 3)
  closeTo(parameters.riseMeanLogReturn, 0.0825)
  closeTo(parameters.riseVolatilityLogReturn, 0.125573)
  closeTo(parameters.jumpThresholdLogReturn, 0.251147)
  closeTo(parameters.jumpProbability, 0.25)
  closeTo(parameters.diffusionMeanLogReturn, 0.01)
  closeTo(parameters.diffusionVolatilityLogReturn, 0)
  closeTo(parameters.jumpMeanLogReturn, 0.3)
  closeTo(parameters.jumpVolatilityLogReturn, 0)
})

test('deriveRecoveryReturnParameters returns unavailable when rebound data is too short', () => {
  const parameters = deriveRecoveryReturnParameters([{ date: '2026-01-01', close: 100 }])

  assert.equal(parameters.status, 'unavailable')
  assert.equal(parameters.returnCount, 0)
  assert.match(parameters.reason, /로그 수익률/)
})

test('createRecoverySeededRandom returns deterministic sequences for the same seed', () => {
  const left = createRecoverySeededRandom('KCHIP')
  const right = createRecoverySeededRandom('KCHIP')

  assert.deepEqual(
    [left(), left(), left()].map((value) => Number(value.toFixed(8))),
    [right(), right(), right()].map((value) => Number(value.toFixed(8))),
  )
})

test('simulateGbmRecovery returns deterministic all-path recovery when volatility is zero', () => {
  const simulation = simulateGbmRecovery(
    {
      currentPrice: 100,
      targetPrice: 121,
      meanLogReturn: 0.1,
      volatilityLogReturn: 0,
    },
    { horizonDays: 5, pathCount: 7, seed: 1 },
  )

  assert.equal(simulation.status, 'available')
  assert.equal(simulation.modelKey, 'gbm')
  assert.equal(simulation.medianRecoveryDays, 2)
  assert.equal(simulation.recoveryProbabilityPct, 100)
  assert.equal(simulation.recoveredPathCount, 7)
})

test('simulateGbmRecovery reports no-hit simulations without inventing a median day', () => {
  const simulation = simulateGbmRecovery(
    {
      currentPrice: 100,
      targetPrice: 110,
      meanLogReturn: 0,
      volatilityLogReturn: 0,
    },
    { horizonDays: 3, pathCount: 5, seed: 1 },
  )

  assert.equal(simulation.status, 'available')
  assert.equal(simulation.medianRecoveryDays, null)
  assert.equal(simulation.recoveryProbabilityPct, 0)
  assert.equal(simulation.recoveredPathCount, 0)
  assert.match(simulation.reason, /목표가/)
})

test('simulateJumpDiffusionRecovery can recover from a guaranteed jump event', () => {
  const simulation = simulateJumpDiffusionRecovery(
    {
      currentPrice: 100,
      targetPrice: 115,
      diffusionMeanLogReturn: 0,
      diffusionVolatilityLogReturn: 0,
      jumpProbability: 1,
      jumpMeanLogReturn: Math.log(1.2),
      jumpVolatilityLogReturn: 0,
    },
    { horizonDays: 1, pathCount: 9, seed: 'jump' },
  )

  assert.equal(simulation.status, 'available')
  assert.equal(simulation.modelKey, 'jumpDiffusion')
  assert.equal(simulation.medianRecoveryDays, 1)
  assert.equal(simulation.recoveryProbabilityPct, 100)
  assert.equal(simulation.recoveredPathCount, 9)
})

test('simulateJumpDiffusionRecovery rejects invalid probability inputs', () => {
  const simulation = simulateJumpDiffusionRecovery(
    {
      currentPrice: 100,
      targetPrice: 115,
      diffusionMeanLogReturn: 0,
      diffusionVolatilityLogReturn: 0,
      jumpProbability: 1.5,
      jumpMeanLogReturn: 0.1,
      jumpVolatilityLogReturn: 0,
    },
    { horizonDays: 1, pathCount: 9 },
  )

  assert.equal(simulation.status, 'unavailable')
  assert.match(simulation.reason, /유효하지/)
})

test('calculateSimilarPatternRecovery samples independent drawdown matches and summarizes recovery days', () => {
  const result = calculateSimilarPatternRecovery(
    {
      primarySeries: [
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 80 },
        { date: '2026-01-03', close: 90 },
        { date: '2026-01-04', close: 100 },
        { date: '2026-01-05', close: 100 },
        { date: '2026-01-06', close: 79 },
        { date: '2026-01-07', close: 100 },
        { date: '2026-01-08', close: 100 },
        { date: '2026-01-09', close: 80 },
      ],
      currentPrice: 80,
      targetPrice: 100,
    },
    {
      lookbackDays: 2,
      tolerancePct: 2,
      spacingDays: 1,
      minSampleSize: 2,
      recoveryDaysDigits: 1,
    },
  )

  assert.equal(result.status, 'available')
  assert.equal(result.sampleCount, 3)
  assert.equal(result.recoveredSampleCount, 2)
  assert.equal(result.recoveryProbabilityPct, 66.7)
  assert.equal(result.medianRecoveryDays, 1.5)
  assert.equal(result.recoveryDaysP25, 1.3)
  assert.equal(result.recoveryDaysP75, 1.8)
  assert.deepEqual(result.samples.map((sample) => sample.recoveryDays), [2, 1, null])
})

test('calculateSimilarPatternRecovery marks sparse samples as low confidence', () => {
  const result = calculateSimilarPatternRecovery(
    {
      primarySeries: [
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 80 },
        { date: '2026-01-03', close: 100 },
      ],
      currentPrice: 80,
      targetPrice: 100,
    },
    {
      lookbackDays: 2,
      tolerancePct: 2,
      minSampleSize: 2,
    },
  )

  assert.equal(result.status, 'low_confidence')
  assert.equal(result.sampleCount, 1)
  assert.equal(result.recoveredSampleCount, 1)
  assert.match(result.reason, /샘플 수/)
})

test('calculateSimilarPatternRecovery returns unavailable when target context is missing', () => {
  const result = calculateSimilarPatternRecovery({
    primarySeries: [{ date: '2026-01-01', close: 100 }],
  })

  assert.equal(result.status, 'unavailable')
  assert.match(result.reason, /targetPrice/)
})

test('buildRecoveryForecastFromPriceSeries runs similar pattern, GBM, JD, and consensus together', () => {
  const forecast = buildRecoveryForecastFromPriceSeries(
    {
      primarySeries: buildPriceSeriesFromReturns([0.1, 0.1, 0.1]),
      peerSeries: [
        {
          label: 'peer-a',
          series: [
            { date: '2026-02-01', close: 121 },
            { date: '2026-02-02', close: 100 },
            { date: '2026-02-03', close: 121 },
            { date: '2026-02-04', close: 121 },
            { date: '2026-02-05', close: 100 },
            { date: '2026-02-06', close: 121 },
          ],
        },
      ],
      currentPrice: 100,
      targetPrice: 121,
    },
    {
      similarPattern: {
        lookbackDays: 2,
        tolerancePct: 5,
        spacingDays: 1,
        minSampleSize: 2,
      },
      simulation: {
        horizonDays: 5,
        pathCount: 7,
        seed: 'integrated',
      },
    },
  )

  assert.equal(forecast.status, 'available')
  assert.equal(forecast.consensus.expectedRecoveryDays, 2)
  assert.equal(forecast.consensus.recoveryProbabilityPct, 100)
  assert.equal(forecast.modelDetails.similarPattern.sampleCount, 2)
  assert.equal(forecast.modelDetails.gbm.medianRecoveryDays, 2)
  assert.equal(forecast.modelDetails.jumpDiffusion.medianRecoveryDays, 2)
  assert.equal(forecast.parameters.status, 'available')
})
