import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UsdKrwFxProxyTimeoutError,
  buildUsdKrwFxUpstreamUrl,
  fetchUsdKrwFxUpstream,
  handleUsdKrwFxRequest,
} from './route'

test('usd krw fx proxy는 crawler endpoint url을 그대로 조합한다', () => {
  const url = buildUsdKrwFxUpstreamUrl('http://127.0.0.1:3040')

  assert.equal(url, 'http://127.0.0.1:3040/api/major/market/fx/usd-krw')
})

test('usd krw fx proxy는 upstream 지연을 timeout으로 끊는다', async () => {
  await assert.rejects(
    () => fetchUsdKrwFxUpstream('http://127.0.0.1:3040/slow', (() => new Promise(() => {})) as typeof fetch, 1),
    UsdKrwFxProxyTimeoutError,
  )
})

test('usd krw fx route는 timeout 시 504를 반환한다', async () => {
  const response = await handleUsdKrwFxRequest(
    new Request('http://localhost/api/market/fx/usd-krw'),
    { fetcher: (() => new Promise(() => {})) as typeof fetch, timeoutMs: 1 },
  )
  const body = await response.json()

  assert.equal(response.status, 504)
  assert.equal(body.ok, false)
  assert.match(body.error.message, /timed out/)
})
