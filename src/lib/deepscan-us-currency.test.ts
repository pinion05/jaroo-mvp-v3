import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildDeepScanCanonicalQuery, type DeepScanCanonicalTargetSession } from './deepscan-canonical'
import { resolveCurrencyAwareAveragePrice } from './deepscan-runtime/build-payload'

test('DeepScan canonical query preserves US holding currency context', () => {
  const target: DeepScanCanonicalTargetSession = {
    holding: {
      name: 'Tesla, Inc.',
      ticker: 'TSLA',
      shares: '7.09569',
      averagePrice: '514619.2058',
      averagePriceCurrency: 'KRW',
      currentPrice: '423.7',
      currentPriceCurrency: 'USD',
      currentProfitRate: '23.8',
      evaluationAmount: '4520654',
      market: 'US',
      marketTone: 'nasdaq',
      usdKrwRate: '1539.7',
    },
  }

  const query = buildDeepScanCanonicalQuery(target)

  assert.equal(query.get('ticker'), 'TSLA')
  assert.equal(query.get('market'), 'US')
  assert.equal(query.get('averagePriceCurrency'), 'KRW')
  assert.equal(query.get('currentPrice'), '423.7')
  assert.equal(query.get('currentPriceCurrency'), 'USD')
  assert.equal(query.get('currentProfitRate'), '23.8')
  assert.equal(query.get('usdKrwRate'), '1539.7')
})

test('US DeepScan converts KRW average price before comparing with USD current price', () => {
  const result = resolveCurrencyAwareAveragePrice({
    averagePrice: '514619.2058',
    averagePriceCurrency: 'KRW',
    currentPrice: 423.7,
    currentPriceCurrency: 'USD',
    usdKrwRate: 1539.7,
  })

  assert.equal(result.converted, true)
  assert.equal(result.averagePriceCurrency, 'KRW')
  assert.equal(result.currentPriceCurrency, 'USD')
  assert.equal(result.blockedReason, null)
  assert.equal(Number(result.averagePriceInCurrentCurrency?.toFixed(2)), 334.23)

  const profitRate = ((423.7 - result.averagePriceInCurrentCurrency!) / result.averagePriceInCurrentCurrency!) * 100
  assert.equal(Number(profitRate.toFixed(1)), 26.8)
})

test('US DeepScan blocks cross-currency cost-basis math when USD/KRW is missing', () => {
  const result = resolveCurrencyAwareAveragePrice({
    averagePrice: '514619.2058',
    averagePriceCurrency: 'KRW',
    currentPrice: 423.7,
    currentPriceCurrency: 'USD',
  })

  assert.equal(result.requiresFx, true)
  assert.equal(result.averagePriceInCurrentCurrency, null)
  assert.equal(result.blockedReason, 'usd-krw-rate-missing')
})
