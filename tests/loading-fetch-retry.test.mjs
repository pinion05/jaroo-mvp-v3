import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchLoadingProxyJson } from '../src/lib/loading-fetch-retry.ts'

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

const originalFetch = globalThis.fetch

test('resolves with data on first ok response', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return makeJsonResponse({ ok: true, data: { price: 10 } })
  }
  try {
    const result = await fetchLoadingProxyJson('/x', { retryDelaysMs: [10, 10] })
    assert.equal(calls, 1)
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { price: 10 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retries on 5xx and recovers when a later attempt succeeds', async () => {
  const statuses = [502, 503, 200]
  const bodies = [
    { ok: false },
    { ok: false },
    { ok: true, data: { price: 20 } },
  ]
  let calls = 0
  globalThis.fetch = async () => {
    const idx = calls
    calls += 1
    return makeJsonResponse(bodies[idx], statuses[idx])
  }
  try {
    const result = await fetchLoadingProxyJson('/x', { retryDelaysMs: [5, 5] })
    assert.equal(calls, 3, 'should retry twice then succeed')
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { price: 20 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retries when body.ok is false (proxy upstream failure)', async () => {
  const bodies = [{ ok: true, data: undefined }, { ok: false }, { ok: true, data: { price: 30 } }]
  let calls = 0
  globalThis.fetch = async () => {
    const idx = calls
    calls += 1
    return makeJsonResponse(bodies[idx])
  }
  try {
    const result = await fetchLoadingProxyJson('/x', { retryDelaysMs: [5, 5] })
    assert.equal(calls, 3)
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { price: 30 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns ok:false after exhausting retries', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return makeJsonResponse({ ok: false }, 502)
  }
  try {
    const result = await fetchLoadingProxyJson('/x', { retryDelaysMs: [5, 5] })
    assert.equal(calls, 3, '1 initial + 2 retries')
    assert.equal(result.ok, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('aborts immediately stop retrying and return ok:false', async () => {
  let calls = 0
  const controller = new AbortController()
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) {
      controller.abort()
    }
    return makeJsonResponse({ ok: false }, 502)
  }
  try {
    const result = await fetchLoadingProxyJson('/x', {
      signal: controller.signal,
      retryDelaysMs: [5, 5, 5],
    })
    assert.equal(result.ok, false)
    // should not keep retrying after abort
    assert.ok(calls <= 2, `expected few calls, got ${calls}`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('network errors are retried', async () => {
  const behaviors = [
    () => Promise.reject(new Error('network')),
    () => Promise.resolve(makeJsonResponse({ ok: true, data: { price: 40 } })),
  ]
  let calls = 0
  globalThis.fetch = async () => {
    const idx = calls
    calls += 1
    return behaviors[idx]()
  }
  try {
    const result = await fetchLoadingProxyJson('/x', { retryDelaysMs: [5] })
    assert.equal(calls, 2)
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { price: 40 })
  } finally {
    globalThis.fetch = originalFetch
  }
})
