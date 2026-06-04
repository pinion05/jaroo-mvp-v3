import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { homeHoldings, type HomeHolding } from '@/lib/jaroo-home-data'

const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, { get: (_target, property) => String(property) })
}

async function loadSummaryBuilder() {
  const module = await import('./jaroo-home-screen')
  return module.buildHomeV2Summary
}

function createHolding(overrides: Partial<HomeHolding>): HomeHolding {
  return {
    ...homeHoldings[0],
    id: overrides.id ?? 0,
    name: overrides.name ?? '테스트',
    shortName: overrides.shortName ?? overrides.name ?? '테스트',
    donutLabel: overrides.donutLabel ?? overrides.name ?? '테스트',
    shares: overrides.shares ?? '1주',
    market: overrides.market ?? 'KOSPI',
    marketTone: overrides.marketTone ?? 'kospi',
    averagePrice: overrides.averagePrice ?? '1,000,000원',
    evaluationAmount: overrides.evaluationAmount ?? '1,000,000원',
    change: overrides.change ?? '+0.0%',
    pnl: overrides.pnl ?? '+0원',
    metaLine: overrides.metaLine ?? '평단 1,000,000원 · 평가금액 1,000,000원',
    metrics: overrides.metrics ?? [
      { label: '평가 금액', value: overrides.evaluationAmount ?? '1,000,000원', tone: 'neutral' },
    ],
    ...overrides,
  }
}

test('home summary는 혼합 KRW/USD 손익을 환율 없이는 수익/손실로 확정하지 않는다', async () => {
  const buildHomeV2Summary = await loadSummaryBuilder()
  const summary = buildHomeV2Summary([
    createHolding({ id: 1, name: '국내', pnl: '+100,000원', evaluationAmount: '1,100,000원', change: '+10.0%' }),
    createHolding({
      id: 2,
      name: '미국',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      pnl: '-$1,000.00',
      evaluationAmount: '$9,000.00',
      change: '-10.0%',
      metrics: [{ label: '평가 금액', value: '$9,000.00', tone: 'neutral' }],
    }),
  ], true)

  assert.equal(summary.badge, '관찰')
  assert.equal(summary.badgeTone, 'amber')
  assert.equal(summary.totalPnl, null)
  assert.equal(summary.totalPnlText, '-')
})

test('home summary는 환율이 있으면 혼합 KRW/USD 손익을 KRW로 정규화한다', async () => {
  const buildHomeV2Summary = await loadSummaryBuilder()
  const summary = buildHomeV2Summary([
    createHolding({ id: 1, name: '국내', pnl: '+100,000원', evaluationAmount: '1,100,000원', change: '+10.0%' }),
    createHolding({
      id: 2,
      name: '미국',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      pnl: '-$1,000.00',
      evaluationAmount: '$9,000.00',
      change: '-10.0%',
      metrics: [{ label: '평가 금액', value: '$9,000.00', tone: 'neutral' }],
    }),
  ], true, { usdKrwRate: 1400 })

  assert.equal(summary.badge, '손실')
  assert.equal(summary.badgeTone, 'red')
  assert.equal(summary.totalPnl, -1_300_000)
  assert.equal(summary.totalPnlText, '-1,300,000원')
  assert.equal(summary.totalEvaluationText, '13,700,000원')
})
