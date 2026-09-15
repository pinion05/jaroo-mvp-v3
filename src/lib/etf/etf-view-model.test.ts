import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildEtfViewModel, type EtfProfileJson } from './etf-view-model'

const profile: EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1',
  code: '069500',
  name: 'KODEX 200',
  market: 'kospi',
  ok: true,
  product: {
    issuerName: '삼성자산운용',
    baseIndexName: '코스피 200',
    totalFeePct: 0.15,
    firstSettleDate: '2002-10-11',
    aum: 24_400_000_000_000,
    nav: 104_100,
    deviationPct: 0.02,
  },
  returns: null,
  holdings: null,
  daily: null,
}

test('buildEtfViewModel maps quotes+holding+profile into hero and basicInfo with integer formatting', () => {
  const vm = buildEtfViewModel({
    profile,
    quote: { price: 104_275, changePct: 1.24, asOf: '2026-09-15T17:23:19+09:00' },
    holding: { shares: 100, averagePrice: 101_400 },
  })

  assert.equal(vm.header.name, 'KODEX 200')
  assert.equal(vm.header.code, '069500')
  assert.equal(vm.header.issuer, '삼성자산운용')
  assert.equal(vm.header.tracking, '코스피 200 추종')
  assert.equal(vm.hero.price, '104,275원')
  assert.equal(vm.hero.change, '+1.24%')
  assert.equal(vm.hero.averagePrice, '평단 101,400원')
  assert.equal(vm.hero.stats[0].label, '순자산')
  assert.equal(vm.hero.stats[0].value, '24.4조원')
  assert.equal(vm.hero.stats[1].value, '연 0.15%')
  assert.equal(vm.hero.stats[2].value, '2002.10')
  assert.equal(vm.hero.profitAmount, '+287,500원')

  const byLabel = new Map(vm.basicInfo.items.map((item) => [item.label, item.value]))
  assert.equal(byLabel.get('운용사'), '삼성자산운용')
  assert.equal(byLabel.get('기준지수'), '코스피 200')
  assert.equal(byLabel.get('NAV'), '104,100원')
  assert.equal(byLabel.get('NAV 괴리율'), '0.02%')
})

test('buildEtfViewModel without holding hides profit fields (guest)', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 104_275, changePct: 1.24 }, holding: null })
  assert.equal(vm.hero.averagePrice, null)
  assert.equal(vm.hero.profitAmount, null)
})

test('buildEtfViewModel loss formatting uses U+2212 and rounded integers', () => {
  const vm = buildEtfViewModel({
    profile,
    quote: { price: 99_000, changePct: -1.5 },
    holding: { shares: 10, averagePrice: 101_400 },
  })
  assert.equal(vm.hero.change, '−1.50%')
  assert.equal(vm.hero.profitAmount, '−24,000원')
  assert.equal(vm.momentum.badge, '↘')
})

test('buildEtfViewModel marks unavailable blocks with explicit reasons', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 104_275, changePct: 0 }, holding: null })
  assert.equal(vm.scenario.notice.reason, 'source-absent')
  assert.match(vm.scenario.notice.message, /애널리스트 목표가/)
  assert.equal(vm.returns.notice.reason, 'source-pending')
  assert.equal(vm.sectorWeights.notice.reason, 'source-pending')
  assert.equal(vm.topHoldings.notice.reason, 'source-pending')
  assert.equal(vm.riskMetrics.notice.reason, 'source-pending')
  assert.equal(vm.peers.notice.reason, 'planned')
  assert.equal(vm.dividendInfo.notice.reason, 'planned')
})

test('buildEtfViewModel omits missing product fields instead of rendering empty rows', () => {
  const sparse: EtfProfileJson = {
    ...profile,
    product: {
      issuerName: null,
      baseIndexName: null,
      totalFeePct: null,
      firstSettleDate: null,
      aum: null,
      nav: null,
      deviationPct: null,
    },
  }
  const vm = buildEtfViewModel({ profile: sparse, quote: { price: 1_000, changePct: 0 }, holding: null })
  assert.deepEqual(vm.hero.stats, [])
  assert.deepEqual(vm.basicInfo.items, [])
  assert.equal(vm.header.tracking, '')
})
