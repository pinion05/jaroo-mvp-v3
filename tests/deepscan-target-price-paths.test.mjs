import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  simulateTargetPricePaths,
  buildTargetPriceFanBands,
  estimateDailyVolatility,
} from '../src/lib/deepscan-target-price-paths.ts'

test('simulateTargetPricePaths returns empty for non-positive current price', () => {
  assert.deepEqual(simulateTargetPricePaths({ currentPrice: 0, targetPrice: 10 }), [])
  assert.deepEqual(simulateTargetPricePaths({ currentPrice: -5, targetPrice: 10 }), [])
  assert.deepEqual(simulateTargetPricePaths({ currentPrice: NaN, targetPrice: 10 }), [])
})

test('simulateTargetPricePaths returns empty for non-positive target price', () => {
  assert.deepEqual(simulateTargetPricePaths({ currentPrice: 10, targetPrice: 0 }), [])
  assert.deepEqual(simulateTargetPricePaths({ currentPrice: 10, targetPrice: -3 }), [])
})

test('each path starts at current price and has steps+1 length', () => {
  const paths = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 120, steps: 10, paths: 5, seed: 'k' })
  assert.equal(paths.length, 5)
  for (const path of paths) {
    assert.equal(path.length, 11)
    assert.equal(path[0], 100)
  }
})

test('all path values stay strictly positive (no blow-ups)', () => {
  const paths = simulateTargetPricePaths({ currentPrice: 50, targetPrice: 80, steps: 60, paths: 50, seed: 'pos' })
  for (const path of paths) {
    for (const v of path) {
      assert.ok(v > 0, `expected positive, got ${v}`)
      assert.ok(Number.isFinite(v))
    }
  }
})

test('deterministic: same seed produces identical paths', () => {
  const a = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 20, paths: 10, seed: 'same' })
  const b = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 20, paths: 10, seed: 'same' })
  assert.deepEqual(a, b)
})

test('different seeds produce different path shapes', () => {
  const a = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 30, paths: 20, seed: 'seed-a' })
  const b = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 30, paths: 20, seed: 'seed-b' })
  assert.notDeepEqual(a, b)
})

test('default seed derived from prices is stable across calls', () => {
  const a = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 15, paths: 8 })
  const b = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 15, paths: 8 })
  assert.deepEqual(a, b)
})

test('median band converges near target price (drift correctness)', () => {
  // With enough paths, the median terminal value should be close to the target.
  const paths = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 150, steps: 60, paths: 200, seed: 'converge' })
  const bands = buildTargetPriceFanBands(paths)
  assert.ok(bands, 'bands should be produced')
  const terminalMedian = bands.median[bands.median.length - 1]
  // allow generous tolerance since this is stochastic, but drift pins it
  assert.ok(Math.abs(terminalMedian - 150) / 150 < 0.25, `median terminal ${terminalMedian} far from target 150`)
})

test('bands: lower <= median <= upper at every step', () => {
  const paths = simulateTargetPricePaths({ currentPrice: 80, targetPrice: 110, steps: 40, paths: 60, seed: 'order' })
  const bands = buildTargetPriceFanBands(paths)
  for (let t = 0; t <= bands.steps; t += 1) {
    assert.ok(bands.lower[t] <= bands.median[t] + 1e-9, `step ${t}: lower ${bands.lower[t]} > median ${bands.median[t]}`)
    assert.ok(bands.median[t] <= bands.upper[t] + 1e-9, `step ${t}: median ${bands.median[t]} > upper ${bands.upper[t]}`)
  }
})

test('bands anchor at current price at t=0', () => {
  const paths = simulateTargetPricePaths({ currentPrice: 42, targetPrice: 60, steps: 20, paths: 30, seed: 'anchor' })
  const bands = buildTargetPriceFanBands(paths)
  assert.equal(bands.lower[0], 42)
  assert.equal(bands.median[0], 42)
  assert.equal(bands.upper[0], 42)
})

test('buildTargetPriceFanBands returns null for empty input', () => {
  assert.equal(buildTargetPriceFanBands([]), null)
})

test('upper band widens above target when target > current (upside cone)', () => {
  const paths = simulateTargetPricePaths({ currentPrice: 100, targetPrice: 140, steps: 50, paths: 80, seed: 'upside' })
  const bands = buildTargetPriceFanBands(paths)
  assert.ok(bands.upper[bands.steps] > bands.median[bands.steps], 'upper terminal should exceed median')
  assert.ok(bands.lower[bands.steps] < bands.median[bands.steps], 'lower terminal should trail median')
})

test('estimateDailyVolatility falls back for too few prices', () => {
  assert.equal(estimateDailyVolatility([100]), 0.025)
  assert.equal(estimateDailyVolatility([100, 101]), 0.025)
  assert.equal(estimateDailyVolatility([]), 0.025)
})

test('estimateDailyVolatility computes a positive stdev from a price series', () => {
  const vol = estimateDailyVolatility([100, 102, 99, 105, 101, 108])
  assert.ok(vol > 0)
  assert.ok(Number.isFinite(vol))
})

test('estimateDailyVolatility respects custom fallback', () => {
  assert.equal(estimateDailyVolatility([5], 0.04), 0.04)
})

test('custom volatility shapes the cone width', () => {
  const lowVol = buildTargetPriceFanBands(
    simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 40, paths: 80, volatility: 0.005, seed: 'w' }),
  )
  const highVol = buildTargetPriceFanBands(
    simulateTargetPricePaths({ currentPrice: 100, targetPrice: 130, steps: 40, paths: 80, volatility: 0.06, seed: 'w' }),
  )
  const lowSpread = lowVol.upper[lowVol.steps] - lowVol.lower[lowVol.steps]
  const highSpread = highVol.upper[highVol.steps] - highVol.lower[highVol.steps]
  assert.ok(highSpread > lowSpread * 2, `high-vol cone (${highSpread}) should be much wider than low-vol (${lowSpread})`)
})
