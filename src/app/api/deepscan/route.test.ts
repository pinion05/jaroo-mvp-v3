import test from 'node:test'
import assert from 'node:assert/strict'

import { NextRequest } from 'next/server'

import { GET, buildDeepScanCanonicalUpstreamPath } from './route'

test('deepscan canonical proxy helper는 crawler 허용 query만 upstream path로 전달한다', () => {
  assert.equal(
    buildDeepScanCanonicalUpstreamPath(
      new URLSearchParams(
        'market=KR&code=005930&ticker=005930.KS&name=삼성전자&shares=10주&averagePrice=70000원&evaluationAmount=750000원&selectedAt=2026-04-15T15%3A00%3A00.000Z&from=home-handoff&debug=true',
      ),
    ),
    '/api/source/wisereport-fnguide-krx-polygon-fmp-deepscan-package/deepscan/canonical?market=KR&code=005930&ticker=005930.KS&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90&shares=10%EC%A3%BC&averagePrice=70000%EC%9B%90&evaluationAmount=750000%EC%9B%90&selectedAt=2026-04-15T15%3A00%3A00.000Z&from=home-handoff',
  )
})

test('deepscan canonical proxy GET은 crawler raw body와 status를 그대로 반환한다', async (t) => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input, init) => {
    assert.equal(input, 'http://127.0.0.1:3040/api/source/wisereport-fnguide-krx-polygon-fmp-deepscan-package/deepscan/canonical?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90')
    assert.deepEqual(init, { cache: 'no-store' })

    return new Response('{"metadata":{"debugId":"abc"}}', {
      status: 422,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const response = await GET(
    new NextRequest('http://localhost/api/deepscan?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90&ignored=value'),
  )

  assert.equal(response.status, 422)
  assert.equal(await response.text(), '{"metadata":{"debugId":"abc"}}')
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
})

test('deepscan canonical proxy GET은 crawler 응답 전에 실패하면 local JSON error를 반환한다', async (t) => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const response = await GET(new NextRequest('http://localhost/api/deepscan?market=KR&code=005930'))

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    ok: false,
    data: null,
    count: 0,
    error: {
      message: 'network down',
    },
  })
})

test('deepscan canonical proxy GET은 crawler 응답 이후 body read 실패를 local JSON error로 변환하지 않는다', async (t) => {
  const originalFetch = globalThis.fetch
  const streamError = new Error('stream broke')

  globalThis.fetch = (async () => {
    const response = new Response('', {
      status: 502,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    })

    Object.defineProperty(response, 'text', {
      value: async () => {
        throw streamError
      },
    })

    return response
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  await assert.rejects(GET(new NextRequest('http://localhost/api/deepscan?market=KR&code=005930')), {
    message: 'stream broke',
  })
})
