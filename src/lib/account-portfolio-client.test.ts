import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchAccountPortfolioItems, saveAccountPortfolioItems } from './account-portfolio-client'

test('fetchAccountPortfolioItems returns saved items for an authenticated response', async () => {
  const fetcher = (async () => new Response(JSON.stringify({
    ok: true,
    items: [{ name: '삼성전자', quantity: 10, averagePrice: 80000 }],
  }), { status: 200 })) as typeof fetch

  const items = await fetchAccountPortfolioItems(fetcher)

  assert.equal(items.length, 1)
  assert.equal(items[0]?.name, '삼성전자')
})

test('fetchAccountPortfolioItems treats unauthenticated or failed responses as empty restore', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ ok: false }), { status: 401 })) as typeof fetch

  assert.deepEqual(await fetchAccountPortfolioItems(fetcher), [])
})

test('saveAccountPortfolioItems sends PUT payload and reports success', async () => {
  let capturedBody = ''
  const fetcher = (async (_input, init) => {
    capturedBody = String(init?.body)
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  const ok = await saveAccountPortfolioItems([{ name: '삼성전자', quantity: 10, averagePrice: 80000 }], fetcher)

  assert.equal(ok, true)
  assert.deepEqual(JSON.parse(capturedBody), {
    items: [{ name: '삼성전자', quantity: 10, averagePrice: 80000 }],
  })
})
