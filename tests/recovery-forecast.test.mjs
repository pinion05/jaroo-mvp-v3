import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRecoveryProbabilityHeadline,
  cumulativeHorizonProbabilities,
  resolveRecoverySimulationHorizonDays,
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

test('summarizeRecoveryForecast keeps a 2-model fallback explicitly low-confidence', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 60.3 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
    // jumpDiffusion 누락 — 상관된 소수 모델의 fallback은 수치만 제공하고 신뢰도는 낮음
  })

  assert.equal(forecast.status, 'low_confidence')
  assert.ok(forecast.consensus, '2개 이상 가용 모델이면 합의를 제공한다')
  assert.match(forecast.reason ?? '', /Jump-Diffusion.*제외/)
  assert.equal(forecast.consensus.expectedRecoveryDays, 79)
  assert.equal(forecast.consensus.confidence.level, 'low')
})

test('summarizeRecoveryForecast returns unavailable when fewer than 2 models are available', () => {
  const forecast = summarizeRecoveryForecast({
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
  })

  assert.equal(forecast.status, 'unavailable')
  assert.equal(forecast.consensus, null)
})

test('summarizeRecoveryForecast excludes a model with invalid probability and falls back to the remaining models', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 101 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
    jumpDiffusion: { medianRecoveryDays: 60, recoveryProbabilityPct: 63.9 },
  })

  // 101% 무효 확률을 가진 similarPattern 은 제외되고, gbm+jumpDiffusion 으로 2모델 fallback
  assert.notEqual(forecast.status, 'unavailable')
  assert.ok(forecast.consensus)
  assert.match(forecast.reason ?? '', /유사 패턴.*제외/)
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

test('deriveRecoveryReturnParameters can use the full observation window instead of selecting the post-low rebound', () => {
  const parameters = deriveRecoveryReturnParameters([
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-02', close: 50 },
    { date: '2026-01-03', close: 60 },
    { date: '2026-01-04', close: 55 },
  ], { windowMode: 'full', minReturnCount: 2 })

  assert.equal(parameters.status, 'available')
  assert.equal(parameters.priceCount, 4)
  assert.equal(parameters.returnCount, 3)
  closeTo(parameters.riseMeanLogReturn, Math.log(55 / 100) / 3)
})

test('deriveRecoveryReturnParameters rejects monthly observations when daily cadence is required', () => {
  const parameters = deriveRecoveryReturnParameters([
    { date: '2026-01-01', close: 100 },
    { date: '2026-02-01', close: 101 },
    { date: '2026-03-01', close: 102 },
    { date: '2026-04-01', close: 103 },
  ], { windowMode: 'full', requireDailyCadence: true, minReturnCount: 2 })

  assert.equal(parameters.status, 'unavailable')
  assert.equal(parameters.cadence.status, 'non_daily')
  assert.ok(parameters.cadence.medianGapDays >= 28)
  assert.match(parameters.reason, /일봉/)
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

test('calculateSimilarPatternRecovery requires each historical sample to recover its own local peak', () => {
  const result = calculateSimilarPatternRecovery(
    {
      primarySeries: [
        { date: '2026-01-01', close: 200 },
        { date: '2026-01-02', close: 100 },
        { date: '2026-01-03', close: 150 },
        { date: '2026-01-04', close: 160 },
      ],
      currentPrice: 60,
      targetPrice: 120,
    },
    {
      lookbackDays: 2,
      tolerancePct: 1,
      spacingDays: 1,
      minSampleSize: 1,
      horizonDays: 252,
    },
  )

  assert.equal(result.sampleCount, 1)
  assert.equal(result.recoveredSampleCount, 0)
  assert.equal(result.recoveryProbabilityPct, 0)
  assert.equal(result.medianRecoveryDays, null)
  assert.equal(result.samples[0].peakClose, 200)
  assert.equal(result.samples[0].recovered, false)
})

test('calculateSimilarPatternRecovery only counts recovery inside the configured horizon', () => {
  const result = calculateSimilarPatternRecovery(
    {
      primarySeries: [
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 80 },
        { date: '2026-01-03', close: 90 },
        { date: '2026-01-04', close: 100 },
      ],
      currentPrice: 80,
      targetPrice: 100,
    },
    {
      lookbackDays: 2,
      tolerancePct: 1,
      spacingDays: 1,
      minSampleSize: 1,
      horizonDays: 1,
    },
  )

  assert.equal(result.sampleCount, 1)
  assert.equal(result.recoveredSampleCount, 0)
  assert.equal(result.medianRecoveryDays, null)
  assert.equal(result.horizonDays, 1)
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

test('buildRecoveryForecastFromPriceSeries infers current price from target drawdown pct', () => {
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
      targetPrice: 121,
      targetDrawdownPct: ((121 - 100) / 121) * 100,
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
  assert.equal(forecast.modelDetails.gbm.medianRecoveryDays, 2)
  assert.equal(forecast.modelDetails.jumpDiffusion.medianRecoveryDays, 2)
})

// ── 기간별 누적 복구확률 (#358) ─────────────────────────────────────────────

test('cumulativeHorizonProbabilities computes 3m/6m/1y/2y/3y buckets from recovery days', () => {
  const recoveryDays = [10, 20, 63, 64, 126, 127, 252, 253, 504, 756]
  const probabilities = cumulativeHorizonProbabilities(recoveryDays, 12, 1, 780)
  // 12 경로 중 ≤63: 3, ≤126: 5, ≤252: 7, ≤504: 9, ≤756: 10
  closeTo(probabilities['3m'], 25.0, 0.05)
  closeTo(probabilities['6m'], 5 / 12 * 100, 0.05)
  closeTo(probabilities['1y'], 7 / 12 * 100, 0.05)
  closeTo(probabilities['2y'], 9 / 12 * 100, 0.05)
  closeTo(probabilities['3y'], 10 / 12 * 100, 0.05)
})

test('cumulativeHorizonProbabilities nulls out buckets beyond the effective horizon', () => {
  // 실효 horizon 252(1년) — 2y/3y는 계산 대상 밖이므로 null (1년치 확률과 중복 표시 방지)
  const probabilities = cumulativeHorizonProbabilities([10, 100, 200, 252], 4, 1, 252)
  assert.equal(probabilities['3m'], 25.0)
  assert.equal(probabilities['6m'], 50.0)
  assert.equal(probabilities['1y'], 100.0)
  assert.equal(probabilities['2y'], null)
  assert.equal(probabilities['3y'], null)
})

test('cumulativeHorizonProbabilities returns all-null buckets for empty/invalid input', () => {
  const empty = cumulativeHorizonProbabilities([], 0, 1, 780)
  for (const key of ['3m', '6m', '1y', '2y', '3y']) {
    assert.equal(empty[key], null)
  }
})

test('resolveRecoverySimulationHorizonDays follows series length — KR 3y vs US 1y', () => {
  assert.equal(resolveRecoverySimulationHorizonDays(780), 780)
  assert.equal(resolveRecoverySimulationHorizonDays(500), 780)
  assert.equal(resolveRecoverySimulationHorizonDays(252), 252)
  assert.equal(resolveRecoverySimulationHorizonDays(100), 252)
})

test('buildRecoveryProbabilityHeadline renders one-sentence breakdown and skips nulls', () => {
  assert.equal(
    buildRecoveryProbabilityHeadline({ '3m': 34.2, '6m': 51.8, '1y': 56.1, '2y': 71.3, '3y': 78.4 }),
    '본전 회복 확률은 3개월 내 34%, 6개월 내 52%, 1년 내 56%, 2년 내 71%, 3년 내 78%입니다',
  )
  assert.equal(
    buildRecoveryProbabilityHeadline({ '3m': null, '6m': 41.5, '1y': 56.1, '2y': null, '3y': null }),
    '본전 회복 확률은 6개월 내 42%, 1년 내 56%입니다',
  )
  assert.equal(buildRecoveryProbabilityHeadline({}), null)
  assert.equal(buildRecoveryProbabilityHeadline(null), null)
})

test('simulation models expose horizonProbabilities — 1y equals recoveryProbabilityPct, monotone', () => {
  const gbm = simulateGbmRecovery(
    { currentPrice: 80, targetPrice: 100, meanLogReturn: 0.0005, volatilityLogReturn: 0.02 },
    { horizonDays: 780, pathCount: 3000, seed: 42 },
  )
  assert.equal(gbm.status, 'available')
  // horizon 780(3년) — recoveryProbabilityPct는 '실효 horizon 내' 확률 → 3년 버킷과 일치(757~780일 경계 유실 감안)
  closeTo(gbm.horizonProbabilities['3y'], gbm.recoveryProbabilityPct, 1.5)
  assert.ok(gbm.horizonProbabilities['3m'] <= gbm.horizonProbabilities['6m'])
  assert.ok(gbm.horizonProbabilities['6m'] <= gbm.horizonProbabilities['1y'])
  assert.ok(gbm.horizonProbabilities['1y'] <= gbm.horizonProbabilities['2y'])
  assert.ok(gbm.horizonProbabilities['2y'] <= gbm.horizonProbabilities['3y'])

  // horizon 252(US 계열) — 2y/3y는 null
  const oneYear = simulateGbmRecovery(
    { currentPrice: 80, targetPrice: 100, meanLogReturn: 0.0005, volatilityLogReturn: 0.02 },
    { horizonDays: 252, pathCount: 3000, seed: 42 },
  )
  assert.equal(oneYear.horizonProbabilities['1y'], oneYear.recoveryProbabilityPct)
  assert.equal(oneYear.horizonProbabilities['2y'], null)
  assert.equal(oneYear.horizonProbabilities['3y'], null)
})

test('similarPattern model exposes horizonProbabilities with sample-based buckets', () => {
  const buildDatedSeries = (closes) => closes.map((close, index) => ({
    date: new Date(Date.UTC(2024, 0, 2 + index)).toISOString().slice(0, 10),
    close,
  }))
  const closes = []
  // 샘플1: 100→80 하락(20% dd) 후 70거래일에 걸쳐 회복 (6개월 버킷)
  closes.push(100); for (let i = 0; i < 5; i += 1) closes.push(80) // 간략화: 즉시 80
  for (let i = 0; i < 70; i += 1) closes.push(80 * Math.pow(1.0035, i + 1))
  // 스페이싱 후 샘플2: 100→80 하락 후 10거래일 만에 회복 (3개월 버킷)
  const atRecovery1 = closes[closes.length - 1] // ≈102 → 100으로 리셋
  closes.push(100); for (let i = 0; i < 5; i += 1) closes.push(80)
  for (let i = 0; i < 10; i += 1) closes.push(80 * Math.pow(1.026, i + 1))
  // 스페이싱 후 샘플3: 100→80 하락, 미회복 (null)
  closes.push(100); for (let i = 0; i < 5; i += 1) closes.push(80)
  for (let i = 0; i < 100; i += 1) closes.push(80 * Math.pow(0.999, i + 1))
  void atRecovery1

  const result = calculateSimilarPatternRecovery(
    { primarySeries: buildDatedSeries(closes), currentPrice: 80, targetPrice: 100 },
    { lookbackDays: 40, tolerancePct: 12, spacingDays: 5, minSampleSize: 1, horizonDays: 780 },
  )
  assert.ok(result.sampleCount >= 2)
  assert.equal(result.horizonProbabilities['1y'], result.recoveryProbabilityPct)
  assert.ok(result.horizonProbabilities['3m'] <= result.horizonProbabilities['6m'])
  assert.ok(result.horizonProbabilities['6m'] <= result.horizonProbabilities['1y'])
  assert.ok(result.horizonProbabilities['1y'] <= result.horizonProbabilities['3y'])
})

test('summarizeRecoveryForecast consensus carries per-horizon weighted average and headline', () => {
  const modelResults = {
    similarPattern: { medianRecoveryDays: 105, recoveryProbabilityPct: 55, horizonProbabilities: { '3m': 26, '6m': 40, '1y': 55, '2y': 70, '3y': 76 } },
    gbm: { medianRecoveryDays: 100, recoveryProbabilityPct: 50, horizonProbabilities: { '3m': 20, '6m': 35, '1y': 50, '2y': 65, '3y': 70 } },
    jumpDiffusion: { medianRecoveryDays: 110, recoveryProbabilityPct: 60, horizonProbabilities: { '3m': 30, '6m': 45, '1y': 60, '2y': 75, '3y': 80 } },
  }
  // 기본 가중치 similarPattern:40/gbm:30/jumpDiffusion:30
  const summary = summarizeRecoveryForecast(modelResults)
  assert.equal(summary.status, 'available')
  closeTo(summary.consensus.horizonProbabilities['3m'], 25.4, 0.05)
  closeTo(summary.consensus.horizonProbabilities['1y'], 55.0, 0.05)
  closeTo(summary.consensus.horizonProbabilities['3y'], 75.4, 0.05)
  assert.equal(
    summary.consensus.probabilityHeadline,
    '본전 회복 확률은 3개월 내 25%, 6개월 내 40%, 1년 내 55%, 2년 내 70%, 3년 내 75%입니다',
  )
})
