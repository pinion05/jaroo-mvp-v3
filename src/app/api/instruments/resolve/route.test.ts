import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveHoldingInstrument } from '@/lib/holding-instrument-lookup'

import {
  MAX_RESOLVE_NAME_LENGTH,
  MAX_RESOLVE_ROWS,
  MIN_VISIBLE_CANDIDATE_SCORE,
  POST,
  enrichResolveRowsWithVisibleInstrumentInfo,
  filterVisibleInstrumentCandidates,
  getResolveRowsValidationError,
} from './route'

function createRow(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    quantity: '1',
    profitRate: '0',
    evaluationAmount: '1000',
    averagePrice: '1000',
    ...overrides,
  }
}

function createCandidate(id: string, score?: number) {
  return {
    id,
    resolvedName: `candidate-${id}`,
    source: 'local' as const,
    score,
  }
}

function findHiddenLowConfidenceNameResolution() {
  const boundaryQueries = ['Microsoft orporation', 'AMAZN COM INC', 'NIDIA CORP', 'Boadcom Inc.', 'Aphabet Inc.']

  for (const query of boundaryQueries) {
    const resolved = resolveHoldingInstrument(query)

    if (resolved && resolved.confidence >= 0.62 && resolved.confidence < MIN_VISIBLE_CANDIDATE_SCORE) {
      return { query, resolved }
    }
  }

  throw new Error('Expected a known boundary query whose confidence stays between 0.62 and 0.65.')
}

test('resolve API는 빈 rows를 거절한다', () => {
  assert.equal(getResolveRowsValidationError([]), 'At least one OCR row is required.')
})

test('resolve API는 rows 상한을 넘기면 거절한다', () => {
  const rows = Array.from({ length: MAX_RESOLVE_ROWS + 1 }, (_, index) => createRow(`종목 ${index + 1}`))

  assert.equal(
    getResolveRowsValidationError(rows),
    `Too many OCR rows. Up to ${MAX_RESOLVE_ROWS} rows are supported per request.`,
  )
})

test('resolve API는 과도하게 긴 종목명을 거절한다', () => {
  const tooLongName = '가'.repeat(MAX_RESOLVE_NAME_LENGTH + 1)

  assert.equal(
    getResolveRowsValidationError([createRow(tooLongName)]),
    `OCR row names must be ${MAX_RESOLVE_NAME_LENGTH} characters or fewer.`,
  )
})

test('resolve API는 허용 범위의 rows를 통과시킨다', () => {
  const rows = [createRow('삼성전자'), createRow('Apple')]

  assert.equal(getResolveRowsValidationError(rows), '')
})

test('resolve API 후보 노출은 65% 미만 점수를 숨긴다', () => {
  const visibleCandidates = filterVisibleInstrumentCandidates([
    createCandidate('low', MIN_VISIBLE_CANDIDATE_SCORE - 0.01),
    createCandidate('threshold', MIN_VISIBLE_CANDIDATE_SCORE),
    createCandidate('high', MIN_VISIBLE_CANDIDATE_SCORE + 0.2),
    createCandidate('unknown'),
  ])

  assert.deepEqual(
    visibleCandidates.map((candidate) => candidate.id),
    ['threshold', 'high', 'unknown'],
  )
})

test('resolve API는 숨겨진 저신뢰 name 매치를 row auto-resolve에 쓰지 않는다', () => {
  const { query, resolved } = findHiddenLowConfidenceNameResolution()
  const [row] = enrichResolveRowsWithVisibleInstrumentInfo([createRow(query)])

  assert.ok(resolved.confidence >= 0.62)
  assert.ok(resolved.confidence < MIN_VISIBLE_CANDIDATE_SCORE)
  assert.equal(row?.resolvedTicker, undefined)
  assert.equal(row?.resolvedCode, undefined)
  assert.equal(row?.resolvedName, undefined)
})

test('resolve API는 명시적 ticker가 있으면 가시성 임계값과 무관하게 enrich를 유지한다', () => {
  const { query, resolved } = findHiddenLowConfidenceNameResolution()
  assert.ok(resolved.ticker)

  const [row] = enrichResolveRowsWithVisibleInstrumentInfo([
    createRow(query, {
      resolvedTicker: resolved.ticker,
    }),
  ])

  assert.equal(row?.resolvedTicker, resolved.ticker)
  assert.equal(row?.resolvedName, resolved.name)
})

test('resolve API는 로컬 KR 종목을 ticker-map 조회 없이 빠르게 확정한다', async () => {
  const startedAt = Date.now()
  const response = await POST(
    new Request('http://localhost/api/instruments/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rows: [createRow('SNT에너지', { averagePrice: '49256.73' })],
      }),
    }),
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.rows[0]?.resolvedName, 'SNT에너지')
  assert.equal(body.rows[0]?.resolvedCode, '100840')
  assert.ok(Date.now() - startedAt < 1000)
})
