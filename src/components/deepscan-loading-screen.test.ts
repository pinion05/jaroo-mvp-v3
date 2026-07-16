import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeepScanReturnRateDisplay,
  calculateFallbackEvaluationAmount,
  calculateFallbackEvaluationMoney,
} from '@/lib/deepscan-loading-metrics'

test('DeepScan return display keeps live and broker snapshot rates separate', () => {
  assert.deepEqual(
    buildDeepScanReturnRateDisplay({ currentProfitRate: -27.3, snapshotProfitRate: -6.8 }),
    { current: '-27.3%', snapshot: '-6.8%' },
  )
  assert.deepEqual(
    buildDeepScanReturnRateDisplay({ currentProfitRate: 12.7 }),
    { current: '+12.7%', snapshot: null },
  )
})

test('calculateFallbackEvaluationAmount prefers live current price times shares over stale OCR evaluation amount', () => {
  assert.equal(
    calculateFallbackEvaluationAmount({
      evaluationAmount: '2,320,500원',
      currentPrice: 77540,
      shares: 35,
      averagePrice: 58828.75,
      currentProfitRate: 31.81,
    }),
    2713900,
  )
})

test('calculateFallbackEvaluationAmount falls back to OCR amount only when live price cannot be computed', () => {
  assert.equal(
    calculateFallbackEvaluationAmount({
      evaluationAmount: '2,320,500원',
      currentPrice: undefined,
      shares: undefined,
      averagePrice: 58828.75,
      currentProfitRate: 31.81,
    }),
    '2,320,500원',
  )
})

test('calculateFallbackEvaluationMoney keeps live current-price currency when it can compute valuation', () => {
  assert.deepEqual(
    calculateFallbackEvaluationMoney({
      evaluationAmount: '2,320,500원',
      currentPrice: 423.7,
      shares: 7.1,
      averagePrice: '514,619.21원',
      currentProfitRate: 23.8,
      currentPriceCurrency: 'USD',
      averagePriceCurrency: 'KRW',
    }),
    {
      amount: 3008.27,
      currency: 'USD',
      source: 'current-price',
    },
  )
})

test('calculateFallbackEvaluationMoney keeps KRW currency for KRW OCR fallback before live quote arrives', () => {
  assert.deepEqual(
    calculateFallbackEvaluationMoney({
      evaluationAmount: '2,320,500원',
      currentPrice: undefined,
      shares: undefined,
      averagePrice: '514,619.21원',
      currentProfitRate: 23.8,
      currentPriceCurrency: 'USD',
      averagePriceCurrency: 'KRW',
    }),
    {
      amount: '2,320,500원',
      currency: 'KRW',
      source: 'evaluation-amount',
    },
  )
})

test('calculateFallbackEvaluationMoney keeps average-price currency for average plus profit-rate fallback', () => {
  assert.deepEqual(
    calculateFallbackEvaluationMoney({
      currentPrice: undefined,
      shares: 7.1,
      averagePrice: '514,619.21원',
      currentProfitRate: 23.8,
      currentPriceCurrency: 'USD',
      averagePriceCurrency: 'KRW',
    }),
    {
      amount: 4523399.932058,
      currency: 'KRW',
      source: 'average-price-profit-rate',
    },
  )
})
