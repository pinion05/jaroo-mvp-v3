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
    evaluationAmount: '-',
    market: 'KOSPI',
    marketTone: 'kospi',
    identifierCode: '005930',
    badge: '인식 완료',
    badgeTone: 'amber',
    cardTone: 'warning',
    change: '-',
    pnl: '-',
    signalTone: 'warning',
    centerScore: '-',
    centerScoreColor: '#FAC775',
    centerBadge: '인식 완료',
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
    metaLine: '평단 80,000원',
    metrics: [
      { label: '보유 수량', value: '10주', tone: 'neutral' },
      { label: '수익률', value: '-', tone: 'neutral' },
      { label: '평가 금액', value: '-', tone: 'neutral' },
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
    createHolding({
      id: 2,
      name: 'Apple',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'AAPL',
      identifierCode: undefined,
      code: 'AAPL',
    }),
    createHolding({
      id: 3,
      name: 'Apple dup',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'AAPL',
      identifierCode: undefined,
      code: 'AAPL',
    }),
  ])

  assert.equal(query, 'codes=005930&tickers=AAPL')
})

test('home current quote hydrate는 KR live quote로 평가금액/손익/수익률/비중을 다시 계산한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [
      createHolding(),
      createHolding({
        id: 2,
        name: '현금성 자산',
        code: '999999',
        identifierCode: '999999',
        shares: '1주',
        averagePrice: '100,000원',
        metaLine: '평단 100,000원',
        metrics: [
          { label: '보유 수량', value: '1주', tone: 'neutral' },
          { label: '수익률', value: '-', tone: 'neutral' },
          { label: '평가 금액', value: '-', tone: 'neutral' },
        ],
      }),
    ],
    [{ market: 'KR', code: '005930', ticker: null, price: 85200, currency: 'KRW', asOf: '2026-04-14', source: 'krx', status: 'ok' }],
  )

  assert.equal(updated.evaluationAmount, '852,000원')
  assert.equal(updated.pnl, '+52,000원')
  assert.equal(updated.change, '+6.5%')
  assert.equal(updated.centerScore, '+6.5%')
  assert.equal(updated.heatmapChange, '+6.5%')
  assert.equal(updated.badge, '수익 중')
  assert.equal(updated.metrics.some((metric) => metric.label === '현재가' && metric.value === '85,200원'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '평가 금액' && metric.value === '852,000원'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '수익률' && metric.value === '+6.5%' && metric.tone === 'positive'), true)
  assert.equal(updated.metaLine, '평단 80,000원 · 평가금액 852,000원 · 현재가 85,200원')
  assert.equal(updated.heatmapWeight, '89%')
  assert.ok(updated.donutPercent > 0.89 && updated.donutPercent < 0.9)
})

test('home current quote hydrate는 US live quote로 평가금액/손익/수익률을 다시 계산한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      name: 'Microsoft Corporation',
      code: 'MSFT',
      shortName: 'Microsoft',
      donutLabel: 'MSFT',
      shares: '3주',
      averagePrice: '$100.00',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'MSFT',
      identifierCode: 'US5949181045',
      metaLine: '티커 MSFT · 종목코드 US5949181045 · 평단 $100.00',
      metrics: [
        { label: '보유 수량', value: '3주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'US', code: null, ticker: 'MSFT', price: 112.34, currency: 'USD', asOf: '2026-04-14T13:30:00Z', source: 'iex', status: 'ok' }],
  )

  assert.equal(updated.evaluationAmount, '$337.02')
  assert.equal(updated.pnl, '+$37.02')
  assert.equal(updated.change, '+12.3%')
  assert.equal(updated.centerScore, '+12.3%')
  assert.equal(updated.heatmapChange, '+12.3%')
  assert.equal(updated.badge, '수익 중')
  assert.equal(updated.metrics.some((metric) => metric.label === '현재가' && metric.value === '$112.34'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '평가 금액' && metric.value === '$337.02'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '수익률' && metric.value === '+12.3%' && metric.tone === 'positive'), true)
  assert.equal(updated.metaLine, '티커 MSFT · 종목코드 US5949181045 · 평단 $100.00 · 평가금액 $337.02 · 현재가 $112.34')
})

test('home current quote hydrate는 일치하는 quote가 없으면 원본을 유지한다', () => {
  const original = createHolding()
  const [updated] = applyCurrentQuotesToHomeHoldings([original], [])

  assert.deepEqual(updated, original)
})
