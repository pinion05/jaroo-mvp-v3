import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

import {
  BriefingSnapshotTimeoutError,
  buildBriefingSnapshotData,
  clearBriefingSnapshotCache,
  handleBriefingSnapshotRequest,
} from './route'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const stockBasic = {
  closePrice: '9,720',
  localTradedAt: '2026-05-29T12:12:19+09:00',
  marketStatus: 'OPEN',
  stockExchangeName: 'KOSPI',
}

const dailyRows = [
  { localTradedAt: '2026-05-27', closePrice: '11,100', openPrice: '13,680', highPrice: '13,910', lowPrice: '11,100', accumulatedTradingVolume: 4150667, fluctuationsRatio: '-16.23' },
  { localTradedAt: '2026-05-28', closePrice: '10,190', openPrice: '10,900', highPrice: '11,260', lowPrice: '9,820', accumulatedTradingVolume: 2187544, fluctuationsRatio: '-8.20' },
  { localTradedAt: '2026-05-29', closePrice: '9,720', openPrice: '10,000', highPrice: '10,270', lowPrice: '9,100', accumulatedTradingVolume: 1385508, fluctuationsRatio: '-4.61' },
]

const indexBasic = {
  closePrice: '8,390.68',
  fluctuationsRatio: '2.43',
  localTradedAt: '2026-05-29T12:11:00+09:00',
}

function createBriefingFetcher(overrides: Partial<Record<'daily' | 'stockBasic' | 'kospi' | 'kosdaq', Response | Error>> = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = url.includes('/price?')
      ? 'daily'
      : url.includes('/stock/') && url.includes('/basic')
        ? 'stockBasic'
        : url.includes('/index/KOSPI/')
          ? 'kospi'
          : url.includes('/index/KOSDAQ/')
            ? 'kosdaq'
            : null

    if (!key) {
      return jsonResponse({ error: 'unexpected url' }, 404)
    }

    const override = overrides[key]
    if (override instanceof Error) {
      throw override
    }
    if (override) {
      return override
    }

    if (key === 'daily') {
      return jsonResponse(dailyRows)
    }
    if (key === 'stockBasic') {
      return jsonResponse(stockBasic)
    }
    return jsonResponse(indexBasic)
  }) as typeof fetch
}

test('briefing snapshot route rejects invalid KR code', async () => {
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=abc'),
    { fetcher: createBriefingFetcher(), cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'invalid-code')
})

test('briefing snapshot returns partial response when daily source fails but basic quote is available', async () => {
  clearBriefingSnapshotCache()
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    { fetcher: createBriefingFetcher({ daily: jsonResponse({ error: 'temporary' }, 500) }), cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.quote.currentPrice, 9720)
  assert.deepEqual(body.data.daily, [])
  assert.equal(body.data.sourceStatus.daily, 'error')
  assert.equal(body.data.sourceStatus.stockBasic, 'ok')
})

test('briefing snapshot hides upstream URLs in error responses', async () => {
  clearBriefingSnapshotCache()
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    {
      fetcher: createBriefingFetcher({
        daily: jsonResponse({ error: 'down' }, 500),
        stockBasic: jsonResponse({ error: 'down' }, 500),
      }),
      cacheTtlMs: 0,
    },
  )
  const body = await response.json()

  assert.equal(response.status, 502)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'upstream-error')
  assert.equal(body.error.message, 'briefing snapshot failed')
  assert.doesNotMatch(body.error.message, /naver|http|stock/u)
})

test('briefing snapshot maps upstream timeout to 504 rather than client abort', async () => {
  clearBriefingSnapshotCache()
  const signalAwareFetcher = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch

  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    { fetcher: signalAwareFetcher, timeoutMs: 5, cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 504)
  assert.equal(body.error.code, 'upstream-timeout')
})

test('buildBriefingSnapshotData exposes timeout errors for direct service callers', async () => {
  const signalAwareFetcher = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch

  await assert.rejects(
    () => buildBriefingSnapshotData('003720', { fetcher: signalAwareFetcher, timeoutMs: 5 }),
    BriefingSnapshotTimeoutError,
  )
})
