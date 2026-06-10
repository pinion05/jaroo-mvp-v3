import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

import {
  QUOTES_CURRENT_PROXY_TIMEOUT_MS,
  QuotesCurrentProxyTimeoutError,
  buildQuotesCurrentUpstreamUrl,
  fetchQuotesCurrentUpstream,
  handleQuotesCurrentRequest,
} from './route'

test('quotes current proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildQuotesCurrentUpstreamUrl('http://127.0.0.1:3040', new URL('http://localhost/api/quotes/current?codes=005930&tickers=AAPL').searchParams)

  assert.equal(url, 'http://127.0.0.1:3040/api/source/krx-polygon-fmp/market/quotes/current?codes=005930&tickers=AAPL')
  assert.equal(QUOTES_CURRENT_PROXY_TIMEOUT_MS, 15_000)
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
  const signalAwareFetcher = async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })

  const response = await handleQuotesCurrentRequest(
    new NextRequest('http://localhost/api/quotes/current?codes=005930'),
    { fetcher: signalAwareFetcher, timeoutMs: 5 },
  )
  const body = await response.json()

  assert.equal(response.status, 504)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'upstream-timeout')
})

test('quotes current route forwards request aborts to the upstream fetch signal', async () => {
  const requestAbortController = new AbortController()
  const upstream = { signal: null as AbortSignal | null }

  const signalAwareFetcher = async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      upstream.signal = init?.signal ?? null
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('client disconnected', 'AbortError'))
      }, { once: true })
    })

  const responsePromise = handleQuotesCurrentRequest(
    new NextRequest('http://localhost/api/quotes/current?codes=005930', { signal: requestAbortController.signal }),
    { fetcher: signalAwareFetcher, timeoutMs: 50 },
  )
  requestAbortController.abort()

  const response = await responsePromise
  const body = await response.json()

  assert.equal(upstream.signal?.aborted, true)
  assert.equal(response.status, 499)
  assert.equal(body.error.code, 'client-abort')
})
