import test from 'node:test'
import assert from 'node:assert/strict'

type RecoveryModelMap = Record<string, { sampleSize?: number | null; recoveryProbabilityPct?: number | null }>
import {
  RECOVERY_FORECAST_CONFIDENCE,
  RECOVERY_FORECAST_STATUS,
  calculateRecoveryForecastConfidence,
  calculateWeightedAverage,
  normalizeRecoveryForecastModelResults,
  summarizeRecoveryForecast,
} from '../src/recovery-forecast.js'

const issueModels = {
  similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 60.3, sampleSize: 63 },
  gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
  jumpDiffusion: { medianRecoveryDays: 60, recoveryProbabilityPct: 63.9 },
}

test('summarizeRecoveryForecast fixes the 40/30/30 consensus contract', () => {
  const forecast = summarizeRecoveryForecast(issueModels)

  assert.equal(forecast.status, RECOVERY_FORECAST_STATUS.AVAILABLE)
  assert.equal(forecast.consensus?.expectedRecoveryDays, 74)
  assert.equal(forecast.consensus?.recoveryProbabilityPct, 60.8)
  assert.equal(forecast.consensus?.confidence.level, RECOVERY_FORECAST_CONFIDENCE.MEDIUM)
  assert.equal(forecast.consensus?.weights.similarPattern, 0.4)
  assert.equal((forecast.models as RecoveryModelMap).similarPattern?.sampleSize, 63)
})

test('calculateRecoveryForecastConfidence uses median spread divided by mean median days', () => {
  assert.deepEqual(calculateRecoveryForecastConfidence([90, 100, 110]), {
    level: RECOVERY_FORECAST_CONFIDENCE.HIGH,
    divergenceRatio: 0.2,
    spreadDays: 20,
    meanRecoveryDays: 100,
  })
  assert.equal(calculateRecoveryForecastConfidence([70, 100, 130])?.level, RECOVERY_FORECAST_CONFIDENCE.MEDIUM)
  assert.equal(calculateRecoveryForecastConfidence([20, 100, 180])?.level, RECOVERY_FORECAST_CONFIDENCE.LOW)
  assert.equal(calculateRecoveryForecastConfidence([0, 100, 180]), null)
})

test('low confidence divergence keeps a consensus but marks forecast status', () => {
  const forecast = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 20, recoveryProbabilityPct: 20 },
    gbm: { medianRecoveryDays: 100, recoveryProbabilityPct: 40 },
    jumpDiffusion: { medianRecoveryDays: 180, recoveryProbabilityPct: 80 },
  })

  assert.equal(forecast.status, RECOVERY_FORECAST_STATUS.LOW_CONFIDENCE)
  assert.equal(forecast.consensus?.expectedRecoveryDays, 92)
  assert.equal(forecast.consensus?.confidence.level, RECOVERY_FORECAST_CONFIDENCE.LOW)
  assert.equal(forecast.consensus?.confidence.divergenceRatio, 1.6)
})

test('missing or invalid required model values return unavailable', () => {
  const missingModel = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 60.3 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
  })
  assert.equal(missingModel.status, RECOVERY_FORECAST_STATUS.UNAVAILABLE)
  assert.equal(missingModel.consensus, null)
  assert.match(missingModel.reason ?? '', /jumpDiffusion result is required/)

  const invalidProbability = summarizeRecoveryForecast({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPct: 101 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
    jumpDiffusion: { medianRecoveryDays: 60, recoveryProbabilityPct: 63.9 },
  })
  assert.equal(invalidProbability.status, RECOVERY_FORECAST_STATUS.UNAVAILABLE)
  assert.match(invalidProbability.reason ?? '', /similarPattern\.recoveryProbabilityPct/)
})

test('normalization accepts recoveryProbabilityPercent as a backward-compatible alias', () => {
  const { models, errors } = normalizeRecoveryForecastModelResults({
    similarPattern: { medianRecoveryDays: 96, recoveryProbabilityPercent: 60.3 },
    gbm: { medianRecoveryDays: 57, recoveryProbabilityPercent: 58.2 },
    jumpDiffusion: { medianRecoveryDays: 60, recoveryProbabilityPercent: 63.9 },
  })

  assert.deepEqual(errors, [])
  assert.equal((models as RecoveryModelMap).similarPattern?.recoveryProbabilityPct, 60.3)
})

test('calculateWeightedAverage rejects malformed weights and values', () => {
  assert.equal(calculateWeightedAverage({ similarPattern: 96, gbm: 57, jumpDiffusion: 60 }), 73.5)
  const invalidWeights = { similarPattern: 0.4, gbm: -0.3, jumpDiffusion: 0.3 } as unknown as Parameters<typeof calculateWeightedAverage>[1]
  assert.equal(calculateWeightedAverage({ similarPattern: 96, gbm: 57, jumpDiffusion: 60 }, invalidWeights), null)
  assert.equal(calculateWeightedAverage({ similarPattern: 96, gbm: Number.NaN, jumpDiffusion: 60 }), null)
})
