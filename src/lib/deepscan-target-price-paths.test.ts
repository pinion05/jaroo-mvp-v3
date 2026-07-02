import test from 'node:test'
import assert from 'node:assert/strict'

import { buildConsensusFanGeometry } from '@/lib/deepscan-target-price-paths'

test('buildConsensusFanGeometry returns null when current or average target is not positive/finite', () => {
  assert.equal(buildConsensusFanGeometry({ currentPrice: 0, averageTarget: 100 }), null)
  assert.equal(buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 0 }), null)
  assert.equal(buildConsensusFanGeometry({ currentPrice: Number.NaN, averageTarget: 100 }), null)
})

test('buildConsensusFanGeometry renders only the average curve when high/low are absent', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, seed: 's' })
  assert.ok(g)
  assert.deepEqual(g!.curves.map((c) => c.key), ['average'])
})

test('buildConsensusFanGeometry returns curves in render order [low, high, average] when all targets are present', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  assert.ok(g)
  assert.deepEqual(g!.curves.map((c) => c.key), ['low', 'high', 'average'])
})

test('buildConsensusFanGeometry skips a null or non-positive high/low but keeps the rest', () => {
  const onlyLow = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: null, seed: 's' })
  assert.ok(onlyLow)
  assert.deepEqual(onlyLow!.curves.map((c) => c.key), ['low', 'average'])

  const onlyHigh = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 0, highTarget: 160, seed: 's' })
  assert.ok(onlyHigh)
  assert.deepEqual(onlyHigh!.curves.map((c) => c.key), ['high', 'average'])
})

test('buildConsensusFanGeometry is deterministic for identical inputs', () => {
  const a = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  const b = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  assert.deepEqual(a, b)
})

test('buildConsensusFanGeometry anchors each curve tail exactly onto its endpoint dot', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  assert.ok(g)
  for (const curve of g!.curves) {
    const match = curve.pathD.match(/L\d+(?:\.\d+)? (\d+(?:\.\d+)?)$/)
    assert.ok(match, `curve ${curve.key} should end with an L segment`)
    assert.equal(Number(match![1]), curve.dotY)
  }
})

test('buildConsensusFanGeometry places the high dot above the low dot (smaller y = higher)', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 50, highTarget: 200, seed: 's' })
  assert.ok(g)
  const low = g!.curves.find((c) => c.key === 'low')
  const high = g!.curves.find((c) => c.key === 'high')
  assert.ok(low && high)
  assert.ok(high!.dotY < low!.dotY, 'high target should render above (lower y) the low target')
})
