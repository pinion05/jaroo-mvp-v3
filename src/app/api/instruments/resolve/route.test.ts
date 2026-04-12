import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_RESOLVE_NAME_LENGTH, MAX_RESOLVE_ROWS, getResolveRowsValidationError } from './route'

function createRow(name: string) {
  return {
    name,
    quantity: '1',
    profitRate: '0',
    evaluationAmount: '1000',
    averagePrice: '1000',
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
