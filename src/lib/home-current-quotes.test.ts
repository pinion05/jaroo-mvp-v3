import test from 'node:test'
import assert from 'node:assert/strict'

import type { HomeHolding } from '@/lib/jaroo-home-data'
import { applyCurrentQuotesToHomeHoldings, buildHomeCurrentQuoteQuery } from './home-current-quotes'

function createHolding(overrides: Partial<HomeHolding> = {}): HomeHolding {
  return {
    id: 1,
    kind: 'stock',
    name: '삼성전자',
    code: '005930',
    shortName: '삼성전자',
    donutLabel: '삼성전자',
    shares: '10주',
    averagePrice: '80,000원',
    evaluationAmount: '800,000원',
    market: 'KOSPI',
    marketTone: 'kospi',
    identifierCode: '005930',
    badge: '관찰 중',
    badgeTone: 'amber',
    cardTone: 'warning',
    change: '-3.0%',
    pnl: '-24,000원',
    signalTone: 'warning',
    centerScore: '-3.0%',
    centerScoreColor: '#FAC775',
    centerBadge: '관찰 중',
    centerBadgeTone: 'amber',
    centerName: '삼성전자',
    donutColor: '#185FA5',
    donutPercent: 1,
    heatmapWeight: '100%',
    heatmapBackground: '#185FA5',
    opinionLabel: 'AI 간략 의견',
    opinionText: '기존 의견',
    opinionBackground: '#f8f8f6',
    opinionBorder: 'transparent',
    opinionTextColor: '#555',
    metaLine: '평단 80,000원 · 평가금액 800,000원',
    metrics: [
      { label: '보유 수량', value: '10주', tone: 'neutral' },
      { label: '수익률', value: '-3.0%', tone: 'warning' },
      { label: '평가 금액', value: '800,000원', tone: 'neutral' },
    ],
    actionLabel: '딥스캔',
    actionSubLabel: 'AI 9인 위원회 분석',
    actionCredits: '300cr',
    actionHref: '/deepscan',
    ...overrides,
  }
}

test('home current quote query는 KR code와 US ticker를 분리해 dedupe한다', () => {
  const query = buildHomeCurrentQuoteQuery([
    createHolding({ identifierCode: '005930' }),
    createHolding({ id: 2, name: 'Apple', market: 'NASDAQ', marketTone: 'nasdaq', identifierTicker: 'AAPL', identifierCode: undefined, code: 'AAPL' }),
    createHolding({ id: 3, name: 'Apple dup', market: 'NASDAQ', marketTone: 'nasdaq', identifierTicker: 'AAPL', identifierCode: undefined, code: 'AAPL' }),
  ])

  assert.equal(query, 'codes=005930&tickers=AAPL')
})

test('home current quote hydrate는 현재가 metric과 metaLine을 추가한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding()],
    [{ market: 'KR', code: '005930', ticker: null, price: 85200, currency: 'KRW', asOf: '2026-04-14', source: 'krx', status: 'ok' }],
  )

  assert.equal(updated.metrics.some((metric) => metric.label === '현재가' && metric.value === '85,200원'), true)
  assert.equal(updated.metaLine.includes('현재가 85,200원'), true)
})

test('home current quote hydrate는 일치하는 quote가 없으면 원본을 유지한다', () => {
  const original = createHolding()
  const [updated] = applyCurrentQuotesToHomeHoldings([original], [])

  assert.deepEqual(updated, original)
})
