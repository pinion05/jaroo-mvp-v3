import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_PORTFOLIO_REQUEST_BODY_BYTES, MAX_PORTFOLIO_ROWS, getPortfolioRequestBodySizeError, getPortfolioRowsValidationError } from '@/lib/portfolio-validation'

const validRow = {
  name: '삼성전자',
  code: '005930',
  ticker: '005930',
  market: 'KOSPI',
  market_tone: 'kospi',
  kind: 'stock',
  quantity: 12,
  average_price: 71000,
  average_price_currency: 'KRW',
  evaluation_amount: 1022400,
  identifier_label: '005930',
  sort_order: 0,
  source: 'ocr',
}

test('portfolio API는 rows가 배열이 아니면 거절한다', () => {
  assert.equal(getPortfolioRowsValidationError(undefined), 'rows must be an array.')
  assert.equal(getPortfolioRowsValidationError('x'), 'rows must be an array.')
})

test('portfolio API는 request body bytes 상한을 넘기면 거절한다', () => {
  assert.equal(getPortfolioRequestBodySizeError('{"rows":[]}'), '')
  assert.equal(
    getPortfolioRequestBodySizeError('x'.repeat(MAX_PORTFOLIO_REQUEST_BODY_BYTES + 1)),
    `request body exceeds ${MAX_PORTFOLIO_REQUEST_BODY_BYTES} bytes.`,
  )
})

test('portfolio API는 빈 rows를 허용한다 (전체 삭제 = clear)', () => {
  assert.equal(getPortfolioRowsValidationError([]), '')
})

test('portfolio API는 rows 상한을 넘기면 거절한다', () => {
  const rows = Array.from({ length: MAX_PORTFOLIO_ROWS + 1 }, (_, index) => ({ name: `종목${index}`, quantity: 1, average_price: 100, sort_order: index, source: 'ocr' }))
  assert.equal(getPortfolioRowsValidationError(rows), `Too many rows. Up to ${MAX_PORTFOLIO_ROWS} rows are supported.`)
})

test('portfolio API는 row 객체와 필수 필드를 검증한다', () => {
  assert.equal(getPortfolioRowsValidationError([null]), 'rows[0] must be an object.')
  assert.equal(getPortfolioRowsValidationError([{ ...validRow, name: '' }]), 'rows[0].name is required.')
  assert.equal(getPortfolioRowsValidationError([{ ...validRow, quantity: '12' }]), 'rows[0].quantity must be a finite number.')
})

test('portfolio API는 enum과 numeric bound를 검증한다', () => {
  assert.equal(getPortfolioRowsValidationError([{ ...validRow, kind: 'bond' }]), 'rows[0].kind has an unsupported value.')
  assert.equal(getPortfolioRowsValidationError([{ ...validRow, average_price_currency: 'EUR' }]), 'rows[0].average_price_currency has an unsupported value.')
  assert.equal(getPortfolioRowsValidationError([{ ...validRow, sort_order: 1.5 }]), 'rows[0].sort_order must be an integer.')
})
