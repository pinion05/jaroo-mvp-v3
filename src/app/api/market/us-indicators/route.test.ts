import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UsMarketIndicatorsProxyTimeoutError,
  buildUsMarketIndicatorsUpstreamUrl,
  fetchUsMarketIndicatorsUpstream,
  handleUsMarketIndicatorsRequest,
} from './route'

test('us market indicators proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildUsMarketIndicatorsUpstreamUrl('http://127.0.0.1:3040')

  assert.equal(url, 'http://127.0.0.1:3040/api/source/polygon-yahoo/us/market/indicators')
})

test('us market indicators proxy는 upstream 지연을 timeout으로 끊는다', async () => {
  await assert.rejects(
    () => fetchUsMarketIndicatorsUpstream('http://127.0.0.1:3040/slow', (() => new Promise(() => {})) as typeof fetch, 1),
    UsMarketIndicatorsProxyTimeoutError,
  )
})

test('us market indicators route는 timeout 시 504를 반환한다', async () => {
  const response = await handleUsMarketIndicatorsRequest(
    new Request('http://localhost/api/market/us-indicators'),
    { fetcher: (() => new Promise(() => {})) as typeof fetch, timeoutMs: 1 },
  )
  const body = await response.json()

  assert.equal(response.status, 504)
  assert.equal(body.ok, false)
  assert.match(body.error.message, /timed out/)
})
