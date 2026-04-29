import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HOME_QUOTE_FETCH_TIMEOUT_MS,
  hydratePortfolioItemsWithCurrentQuotes,
  resolveUsdKrwRateAfterFailedQuoteResponse,
  shouldSkipHomeQuoteHydration,
} from './home-quote-bootstrap'
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

function createNonOkResponseWithJsonSpy(onJson: () => void) {
  const response = new Response(null, { status: 500 })
  Object.defineProperty(response, 'json', {
    value: async () => {
      onJson()
      throw new Error('non-OK responses should not be parsed')
    },
  })
  return response
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

test('hydratePortfolioItemsWithCurrentQuotes returns error but preserves stale quote fields when quote fetch fails', async () => {
  let quoteJsonCalls = 0
  const result = await hydratePortfolioItemsWithCurrentQuotes(
    [createPortfolioItem({ currentPrice: 85000, currentProfitRate: 6.3, currentPriceCurrency: 'KRW' })],
    async () => createNonOkResponseWithJsonSpy(() => {
      quoteJsonCalls += 1
    }),
  )

  assert.equal(result.quoteStatus, 'error')
  assert.match(result.quoteErrorMessage ?? '', /현재 시세/)
  assert.equal(quoteJsonCalls, 0)
  assert.equal(result.items[0]?.currentPrice, 85000)
  assert.equal(result.items[0]?.currentProfitRate, 6.3)
  assert.equal(result.items[0]?.currentPriceCurrency, 'KRW')
})

test('hydratePortfolioItemsWithCurrentQuotes does not parse non-OK FX responses and preserves stale US quote fields', async () => {
  let fxJsonCalls = 0
  const staleItem = createPortfolioItem({
    code: 'PYPL',
    ticker: 'PYPL',
    market: 'NASDAQ',
    marketTone: 'nasdaq',
    name: 'PayPal Holdings, Inc.',
    averagePrice: 79577.3278,
    averagePriceCurrency: 'KRW',
    currentPrice: 47.51,
    currentProfitRate: -11.8,
    currentPriceCurrency: 'USD',
  })

  const result = await hydratePortfolioItemsWithCurrentQuotes(
    [staleItem],
    async (input) => {
      const url = String(input)
      if (url === '/api/market/fx/usd-krw') {
        return createNonOkResponseWithJsonSpy(() => {
          fxJsonCalls += 1
        })
      }

      if (url.startsWith('/api/quotes/current?')) {
        return new Response(JSON.stringify({
          data: {
            items: [{ market: 'US', code: null, ticker: 'PYPL', price: 47.51, currency: 'USD', status: 'ok' }],
          },
        }))
      }

      throw new Error(`unexpected url: ${url}`)
    },
  )

  assert.equal(result.quoteStatus, 'error')
  assert.equal(fxJsonCalls, 0)
  assert.equal(result.items[0], staleItem)
})

test('resolveUsdKrwRateAfterFailedQuoteResponse preserves prior FX when quote and FX refresh both fail', () => {
  assert.equal(resolveUsdKrwRateAfterFailedQuoteResponse(1476.7, null, true), 1476.7)
  assert.equal(resolveUsdKrwRateAfterFailedQuoteResponse(1476.7, 1400, false), 1400)
})

test('home quote hydration only skips completed matching snapshots, not stale loading state', () => {
  assert.equal(HOME_QUOTE_FETCH_TIMEOUT_MS <= 2500, true)
  assert.equal(shouldSkipHomeQuoteHydration({
    refreshVersion: 0,
    quoteQueryKey: 'codes=005930',
    quoteQuery: 'codes=005930',
    quoteStatus: 'success',
  }), true)
  assert.equal(shouldSkipHomeQuoteHydration({
    refreshVersion: 0,
    quoteQueryKey: 'codes=005930',
    quoteQuery: 'codes=005930',
    quoteStatus: 'loading',
  }), false)
  assert.equal(shouldSkipHomeQuoteHydration({
    refreshVersion: 1,
    quoteQueryKey: 'codes=005930',
    quoteQuery: 'codes=005930',
    quoteStatus: 'success',
  }), false)
})

test('hydratePortfolioItemsWithCurrentQuotes times out slow quote fetches and keeps stale quote fields', async () => {
  const staleItem = createPortfolioItem({ currentPrice: 85000, currentProfitRate: 6.3, currentPriceCurrency: 'KRW' })

  const result = await hydratePortfolioItemsWithCurrentQuotes(
    [staleItem],
    async () => new Promise<Response>(() => {
      // Keep pending until the helper-level timeout aborts the request.
    }),
    { quoteTimeoutMs: 5 },
  )

  assert.equal(result.quoteStatus, 'error')
  assert.match(result.quoteErrorMessage ?? '', /지연/)
  assert.equal(result.items[0], staleItem)
})
