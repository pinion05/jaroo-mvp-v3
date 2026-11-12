import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveDeepScanDisplayCurrencies,
  resolveCurrencyAwareAveragePrice,
} from './deepscan-average-price-currency'

/**
 * 2026-11-12 블랙박스 테스트 T4L-B2 회귀 — US 종목 평단가 통화 오인.
 *
 * 실제 프로덕션 재현값: AAPL 10주 · 평단 228(통화 미표기 · DB null) · 현재가
 * $355.63 · usdKrwRate 1333.18. 과거 로딩 화면은 prop 기본값 'KRW'로 물려
 * "원화 평단 228원을 $0.17로 환산" → "+207,846.84%"를 노출했다.
 */

test('US 종목 평단 통화 미상 → 서버 추론과 동일하게 USD로 표시한다 (AAPL 실측값)', () => {
  const resolved = resolveDeepScanDisplayCurrencies({
    market: 'US',
    averagePrice: 228,
    averagePriceCurrency: null,
    currentPrice: 355.63,
    currentPriceCurrency: 'USD',
    usdKrwRate: 1333.18,
  })

  assert.equal(resolved.averagePriceCurrency, 'USD')
  assert.equal(resolved.currentPriceCurrency, 'USD')

  const costBasis = resolveCurrencyAwareAveragePrice({
    averagePrice: '228',
    averagePriceCurrency: null,
    currentPrice: 355.63,
    currentPriceCurrency: 'USD',
    usdKrwRate: 1333.18,
  })
  assert.equal(costBasis.averagePriceCurrency, 'USD')
  assert.equal(costBasis.converted, false)
  assert.equal(costBasis.averagePriceInCurrentCurrency, 228)
})

test('원화평단-미국주(명시 KRW)는 추론을 이기지 않는다 — 환산은 정상 방향으로만', () => {
  const resolved = resolveDeepScanDisplayCurrencies({
    market: 'US',
    averagePrice: 514619.2058,
    averagePriceCurrency: 'KRW',
    currentPrice: 423.7,
    currentPriceCurrency: 'USD',
    usdKrwRate: 1539.7,
  })

  assert.equal(resolved.averagePriceCurrency, 'KRW')
  assert.equal(resolved.currentPriceCurrency, 'USD')

  const costBasis = resolveCurrencyAwareAveragePrice({
    averagePrice: '514619.2058',
    averagePriceCurrency: 'KRW',
    currentPrice: 423.7,
    currentPriceCurrency: 'USD',
    usdKrwRate: 1539.7,
  })
  assert.equal(costBasis.converted, true)
  assert.equal(Number(costBasis.averagePriceInCurrentCurrency?.toFixed(2)), 334.23)
})

test('한국 종목은 통화 미상이어도 KRW 기본값을 유지한다', () => {
  const resolved = resolveDeepScanDisplayCurrencies({
    market: 'KOSPI',
    averagePrice: 38634,
    averagePriceCurrency: null,
    currentPrice: 23500,
    currentPriceCurrency: 'KRW',
    usdKrwRate: 1333.18,
  })

  assert.equal(resolved.averagePriceCurrency, 'KRW')
  assert.equal(resolved.currentPriceCurrency, 'KRW')
})

test('현재가 통화까지 없으면 시장으로 기본 통화를 정한다 (US→USD, 그 외→KRW)', () => {
  assert.equal(
    resolveDeepScanDisplayCurrencies({ market: 'US', averagePrice: 228 }).currentPriceCurrency,
    'USD',
  )
  assert.equal(
    resolveDeepScanDisplayCurrencies({ market: 'KOSDAQ', averagePrice: 66519 }).currentPriceCurrency,
    'KRW',
  )
})

test('US 종목 평단 문자열("228.00")도 숫자로 정규화해 추론한다', () => {
  const resolved = resolveDeepScanDisplayCurrencies({
    market: 'US',
    averagePrice: '228.00',
    currentPrice: '355.63',
    currentPriceCurrency: 'USD',
    usdKrwRate: 1333.18,
  })

  assert.equal(resolved.averagePriceCurrency, 'USD')
})
