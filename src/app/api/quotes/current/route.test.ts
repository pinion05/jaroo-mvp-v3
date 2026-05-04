import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

import {
  GET,
  QuotesCurrentProxyTimeoutError,
  buildQuotesCurrentUpstreamUrl,
  fetchQuotesCurrentUpstream,
} from './route'

test('quotes current proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildQuotesCurrentUpstreamUrl('http://127.0.0.1:3040', new URL('http://localhost/api/quotes/current?codes=005930&tickers=AAPL').searchParams)

  assert.equal(url, 'http://127.0.0.1:3040/api/source/krx-polygon-fmp/market/quotes/current?codes=005930&tickers=AAPL')
})

test('quotes current proxy fetch normalizes signal-aware upstream timeout aborts', async () => {
  const signalAwareFetcher = async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })

  await assert.rejects(
    () => fetchQuotesCurrentUpstream('http://127.0.0.1:3040/slow', signalAwareFetcher, 5),
    QuotesCurrentProxyTimeoutError,
  )
})

test('quotes current route returns 504 JSON when crawler proxy times out', async () => {
  const originalFetch = globalThis.fetch
  const originalTimeoutMs = process.env.QUOTES_CURRENT_PROXY_TIMEOUT_MS
  const signalAwareFetcher = async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })

  globalThis.fetch = signalAwareFetcher
  process.env.QUOTES_CURRENT_PROXY_TIMEOUT_MS = '5'

  try {
    const response = await GET(new NextRequest('http://localhost/api/quotes/current?codes=005930'))
    const body = await response.json()

    assert.equal(response.status, 504)
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'upstream-timeout')
  } finally {
    globalThis.fetch = originalFetch
    if (originalTimeoutMs === undefined) {
      delete process.env.QUOTES_CURRENT_PROXY_TIMEOUT_MS
    } else {
      process.env.QUOTES_CURRENT_PROXY_TIMEOUT_MS = originalTimeoutMs
    }
  }
})
