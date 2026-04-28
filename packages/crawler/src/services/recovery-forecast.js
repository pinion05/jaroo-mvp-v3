const DEFAULT_DISCLAIMER = '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.';
const MODEL_WEIGHTS = Object.freeze({ similarPattern: 0.4, gbm: 0.3, jumpDiffusion: 0.3 });
const TRADING_DAYS = 252;
const DEFAULT_PATHS = 5000;

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function normalizePricePoint(point) {
  if (!point || typeof point !== 'object') return null;
  const close = asFiniteNumber(point.close ?? point.price ?? point.value);
  if (close === null || close <= 0) return null;
  const date = typeof point.date === 'string' && point.date.trim() ? point.date.trim() : null;
  return { date, close };
}

export function normalizePriceHistory(history = []) {
  return Array.isArray(history)
    ? history.map(normalizePricePoint).filter(Boolean).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
    : [];
}

export function calculateLogReturns(history = []) {
  const points = normalizePriceHistory(history);
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].close;
    const current = points[index].close;
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  return returns;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values, avg = mean(values)) {
  if (!values.length || avg === null) return null;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function round(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function roundPct(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 10 : null;
}

function createSeededRandom(seed = 123456789) {
  let state = (seed >>> 0) || 123456789;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function normalSample(random) {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function calculateReboundParameters(history = []) {
  const points = normalizePriceHistory(history);
  if (points.length < 3) return { returns: [], lowIndex: -1, mu: null, sigma: null };
  let lowIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].close < points[lowIndex].close) lowIndex = index;
  }
  const rebound = points.slice(lowIndex);
  const returns = calculateLogReturns(rebound);
  const mu = mean(returns);
  const sigma = stddev(returns, mu);
  return { returns, lowIndex, mu, sigma };
}

export function splitJumpDiffusionReturns(returns = []) {
  const safeReturns = returns.filter((value) => typeof value === 'number' && Number.isFinite(value));
  const avg = mean(safeReturns);
  const sigmaAll = stddev(safeReturns, avg);
  if (!safeReturns.length || avg === null || sigmaAll === null) {
    return { diffusionReturns: [], jumpReturns: [], muD: null, sigmaD: null, lambda: null, muJ: null, sigmaJ: null };
  }
  const threshold = sigmaAll * 2;
  const diffusionReturns = [];
  const jumpReturns = [];
  for (const value of safeReturns) {
    if (Math.abs(value - avg) > threshold) jumpReturns.push(value);
    else diffusionReturns.push(value);
  }
  const muD = mean(diffusionReturns);
  const sigmaD = stddev(diffusionReturns, muD);
  const muJ = mean(jumpReturns) ?? 0;
  const sigmaJ = stddev(jumpReturns, muJ) ?? 0;
  return { diffusionReturns, jumpReturns, muD, sigmaD, lambda: jumpReturns.length / safeReturns.length, muJ, sigmaJ };
}

export function sampleSimilarPatterns({ history = [], averagePrice, currentPrice, lookbackDays = 40, tolerancePct = 12, spacingDays = 20, horizonDays = TRADING_DAYS } = {}) {
  const points = normalizePriceHistory(history);
  if (points.length < lookbackDays + 2 || !(averagePrice > 0) || !(currentPrice > 0)) return [];
  const currentLossPct = ((currentPrice - averagePrice) / averagePrice) * 100;
  const samples = [];
  let lastSampleIndex = -Infinity;
  for (let index = lookbackDays; index < points.length - 1; index += 1) {
    const window = points.slice(index - lookbackDays, index + 1);
    const high = Math.max(...window.map((point) => point.close));
    if (!(high > 0)) continue;
    const drawdownPct = ((points[index].close - high) / high) * 100;
    if (Math.abs(drawdownPct - currentLossPct) > tolerancePct) continue;
    if (index - lastSampleIndex < spacingDays) continue;
    lastSampleIndex = index;
    let recoveredInDays = null;
    const target = points[index].close * (averagePrice / currentPrice);
    for (let futureIndex = index + 1; futureIndex < Math.min(points.length, index + horizonDays + 1); futureIndex += 1) {
      if (points[futureIndex].close >= target) {
        recoveredInDays = futureIndex - index;
        break;
      }
    }
    samples.push({ startIndex: index, drawdownPct, recovered: recoveredInDays !== null, recoveredInDays });
  }
  return samples;
}

function summarizeHits(hits, paths) {
  const recoveredDays = hits.filter((value) => value !== null);
  return {
    probabilityWithinOneYear: paths > 0 ? recoveredDays.length / paths : null,
    medianDays: round(quantile(recoveredDays, 0.5)),
    p25Days: round(quantile(recoveredDays, 0.25)),
    p75Days: round(quantile(recoveredDays, 0.75)),
    sampleCount: paths,
  };
}

export function simulatePaths({ currentPrice, averagePrice, mu, sigma, paths = DEFAULT_PATHS, horizonDays = TRADING_DAYS, seed = 20260428, jumpParams = null }) {
  if (!(currentPrice > 0) || !(averagePrice > 0) || mu === null || sigma === null || sigma < 0) return summarizeHits([], 0);
  const random = createSeededRandom(seed);
  const hits = [];
  for (let path = 0; path < paths; path += 1) {
    let price = currentPrice;
    let hit = null;
    for (let day = 1; day <= horizonDays; day += 1) {
      let dailyReturn = mu + sigma * normalSample(random);
      if (jumpParams && random() < jumpParams.lambda) {
        dailyReturn += jumpParams.muJ + jumpParams.sigmaJ * normalSample(random);
      }
      price *= Math.exp(dailyReturn);
      if (price >= averagePrice) {
        hit = day;
        break;
      }
    }
    hits.push(hit);
  }
  return summarizeHits(hits, paths);
}

function unavailable(reason, missingInputs = []) {
  return {
    status: 'unavailable',
    expectedRecoveryDays: null,
    expectedRecoveryPeriodLabel: '계산 불가',
    probabilityWithinOneYear: null,
    confidence: 'low',
    confidenceLabel: '낮음',
    divergenceRatio: null,
    disclaimer: DEFAULT_DISCLAIMER,
    models: [],
    dataQuality: { sampleCount: 0, historyDays: 0, similarPatternSamples: 0, missingInputs, notes: [reason] },
  };
}

function periodLabel(days) {
  if (!(days > 0)) return '계산 불가';
  if (days < 21) return `약 ${Math.round(days)}거래일`;
  if (days < 63) return `약 ${Math.round(days / 21)}개월`;
  return `약 ${Math.round(days / 21)}개월`;
}

function confidenceFromMedians(medians) {
  const values = medians.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (values.length < 2) return { confidence: 'low', confidenceLabel: '낮음', divergenceRatio: null };
  const avg = mean(values);
  const divergenceRatio = avg ? (Math.max(...values) - Math.min(...values)) / avg : null;
  if (divergenceRatio !== null && divergenceRatio < 0.3) return { confidence: 'high', confidenceLabel: '높음', divergenceRatio };
  if (divergenceRatio !== null && divergenceRatio <= 0.7) return { confidence: 'medium', confidenceLabel: '보통', divergenceRatio };
  return { confidence: 'low', confidenceLabel: '낮음', divergenceRatio };
}

export function calculateRecoveryConfidence(medians = []) {
  return confidenceFromMedians(medians);
}

export function buildRecoveryForecast(input = {}) {
  const averagePrice = asFiniteNumber(input.averagePrice);
  const currentPrice = asFiniteNumber(input.currentPrice);
  const history = normalizePriceHistory(input.priceHistory);
  const paths = parsePositiveInteger(input.paths, DEFAULT_PATHS);
  const horizonDays = parsePositiveInteger(input.horizonDays, TRADING_DAYS);
  const missingInputs = [];
  if (!(averagePrice > 0)) missingInputs.push('averagePrice');
  if (!(currentPrice > 0)) missingInputs.push('currentPrice');
  if (history.length < 60) missingInputs.push('priceHistory');
  if (missingInputs.length) return unavailable('원금 회수 예측에 필요한 평단/현재가/가격 이력이 부족합니다.', missingInputs);
  if (currentPrice >= averagePrice) return unavailable('현재가가 평단 이상이라 손실 회복 예측 대상이 아닙니다.', []);

  const returns = calculateLogReturns(history);
  if (returns.length < 40) return unavailable('로그 수익률 표본이 부족합니다.', ['priceHistory']);

  const similarSamples = sampleSimilarPatterns({ history, averagePrice, currentPrice, horizonDays });
  const recoveredSamples = similarSamples.filter((sample) => sample.recovered && sample.recoveredInDays !== null).map((sample) => sample.recoveredInDays);
  const similarModel = {
    id: 'similarPattern',
    label: '유사 패턴 통계',
    weight: MODEL_WEIGHTS.similarPattern,
    status: similarSamples.length >= 3 && recoveredSamples.length > 0 ? 'ok' : 'low_confidence',
    medianDays: round(quantile(recoveredSamples, 0.5)),
    p25Days: round(quantile(recoveredSamples, 0.25)),
    p75Days: round(quantile(recoveredSamples, 0.75)),
    probabilityWithinOneYear: similarSamples.length ? recoveredSamples.length / similarSamples.length : null,
    sampleCount: similarSamples.length,
  };

  const rebound = calculateReboundParameters(history);
  const fallbackMu = mean(returns);
  const fallbackSigma = stddev(returns, fallbackMu);
  const mu = rebound.returns.length >= 10 ? rebound.mu : fallbackMu;
  const sigma = rebound.returns.length >= 10 ? rebound.sigma : fallbackSigma;
  const gbm = simulatePaths({ currentPrice, averagePrice, mu, sigma, paths, horizonDays, seed: input.seed ?? 20260428 });
  const gbmModel = { id: 'gbm', label: 'GBM', weight: MODEL_WEIGHTS.gbm, status: gbm.medianDays === null ? 'low_confidence' : 'ok', ...gbm };

  const jumpSplit = splitJumpDiffusionReturns(returns);
  const jd = simulatePaths({
    currentPrice,
    averagePrice,
    mu: jumpSplit.muD ?? fallbackMu,
    sigma: jumpSplit.sigmaD ?? fallbackSigma,
    paths,
    horizonDays,
    seed: (input.seed ?? 20260428) + 17,
    jumpParams: {
      lambda: jumpSplit.lambda ?? 0,
      muJ: jumpSplit.muJ ?? 0,
      sigmaJ: jumpSplit.sigmaJ ?? 0,
    },
  });
  const jumpModel = { id: 'jumpDiffusion', label: 'Jump-Diffusion', weight: MODEL_WEIGHTS.jumpDiffusion, status: jd.medianDays === null ? 'low_confidence' : 'ok', ...jd };

  const models = [similarModel, gbmModel, jumpModel];
  const usableModels = models.filter((model) => typeof model.medianDays === 'number' && Number.isFinite(model.medianDays));
  const weightTotal = usableModels.reduce((sum, model) => sum + model.weight, 0);
  if (!usableModels.length || weightTotal <= 0) return unavailable('모든 예측 모델이 회복 중앙값을 계산하지 못했습니다.', []);
  const expectedRecoveryDays = round(usableModels.reduce((sum, model) => sum + model.medianDays * model.weight, 0) / weightTotal);
  const probabilityWithinOneYear = usableModels.reduce((sum, model) => sum + (model.probabilityWithinOneYear ?? 0) * model.weight, 0) / weightTotal;
  const confidence = confidenceFromMedians(usableModels.map((model) => model.medianDays));
  const hasLowConfidenceModel = models.some((model) => model.status !== 'ok');

  return {
    status: hasLowConfidenceModel ? 'low_confidence' : 'ok',
    expectedRecoveryDays,
    expectedRecoveryPeriodLabel: periodLabel(expectedRecoveryDays),
    probabilityWithinOneYear: roundPct(probabilityWithinOneYear),
    confidence: hasLowConfidenceModel && confidence.confidence === 'high' ? 'medium' : confidence.confidence,
    confidenceLabel: hasLowConfidenceModel && confidence.confidence === 'high' ? '보통' : confidence.confidenceLabel,
    divergenceRatio: confidence.divergenceRatio === null ? null : Math.round(confidence.divergenceRatio * 1000) / 1000,
    disclaimer: DEFAULT_DISCLAIMER,
    models: models.map((model) => ({
      id: model.id,
      label: model.label,
      weight: model.weight,
      status: model.status,
      medianDays: model.medianDays,
      p25Days: model.p25Days,
      p75Days: model.p75Days,
      probabilityWithinOneYear: model.probabilityWithinOneYear === null ? null : roundPct(model.probabilityWithinOneYear),
      sampleCount: model.sampleCount,
    })),
    dataQuality: {
      sampleCount: returns.length,
      historyDays: history.length,
      similarPatternSamples: similarSamples.length,
      missingInputs: [],
      notes: [
        `가격 이력 ${history.length}개`,
        `유사 패턴 ${similarSamples.length}개`,
        `점프 표본 ${jumpSplit.jumpReturns.length}개`,
      ],
    },
  };
}

export { DEFAULT_DISCLAIMER as RECOVERY_FORECAST_DISCLAIMER };
