import test from 'node:test'
import assert from 'node:assert/strict'

import { clearKrDailyPriceHistoryCache, fetchKrDailyPriceHistory } from './kr-daily-price-history'

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
    cacheTtlMs: 0,
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
    () => fetchKrDailyPriceHistory('100840', { fetcher, pageCount: 1, cacheTtlMs: 0 }),
    /HTTP 503/,
  )
})

test('fetchKrDailyPriceHistory requests 13 pages (3-year daily bars) by default', async () => {
  clearKrDailyPriceHistoryCache()
  const requestedPages: number[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const page = Number(new URL(String(input)).searchParams.get('page'))
    requestedPages.push(page)
    // 상장 3년 미만 종목처럼 페이지마다 1봉씩 짧게 내려오는 경우도 그대로 수용한다.
    return new Response(
      JSON.stringify([{ localTradedAt: `2025-01-${String(page).padStart(2, '0')}`, closePrice: String(1000 + page) }]),
      { status: 200 },
    )
  }) as typeof fetch

  const series = await fetchKrDailyPriceHistory('515151', { fetcher, timeoutMs: 5000, cacheTtlMs: 0 })

  assert.deepEqual([...requestedPages].sort((left, right) => left - right), Array.from({ length: 13 }, (_, index) => index + 1))
  assert.equal(series.length, 13)
  assert.equal(series[0]?.date, '2025-01-01')
  assert.equal(series[12]?.date, '2025-01-13')
})

test('fetchKrDailyPriceHistory fetches pages in sequential chunks of 5 to avoid upstream 429s', async () => {
  clearKrDailyPriceHistoryCache()
  const events: string[] = []
  let activeRequests = 0
  let maxActiveRequests = 0
  const fetcher = (async (input: string | URL | Request) => {
    const page = Number(new URL(String(input)).searchParams.get('page'))
    activeRequests += 1
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
    events.push(`start:${page}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
    events.push(`end:${page}`)
    activeRequests -= 1
    return new Response(
      JSON.stringify([{ localTradedAt: `2025-01-${String(page).padStart(2, '0')}`, closePrice: String(1000 + page) }]),
      { status: 200 },
    )
  }) as typeof fetch

  await fetchKrDailyPriceHistory('626262', { fetcher, timeoutMs: 5000, cacheTtlMs: 0 })

  // 동시 요청은 청크 크기(5)를 넘지 않는다.
  assert.ok(maxActiveRequests <= 5, `동시 요청 수 상한(5) 초과: max=${maxActiveRequests}`)
  // 청크는 순차적으로만 진행한다 — 6페이지 이후는 1~5페이지가 모두 끝난 뒤에 시작한다.
  const secondChunkStart = events.indexOf('start:6')
  assert.ok(secondChunkStart > 0)
  for (let page = 1; page <= 5; page += 1) {
    assert.ok(events.indexOf(`end:${page}`) < secondChunkStart, `page ${page}는 청크 2 시작 전에 완료돼야 한다`)
  }
})

test('fetchKrDailyPriceHistory serves the second identical call from the module TTL cache', async () => {
  clearKrDailyPriceHistoryCache()
  let fetchCount = 0
  const fetcher = (async () => {
    fetchCount += 1
    return new Response(
      JSON.stringify([{ localTradedAt: '2026-10-30', closePrice: '7,000' }]),
      { status: 200 },
    )
  }) as typeof fetch

  const first = await fetchKrDailyPriceHistory('313131', { fetcher, timeoutMs: 5000 })
  const second = await fetchKrDailyPriceHistory('313131', { fetcher, timeoutMs: 5000 })

  assert.equal(fetchCount, 13, '첫 호출만 13페이지를 fetch해야 한다')
  assert.deepEqual(second, first)

  // 캐시를 비우면 다시 fetch한다.
  clearKrDailyPriceHistoryCache()
  await fetchKrDailyPriceHistory('313131', { fetcher, timeoutMs: 5000 })
  assert.equal(fetchCount, 26)
})

test('fetchKrDailyPriceHistory refetches after the cache TTL expires', async () => {
  clearKrDailyPriceHistoryCache()
  let fetchCount = 0
  const fetcher = (async () => {
    fetchCount += 1
    return new Response(
      JSON.stringify([{ localTradedAt: '2026-10-30', closePrice: '9,900' }]),
      { status: 200 },
    )
  }) as typeof fetch

  await fetchKrDailyPriceHistory('424242', { fetcher, timeoutMs: 5000, cacheTtlMs: 20 })
  await new Promise((resolve) => setTimeout(resolve, 40))
  await fetchKrDailyPriceHistory('424242', { fetcher, timeoutMs: 5000, cacheTtlMs: 20 })

  assert.equal(fetchCount, 26, 'TTL 만료 후에는 같은 코드라도 다시 fetch해야 한다')
})
