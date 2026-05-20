import test from 'node:test'
import assert from 'node:assert/strict'

import { createDeepScanCommitteeStatusResponse, parseCommitteeProgressBody } from './route'

test('committee status route requires requestId', async () => {
  const response = createDeepScanCommitteeStatusResponse(new URLSearchParams(), () => null)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).ok, false)
})

test('committee status route returns not_found without 500', async () => {
  const response = createDeepScanCommitteeStatusResponse(new URLSearchParams('requestId=missing'), () => null)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.status, 'not_found')
  assert.deepEqual(body.pending, [])
})

test('committee status route returns progressive state', async () => {
  const response = createDeepScanCommitteeStatusResponse(new URLSearchParams('requestId=job-1'), () => ({
    requestId: 'job-1',
    status: 'partial',
    results: { profitability: { score: 70, reason: 'ok', confidence: 'medium' } },
    errors: [],
    pending: ['valuation'],
    completed: 1,
    updatedAt: '2026-05-11T00:00:00.000Z',
    softDeadlineMs: 25000,
  }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.status, 'partial')
  assert.deepEqual(body.pending, ['valuation'])
  assert.equal(body.completed, 1)
})


test('parseCommitteeProgressBody sanitizes malformed upstream fields', () => {
  const parsed = parseCommitteeProgressBody(JSON.stringify({
    requestId: 'job-2',
    status: 42,
    results: ['not-a-record'],
    errors: 'not-an-array',
    pending: ['valuation', 1, 'quality'],
    completed: '1',
    updatedAt: 123,
    softDeadlineMs: Number.NaN,
  }))

  assert.deepEqual(parsed, {
    requestId: 'job-2',
    status: 'unknown',
    results: undefined,
    errors: undefined,
    pending: ['valuation', 'quality'],
    completed: undefined,
    updatedAt: undefined,
    softDeadlineMs: undefined,
  })
})

test('parseCommitteeProgressBody returns null for invalid JSON or missing requestId', () => {
  assert.equal(parseCommitteeProgressBody('{'), null)
  assert.equal(parseCommitteeProgressBody(JSON.stringify({ status: 'partial' })), null)
})
