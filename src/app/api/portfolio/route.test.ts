import assert from 'node:assert/strict'
import test from 'node:test'

import { createAccountPortfolioGetResponse, createAccountPortfolioPutResponse } from './route'

type FakeSupabaseOptions = {
  userId?: string | null
  rows?: unknown[]
  selectError?: { message: string } | null
  rpcError?: { message: string } | null
}

function createFakeSupabase(options: FakeSupabaseOptions = {}) {
  const calls: { rpc?: { fn: string; args: Record<string, unknown> }; eq?: { column: string; value: string } } = {}
  const client = {
    calls,
    auth: {
      async getUser() {
        return {
          data: { user: options.userId === null ? null : { id: options.userId ?? 'user-123' } },
          error: null,
        }
      },
    },
    from(table: string) {
      assert.equal(table, 'portfolio_holdings')
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.eq = { column, value }
              return {
                async order() {
                  return {
                    data: options.rows ?? [],
                    error: options.selectError ?? null,
                  }
                },
              }
            },
          }
        },
      }
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc = { fn, args }
      return {
        data: 1,
        error: options.rpcError ?? null,
      }
    },
  }

  return client
}

test('portfolio GET requires an authenticated Supabase user', async () => {
  const response = await createAccountPortfolioGetResponse(createFakeSupabase({ userId: null }))
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.error.code, 'auth_required')
})

test('portfolio GET returns current user holdings as normalized portfolio items', async () => {
  const fakeSupabase = createFakeSupabase({
    userId: 'user-abc',
    rows: [{
      name: '삼성전자',
      code: '005930',
      market: 'KOSPI',
      market_tone: 'kospi',
      kind: 'stock',
      quantity: '10',
      average_price: '80000',
      average_price_currency: 'KRW',
    }],
  })
  const response = await createAccountPortfolioGetResponse(fakeSupabase)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(fakeSupabase.calls.eq, { column: 'user_id', value: 'user-abc' })
  assert.equal(body.items[0].name, '삼성전자')
  assert.equal(body.items[0].quantity, 10)
})

test('portfolio PUT validates payload and replaces current user holdings through RPC', async () => {
  const fakeSupabase = createFakeSupabase()
  const response = await createAccountPortfolioPutResponse(
    new Request('http://localhost/api/portfolio', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{
          name: 'Microsoft Corporation',
          ticker: 'MSFT',
          market: 'NASDAQ',
          marketTone: 'nasdaq',
          kind: 'stock',
          quantity: 3,
          averagePrice: 972.11,
          averagePriceCurrency: 'USD',
          currentPrice: 1150,
        }],
      }),
    }),
    fakeSupabase,
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.count, 1)
  assert.equal(fakeSupabase.calls.rpc?.fn, 'replace_portfolio_holdings')
  assert.deepEqual(fakeSupabase.calls.rpc?.args.p_items, [{
    name: 'Microsoft Corporation',
    code: undefined,
    ticker: 'MSFT',
    market: 'NASDAQ',
    market_tone: 'nasdaq',
    kind: 'stock',
    quantity: 3,
    average_price: 972.11,
    average_price_currency: 'USD',
    evaluation_amount: undefined,
    identifier_label: 'MSFT',
    sort_order: 0,
    source: 'ocr-merge',
  }])
})

test('portfolio PUT rejects malformed payloads', async () => {
  const response = await createAccountPortfolioPutResponse(
    new Request('http://localhost/api/portfolio', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: 'not-array' }),
    }),
    createFakeSupabase(),
  )
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.error.code, 'invalid_portfolio_payload')
})
