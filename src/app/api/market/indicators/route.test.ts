import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MarketIndicatorsProxyTimeoutError,
  buildMarketIndicatorsUpstreamUrl,
  fetchMarketIndicatorsUpstream,
  handleMarketIndicatorsRequest,
} from './route'

test('market indicators proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildMarketIndicatorsUpstreamUrl('http://127.0.0.1:3040')

  assert.equal(url, 'http://127.0.0.1:3040/api/source/stockplus-adrinfo-investing/market/indicators')
})

test('market indicators proxy는 upstream 지연을 timeout으로 끊는다', async () => {
  await assert.rejects(
    () => fetchMarketIndicatorsUpstream('http://127.0.0.1:3040/slow', (() => new Promise(() => {})) as typeof fetch, 1),
    MarketIndicatorsProxyTimeoutError,
  )
})

test('market indicators route는 timeout 시 504를 반환한다', async () => {
  const response = await handleMarketIndicatorsRequest(
    new Request('http://localhost/api/market/indicators'),
    { fetcher: (() => new Promise(() => {})) as typeof fetch, timeoutMs: 1 },
  )
  const body = await response.json()

  assert.equal(response.status, 504)
  assert.equal(body.ok, false)
  assert.match(body.error.message, /timed out/)
})
