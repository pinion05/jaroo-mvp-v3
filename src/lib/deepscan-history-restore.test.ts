import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDeepScanTargetInputFromHistoryTargetInput } from './deepscan-history-restore'

test('KR 종목: 수량·평단 단위 문자열을 숫자로 복원하고 kospi 톤을 잡는다', () => {
  const target = buildDeepScanTargetInputFromHistoryTargetInput({
    instrument: { name: '삼성전자', code: '005930', market: 'KOSPI', kind: 'stock' },
    holding: { shares: '501', averagePrice: '96,852원', averagePriceCurrency: 'KRW' },
  })
  assert.ok(target)
  assert.equal(target.name, '삼성전자')
  assert.equal(target.code, '005930')
  assert.equal(target.market, 'KOSPI')
  assert.equal(target.marketTone, 'kospi')
  assert.equal(target.kind, 'stock')
  assert.equal(target.quantity, 501)
  assert.equal(target.averagePrice, 96852)
  assert.equal(target.averagePriceCurrency, 'KRW')
})

test('US 종목: market=US면 nasdaq 톤, 통화는 USD로 내려온다', () => {
  const target = buildDeepScanTargetInputFromHistoryTargetInput({
    instrument: { name: 'Apple', ticker: 'AAPL', market: 'US', kind: 'stock' },
    holding: { shares: '10 shares', averagePrice: '$150.20', averagePriceCurrency: 'USD', usdKrwRate: '1350' },
  })
  assert.ok(target)
  assert.equal(target.ticker, 'AAPL')
  assert.equal(target.marketTone, 'nasdaq')
  assert.equal(target.quantity, 10)
  assert.equal(target.averagePrice, 150.2)
  assert.equal(target.averagePriceCurrency, 'USD')
  assert.equal(target.usdKrwRate, 1350)
})

test('ETF: kind=etf면 etf 톤을 잡는다', () => {
  const target = buildDeepScanTargetInputFromHistoryTargetInput({
    instrument: { name: 'KODEX 200', code: '069500', market: 'KOSPI', kind: 'etf' },
    holding: { shares: '100', averagePrice: '82,770' },
  })
  assert.ok(target)
  assert.equal(target.marketTone, 'etf')
})

test('KOSDAQ: kosdaq 톤을 잡는다', () => {
  const target = buildDeepScanTargetInputFromHistoryTargetInput({
    instrument: { name: 'SFA반도체', code: '036540', market: 'KOSDAQ' },
    holding: { shares: '23', averagePrice: '11,200' },
  })
  assert.ok(target)
  assert.equal(target.marketTone, 'kosdaq')
})

test('부가 지표(현재가·평가액·수익률)는 있을 때만 내려온다', () => {
  const target = buildDeepScanTargetInputFromHistoryTargetInput({
    instrument: { name: 'LG디스플레이', code: '034220', market: 'KOSPI' },
    holding: {
      shares: '16',
      averagePrice: '17,000',
      currentPrice: '13,050',
      currentProfitRate: '-23.5',
      evaluationAmount: '208,800',
    },
  })
  assert.ok(target)
  assert.equal(target.currentPrice, 13050)
  assert.equal(target.currentProfitRate, -23.5)
  assert.equal(target.evaluationAmount, 208800)
  assert.equal('currentPriceCurrency' in target, false)
})

test('수량·평단이 없거나 0이하면 복원하지 않는다(null)', () => {
  assert.equal(buildDeepScanTargetInputFromHistoryTargetInput(null), null)
  assert.equal(buildDeepScanTargetInputFromHistoryTargetInput('x'), null)
  assert.equal(
    buildDeepScanTargetInputFromHistoryTargetInput({
      instrument: { name: '이름만' },
      holding: { shares: '501' },
    }),
    null,
  )
  assert.equal(
    buildDeepScanTargetInputFromHistoryTargetInput({
      instrument: { name: '0주' },
      holding: { shares: '0', averagePrice: '10,000' },
    }),
    null,
  )
})
