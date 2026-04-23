import test from 'node:test'
import assert from 'node:assert/strict'

import { hydratePortfolioItemsWithCurrentQuotes } from './home-quote-bootstrap'
import type { PortfolioNormalizedItem } from './workflow-types'

function createPortfolioItem(overrides: Partial<PortfolioNormalizedItem> = {}): PortfolioNormalizedItem {
  return {
    code: '005930',
    ticker: '005930.KS',
    market: 'KOSPI',
    marketTone: 'kospi',
    kind: 'stock',
    name: '삼성전자',
    quantity: 10,
    averagePrice: 80000,
    averagePriceCurrency: 'KRW',
    ...overrides,
  }
}

test('hydratePortfolioItemsWithCurrentQuotes patches quote fields for successful KR quote responses', async () => {
  const result = await hydratePortfolioItemsWithCurrentQuotes(
    [createPortfolioItem()],
    async (input) => {
      const url = String(input)
      if (url.startsWith('/api/quotes/current?')) {
        return new Response(JSON.stringify({
          data: {
            items: [{ market: 'KR', code: '005930', price: 85000, currency: 'KRW', status: 'ok' }],
          },
        }))
      }

      throw new Error(`unexpected url: ${url}`)
    },
  )

  assert.equal(result.quoteStatus, 'success')
  assert.equal(result.quoteQuery, 'codes=005930')
  assert.equal(result.items[0]?.currentPrice, 85000)
  assert.equal(result.items[0]?.currentPriceCurrency, 'KRW')
  assert.equal(result.items[0]?.currentProfitRate, 6.3)
})

test('hydratePortfolioItemsWithCurrentQuotes returns error and clears quote fields when quote fetch fails', async () => {
  const result = await hydratePortfolioItemsWithCurrentQuotes(
    [createPortfolioItem({ currentPrice: 85000, currentProfitRate: 6.3, currentPriceCurrency: 'KRW' })],
    async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 }),
  )

  assert.equal(result.quoteStatus, 'error')
  assert.match(result.quoteErrorMessage ?? '', /현재 시세/)
  assert.equal(result.items[0]?.currentPrice, undefined)
  assert.equal(result.items[0]?.currentProfitRate, undefined)
  assert.equal(result.items[0]?.currentPriceCurrency, undefined)
})
