import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountHoldingRowToPortfolioItem,
  buildAccountPortfolioHoldingInputs,
  sanitizeAccountPortfolioItems,
} from './account-portfolio'
import type { PortfolioNormalizedItem } from './workflow-types'

const sampleItem: PortfolioNormalizedItem = {
  name: 'Microsoft Corporation',
  ticker: 'MSFT',
  code: 'US5949181045',
  market: 'NASDAQ',
  marketTone: 'nasdaq',
  kind: 'stock',
  quantity: 3,
  averagePrice: 972.11,
  averagePriceCurrency: 'USD',
  evaluationAmount: 3450,
  currentPrice: 1150,
  currentPriceCurrency: 'USD',
  currentProfitRate: 18.3,
  identifierLabel: 'MSFT · US5949181045',
}

test('account portfolio inputs persist stable holding fields and omit live quote fields', () => {
  const [input] = buildAccountPortfolioHoldingInputs([sampleItem])

  assert.deepEqual(input, {
    name: 'Microsoft Corporation',
    ticker: 'MSFT',
    code: 'US5949181045',
    market: 'NASDAQ',
    market_tone: 'nasdaq',
    kind: 'stock',
    quantity: 3,
    average_price: 972.11,
    average_price_currency: 'USD',
    evaluation_amount: 3450,
    identifier_label: 'MSFT · US5949181045',
    sort_order: 0,
    source: 'ocr-merge',
  })
  assert.equal('currentPrice' in (input as Record<string, unknown>), false)
})

test('account portfolio row maps back to PortfolioNormalizedItem with numeric strings', () => {
  const restored = accountHoldingRowToPortfolioItem({
    name: '삼성전자',
    code: '005930',
    market: 'KOSPI',
    market_tone: 'kospi',
    kind: 'stock',
    quantity: '10',
    average_price: '80000',
    average_price_currency: 'KRW',
    evaluation_amount: '766000',
  })

  assert.deepEqual(restored, {
    name: '삼성전자',
    code: '005930',
    ticker: undefined,
    market: 'KOSPI',
    marketTone: 'kospi',
    kind: 'stock',
    quantity: 10,
    averagePrice: 80000,
    averagePriceCurrency: 'KRW',
    evaluationAmount: 766000,
    identifierLabel: '005930',
  })
})

test('account portfolio sanitizer rejects unusable rows', () => {
  assert.deepEqual(sanitizeAccountPortfolioItems([
    { name: '', quantity: 1, averagePrice: 1000 },
    { name: 'bad quantity', quantity: 0, averagePrice: 1000 },
    { name: 'bad average', quantity: 1, averagePrice: -1 },
    sampleItem,
  ]), [{
    name: 'Microsoft Corporation',
    ticker: 'MSFT',
    code: 'US5949181045',
    market: 'NASDAQ',
    marketTone: 'nasdaq',
    kind: 'stock',
    quantity: 3,
    averagePrice: 972.11,
    averagePriceCurrency: 'USD',
    evaluationAmount: 3450,
    identifierLabel: 'MSFT · US5949181045',
  }])
})
