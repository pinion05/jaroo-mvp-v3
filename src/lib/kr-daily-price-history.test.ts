import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchKrDailyPriceHistory } from './kr-daily-price-history'

test('fetchKrDailyPriceHistory merges paged Naver rows into a deduplicated ascending daily series', async () => {
  const requestedPages: number[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const page = Number(url.searchParams.get('page'))
    requestedPages.push(page)
    const rows = page === 1
      ? [
          { localTradedAt: '2026-01-04', closePrice: '10,400' },
          { localTradedAt: '2026-01-03', closePrice: '10,300' },
        ]
      : [
          { localTradedAt: '2026-01-03', closePrice: '9,999' },
          { localTradedAt: '2026-01-02', closePrice: '10,200' },
        ]
    return new Response(JSON.stringify(rows), { status: 200 })
  }) as typeof fetch

  const series = await fetchKrDailyPriceHistory('100840', {
    fetcher,
    pageCount: 2,
    pageSize: 2,
    timeoutMs: 1000,
  })

  assert.deepEqual(requestedPages.sort(), [1, 2])
  assert.deepEqual(series, [
    { date: '2026-01-02', close: 10200 },
    { date: '2026-01-03', close: 10300 },
    { date: '2026-01-04', close: 10400 },
  ])
})

test('fetchKrDailyPriceHistory rejects invalid KR codes before requesting upstream', async () => {
  let called = false
  const fetcher = (async () => {
    called = true
    return new Response('[]')
  }) as typeof fetch

  await assert.rejects(
    () => fetchKrDailyPriceHistory('ABC', { fetcher }),
    /6자리/,
  )
  assert.equal(called, false)
})

test('fetchKrDailyPriceHistory rejects a non-OK Naver page instead of returning partial history', async () => {
  const fetcher = (async () => new Response('busy', { status: 503 })) as typeof fetch

  await assert.rejects(
    () => fetchKrDailyPriceHistory('100840', { fetcher, pageCount: 1 }),
    /HTTP 503/,
  )
})
