import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildEtfViewModel, type EtfProfileJson } from './etf-view-model'
import { computeEtfMetrics } from './etf-metrics'

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
  assert.equal(byLabel.get('NAV 괴리율'), '+0.02%')
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
  // 일봉 지표 없음(260행 미만) → 시나리오·수익률·리스크는 소스 준비 중 사유
  assert.equal(vm.scenario.notice?.reason, 'source-pending')
  assert.match(vm.scenario.notice?.message ?? '', /52주 위치/)
  assert.equal(vm.returns.notice?.reason, 'source-pending')
  assert.equal(vm.riskMetrics.notice?.reason, 'source-pending')
  assert.equal(vm.sectorWeights.notice.reason, 'source-pending')
  assert.equal(vm.topHoldings.notice?.reason, 'source-pending')
  assert.equal(vm.peers.notice.reason, 'planned')
  assert.equal(vm.dividendInfo.notice.reason, 'planned')
})

test('buildEtfViewModel fills returns·risk·scenario from metrics and holdings from profile', () => {
  const metrics = computeEtfMetrics(
    Array.from({ length: 260 }, (_, index) => ({
      date: `2025-${String((index % 12) + 1).padStart(2, '0')}-15`,
      close: index < 200 ? 100 + index : 300 - index / 2,
    })),
  )
  assert.ok(metrics, 'fixture must satisfy the 260-row minimum')

  const vm = buildEtfViewModel({
    profile: {
      ...profile,
      holdings: [
        { rank: 1, code: '005930', name: '삼성전자', weightPct: 32.63, changePct: null },
        { rank: 2, code: '000660', name: 'SK하이닉스', weightPct: 27.07, changePct: null },
      ],
    },
    quote: { price: 150_000, changePct: 0 },
    holding: null,
    metrics,
  })

  // 기간별 수익률 — 실 items
  assert.equal(vm.returns.notice, null)
  assert.deepEqual(
    vm.returns.items?.map((item) => item.label),
    ['1개월', '3개월', '6개월', '1년'],
  )

  // 리스크 — 4칸 팩트
  assert.equal(vm.riskMetrics.notice, null)
  assert.equal(vm.riskMetrics.items?.length, 4)
  assert.ok(vm.riskMetrics.items?.some((item) => item.label === '샤프지수'))

  // 시나리오 — 52주 위치 + 애널리스트 목표가 부재 사유(D7)
  assert.equal(vm.scenario.notice, null)
  assert.ok(vm.scenario.scenario)
  assert.match(vm.scenario.scenario.positionText, /^\d+%/)
  assert.match(vm.scenario.scenario.note, /애널리스트 목표가/)

  // 구성 종목 — 상위 10개 + 비중 바
  assert.equal(vm.topHoldings.notice, null)
  assert.equal(vm.topHoldings.items?.length, 2)
  assert.equal(vm.topHoldings.items?.[0].weightText, '32.63%')
  assert.equal(vm.topHoldings.items?.[0].weightBarPct, 100)
  assert.match(vm.topHoldings.summary ?? '', /네이버/)
})

test('buildEtfViewModel without changePct hides change badge and keeps momentum neutral', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 104_275, changePct: null }, holding: null })
  assert.equal(vm.hero.change, null)
  assert.equal(vm.momentum.badge, '·')
  assert.match(vm.momentum.label, /등락/)
})

test('buildEtfViewModel formats NAV deviation with U+2212 for discount', () => {
  const vm = buildEtfViewModel({
    profile: { ...profile, product: { ...profile.product, deviationPct: -0.24 } },
    quote: { price: 104_275, changePct: 0 },
    holding: null,
  })
  const byLabel = new Map(vm.basicInfo.items.map((item) => [item.label, item.value]))
  assert.equal(byLabel.get('NAV 괴리율'), '−0.24%')
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

// ── 미국 ETF 달러 표기 (2026-09-16) ──────────────────────────────

test('buildEtfViewModel formats US ETF money as dollars (price·평단·손익·AUM·NAV)', () => {
  const usProfile: EtfProfileJson = {
    schemaVersion: 'jaroo-etf-profile-v1',
    code: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    market: 'us',
    ok: true,
    currency: 'USD',
    quote: { changePct: -0.46 },
    product: {
      issuerName: 'Vanguard',
      baseIndexName: null,
      totalFeePct: 0.03,
      firstSettleDate: null,
      aum: 1_756_880_437_248,
      nav: 702.62,
      deviationPct: null,
    },
    returns: null,
    holdings: [{ rank: 1, code: 'NVDA', name: 'NVIDIA Corp', weightPct: 7.55, changePct: null }],
    daily: null,
  }

  const vm = buildEtfViewModel({
    profile: usProfile,
    quote: { price: 699.3, changePct: -0.46 },
    holding: { shares: 10, averagePrice: 480 },
    metrics: null,
  })

  assert.equal(vm.hero.price, '$699.3')
  assert.equal(vm.hero.averagePrice, '평단 $480')
  // (699.3 − 480) × 10주 = +$2,193
  assert.equal(vm.hero.profitAmount, '+$2,193')
  assert.ok(vm.hero.stats.some((stat) => stat.label === '순자산' && stat.value === '1.76조 달러'))
  assert.ok(vm.basicInfo.items.some((item) => item.label === 'NAV' && item.value === '$702.62'))
})
