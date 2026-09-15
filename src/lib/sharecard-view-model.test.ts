import test from 'node:test'
import assert from 'node:assert/strict'

import type { HomeHolding } from '@/lib/holding-types'
import { buildSharePortfolioCard, buildShareStockCards } from './sharecard-view-model'

function makeHolding(overrides: Partial<HomeHolding> = {}): HomeHolding {
  return {
    id: 1,
    kind: 'stock',
    name: '삼성전자',
    shortName: '삼성전자',
    donutLabel: '삼성전자',
    shares: '10주',
    averagePrice: '70,000원',
    market: 'KOSPI',
    marketTone: 'kospi',
    badge: '손실 중',
    badgeTone: 'red',
    cardTone: 'warning',
    change: '-5.0%',
    pnl: '-12,000원',
    evaluationAmount: '688,000원',
    signalTone: 'warning',
    centerScore: '-5.0%',
    centerScoreColor: '#FAC775',
    centerBadge: '손실 중',
    centerBadgeTone: 'red',
    centerName: '삼성전자',
    donutColor: '#E24B4A',
    donutPercent: 0.5,
    heatmapWeight: '50%',
    heatmapBackground: '#BC7010',
    heatmapBadge: '손실 중',
    heatmapBadgeTone: 'red',
    opinionLabel: '간략 의견',
    opinionText: '테스트 픽스처',
    opinionBackground: '#f8f8f6',
    opinionBorder: 'transparent',
    opinionTextColor: '#555',
    metaLine: '평단 70,000원',
    metrics: [],
    actionLabel: '딥스캔 분석',
    actionHref: '/deepscan',
    ...overrides,
  }
}

test('buildShareStockCards 매핑 — 이름/수량/평단/손익/상태/도트를 그대로 전달한다', () => {
  const [card] = buildShareStockCards([
    makeHolding({
      name: 'SK하이닉스',
      shares: '40주',
      averagePrice: '146,500원',
      change: '+31.4%',
      pnl: '+1,832,000원',
      badge: '수익 중',
      donutColor: '#7E97BD',
    }),
  ])

  assert.equal(card.name, 'SK하이닉스')
  assert.equal(card.market, 'KOSPI')
  assert.equal(card.quantity, '40주')
  assert.equal(card.averagePrice, '146,500원')
  assert.equal(card.rate, '+31.4%')
  assert.equal(card.amount, '+1,832,000원')
  assert.equal(card.status, '수익 중')
  assert.equal(card.dot, '#7E97BD')
})

test('바람(모멘텀) 등급 — 수익률 구간에 따라 순풍/미풍/역풍/데이터 없음으로 나뉜다', () => {
  const cards = buildShareStockCards([
    makeHolding({ id: 1, name: 'A', change: '+31.4%' }),
    makeHolding({ id: 2, name: 'B', change: '-5.0%' }),
    makeHolding({ id: 3, name: 'C', change: '-23.4%' }),
    makeHolding({ id: 4, name: 'D', change: '-' }),
  ])

  assert.equal(cards[0]?.wind, '순풍')
  assert.equal(cards[1]?.wind, '미풍')
  assert.equal(cards[2]?.wind, '역풍')
  assert.equal(cards[3]?.wind, '미풍')
  assert.equal(cards[0]?.performanceTone, 'positive')
  assert.equal(cards[1]?.performanceTone, 'danger')
  assert.equal(cards[3]?.performanceTone, 'neutral')
})

test('포트폴리오 카드(원화 단일) — 손익 합산·전체 수익률·종목 수·날짜를 계산한다', () => {
  const card = buildSharePortfolioCard(
    [
      makeHolding({ id: 1, change: '-5.0%', pnl: '-12,000원', evaluationAmount: '688,000원' }),
      makeHolding({ id: 2, name: 'SK하이닉스', change: '+20.0%', pnl: '+25,000원', evaluationAmount: '150,000원' }),
    ],
    { now: new Date(2026, 8, 16) },
  )

  assert.equal(card.totalPnl, '+13,000원')
  assert.equal(card.totalSummary, '전체 수익률 +1.6% · 2개 종목')
  // 평균 수익률 (-5.0 + 20.0) / 2 = +7.5% → 순풍
  assert.equal(card.momentumLabel, '순풍')
  assert.equal(card.momentumDetail, '나아지는 중 ↑')
  assert.equal(card.date, '2026.09.16')
  assert.equal(card.brand, 'jaroo.kr')
})

test('포트폴리오 카드(원/달러 혼합) — 환율 없으면 총손익을 유지하고, 환율이 있으면 원화로 합산한다', () => {
  const mixedHoldings = [
    makeHolding({ id: 1, change: '+10.0%', pnl: '+10,000원', evaluationAmount: '110,000원' }),
    makeHolding({
      id: 2,
      name: 'VOO',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      shares: '10주',
      averagePrice: '$100.00',
      averagePriceCurrency: 'USD',
      change: '+2.0%',
      pnl: '+$20.00',
      evaluationAmount: '$1,020.00',
    }),
  ]

  const withoutFx = buildSharePortfolioCard(mixedHoldings, { now: new Date(2026, 8, 16) })
  assert.equal(withoutFx.totalPnl, '-')
  assert.equal(withoutFx.totalSummary, '2개 종목')

  const withFx = buildSharePortfolioCard(mixedHoldings, { usdKrwRate: 1300, now: new Date(2026, 8, 16) })
  assert.equal(withFx.totalPnl, '+36,000원')
  assert.equal(withFx.totalSummary, '전체 수익률 +2.6% · 2개 종목')
})

test('포트폴리오 카드 — 평가금액 텍스트가 없으면 수량×평단으로 대체한다', () => {
  const card = buildSharePortfolioCard(
    [makeHolding({ change: '-12.0%', pnl: '-24,000원', evaluationAmount: undefined })],
    { now: new Date(2026, 8, 16) },
  )

  // 평가금액 = 10주 × 70,000원 = 700,000원, 원금 = 700,000 - (-24,000) = 724,000원
  assert.equal(card.totalSummary, '전체 수익률 -3.3% · 1개 종목')
})

test('포트폴리오 카드 — 전체 손실 구간이면 역풍 라벨을 붙인다', () => {
  const card = buildSharePortfolioCard(
    [
      makeHolding({ id: 1, change: '-23.4%', pnl: '-170,180원', evaluationAmount: '560,000원' }),
      makeHolding({ id: 2, name: '코칩', change: '-14.3%', pnl: '-91,000원', evaluationAmount: '450,000원' }),
    ],
    { now: new Date(2026, 8, 16) },
  )

  assert.equal(card.momentumLabel, '역풍')
  assert.equal(card.momentumDetail, '경계 필요 ↓')
  assert.equal(card.totalPnl, '-261,180원')
})
