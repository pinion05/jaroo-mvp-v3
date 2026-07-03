/**
 * Random-walk simulation for the DeepScan target-price fan chart.
 *
 * The analyst target price is a single future point estimate, so there is no
 * realized path to chart. We instead synthesize many plausible paths from the
 * current price toward the target price using geometric Brownian motion, then
 * collapse them into quantile bands (a "cone of uncertainty").
 *
 * The simulation is deterministic given the same seed so the fan shape is
 * stable across re-renders and refreshes (no flicker).
 */

/** Per-step quantile bands derived from simulated paths. */
export type TargetPriceFanBands = {
  /** number of forward steps (excludes the t=0 anchor = current price) */
  steps: number
  /** lower band values, length === steps + 1 (index 0 === current price) */
  lower: number[]
  /** median band values, length === steps + 1 */
  median: number[]
  /** upper band values, length === steps + 1 */
  upper: number[]
}

/** Default forward horizon in trading steps (~3 months). */
export const DEFAULT_TARGET_PRICE_FAN_STEPS = 60

/** Default number of simulated paths. More paths = smoother bands + tighter median convergence to the target. */
export const DEFAULT_TARGET_PRICE_FAN_PATHS = 128

/**
 * Default per-step (daily) volatility when real price history is unavailable.
 * ~2.5%/day is a conservative middle ground for equities.
 */
export const DEFAULT_TARGET_PRICE_DAILY_VOLATILITY = 0.025

export type SimulateTargetPricePathsInput = {
  currentPrice: number
  targetPrice: number
  steps?: number
  paths?: number
  volatility?: number
  /** Seed string. Defaults to `${currentPrice}|${targetPrice}` for stability. */
  seed?: string
}

/**
 * Simulate `paths` geometric-Brownian-motion paths from currentPrice toward
 * targetPrice over `steps` intervals. Each returned path has length
 * `steps + 1`; index 0 is the current price, the final index is the realized
 * terminal value (which scatters around the target by construction).
 */
export function simulateTargetPricePaths(input: SimulateTargetPricePathsInput): number[][] {
  const { currentPrice, targetPrice } = input
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return []
  }
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    return []
  }

  const steps = clampPositiveInteger(input.steps, DEFAULT_TARGET_PRICE_FAN_STEPS)
  const pathCount = clampPositiveInteger(input.paths, DEFAULT_TARGET_PRICE_FAN_PATHS)
  const sigma = Number.isFinite(input.volatility) && (input.volatility as number) > 0
    ? (input.volatility as number)
    : DEFAULT_TARGET_PRICE_DAILY_VOLATILITY
  const seed = input.seed?.length ? input.seed : `${currentPrice}|${targetPrice}`

  // Drift so the geometric mean path converges to the target: the median of
  // ln(S_T) lands on ln(targetPrice).
  const drift = (Math.log(targetPrice) - Math.log(currentPrice)) / steps
  const rng = mulberry32(hashString(seed))

  const paths: number[][] = []
  for (let p = 0; p < pathCount; p += 1) {
    const path = new Array<number>(steps + 1)
    path[0] = currentPrice
    let value = currentPrice
    for (let t = 1; t <= steps; t += 1) {
      const z = gaussian(rng)
      value = value * Math.exp(drift - 0.5 * sigma * sigma + sigma * z)
      if (!Number.isFinite(value) || value <= 0) {
        // guard against pathological RNG tails
        value = path[t - 1]
      }
      path[t] = value
    }
    paths.push(path)
  }

  return paths
}

/**
 * Reduce simulated paths to quantile bands (lower / median / upper) at every
 * step. Lower/upper default to the 10th/90th percentile.
 */
export function buildTargetPriceFanBands(paths: number[][]): TargetPriceFanBands | null {
  if (paths.length === 0) {
    return null
  }
  const steps = paths[0].length - 1
  if (steps < 1) {
    return null
  }

  const lower: number[] = []
  const median: number[] = []
  const upper: number[] = []

  for (let t = 0; t <= steps; t += 1) {
    const column = paths.map((path) => path[t]).sort((a, b) => a - b)
    lower.push(quantile(column, 0.1))
    median.push(quantile(column, 0.5))
    upper.push(quantile(column, 0.9))
  }

  return { steps, lower, median, upper }
}

/**
 * Estimate per-step (daily) volatility from a price series as the standard
 * deviation of log returns. Falls back to `fallback` when there is too little
 * data.
 */
export function estimateDailyVolatility(
  prices: Array<number | null | undefined>,
  fallback = DEFAULT_TARGET_PRICE_DAILY_VOLATILITY,
): number {
  const closes = prices.filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
  if (closes.length < 3) {
    return fallback
  }

  const logReturns: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    logReturns.push(Math.log(closes[i] / closes[i - 1]))
  }
  if (logReturns.length === 0) {
    return fallback
  }

  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length
  const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / logReturns.length
  const stdev = Math.sqrt(variance)
  return Number.isFinite(stdev) && stdev > 0 ? stdev : fallback
}

// ---------------------------------------------------------------------------
// Multi-endpoint fan geometry
//
// Maps one median projection curve per active target-price endpoint (평균 /
// 최고 / 최저) into the SVG pixel space used by the loading-screen consensus
// chart. Pure + deterministic so it can be unit-tested with node:test
// (the .tsx component itself cannot be imported there due to its CSS-module
// import). The component consumes the returned `curves` array directly.
// ---------------------------------------------------------------------------

export type ConsensusFanCurveKey = 'high' | 'average' | 'low'

export type ConsensusFanCurve = {
  /** Which target-price level this curve projects to; drives styling + legend. */
  key: ConsensusFanCurveKey
  /** SVG path data for the median projection, e.g. "M10 50 L20 49 ...". */
  pathD: string
  /** Pixel y of the right-edge dot (the curve's terminal point lands here). */
  dotY: number
}

export type ConsensusFanGeometryInput = {
  currentPrice: number
  averageTarget: number
  highTarget?: number | null
  lowTarget?: number | null
  /** Recent close prices (oldest→newest); rendered as a left-third sparkline of real price action. */
  recentCloses?: Array<number | null | undefined>
  /** Per-step (daily) volatility; falls back to the default when not finite. */
  volatility?: number
  /** Base seed; suffixed per endpoint so each curve is independently stable. */
  seed?: string
}

export type ConsensusFanGeometry = {
  leftX: number
  rightX: number
  /** Right edge of the current-price line; the projection curves fan out from here (left third of the plot). */
  fanStartX: number
  currentY: number
  /** Sparkline path for recent closes across the left third; `null` → caller draws a flat current-price line. */
  recentPath: string | null
  /**
   * Active curves in render order `[low, high, average]` so the average
   * (primary) curve is painted last and sits on top. `high`/`low` are omitted
   * when their target is absent/non-positive.
   */
  curves: ConsensusFanCurve[]
}

/**
 * Build the pixel geometry for the consensus fan chart. Returns `null` when
 * the required current/average values are missing or no curve could be built.
 */
export function buildConsensusFanGeometry(input: ConsensusFanGeometryInput): ConsensusFanGeometry | null {
  const { currentPrice, averageTarget } = input
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(averageTarget) || averageTarget <= 0) {
    return null
  }

  // Plot region (must match the SVG viewBox 0 0 300 120 used by the component).
  const left = 10
  const right = 290
  const top = 18
  const bottom = 100
  const width = right - left
  const padY = 10
  const plotTop = top + padY
  const plotBottom = bottom - padY

  // Collect active endpoints (average is always present; high/low optional).
  const endpoints: Array<{ key: ConsensusFanCurveKey; price: number }> = []
  if (Number.isFinite(input.lowTarget) && (input.lowTarget as number) > 0) {
    endpoints.push({ key: 'low', price: input.lowTarget as number })
  }
  endpoints.push({ key: 'average', price: averageTarget })
  if (Number.isFinite(input.highTarget) && (input.highTarget as number) > 0) {
    endpoints.push({ key: 'high', price: input.highTarget as number })
  }

  const baseSeed = input.seed && input.seed.length ? input.seed : `${currentPrice}|${averageTarget}`
  const volatility = Number.isFinite(input.volatility) && (input.volatility as number) > 0
    ? (input.volatility as number)
    : DEFAULT_TARGET_PRICE_DAILY_VOLATILITY

  // Simulate a deterministic median path per endpoint.
  const perEndpoint = endpoints.map((ep) => {
    const paths = simulateTargetPricePaths({
      currentPrice,
      targetPrice: ep.price,
      volatility,
      seed: `${baseSeed}|${ep.key}`,
    })
    const bands = buildTargetPriceFanBands(paths)
    return { key: ep.key, price: ep.price, median: bands ? bands.median : null }
  })

  // Recent closes → left-third sparkline of real price action. Collected early
  // so they join the shared y-extent (option A: one honest axis).
  const recentCloses = (input.recentCloses ?? []).filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0,
  )

  // Shared y-extent across current + recent closes + endpoints + medians,
  // so the sparkline, curves and dots all fit inside the plot area.
  const extentValues: number[] = [currentPrice, ...recentCloses, ...endpoints.map((e) => e.price)]
  for (const pe of perEndpoint) {
    if (pe.median) {
      extentValues.push(...pe.median)
    }
  }
  const minValue = Math.min(...extentValues)
  const maxValue = Math.max(...extentValues)
  const range = maxValue - minValue || Math.max(1, maxValue * 0.02)

  const stepCount = perEndpoint[0].median?.length ?? 0
  // The current-price line spans the LEFT THIRD of the plot; the projection
  // curves fan out from `fanStart` (≈1/3 in) to `right`, so the chart reads as
  // a short current-price line that splits into 최저/평균/최고 projections.
  const fanStart = left + width * (1 / 3)
  const fanWidth = right - fanStart
  const xAt = (i: number) => (stepCount <= 1 ? right : fanStart + (fanWidth * i) / (stepCount - 1))
  const yAt = (value: number) => clamp(plotBottom - ((value - minValue) / range) * (plotBottom - plotTop), top, bottom)
  const round = (v: number) => Math.round(v * 10) / 10

  const currentY = round(yAt(currentPrice))

  // Left-third sparkline of recent closes, evenly mapped left→fanStart and
  // anchored so its tail lands exactly on currentY, joining the fan at the split.
  let recentPath: string | null = null
  if (recentCloses.length >= 2) {
    const n = recentCloses.length
    const recentWidth = fanStart - left
    const lastCloseY = yAt(recentCloses[n - 1])
    const sparkPts = recentCloses.map((value, i) => {
      const t = i / (n - 1)
      return {
        x: round(left + recentWidth * t),
        y: round(yAt(value) + (currentY - lastCloseY) * t),
      }
    })
    recentPath = sparkPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
  }

  const renderOrder: ConsensusFanCurveKey[] = ['low', 'high', 'average']
  const curves: ConsensusFanCurve[] = []
  for (const key of renderOrder) {
    const pe = perEndpoint.find((p) => p.key === key)
    if (!pe || !pe.median || pe.median.length === 0) {
      continue
    }
    const median = pe.median
    const n = median.length
    const endpointY = round(yAt(pe.price))
    const lastMedianY = yAt(median[n - 1])
    // Anchor: nudge each point by a linear shift so the final point lands
    // exactly on the endpoint dot (same technique the old single-target
    // builder used), with no visible kink.
    const points = median.map((value, i) => {
      const t = n === 1 ? 1 : i / (n - 1)
      const shift = (endpointY - lastMedianY) * t
      return { x: round(xAt(i)), y: round(yAt(value) + shift) }
    })
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
    curves.push({ key, pathD, dotY: endpointY })
  }

  if (curves.length === 0) {
    return null
  }

  return { leftX: left, rightX: right, fanStartX: round(fanStart), currentY, recentPath, curves }
}

// --- internals ---

function clampPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/** Linear-interpolated percentile of a pre-sorted ascending array. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN
  }
  if (sorted.length === 1) {
    return sorted[0]
  }
  const pos = clamp(p, 0, 1) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) {
    return sorted[lo]
  }
  const frac = pos - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** FNV-1a style string hash → uint32. */
function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // force into unsigned 32-bit
  return hash >>> 0
}

/** Deterministic PRNG (mulberry32). Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal sample via Box-Muller transform. */
function gaussian(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) {
    u = rng()
  }
  while (v === 0) {
    v = rng()
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
