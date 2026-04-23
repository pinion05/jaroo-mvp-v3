import test from 'node:test'
import assert from 'node:assert/strict'

import type { HomeHolding } from '@/lib/jaroo-home-data'
import {
  applyCurrentQuotesToHomeHoldings,
  buildHomeCurrentQuoteQuery,
  buildQuoteLookupKey,
  requiresFxConversion,
  shouldTreatQuoteFailureAsErrorCard,
} from './home-current-quotes'

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

test('KR holding이 보조 ticker를 가져도 quote lookup/query는 code를 우선한다', () => {
  const krHolding = createHolding({
    identifierCode: '005930',
    identifierTicker: '005930.KS',
    code: '005930',
  })

  assert.equal(buildQuoteLookupKey(krHolding), '005930')
  assert.equal(buildHomeCurrentQuoteQuery([krHolding]), 'codes=005930')
})

test('FX는 USD quote에 KRW cost basis가 필요한 경우에만 요구한다', () => {
  assert.equal(requiresFxConversion('USD', 'KRW'), true)
  assert.equal(requiresFxConversion('USD', 'USD'), false)
  assert.equal(requiresFxConversion('KRW', 'KRW'), false)
  assert.equal(requiresFxConversion('KRW', null), false)
})

test('quote-unavailable는 ETF/ETN holding에서 오류 카드로 승격하지 않는다', () => {
  assert.equal(shouldTreatQuoteFailureAsErrorCard(createHolding({ kind: 'stock' }), 'quote-unavailable'), true)
  assert.equal(shouldTreatQuoteFailureAsErrorCard(createHolding({ kind: 'etf' }), 'quote-unavailable'), false)
  assert.equal(shouldTreatQuoteFailureAsErrorCard(createHolding({ kind: 'etf' }), 'fx-required'), true)
})

test('home current quote hydrate는 ETN holding의 live 수익률에 맞춰 badge를 갱신한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      kind: 'etf',
      name: '삼성 인버스 코스피 200 선물 ETN',
      code: '530092',
      shortName: '삼성인버스',
      donutLabel: '삼성인버스ETN',
      shares: '10주',
      averagePrice: '3,000원',
      market: 'ETN',
      marketTone: 'etf',
      identifierCode: '530092',
      badge: '인식 완료',
      badgeTone: 'amber',
      cardTone: 'warning',
      signalTone: 'etf',
      centerBadge: '인식 완료',
      centerBadgeTone: 'amber',
      centerScore: '-',
      heatmapBackground: '#1E4D8C',
      heatmapBadge: '인식 완료',
      heatmapBadgeTone: 'amber',
      metrics: [
        { label: '보유 수량', value: '10주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'KR', code: '530092', ticker: null, price: 3475, currency: 'KRW', asOf: '2026-04-23', source: 'wisereport-etn', status: 'ok' }],
  )

  assert.equal(updated.change, '+15.8%')
  assert.equal(updated.badge, '수익 중')
  assert.equal(updated.badgeTone, 'green')
  assert.equal(updated.cardTone, 'profit')
  assert.equal(updated.centerBadge, '수익 중')
})

test('home current quote hydrate는 ETF holding의 badge는 placeholder 상태를 유지한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      kind: 'etf',
      name: 'TIGER 200',
      code: '102110',
      shortName: 'TIGER200',
      donutLabel: 'TIGER200',
      shares: '10주',
      averagePrice: '40,000원',
      market: 'ETF',
      marketTone: 'etf',
      identifierCode: '102110',
      badge: '인식 완료',
      badgeTone: 'amber',
      cardTone: 'warning',
      signalTone: 'etf',
      centerBadge: '인식 완료',
      centerBadgeTone: 'amber',
      centerScore: '-',
      heatmapBackground: '#1E4D8C',
      heatmapBadge: '인식 완료',
      heatmapBadgeTone: 'amber',
      metrics: [
        { label: '보유 수량', value: '10주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'KR', code: '102110', ticker: null, price: 43000, currency: 'KRW', asOf: '2026-04-23', source: 'wisereport-etf', status: 'ok' }],
  )

  assert.equal(updated.change, '+7.5%')
  assert.equal(updated.badge, '인식 완료')
  assert.equal(updated.cardTone, 'warning')
  assert.equal(updated.centerBadge, '인식 완료')
})

test('home current quote hydrate는 KR live quote로 평가금액/손익/수익률/비중을 다시 계산한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [
      createHolding({ evaluationAmount: '999,999원' }),
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

test('home current quote hydrate는 KR holding의 보조 ticker가 있어도 KR code quote로 갱신한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [
      createHolding({
        identifierCode: '005930',
        identifierTicker: '005930.KS',
        code: '005930',
      }),
    ],
    [{ market: 'KR', code: '005930', ticker: null, price: 85200, currency: 'KRW', asOf: '2026-04-14', source: 'krx', status: 'ok' }],
  )

  assert.equal(updated.evaluationAmount, '852,000원')
  assert.equal(updated.change, '+6.5%')
  assert.equal(updated.metrics.some((metric) => metric.label === '현재가' && metric.value === '85,200원'), true)
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

test('home current quote hydrate는 KRW 평단인 미국 종목을 FX로 USD 기준 손익률로 변환한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      name: 'PayPal Holdings, Inc.',
      code: 'PYPL',
      shortName: 'PayPal',
      donutLabel: 'PYPL',
      shares: '46.934557주',
      averagePrice: '79,577.3278원',
      averagePriceCurrency: 'KRW',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'PYPL',
      identifierCode: 'US70450Y1038',
      metaLine: '티커 PYPL · 종목코드 US70450Y1038 · 평단 79,577.3278원',
      metrics: [
        { label: '보유 수량', value: '46.934557주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'US', code: null, ticker: 'PYPL', price: 47.51, currency: 'USD', asOf: '2026-04-14T13:30:00Z', source: 'iex', status: 'ok' }],
    { usdKrwRate: 1476.7 },
  )

  assert.equal(updated.evaluationAmount, '$2,229.86')
  assert.equal(updated.pnl, '-$299.38')
  assert.equal(updated.change, '-11.8%')
  assert.equal(updated.centerScore, '-11.8%')
  assert.equal(updated.heatmapChange, '-11.8%')
  assert.equal(updated.badge, '관찰 중')
  assert.equal(updated.metrics.some((metric) => metric.label === '현재가' && metric.value === '$47.51'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '평가 금액' && metric.value === '$2,229.86'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '수익률' && metric.value === '-11.8%' && metric.tone === 'warning'), true)
  assert.equal(updated.metaLine, '티커 PYPL · 종목코드 US70450Y1038 · 평단 79,577.3278원 · 평가금액 $2,229.86 · 현재가 $47.51')
})

test('home current quote hydrate는 FX가 없으면 KRW 평단 미국 종목의 손익률을 placeholder로 유지한다', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      name: 'PayPal Holdings, Inc.',
      code: 'PYPL',
      shortName: 'PayPal',
      donutLabel: 'PYPL',
      shares: '46.934557주',
      averagePrice: '79,577.3278원',
      averagePriceCurrency: 'KRW',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'PYPL',
      identifierCode: 'US70450Y1038',
      badge: '인식 완료',
      badgeTone: 'amber',
      cardTone: 'warning',
      centerBadge: '인식 완료',
      centerBadgeTone: 'amber',
      signalTone: 'warning',
      metaLine: '티커 PYPL · 종목코드 US70450Y1038 · 평단 79,577.3278원',
      metrics: [
        { label: '보유 수량', value: '46.934557주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'US', code: null, ticker: 'PYPL', price: 47.51, currency: 'USD', asOf: '2026-04-14T13:30:00Z', source: 'iex', status: 'ok' }],
  )

  assert.equal(updated.evaluationAmount, '$2,229.86')
  assert.equal(updated.pnl, '-')
  assert.equal(updated.change, '-')
  assert.equal(updated.centerScore, '-')
  assert.equal(updated.heatmapChange, '-')
  assert.equal(updated.badge, '인식 완료')
  assert.equal(updated.metrics.some((metric) => metric.label === '현재가' && metric.value === '$47.51'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '평가 금액' && metric.value === '$2,229.86'), true)
  assert.equal(updated.metrics.some((metric) => metric.label === '수익률' && metric.value === '-' && metric.tone === 'neutral'), true)
})


test('home current quote hydrate infers KRW cost basis for US holdings when uncoded average price matches FX-adjusted quote range', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      name: 'Tesla, Inc.',
      code: 'TSLA',
      shortName: 'Tesla',
      donutLabel: 'TSLA',
      shares: '5주',
      averagePrice: '484,779.9799',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'TSLA',
      identifierCode: 'US88160R1014',
      metaLine: '티커 TSLA · 종목코드 US88160R1014 · 평단 484,779.9799',
      metrics: [
        { label: '보유 수량', value: '5주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'US', code: null, ticker: 'TSLA', price: 388.9, currency: 'USD', asOf: '2026-04-17T13:30:00Z', source: 'polygon', status: 'ok' }],
    { usdKrwRate: 1400 },
  )

  assert.equal(updated.evaluationAmount, '$1,944.50')
  assert.equal(updated.change, '+12.3%')
  assert.equal(updated.pnl, '+$213.14')
  assert.equal(updated.metrics.some((metric) => metric.label === '수익률' && metric.value === '+12.3%' && metric.tone === 'positive'), true)
})

test('home current quote hydrate infers FX-required for US holdings when uncoded average price appears KRW-like but FX is unavailable', () => {
  const [updated] = applyCurrentQuotesToHomeHoldings(
    [createHolding({
      name: 'Tesla, Inc.',
      code: 'TSLA',
      shortName: 'Tesla',
      donutLabel: 'TSLA',
      shares: '5주',
      averagePrice: '484,779.9799',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      identifierTicker: 'TSLA',
      identifierCode: 'US88160R1014',
      metaLine: '티커 TSLA · 종목코드 US88160R1014 · 평단 484,779.9799',
      metrics: [
        { label: '보유 수량', value: '5주', tone: 'neutral' },
        { label: '수익률', value: '-', tone: 'neutral' },
        { label: '평가 금액', value: '-', tone: 'neutral' },
      ],
    })],
    [{ market: 'US', code: null, ticker: 'TSLA', price: 388.9, currency: 'USD', asOf: '2026-04-17T13:30:00Z', source: 'polygon', status: 'ok' }],
  )

  assert.equal(updated.evaluationAmount, '$1,944.50')
  assert.equal(updated.change, '-')
  assert.equal(updated.pnl, '-')
})

test('home current quote hydrate는 혼합 KR/USD 포트폴리오 비중을 KRW 기준으로 정규화한다', () => {
  const [krHolding, usHolding] = applyCurrentQuotesToHomeHoldings(
    [
      createHolding({
        id: 1,
        name: '삼성전자',
        code: '005930',
        identifierCode: '005930',
        shares: '10주',
        averagePrice: '80,000원',
        market: 'KOSPI',
        marketTone: 'kospi',
        metaLine: '평단 80,000원',
      }),
      createHolding({
        id: 2,
        name: 'Microsoft Corporation',
        code: 'MSFT',
        shortName: 'Microsoft',
        donutLabel: 'MSFT',
        shares: '3주',
        averagePrice: '$100.00',
        averagePriceCurrency: 'USD',
        market: 'NASDAQ',
        marketTone: 'nasdaq',
        identifierTicker: 'MSFT',
        identifierCode: 'US5949181045',
        metaLine: '티커 MSFT · 종목코드 US5949181045 · 평단 $100.00',
      }),
    ],
    [
      { market: 'KR', code: '005930', ticker: null, price: 85200, currency: 'KRW', asOf: '2026-04-14', source: 'krx', status: 'ok' },
      { market: 'US', code: null, ticker: 'MSFT', price: 112.34, currency: 'USD', asOf: '2026-04-14T13:30:00Z', source: 'iex', status: 'ok' },
    ],
    { usdKrwRate: 1476.7 },
  )

  assert.equal(krHolding.heatmapWeight, '63%')
  assert.ok(krHolding.donutPercent > 0.63 && krHolding.donutPercent < 0.64)
  assert.equal(usHolding.heatmapWeight, '37%')
  assert.ok(usHolding.donutPercent > 0.36 && usHolding.donutPercent < 0.38)
})

test('home current quote hydrate는 일치하는 quote가 없으면 원본을 유지한다', () => {
  const original = createHolding()
  const [updated] = applyCurrentQuotesToHomeHoldings([original], [])

  assert.deepEqual(updated, original)
})
