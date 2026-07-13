'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { buildKrRecoveryForecast } = require('../src/services/recovery-forecast.js')

// 결정론적 KR 손실 시나리오: 평단 28000 → 반등 사이클 → 현재 20050 (코칩 예시와 유사한 -28% 손실)
function buildSyntheticKrLossSeries() {
  const points = []
  let price = 28000
  let seed = 126730
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  // 3회의 하락-반등 사이클로 유사패턴 샘플 확보
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (let i = 0; i < 30; i += 1) {
      price *= 1 - (0.011 + rnd() * 0.005)
      points.push({ date: `2024-0${cycle}-${String(i).padStart(2, '0')}`, close: Math.round(price) })
    }
    for (let i = 0; i < 40; i += 1) {
      price *= 1 + (0.008 + rnd() * 0.006)
      points.push({ date: `2024-1${cycle}-${String(i).padStart(2, '0')}`, close: Math.round(price) })
    }
  }
  // 마지막 손실 구간
  for (let i = 0; i < 35; i += 1) {
    price *= 1 - (0.01 + rnd() * 0.005)
    points.push({ date: `2024-9-${String(i).padStart(2, '0')}`, close: Math.round(price) })
  }
  return points
}

test('buildKrRecoveryForecast returns an envelope with core raw forecast plus shaping context for a loss-making holding', () => {
  const priceHistory = buildSyntheticKrLossSeries()
  const result = buildKrRecoveryForecast({
    averagePrice: 28000,
    currentPrice: 20050,
    priceHistory,
    instrumentCode: '126730',
  })

  assert.deepEqual(Object.keys(result).sort(), ['currentPrice', 'forecast', 'targetPrice'])
  assert.equal(result.currentPrice, 20050)
  assert.equal(result.targetPrice, 28000)

  const { forecast } = result
  assert.ok(['available', 'low_confidence', 'unavailable'].includes(forecast.status))
  // core 엔진 재사용 검증: 모델 키가 core 정의와 일치
  assert.deepEqual(Object.keys(forecast.models).sort(), ['gbm', 'jumpDiffusion', 'similarPattern'])
  if (forecast.status !== 'unavailable') {
    assert.ok(forecast.consensus)
    assert.ok(['high', 'medium', 'low'].includes(forecast.consensus.confidence.level))
    assert.equal(typeof forecast.consensus.expectedRecoveryDays, 'number')
  }
})

test('buildKrRecoveryForecast falls back to the latest price-history close when currentPrice is missing', () => {
  const priceHistory = buildSyntheticKrLossSeries()
  const lastClose = priceHistory.at(-1).close
  const result = buildKrRecoveryForecast({
    averagePrice: 28000,
    priceHistory,
    instrumentCode: '126730',
  })

  assert.equal(result.currentPrice, lastClose)
})

test('buildKrRecoveryForecast returns an unavailable envelope when average price is missing', () => {
  const result = buildKrRecoveryForecast({ priceHistory: buildSyntheticKrLossSeries() })

  assert.equal(result.forecast.status, 'unavailable')
  assert.equal(result.currentPrice, null)
  assert.equal(result.targetPrice, null)
  assert.match(result.forecast.reason, /평단가/)
})

test('buildKrRecoveryForecast returns an unavailable envelope when price history is too short', () => {
  const result = buildKrRecoveryForecast({
    averagePrice: 28000,
    currentPrice: 20050,
    priceHistory: [{ date: '2026-01-01', close: 20050 }, { date: '2026-01-02', close: 20100 }],
  })

  assert.equal(result.forecast.status, 'unavailable')
  assert.match(result.forecast.reason, /과거 주가 데이터/)
})

test('buildKrRecoveryForecast uses core status vocabulary (available/unavailable/low_confidence), never the legacy ok value', () => {
  const result = buildKrRecoveryForecast({
    averagePrice: 28000,
    currentPrice: 20050,
    priceHistory: buildSyntheticKrLossSeries(),
    instrumentCode: '126730',
  })
  // 드리프트 회귀 가드: 과거 closed PR의 'ok' 상태가 다시 들어오지 않아야 함
  assert.notEqual(result.forecast.status, 'ok')
  assert.ok(['available', 'low_confidence', 'unavailable'].includes(result.forecast.status))
})
