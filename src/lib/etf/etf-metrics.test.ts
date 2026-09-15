import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeEtfMetrics, ETF_METRICS_MIN_DAILY_ROWS } from './etf-metrics'

// 고정 시계열 fixture — 날짜는 등간격 거래일 가정(순수 함수는 정렬만 하고 달력을 보지 않는다).
function makeDaily(closes: number[], startDate = '2025-01-01') {
  return closes.map((close, index) => ({
    date: new Date(Date.parse(startDate) + index * 86_400_000).toISOString().slice(0, 10),
    close,
  }))
}

test('computeEtfMetrics returns null under the 260-row minimum', () => {
  assert.equal(computeEtfMetrics(null), null)
  assert.equal(computeEtfMetrics([]), null)
  assert.equal(computeEtfMetrics(makeDaily(Array.from({ length: ETF_METRICS_MIN_DAILY_ROWS - 1 }, () => 100))), null)
})

test('computeEtfMetrics flat series: zero returns/vol/mdd, null sharpe, flat 52w', () => {
  const metrics = computeEtfMetrics(makeDaily(Array.from({ length: 300 }, () => 100)))
  assert.ok(metrics)
  assert.deepEqual(metrics.returns, { m1: 0, m3: 0, m6: 0, y1: 0 })
  assert.equal(metrics.volatilityAnnPct, 0)
  assert.equal(metrics.mddPct, 0)
  assert.equal(metrics.sharpe, null)
  assert.deepEqual(metrics.week52, { high: 100, low: 100 })
})

test('computeEtfMetrics monotonic +1%/day: period returns, 52w window, zero drawdown', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * 1.01 ** i)
  const metrics = computeEtfMetrics(makeDaily(closes))
  assert.ok(metrics)

  const approx = (actual: number | null, expected: number) =>
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `expected ~${expected}, got ${actual}`)

  approx(metrics.returns.m1, (1.01 ** 21 - 1) * 100)
  approx(metrics.returns.m3, (1.01 ** 63 - 1) * 100)
  approx(metrics.returns.m6, (1.01 ** 126 - 1) * 100)
  approx(metrics.returns.y1, (1.01 ** 252 - 1) * 100)
  assert.equal(metrics.mddPct, 0)
  // 52주 창(마지막 252행) = 인덱스 48..299
  approx(metrics.week52?.high ?? null, 100 * 1.01 ** 299)
  approx(metrics.week52?.low ?? null, 100 * 1.01 ** 48)
  // 일별 로그수익률이 상수 → 표본표준편차 0 → 샤프 정의 불가
  assert.equal(metrics.sharpe, null)
})

test('computeEtfMetrics crash fixture: MDD -50% and 52-week extremes', () => {
  const rising = Array.from({ length: 200 }, (_, i) => 100 + (i * 100) / 199) // 100 → 200
  const falling = Array.from({ length: 60 }, (_, j) => 200 - ((j + 1) * 100) / 60) // 200 → 100
  const metrics = computeEtfMetrics(makeDaily([...rising, ...falling]))
  assert.ok(metrics)

  assert.ok(metrics.mddPct !== null && Math.abs(metrics.mddPct - -50) < 1e-6, `mdd ${metrics.mddPct}`)
  assert.ok(metrics.week52 && Math.abs(metrics.week52.high - 200) < 1e-6)
  assert.ok(metrics.week52 && Math.abs(metrics.week52.low - 100) < 1e-6)
  // 마지막 21거래일은 하락 구간 — 1개월 수익률은 음수
  assert.ok(metrics.returns.m1 !== null && metrics.returns.m1 < 0)
})

test('computeEtfMetrics alternating closes: annualized volatility and sharpe formulas', () => {
  // 짝수 인덱스 100, 홀수 105 — 로그수익률은 정확히 ±ln(1.05) 교대
  const closes = Array.from({ length: 260 }, (_, i) => (i % 2 === 0 ? 100 : 105))
  const metrics = computeEtfMetrics(makeDaily(closes))
  assert.ok(metrics)

  const a = Math.log(1.05)
  const logReturns = Array.from({ length: 259 }, (_, i) => (i % 2 === 0 ? a : -a))
  const mean = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length
  const sampleStd = Math.sqrt(
    logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (logReturns.length - 1),
  )
  const expectedVol = sampleStd * Math.sqrt(252) * 100
  assert.ok(metrics.volatilityAnnPct !== null && Math.abs(metrics.volatilityAnnPct - expectedVol) < 1e-9)

  const annualizedPct = ((105 / 100) ** (252 / 259) - 1) * 100
  const expectedSharpe = (annualizedPct / 100 - 0.035) / (expectedVol / 100)
  assert.ok(metrics.sharpe !== null && Math.abs(metrics.sharpe - expectedSharpe) < 1e-9)
})

test('computeEtfMetrics sorts newest-first input before computing', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * 1.01 ** i)
  const ascending = makeDaily(closes)
  const metricsFromReversed = computeEtfMetrics([...ascending].reverse())
  const metricsFromAscending = computeEtfMetrics(ascending)
  assert.deepEqual(metricsFromReversed, metricsFromAscending)
})
