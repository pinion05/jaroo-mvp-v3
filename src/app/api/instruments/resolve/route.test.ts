import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_RESOLVE_NAME_LENGTH,
  MAX_RESOLVE_ROWS,
  MIN_VISIBLE_CANDIDATE_SCORE,
  filterVisibleInstrumentCandidates,
  getResolveRowsValidationError,
} from './route'

function createRow(name: string) {
  return {
    name,
    quantity: '1',
    profitRate: '0',
    evaluationAmount: '1000',
    averagePrice: '1000',
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
