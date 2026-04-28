export const RECOVERY_FORECAST_MODEL_KEYS = Object.freeze(['similarPattern', 'gbm', 'jumpDiffusion'])

export const RECOVERY_FORECAST_STATUS = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  LOW_CONFIDENCE: 'low_confidence',
})

export const RECOVERY_FORECAST_CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
})

export const RECOVERY_FORECAST_MODEL_WEIGHTS = Object.freeze({
  similarPattern: 0.4,
  gbm: 0.3,
  jumpDiffusion: 0.3,
})

const RECOVERY_FORECAST_MODEL_LABELS = Object.freeze({
  similarPattern: 'similar pattern',
  gbm: 'GBM',
  jumpDiffusion: 'Jump-Diffusion',
})

const DEFAULT_CONFIDENCE_THRESHOLDS = Object.freeze({
  highBelow: 0.3,
  mediumMax: 0.7,
})

/**
 * @typedef {'similarPattern' | 'gbm' | 'jumpDiffusion'} RecoveryForecastModelKey
 * @typedef {'available' | 'unavailable' | 'low_confidence'} RecoveryForecastStatus
 * @typedef {'high' | 'medium' | 'low'} RecoveryForecastConfidenceLevel
 * @typedef {object} RecoveryForecastModelInput
 * @property {number} medianRecoveryDays
 * @property {number} [recoveryProbabilityPct]
 * @property {number} [recoveryProbabilityPercent]
 * @property {number} [sampleSize]
 * @typedef {object} RecoveryForecastModelSummary
 * @property {RecoveryForecastModelKey} key
 * @property {string} label
 * @property {number} medianRecoveryDays
 * @property {number} recoveryProbabilityPct
 * @property {number | null} sampleSize
 * @typedef {object} RecoveryForecastConfidenceSummary
 * @property {RecoveryForecastConfidenceLevel} level
 * @property {number} divergenceRatio
 * @property {number} spreadDays
 * @property {number} meanRecoveryDays
 * @typedef {object} RecoveryForecastConsensusSummary
 * @property {number} expectedRecoveryDays
 * @property {number} recoveryProbabilityPct
 * @property {RecoveryForecastConfidenceSummary} confidence
 * @property {Record<RecoveryForecastModelKey, number>} weights
 * @typedef {object} RecoveryForecastSummary
 * @property {RecoveryForecastStatus} status
 * @property {Partial<Record<RecoveryForecastModelKey, RecoveryForecastModelSummary>>} models
 * @property {RecoveryForecastConsensusSummary | null} consensus
 * @property {string | null} reason
 * @property {string[]} errors
 */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0
}

function isProbability(value) {
  return isFiniteNumber(value) && value >= 0 && value <= 100
}

function roundTo(value, digits = 0) {
  if (!isFiniteNumber(value)) return null
  const factor = 10 ** Math.max(0, digits)
  return Math.round(value * factor) / factor
}

function getRecoveryProbabilityPct(input) {
  if (isFiniteNumber(input?.recoveryProbabilityPct)) {
    return input.recoveryProbabilityPct
  }
  if (isFiniteNumber(input?.recoveryProbabilityPercent)) {
    return input.recoveryProbabilityPercent
  }
  return null
}

function normalizeModelResult(key, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { model: null, error: `${key} result is required` }
  }

  const medianRecoveryDays = input.medianRecoveryDays
  if (!isPositiveNumber(medianRecoveryDays)) {
    return { model: null, error: `${key}.medianRecoveryDays must be a positive number` }
  }

  const recoveryProbabilityPct = getRecoveryProbabilityPct(input)
  if (!isProbability(recoveryProbabilityPct)) {
    return { model: null, error: `${key}.recoveryProbabilityPct must be between 0 and 100` }
  }

  const sampleSize = isFiniteNumber(input.sampleSize) && input.sampleSize >= 0
    ? Math.round(input.sampleSize)
    : null

  return {
    model: {
      key,
      label: RECOVERY_FORECAST_MODEL_LABELS[key],
      medianRecoveryDays,
      recoveryProbabilityPct,
      sampleSize,
    },
    error: null,
  }
}

export function normalizeRecoveryForecastModelResults(modelResults) {
  if (!modelResults || typeof modelResults !== 'object' || Array.isArray(modelResults)) {
    return { models: {}, errors: ['modelResults must be an object keyed by recovery model'] }
  }

  const models = {}
  const errors = []
  for (const key of RECOVERY_FORECAST_MODEL_KEYS) {
    const { model, error } = normalizeModelResult(key, modelResults[key])
    if (model) {
      models[key] = model
    }
    if (error) {
      errors.push(error)
    }
  }

  return { models, errors }
}

export function calculateWeightedAverage(valuesByModel, weights = RECOVERY_FORECAST_MODEL_WEIGHTS) {
  if (!valuesByModel || typeof valuesByModel !== 'object') return null

  let weightedTotal = 0
  let weightTotal = 0
  for (const key of RECOVERY_FORECAST_MODEL_KEYS) {
    const value = valuesByModel[key]
    const weight = weights[key]
    if (!isFiniteNumber(value) || !isFiniteNumber(weight) || weight < 0) {
      return null
    }
    weightedTotal += value * weight
    weightTotal += weight
  }

  return weightTotal > 0 ? weightedTotal / weightTotal : null
}

export function calculateRecoveryForecastConfidence(medianRecoveryDays, thresholds = DEFAULT_CONFIDENCE_THRESHOLDS) {
  const values = Array.isArray(medianRecoveryDays)
    ? medianRecoveryDays
    : RECOVERY_FORECAST_MODEL_KEYS.map((key) => medianRecoveryDays?.[key])

  if (values.length !== RECOVERY_FORECAST_MODEL_KEYS.length || values.some((value) => !isPositiveNumber(value))) {
    return null
  }

  const meanRecoveryDays = values.reduce((total, value) => total + value, 0) / values.length
  const spreadDays = Math.max(...values) - Math.min(...values)
  const divergenceRatio = spreadDays / meanRecoveryDays
  const level = divergenceRatio < thresholds.highBelow
    ? RECOVERY_FORECAST_CONFIDENCE.HIGH
    : divergenceRatio <= thresholds.mediumMax
      ? RECOVERY_FORECAST_CONFIDENCE.MEDIUM
      : RECOVERY_FORECAST_CONFIDENCE.LOW

  return {
    level,
    divergenceRatio,
    spreadDays,
    meanRecoveryDays,
  }
}

export function summarizeRecoveryForecast(modelResults, options = {}) {
  const { models, errors } = normalizeRecoveryForecastModelResults(modelResults)
  if (errors.length > 0) {
    return {
      status: RECOVERY_FORECAST_STATUS.UNAVAILABLE,
      models,
      consensus: null,
      reason: errors[0],
      errors,
    }
  }

  const medianValues = Object.fromEntries(
    RECOVERY_FORECAST_MODEL_KEYS.map((key) => [key, models[key].medianRecoveryDays]),
  )
  const probabilityValues = Object.fromEntries(
    RECOVERY_FORECAST_MODEL_KEYS.map((key) => [key, models[key].recoveryProbabilityPct]),
  )

  const expectedRecoveryDaysRaw = calculateWeightedAverage(medianValues, options.weights ?? RECOVERY_FORECAST_MODEL_WEIGHTS)
  const recoveryProbabilityPctRaw = calculateWeightedAverage(probabilityValues, options.weights ?? RECOVERY_FORECAST_MODEL_WEIGHTS)
  const confidence = calculateRecoveryForecastConfidence(medianValues, options.confidenceThresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS)

  if (expectedRecoveryDaysRaw == null || recoveryProbabilityPctRaw == null || confidence == null) {
    return {
      status: RECOVERY_FORECAST_STATUS.UNAVAILABLE,
      models,
      consensus: null,
      reason: 'recovery forecast consensus could not be calculated',
      errors: ['recovery forecast consensus could not be calculated'],
    }
  }

  return {
    status: confidence.level === RECOVERY_FORECAST_CONFIDENCE.LOW
      ? RECOVERY_FORECAST_STATUS.LOW_CONFIDENCE
      : RECOVERY_FORECAST_STATUS.AVAILABLE,
    models,
    consensus: {
      expectedRecoveryDays: roundTo(expectedRecoveryDaysRaw, options.recoveryDaysDigits ?? 0),
      recoveryProbabilityPct: roundTo(recoveryProbabilityPctRaw, options.probabilityDigits ?? 1),
      confidence: {
        level: confidence.level,
        divergenceRatio: roundTo(confidence.divergenceRatio, options.divergenceDigits ?? 4),
        spreadDays: roundTo(confidence.spreadDays, options.recoveryDaysDigits ?? 0),
        meanRecoveryDays: roundTo(confidence.meanRecoveryDays, options.recoveryDaysDigits ?? 1),
      },
      weights: { ...(options.weights ?? RECOVERY_FORECAST_MODEL_WEIGHTS) },
    },
    reason: null,
    errors: [],
  }
}

export const buildRecoveryForecast = summarizeRecoveryForecast
