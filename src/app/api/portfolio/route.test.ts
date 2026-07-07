import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_PORTFOLIO_ROWS, getPortfolioRowsValidationError } from './route'

test('portfolio API는 rows가 배열이 아니면 거절한다', () => {
  assert.equal(getPortfolioRowsValidationError(undefined), 'rows must be an array.')
  assert.equal(getPortfolioRowsValidationError('x'), 'rows must be an array.')
})

test('portfolio API는 빈 rows를 허용한다 (전체 삭제 = clear)', () => {
  assert.equal(getPortfolioRowsValidationError([]), '')
})

test('portfolio API는 rows 상한을 넘기면 거절한다', () => {
  const rows = Array.from({ length: MAX_PORTFOLIO_ROWS + 1 }, (_, index) => ({ name: `종목${index}`, quantity: 1, average_price: 100, sort_order: index, source: 'ocr' }))
  assert.equal(getPortfolioRowsValidationError(rows), `Too many rows. Up to ${MAX_PORTFOLIO_ROWS} rows are supported.`)
})
