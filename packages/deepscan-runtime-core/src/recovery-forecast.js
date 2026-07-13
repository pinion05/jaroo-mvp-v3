export const RECOVERY_FORECAST_MODEL_KEYS = Object.freeze([
  'similarPattern',
  'gbm',
  'jumpDiffusion',
])

export const DEFAULT_RECOVERY_FORECAST_MODEL_WEIGHTS = Object.freeze({
  similarPattern: 0.4,
  gbm: 0.3,
  jumpDiffusion: 0.3,
})

export const RECOVERY_FORECAST_STATUSES = Object.freeze([
  'available',
  'unavailable',
  'low_confidence',
])

export const RECOVERY_FORECAST_CONFIDENCE_LEVELS = Object.freeze([
  'high',
  'medium',
  'low',
])

export const DEFAULT_RECOVERY_FORECAST_CONFIDENCE_THRESHOLDS = Object.freeze({
  highMaxDeviationRatio: 0.3,
  mediumMaxDeviationRatio: 0.7,
})

export const DEFAULT_RECOVERY_RETURN_PARAMETER_OPTIONS = Object.freeze({
  jumpStdMultiplier: 2,
  minReturnCount: 2,
})

export const DEFAULT_RECOVERY_SIMULATION_OPTIONS = Object.freeze({
  horizonDays: 252,
  pathCount: 5000,
  seed: 126730,
})

export const DEFAULT_SIMILAR_PATTERN_OPTIONS = Object.freeze({
  lookbackDays: 40,
  tolerancePct: 12,
  spacingDays: 20,
  minSampleSize: 3,
})

/**
 * @typedef {'similarPattern' | 'gbm' | 'jumpDiffusion'} RecoveryForecastModelKey
 * @typedef {'available' | 'unavailable' | 'low_confidence'} RecoveryForecastStatus
 * @typedef {'high' | 'medium' | 'low'} RecoveryForecastConfidenceLevel
 *
 * @typedef {object} RecoveryForecastModelInput
 * @property {number} medianRecoveryDays
 * @property {number | null | undefined} [recoveryProbabilityPct]
 * @property {number | null | undefined} [sampleSize]
 * @property {string | null | undefined} [note]
 *
 * @typedef {object} RecoveryForecastModelSummary
 * @property {RecoveryForecastModelKey} key
 * @property {string} label
 * @property {number} medianRecoveryDays
 * @property {number | null} recoveryProbabilityPct
 * @property {number | null} sampleSize
 * @property {string | null} note
 *
 * @typedef {object} RecoveryForecastConfidenceSummary
 * @property {RecoveryForecastConfidenceLevel} level
 * @property {number | null} deviationRatio
 * @property {number | null} averageMedianDays
 * @property {number | null} minMedianDays
 * @property {number | null} maxMedianDays
 * @property {string | null} reason
 *
 * @typedef {object} RecoveryForecastConsensusSummary
 * @property {number} expectedRecoveryDays
 * @property {number | null} recoveryProbabilityPct
 * @property {RecoveryForecastConfidenceSummary} confidence
 * @property {Record<RecoveryForecastModelKey, number>} weights
 * @property {string} disclaimer
 *
 * @typedef {object} RecoveryForecastSummary
 * @property {RecoveryForecastStatus} status
 * @property {string | null} reason
 * @property {Partial<Record<RecoveryForecastModelKey, RecoveryForecastModelSummary>>} models
 * @property {RecoveryForecastConsensusSummary | null} consensus
 *
 * @typedef {object} RecoveryPricePoint
 * @property {string | null} date
 * @property {number} close
 *
 * @typedef {object} RecoveryLogReturnPoint
 * @property {string | null} fromDate
 * @property {string | null} toDate
 * @property {number} fromClose
 * @property {number} toClose
 * @property {number} logReturn
 */

const MODEL_LABELS = Object.freeze({
  similarPattern: '유사 패턴',
  gbm: 'GBM',
  jumpDiffusion: 'Jump-Diffusion',
})

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseFiniteNumber(value) {
  if (isFiniteNumber(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/[,\s₩$원]/g, '').trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePositiveFiniteNumber(value) {
  const parsed = parseFiniteNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function hashSeed(seed) {
  if (Number.isInteger(seed)) {
    return seed >>> 0
  }

  const text = String(seed ?? DEFAULT_RECOVERY_SIMULATION_OPTIONS.seed)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createRecoverySeededRandom(seed = DEFAULT_RECOVERY_SIMULATION_OPTIONS.seed) {
  let state = hashSeed(seed) || 1

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomStandardNormal(random) {
  const u1 = Math.max(random(), Number.EPSILON)
  const u2 = Math.max(random(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function normalizeDateToken(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const raw = String(value).trim()
  if (!raw) {
    return null
  }

  const digits = raw.replace(/\D/g, '')
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  }

  return raw
}

function roundTo(value, digits = 0) {
  if (!isFiniteNumber(value)) {
    return null
  }

  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function median(values) {
  const finiteValues = values.filter(isFiniteNumber).sort((left, right) => left - right)
  if (finiteValues.length === 0) {
    return null
  }

  const middle = Math.floor(finiteValues.length / 2)
  if (finiteValues.length % 2 === 1) {
    return finiteValues[middle]
  }

  return (finiteValues[middle - 1] + finiteValues[middle]) / 2
}

function percentile(values, percentileValue) {
  const finiteValues = values.filter(isFiniteNumber).sort((left, right) => left - right)
  if (finiteValues.length === 0) {
    return null
  }

  const boundedPercentile = Math.min(100, Math.max(0, percentileValue))
  const position = (boundedPercentile / 100) * (finiteValues.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)

  if (lowerIndex === upperIndex) {
    return finiteValues[lowerIndex]
  }

  const weight = position - lowerIndex
  return finiteValues[lowerIndex] * (1 - weight) + finiteValues[upperIndex] * weight
}

function buildUnavailableForecast(reason, models = {}) {
  return {
    status: 'unavailable',
    reason,
    models,
    consensus: null,
  }
}

function normalizeModelResults(modelResults) {
  if (!isPlainObject(modelResults)) {
    return { models: {}, errors: ['modelResults must be an object keyed by recovery model'] }
  }

  const models = {}
  const errors = []

  for (const key of RECOVERY_FORECAST_MODEL_KEYS) {
    const source = modelResults[key]
    if (!isPlainObject(source)) {
      errors.push(`${key} result is missing`)
      continue
    }

    const medianRecoveryDays = source.medianRecoveryDays
    const recoveryProbabilityPct = source.recoveryProbabilityPct

    if (!isFiniteNumber(medianRecoveryDays) || medianRecoveryDays < 0) {
      errors.push(`${key}.medianRecoveryDays must be a non-negative finite number`)
      continue
    }

    if (
      recoveryProbabilityPct !== undefined
      && recoveryProbabilityPct !== null
      && (!isFiniteNumber(recoveryProbabilityPct) || recoveryProbabilityPct < 0 || recoveryProbabilityPct > 100)
    ) {
      errors.push(`${key}.recoveryProbabilityPct must be between 0 and 100 when provided`)
      continue
    }

    models[key] = {
      key,
      label: MODEL_LABELS[key],
      medianRecoveryDays,
      recoveryProbabilityPct: isFiniteNumber(recoveryProbabilityPct) ? recoveryProbabilityPct : null,
      sampleSize: isFiniteNumber(source.sampleSize) ? source.sampleSize : null,
      note: typeof source.note === 'string' && source.note.trim().length > 0 ? source.note.trim() : null,
    }
  }

  return { models, errors }
}

export function normalizeRecoveryPriceSeries(priceSeries) {
  if (!Array.isArray(priceSeries)) {
    return []
  }

  const points = priceSeries
    .map((point) => {
      if (isFiniteNumber(point) || typeof point === 'string') {
        const close = parseFiniteNumber(point)
        return close !== null && close > 0 ? { date: null, close } : null
      }

      if (!isPlainObject(point)) {
        return null
      }

      const close = parseFiniteNumber(point.close ?? point.closePrice ?? point.price ?? point.value)
      if (close === null || close <= 0) {
        return null
      }

      return {
        date: normalizeDateToken(point.date ?? point.tradeDate ?? point.at ?? point.time),
        close,
      }
    })
    .filter(Boolean)

  const allDated = points.length > 0 && points.every((point) => typeof point.date === 'string' && point.date.length > 0)
  if (!allDated) {
    return points
  }

  return [...points].sort((left, right) => left.date.localeCompare(right.date))
}

export function calculateRecoveryLogReturns(priceSeries) {
  const points = normalizeRecoveryPriceSeries(priceSeries)
  const returns = []

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (!previous || !current || previous.close <= 0 || current.close <= 0) {
      continue
    }

    returns.push({
      fromDate: previous.date,
      toDate: current.date,
      fromClose: previous.close,
      toClose: current.close,
      logReturn: Math.log(current.close / previous.close),
    })
  }

  return returns
}

export function findRecoveryLowPoint(priceSeries) {
  const points = normalizeRecoveryPriceSeries(priceSeries)
  if (points.length === 0) {
    return null
  }

  let lowIndex = 0
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].close < points[lowIndex].close) {
      lowIndex = index
    }
  }

  return {
    index: lowIndex,
    date: points[lowIndex].date,
    close: points[lowIndex].close,
  }
}

export function extractRecoveryReboundWindow(priceSeries) {
  const points = normalizeRecoveryPriceSeries(priceSeries)
  const lowPoint = findRecoveryLowPoint(points)
  if (!lowPoint) {
    return {
      lowPoint: null,
      points: [],
    }
  }

  return {
    lowPoint,
    points: points.slice(lowPoint.index),
  }
}

function mean(values) {
  const finiteValues = values.filter(isFiniteNumber)
  if (finiteValues.length === 0) {
    return null
  }

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
}

function populationStandardDeviation(values) {
  const average = mean(values)
  if (average === null) {
    return null
  }

  const finiteValues = values.filter(isFiniteNumber)
  const variance = finiteValues.reduce((sum, value) => sum + (value - average) ** 2, 0) / finiteValues.length
  return Math.sqrt(variance)
}

function normalizeSimulationOptions(options = {}) {
  const horizonDays = Number.isInteger(options.horizonDays) && options.horizonDays > 0
    ? options.horizonDays
    : DEFAULT_RECOVERY_SIMULATION_OPTIONS.horizonDays
  const pathCount = Number.isInteger(options.pathCount) && options.pathCount > 0
    ? options.pathCount
    : DEFAULT_RECOVERY_SIMULATION_OPTIONS.pathCount

  return {
    horizonDays,
    pathCount,
    seed: options.seed ?? DEFAULT_RECOVERY_SIMULATION_OPTIONS.seed,
    recoveryDaysDigits: options.recoveryDaysDigits ?? 0,
    probabilityDigits: options.probabilityDigits ?? 1,
  }
}

function buildSimulationUnavailable(reason, modelKey, options) {
  return {
    status: 'unavailable',
    modelKey,
    reason,
    medianRecoveryDays: null,
    recoveryProbabilityPct: null,
    recoveredPathCount: 0,
    pathCount: options.pathCount,
    horizonDays: options.horizonDays,
  }
}

function summarizeSimulationRecoveryDays(recoveryDays, modelKey, options) {
  const recoveredPathCount = recoveryDays.length
  const recoveryProbabilityPct = roundTo((recoveredPathCount / options.pathCount) * 100, options.probabilityDigits)
  const medianRecoveryDays = roundTo(median(recoveryDays), options.recoveryDaysDigits)

  return {
    status: 'available',
    modelKey,
    reason: recoveredPathCount === 0 ? '시뮬레이션 기간 안에 목표가에 도달한 경로가 없습니다.' : null,
    medianRecoveryDays,
    recoveryProbabilityPct,
    recoveredPathCount,
    pathCount: options.pathCount,
    horizonDays: options.horizonDays,
  }
}

function simulateRecoveryDays({
  currentPrice,
  targetPrice,
  horizonDays,
  pathCount,
  random,
  nextLogReturn,
}) {
  const recoveryDays = []

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    let price = currentPrice

    for (let day = 1; day <= horizonDays; day += 1) {
      price *= Math.exp(nextLogReturn(random))

      if (price >= targetPrice) {
        recoveryDays.push(day)
        break
      }
    }
  }

  return recoveryDays
}

export function deriveRecoveryReturnParameters(priceSeries, options = {}) {
  const jumpStdMultiplier = isFiniteNumber(options.jumpStdMultiplier)
    ? options.jumpStdMultiplier
    : DEFAULT_RECOVERY_RETURN_PARAMETER_OPTIONS.jumpStdMultiplier
  const minReturnCount = Number.isInteger(options.minReturnCount) && options.minReturnCount >= 1
    ? options.minReturnCount
    : DEFAULT_RECOVERY_RETURN_PARAMETER_OPTIONS.minReturnCount

  const reboundWindow = extractRecoveryReboundWindow(priceSeries)
  const logReturnPoints = calculateRecoveryLogReturns(reboundWindow.points)
  const logReturns = logReturnPoints.map((point) => point.logReturn)

  if (logReturns.length < minReturnCount) {
    return {
      status: 'unavailable',
      reason: `반등 구간 로그 수익률이 ${minReturnCount}개 미만입니다.`,
      lowPoint: reboundWindow.lowPoint,
      priceCount: reboundWindow.points.length,
      returnCount: logReturns.length,
      logReturns,
    }
  }

  const riseMeanLogReturn = mean(logReturns)
  const riseVolatilityLogReturn = populationStandardDeviation(logReturns)
  const jumpThresholdLogReturn = Math.abs(riseVolatilityLogReturn * jumpStdMultiplier)
  const jumpLogReturns = []
  const diffusionLogReturns = []

  for (const value of logReturns) {
    if (jumpThresholdLogReturn > 0 && Math.abs(value) > jumpThresholdLogReturn) {
      jumpLogReturns.push(value)
    } else {
      diffusionLogReturns.push(value)
    }
  }

  return {
    status: 'available',
    reason: null,
    lowPoint: reboundWindow.lowPoint,
    priceCount: reboundWindow.points.length,
    returnCount: logReturns.length,
    logReturns,
    riseMeanLogReturn,
    riseVolatilityLogReturn,
    jumpStdMultiplier,
    jumpThresholdLogReturn,
    jumpCount: jumpLogReturns.length,
    diffusionCount: diffusionLogReturns.length,
    jumpProbability: jumpLogReturns.length / logReturns.length,
    diffusionMeanLogReturn: mean(diffusionLogReturns),
    diffusionVolatilityLogReturn: populationStandardDeviation(diffusionLogReturns),
    jumpMeanLogReturn: mean(jumpLogReturns),
    jumpVolatilityLogReturn: populationStandardDeviation(jumpLogReturns),
  }
}

export function simulateGbmRecovery(modelInput, options = {}) {
  const simulationOptions = normalizeSimulationOptions(options)
  const currentPrice = parsePositiveFiniteNumber(modelInput?.currentPrice)
  const targetPrice = parsePositiveFiniteNumber(modelInput?.targetPrice)
  const meanLogReturn = parseFiniteNumber(modelInput?.meanLogReturn)
  const volatilityLogReturn = parseFiniteNumber(modelInput?.volatilityLogReturn)

  if (currentPrice === null || targetPrice === null) {
    return buildSimulationUnavailable('currentPrice와 targetPrice는 0보다 큰 숫자여야 합니다.', 'gbm', simulationOptions)
  }

  if (targetPrice <= currentPrice) {
    return {
      status: 'available',
      modelKey: 'gbm',
      reason: null,
      medianRecoveryDays: 0,
      recoveryProbabilityPct: 100,
      recoveredPathCount: simulationOptions.pathCount,
      pathCount: simulationOptions.pathCount,
      horizonDays: simulationOptions.horizonDays,
    }
  }

  if (meanLogReturn === null || volatilityLogReturn === null || volatilityLogReturn < 0) {
    return buildSimulationUnavailable('GBM 평균 로그수익률과 변동성은 유효한 숫자여야 합니다.', 'gbm', simulationOptions)
  }

  const random = createRecoverySeededRandom(simulationOptions.seed)
  const drift = meanLogReturn - (volatilityLogReturn ** 2) / 2
  const recoveryDays = simulateRecoveryDays({
    currentPrice,
    targetPrice,
    horizonDays: simulationOptions.horizonDays,
    pathCount: simulationOptions.pathCount,
    random,
    nextLogReturn: (rng) => drift + volatilityLogReturn * randomStandardNormal(rng),
  })

  return summarizeSimulationRecoveryDays(recoveryDays, 'gbm', simulationOptions)
}

export function simulateJumpDiffusionRecovery(modelInput, options = {}) {
  const simulationOptions = normalizeSimulationOptions(options)
  const currentPrice = parsePositiveFiniteNumber(modelInput?.currentPrice)
  const targetPrice = parsePositiveFiniteNumber(modelInput?.targetPrice)
  const diffusionMeanLogReturn = parseFiniteNumber(modelInput?.diffusionMeanLogReturn)
  const diffusionVolatilityLogReturn = parseFiniteNumber(modelInput?.diffusionVolatilityLogReturn)
  const jumpProbability = parseFiniteNumber(modelInput?.jumpProbability)
  let jumpMeanLogReturn = parseFiniteNumber(modelInput?.jumpMeanLogReturn)
  let jumpVolatilityLogReturn = parseFiniteNumber(modelInput?.jumpVolatilityLogReturn)

  if (currentPrice === null || targetPrice === null) {
    return buildSimulationUnavailable('currentPrice와 targetPrice는 0보다 큰 숫자여야 합니다.', 'jumpDiffusion', simulationOptions)
  }

  if (targetPrice <= currentPrice) {
    return {
      status: 'available',
      modelKey: 'jumpDiffusion',
      reason: null,
      medianRecoveryDays: 0,
      recoveryProbabilityPct: 100,
      recoveredPathCount: simulationOptions.pathCount,
      pathCount: simulationOptions.pathCount,
      horizonDays: simulationOptions.horizonDays,
    }
  }

  if (jumpProbability === 0) {
    jumpMeanLogReturn ??= 0
    jumpVolatilityLogReturn ??= 0
  }

  if (
    diffusionMeanLogReturn === null
    || diffusionVolatilityLogReturn === null
    || diffusionVolatilityLogReturn < 0
    || jumpProbability === null
    || jumpProbability < 0
    || jumpProbability > 1
    || jumpMeanLogReturn === null
    || jumpVolatilityLogReturn === null
    || jumpVolatilityLogReturn < 0
  ) {
    return buildSimulationUnavailable('Jump-Diffusion 입력 파라미터가 유효하지 않습니다.', 'jumpDiffusion', simulationOptions)
  }

  const random = createRecoverySeededRandom(simulationOptions.seed)
  const diffusionDrift = diffusionMeanLogReturn - (diffusionVolatilityLogReturn ** 2) / 2
  const recoveryDays = simulateRecoveryDays({
    currentPrice,
    targetPrice,
    horizonDays: simulationOptions.horizonDays,
    pathCount: simulationOptions.pathCount,
    random,
    nextLogReturn: (rng) => {
      const diffusion = diffusionDrift + diffusionVolatilityLogReturn * randomStandardNormal(rng)
      const jump = rng() < jumpProbability
        ? jumpMeanLogReturn + jumpVolatilityLogReturn * randomStandardNormal(rng)
        : 0
      return diffusion + jump
    },
  })

  return summarizeSimulationRecoveryDays(recoveryDays, 'jumpDiffusion', simulationOptions)
}

function normalizePrimarySeriesInput(input) {
  if (Array.isArray(input)) {
    return input
  }

  if (!isPlainObject(input)) {
    return []
  }

  return input.primarySeries ?? input.priceSeries ?? input.series ?? []
}

function modelResultFromDetail(detail) {
  if (!detail || !isFiniteNumber(detail.medianRecoveryDays)) {
    return null
  }

  return {
    medianRecoveryDays: detail.medianRecoveryDays,
    recoveryProbabilityPct: isFiniteNumber(detail.recoveryProbabilityPct) ? detail.recoveryProbabilityPct : null,
    sampleSize: isFiniteNumber(detail.sampleCount) ? detail.sampleCount : null,
    note: detail.reason,
  }
}

export function buildRecoveryForecastFromPriceSeries(input, options = {}) {
  const targetPrice = parsePositiveFiniteNumber(input?.targetPrice ?? input?.buyPrice ?? input?.averagePrice)
  const currentPrice = inferCurrentPrice(input, targetPrice)
  const primarySeries = normalizePrimarySeriesInput(input)
  const modelDetails = {
    similarPattern: calculateSimilarPatternRecovery(input, options.similarPattern),
    gbm: null,
    jumpDiffusion: null,
  }

  const parameters = deriveRecoveryReturnParameters(primarySeries, options.returnParameters)

  if (currentPrice !== null && targetPrice !== null && parameters.status === 'available') {
    modelDetails.gbm = simulateGbmRecovery(
      {
        currentPrice,
        targetPrice,
        meanLogReturn: parameters.riseMeanLogReturn,
        volatilityLogReturn: parameters.riseVolatilityLogReturn,
      },
      options.simulation,
    )
    modelDetails.jumpDiffusion = simulateJumpDiffusionRecovery(
      {
        currentPrice,
        targetPrice,
        diffusionMeanLogReturn: parameters.diffusionMeanLogReturn,
        diffusionVolatilityLogReturn: parameters.diffusionVolatilityLogReturn,
        jumpProbability: parameters.jumpProbability,
        jumpMeanLogReturn: parameters.jumpMeanLogReturn,
        jumpVolatilityLogReturn: parameters.jumpVolatilityLogReturn,
      },
      options.simulation,
    )
  } else {
    const reason = currentPrice === null || targetPrice === null
      ? 'currentPrice와 targetPrice는 0보다 큰 숫자여야 합니다.'
      : parameters.reason
    const simulationOptions = normalizeSimulationOptions(options.simulation)
    modelDetails.gbm = buildSimulationUnavailable(reason, 'gbm', simulationOptions)
    modelDetails.jumpDiffusion = buildSimulationUnavailable(reason, 'jumpDiffusion', simulationOptions)
  }

  const modelResults = {
    similarPattern: modelResultFromDetail(modelDetails.similarPattern),
    gbm: modelResultFromDetail(modelDetails.gbm),
    jumpDiffusion: modelResultFromDetail(modelDetails.jumpDiffusion),
  }

  const missingModels = RECOVERY_FORECAST_MODEL_KEYS.filter((key) => modelResults[key] === null)
  if (missingModels.length > 0) {
    return {
      status: 'unavailable',
      reason: `최종 예측에 필요한 모델 결과가 부족합니다: ${missingModels.join(', ')}`,
      models: modelResults,
      consensus: null,
      parameters,
      modelDetails,
    }
  }

  const forecast = summarizeRecoveryForecast(modelResults, options.consensus)
  const anyLowConfidenceModel = Object.values(modelDetails).some((detail) => detail?.status === 'low_confidence')
  if (forecast.status === 'available' && anyLowConfidenceModel) {
    return {
      ...forecast,
      status: 'low_confidence',
      reason: '하나 이상의 하위 모델이 낮은 신뢰도로 계산되었습니다.',
      parameters,
      modelDetails,
    }
  }

  return {
    ...forecast,
    parameters,
    modelDetails,
  }
}

function normalizeSimilarPatternOptions(options = {}) {
  return {
    lookbackDays: Number.isInteger(options.lookbackDays) && options.lookbackDays > 0
      ? options.lookbackDays
      : DEFAULT_SIMILAR_PATTERN_OPTIONS.lookbackDays,
    tolerancePct: isFiniteNumber(options.tolerancePct) && options.tolerancePct >= 0
      ? options.tolerancePct
      : DEFAULT_SIMILAR_PATTERN_OPTIONS.tolerancePct,
    spacingDays: Number.isInteger(options.spacingDays) && options.spacingDays >= 0
      ? options.spacingDays
      : DEFAULT_SIMILAR_PATTERN_OPTIONS.spacingDays,
    minSampleSize: Number.isInteger(options.minSampleSize) && options.minSampleSize >= 1
      ? options.minSampleSize
      : DEFAULT_SIMILAR_PATTERN_OPTIONS.minSampleSize,
    recoveryDaysDigits: options.recoveryDaysDigits ?? 0,
    probabilityDigits: options.probabilityDigits ?? 1,
  }
}

function normalizePatternSeries(input) {
  if (Array.isArray(input)) {
    return [{ label: 'primary', points: normalizeRecoveryPriceSeries(input) }]
  }

  if (!isPlainObject(input)) {
    return []
  }

  const seriesList = []
  if (Array.isArray(input.primarySeries)) {
    seriesList.push({ label: input.primaryLabel ?? 'primary', points: normalizeRecoveryPriceSeries(input.primarySeries) })
  }

  if (Array.isArray(input.peerSeries)) {
    for (const [index, peer] of input.peerSeries.entries()) {
      if (Array.isArray(peer)) {
        seriesList.push({ label: `peer-${index + 1}`, points: normalizeRecoveryPriceSeries(peer) })
      } else if (isPlainObject(peer) && Array.isArray(peer.series)) {
        seriesList.push({
          label: peer.label ?? peer.name ?? `peer-${index + 1}`,
          points: normalizeRecoveryPriceSeries(peer.series),
        })
      }
    }
  }

  return seriesList
}

function inferTargetDrawdownPct(input, targetPrice) {
  const explicitDrawdownPct = parseFiniteNumber(input?.targetDrawdownPct)
  if (explicitDrawdownPct !== null && explicitDrawdownPct >= 0) {
    return explicitDrawdownPct
  }

  const currentPrice = parsePositiveFiniteNumber(input?.currentPrice)
  if (currentPrice === null || targetPrice === null) {
    return null
  }

  return Math.abs(((currentPrice - targetPrice) / targetPrice) * 100)
}

function inferCurrentPrice(input, targetPrice) {
  const currentPrice = parsePositiveFiniteNumber(input?.currentPrice)
  if (currentPrice !== null) {
    return currentPrice
  }

  const explicitDrawdownPct = parseFiniteNumber(input?.targetDrawdownPct)
  if (
    targetPrice === null
    || explicitDrawdownPct === null
    || explicitDrawdownPct < 0
    || explicitDrawdownPct >= 100
  ) {
    return null
  }

  return targetPrice * (1 - (explicitDrawdownPct / 100))
}

function findFirstRecoveryDay(points, startIndex, targetPrice) {
  for (let index = startIndex + 1; index < points.length; index += 1) {
    if (points[index].close >= targetPrice) {
      return index - startIndex
    }
  }

  return null
}

export function calculateSimilarPatternRecovery(input, options = {}) {
  const patternOptions = normalizeSimilarPatternOptions(options)
  const targetPrice = parsePositiveFiniteNumber(input?.targetPrice ?? input?.buyPrice ?? input?.averagePrice)
  const targetDrawdownPct = inferTargetDrawdownPct(input, targetPrice)
  const seriesList = normalizePatternSeries(input)

  if (targetPrice === null || targetDrawdownPct === null) {
    return {
      status: 'unavailable',
      modelKey: 'similarPattern',
      reason: 'targetPrice와 currentPrice 또는 targetDrawdownPct가 필요합니다.',
      medianRecoveryDays: null,
      recoveryProbabilityPct: null,
      sampleCount: 0,
      recoveredSampleCount: 0,
      recoveryDaysP25: null,
      recoveryDaysP75: null,
      samples: [],
    }
  }

  const samples = []
  const minDrawdownPct = Math.max(0, targetDrawdownPct - patternOptions.tolerancePct)
  const maxDrawdownPct = targetDrawdownPct + patternOptions.tolerancePct

  for (const { label, points } of seriesList) {
    let lastSampleIndex = -Infinity
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]
      const start = Math.max(0, index - patternOptions.lookbackDays + 1)
      const lookback = points.slice(start, index + 1)
      const peakClose = Math.max(...lookback.map((point) => point.close))
      const drawdownPct = peakClose > 0 ? ((peakClose - current.close) / peakClose) * 100 : 0

      if (drawdownPct < minDrawdownPct || drawdownPct > maxDrawdownPct) {
        continue
      }

      if (index - lastSampleIndex < patternOptions.spacingDays) {
        continue
      }

      const recoveryDays = findFirstRecoveryDay(points, index, targetPrice)
      samples.push({
        seriesLabel: label,
        index,
        date: current.date,
        close: current.close,
        peakClose,
        drawdownPct: roundTo(drawdownPct, 2),
        recoveryDays,
        recovered: recoveryDays !== null,
      })
      lastSampleIndex = index
    }
  }

  if (samples.length === 0) {
    return {
      status: 'unavailable',
      modelKey: 'similarPattern',
      reason: '유사 하락 패턴 샘플을 찾지 못했습니다.',
      medianRecoveryDays: null,
      recoveryProbabilityPct: null,
      sampleCount: 0,
      recoveredSampleCount: 0,
      recoveryDaysP25: null,
      recoveryDaysP75: null,
      samples,
    }
  }

  const recoveredDays = samples
    .map((sample) => sample.recoveryDays)
    .filter(isFiniteNumber)
  const recoveredSampleCount = recoveredDays.length
  const status = samples.length < patternOptions.minSampleSize ? 'low_confidence' : 'available'

  return {
    status,
    modelKey: 'similarPattern',
    reason: status === 'low_confidence' ? '유사 패턴 샘플 수가 충분하지 않습니다.' : null,
    medianRecoveryDays: roundTo(median(recoveredDays), patternOptions.recoveryDaysDigits),
    recoveryProbabilityPct: roundTo((recoveredSampleCount / samples.length) * 100, patternOptions.probabilityDigits),
    sampleCount: samples.length,
    recoveredSampleCount,
    recoveryDaysP25: roundTo(percentile(recoveredDays, 25), patternOptions.recoveryDaysDigits),
    recoveryDaysP75: roundTo(percentile(recoveredDays, 75), patternOptions.recoveryDaysDigits),
    targetDrawdownPct: roundTo(targetDrawdownPct, 2),
    tolerancePct: patternOptions.tolerancePct,
    samples,
  }
}

function normalizeWeights(weights) {
  const source = isPlainObject(weights) ? weights : DEFAULT_RECOVERY_FORECAST_MODEL_WEIGHTS
  const normalized = {}
  let total = 0

  for (const key of RECOVERY_FORECAST_MODEL_KEYS) {
    const weight = source[key]
    if (!isFiniteNumber(weight) || weight < 0) {
      return null
    }

    normalized[key] = weight
    total += weight
  }

  if (total <= 0) {
    return null
  }

  for (const key of RECOVERY_FORECAST_MODEL_KEYS) {
    normalized[key] = normalized[key] / total
  }

  return normalized
}

function weightedAverage(models, field, weights) {
  let total = 0
  let weightTotal = 0

  for (const key of RECOVERY_FORECAST_MODEL_KEYS) {
    const value = models[key]?.[field]
    const weight = weights[key]
    if (!isFiniteNumber(value) || !isFiniteNumber(weight) || weight <= 0) {
      continue
    }

    total += value * weight
    weightTotal += weight
  }

  return weightTotal > 0 ? total / weightTotal : null
}

export function calculateRecoveryForecastConfidence(medianRecoveryDays, thresholds = DEFAULT_RECOVERY_FORECAST_CONFIDENCE_THRESHOLDS) {
  const values = Array.isArray(medianRecoveryDays)
    ? medianRecoveryDays.filter((value) => isFiniteNumber(value) && value >= 0)
    : []

  if (values.length < 3) {
    return {
      level: 'low',
      deviationRatio: null,
      averageMedianDays: null,
      minMedianDays: null,
      maxMedianDays: null,
      reason: '신뢰도 계산에는 세 모델의 중앙 회수 기간이 모두 필요합니다.',
    }
  }

  const minMedianDays = Math.min(...values)
  const maxMedianDays = Math.max(...values)
  const averageMedianDays = values.reduce((sum, value) => sum + value, 0) / values.length
  const deviationRatio = averageMedianDays > 0 ? (maxMedianDays - minMedianDays) / averageMedianDays : 0

  const highMaxDeviationRatio = isFiniteNumber(thresholds.highMaxDeviationRatio)
    ? thresholds.highMaxDeviationRatio
    : DEFAULT_RECOVERY_FORECAST_CONFIDENCE_THRESHOLDS.highMaxDeviationRatio
  const mediumMaxDeviationRatio = isFiniteNumber(thresholds.mediumMaxDeviationRatio)
    ? thresholds.mediumMaxDeviationRatio
    : DEFAULT_RECOVERY_FORECAST_CONFIDENCE_THRESHOLDS.mediumMaxDeviationRatio

  let level = 'low'
  if (deviationRatio < highMaxDeviationRatio) {
    level = 'high'
  } else if (deviationRatio <= mediumMaxDeviationRatio) {
    level = 'medium'
  }

  return {
    level,
    deviationRatio: roundTo(deviationRatio, 4),
    averageMedianDays: roundTo(averageMedianDays, 1),
    minMedianDays,
    maxMedianDays,
    reason: null,
  }
}

export function summarizeRecoveryForecast(modelResults, options = {}) {
  const { models, errors } = normalizeModelResults(modelResults)

  if (errors.length > 0) {
    return buildUnavailableForecast(errors.join('; '), models)
  }

  const weights = normalizeWeights(options.weights)
  if (!weights) {
    return buildUnavailableForecast('model weights must be non-negative numbers with a positive total', models)
  }

  const confidence = calculateRecoveryForecastConfidence(
    RECOVERY_FORECAST_MODEL_KEYS.map((key) => models[key].medianRecoveryDays),
    options.confidenceThresholds,
  )

  // 종합 회수일 = 세 모델(similarPattern/GBM/Jump-Diffusion) 중앙값의 가중평균(기본 40/30/30).
  // 기획서 '원금회수 모델 설명서' §7-1 공식을 그대로 구현. 동 문서 §7-3 코칩 예시(58일/5%/신뢰 높음)는
  // GBM+JD만 평균한 결과로 본문 공식과 모순됨 — 공식 적용 시 코칩류 입력은 약 74일/신뢰 보통 이 정확.
  // (2026-07 합의: 공식(40/30/30) 준수 유지, 예시는 산술 오기로 간주. tests/recovery-forecast.test.mjs 도 74 명시.)
  const expectedRecoveryDaysRaw = weightedAverage(models, 'medianRecoveryDays', weights)
  if (!isFiniteNumber(expectedRecoveryDaysRaw)) {
    return buildUnavailableForecast('expected recovery days could not be calculated', models)
  }

  const recoveryProbabilityPctRaw = weightedAverage(models, 'recoveryProbabilityPct', weights)
  const expectedRecoveryDays = roundTo(expectedRecoveryDaysRaw, options.recoveryDaysDigits ?? 0)
  const recoveryProbabilityPct = roundTo(recoveryProbabilityPctRaw, options.probabilityDigits ?? 1)
  const status = confidence.level === 'low' ? 'low_confidence' : 'available'

  return {
    status,
    reason: status === 'low_confidence'
      ? '세 모델의 회수 기간 차이가 커서 낮은 신뢰도로 표시합니다.'
      : null,
    models,
    consensus: {
      expectedRecoveryDays,
      recoveryProbabilityPct,
      confidence,
      weights,
      disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
    },
  }
}
