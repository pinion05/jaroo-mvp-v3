import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TARGET_PRICE_FAN_STEPS,
  buildProjectionPath,
  estimateDailyVolatility,
  buildConsensusFanGeometry,
} from '../src/lib/deepscan-target-price-paths.ts'

// 2026-09-14 재작성 — #261 리팩터링으로 기존 몬테카를로 밴드 API
// (simulateTargetPricePaths/buildTargetPriceFanBands)가
// 결정론적 단일 경로(buildProjectionPath) + SVG 지오메트리
// (buildConsensusFanGeometry)로 대체됐다. 이 파일은 현행 API의
// 계약를 같은 관점(퇴화 입력·양수 불변식·순서 불변식·결정론)으로 검증한다.

test('buildProjectionPath returns empty for non-positive or non-finite prices', () => {
  assert.deepEqual(buildProjectionPath({ currentPrice: 0, targetPrice: 10 }), [])
  assert.deepEqual(buildProjectionPath({ currentPrice: -5, targetPrice: 10 }), [])
  assert.deepEqual(buildProjectionPath({ currentPrice: NaN, targetPrice: 10 }), [])
  assert.deepEqual(buildProjectionPath({ currentPrice: 10, targetPrice: 0 }), [])
  assert.deepEqual(buildProjectionPath({ currentPrice: 10, targetPrice: -3 }), [])
})

test('path length is steps+1, starts at current price, ends exactly at target', () => {
  const path = buildProjectionPath({ currentPrice: 100, targetPrice: 150, steps: 10, seed: 'k' })
  assert.equal(path.length, 11)
  assert.equal(path[0], 100)
  assert.equal(path[path.length - 1], 150)
})

test('all path values stay strictly positive (no blow-ups)', () => {
  const path = buildProjectionPath({ currentPrice: 50, targetPrice: 80, steps: 60, seed: 'pos' })
  for (const value of path) {
    assert.ok(value > 0, `non-positive value ${value}`)
  }
})

test('non-positive steps falls back to the default step count', () => {
  const path = buildProjectionPath({ currentPrice: 100, targetPrice: 120, steps: 0, seed: 'steps' })
  assert.equal(path.length, DEFAULT_TARGET_PRICE_FAN_STEPS + 1)
})

test('deterministic for a fixed seed, interior differs across seeds', () => {
  const a1 = buildProjectionPath({ currentPrice: 100, targetPrice: 130, steps: 40, seed: 'same' })
  const a2 = buildProjectionPath({ currentPrice: 100, targetPrice: 130, steps: 40, seed: 'same' })
  assert.deepEqual(a1, a2)

  const b = buildProjectionPath({ currentPrice: 100, targetPrice: 130, steps: 40, seed: 'other' })
  const interiorDiffers = a1.some((value, i) => i > 0 && i < a1.length - 1 && Math.abs(value - b[i]) > 1e-12)
  assert.ok(interiorDiffers, 'seed should perturb the interior walk')
  // 끝점은 시드와 무관하게 고정된다(브리지 보정)
  assert.equal(a1[a1.length - 1], b[b.length - 1])
})

test('estimateDailyVolatility falls back with fewer than 3 closes', () => {
  assert.equal(estimateDailyVolatility([], 0.05), 0.05)
  assert.equal(estimateDailyVolatility([100], 0.05), 0.05)
  assert.equal(estimateDailyVolatility([100, 110], 0.05), 0.05)
})

test('estimateDailyVolatility falls back for constant series (zero stdev)', () => {
  assert.equal(estimateDailyVolatility([100, 100, 100, 100], 0.04), 0.04)
})

test('estimateDailyVolatility: invalid entries are filtered, real variance wins', () => {
  // [100, 105, 103] — 비등차 로그수익률로 실분산(≈0.034)이 계산되고,
  // 폴백(0.01)과 변별력 있게: 무효값이 필터링되지 않으면 closes<3 → 폴백이었을 것.
  const stdev = estimateDailyVolatility([null, 100, undefined, 105, 103, NaN], 0.01)
  assert.ok(stdev > 0.02, `expected computed variance (~0.034), got ${stdev} (fallback?)`)
  assert.ok(stdev < 0.2, `implausibly large stdev ${stdev}`)
})

test('buildConsensusFanGeometry returns null for invalid required values', () => {
  assert.equal(buildConsensusFanGeometry({ currentPrice: 0, averageTarget: 100 }), null)
  assert.equal(buildConsensusFanGeometry({ currentPrice: 100, averageTarget: NaN }), null)
  assert.equal(buildConsensusFanGeometry({ currentPrice: -1, averageTarget: 100 }), null)
})

test('curve render order is [low, high, average] so the average paints last', () => {
  const geometry = buildConsensusFanGeometry({
    currentPrice: 100,
    averageTarget: 130,
    highTarget: 160,
    lowTarget: 110,
    seed: 'order',
  })
  assert.ok(geometry)
  assert.deepEqual(
    geometry.curves.map((curve) => curve.key),
    ['low', 'high', 'average'],
  )
})

test('SVG y-axis inversion: higher target price renders with a smaller dotY', () => {
  const geometry = buildConsensusFanGeometry({
    currentPrice: 100,
    averageTarget: 130,
    highTarget: 160,
    lowTarget: 110,
    seed: 'axis',
  })
  assert.ok(geometry)
  const byKey = Object.fromEntries(geometry.curves.map((curve) => [curve.key, curve.dotY]))
  assert.ok(byKey.high < byKey.average, `high ${byKey.high} should sit above average ${byKey.average}`)
  assert.ok(byKey.average < byKey.low, `average ${byKey.average} should sit above low ${byKey.low}`)
})

test('optional endpoints and overlays degrade cleanly', () => {
  const geometry = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 130, seed: 'solo' })
  assert.ok(geometry)
  assert.deepEqual(
    geometry.curves.map((curve) => curve.key),
    ['average'],
  )
  assert.equal(geometry.recentPath, null, 'no recentCloses → no sparkline')
  assert.equal(geometry.averagePriceY, null, 'no averagePrice → no dashed line')

  const withExtras = buildConsensusFanGeometry({
    currentPrice: 100,
    averageTarget: 130,
    averagePrice: 120,
    recentCloses: [95, 98, 101],
    seed: 'extras',
  })
  assert.ok(withExtras)
  assert.ok(typeof withExtras.recentPath === 'string' && withExtras.recentPath.startsWith('M'))
  assert.ok(typeof withExtras.averagePriceY === 'number')
})
