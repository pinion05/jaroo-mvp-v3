import test from 'node:test'
import assert from 'node:assert/strict'

import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import { mapAppliedRowsToSaveRows, mapDbRowsToAppliedRows } from './portfolio-sync'

function createRow(overrides: Partial<AppliedHomePortfolioRow> = {}): AppliedHomePortfolioRow {
  return {
    name: '삼성전자',
    resolvedName: '삼성전자',
    quantity: '10',
    averagePrice: '70,000',
    profitRate: '+5%',
    evaluationAmount: '735,000',
    resolvedCode: '005930',
    code: '005930',
    resolvedTicker: undefined,
    ticker: undefined,
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    ...overrides,
  }
}

test('mapAppliedRowsToSaveRows는 OCR row를 저장 DTO로 변환한다 (콤마/단위 제거, sort_order)', () => {
  const [row] = mapAppliedRowsToSaveRows([createRow(), createRow({ name: 'AAPL', resolvedMarketTone: 'nasdaq', resolvedKind: 'stock', resolvedTicker: 'AAPL', resolvedCode: undefined, code: undefined })])

  assert.equal(row.name, '삼성전자')
  assert.equal(row.quantity, 10)
  assert.equal(row.average_price, 70000)
  assert.equal(row.evaluation_amount, 735000)
  assert.equal(row.code, '005930')
  assert.equal(row.market_tone, 'kospi')
  assert.equal(row.kind, 'stock')
  assert.equal(row.source, 'ocr')
  assert.equal(row.sort_order, 0)
})

test('mapAppliedRowsToSaveRows는 두 번째 row의 sort_order를 1로 한다', () => {
  const rows = mapAppliedRowsToSaveRows([createRow(), createRow({ name: 'A' })])
  assert.equal(rows[0].sort_order, 0)
  assert.equal(rows[1].sort_order, 1)
})

test('mapAppliedRowsToSaveRows는 파싱 불가 숫자를 0으로 채운다 (NOT NULL 컬럼)', () => {
  const [row] = mapAppliedRowsToSaveRows([createRow({ quantity: 'N/A', averagePrice: '' })])
  assert.equal(row.quantity, 0)
  assert.equal(row.average_price, 0)
})

test('mapAppliedRowsToSaveRows는 identifier_label을 ticker · code 로 만든다', () => {
  const [row] = mapAppliedRowsToSaveRows([createRow({ resolvedTicker: 'AAPL', resolvedCode: undefined, code: undefined })])
  assert.equal(row.identifier_label, 'AAPL')
})

test('mapDbRowsToAppliedRows는 DB row를 AppliedHomePortfolioRow로 round-trip 한다', () => {
  const [saveRow] = mapAppliedRowsToSaveRows([createRow()])
  const [roundTrip] = mapDbRowsToAppliedRows([saveRow])
  assert.equal(roundTrip.name, '삼성전자')
  assert.equal(roundTrip.resolvedName, '삼성전자')
  assert.equal(roundTrip.quantity, '10')
  assert.equal(roundTrip.averagePrice, '70000')
  assert.equal(roundTrip.profitRate, '') // not stored; recomputed on load
  assert.equal(roundTrip.evaluationAmount, '735000')
  assert.equal(roundTrip.resolvedMarketTone, 'kospi')
  assert.equal(roundTrip.resolvedKind, 'stock')
})

test('mapDbRowsToAppliedRows는 null evaluation_amount를 빈 문자열로 채운다', () => {
  const [roundTrip] = mapDbRowsToAppliedRows([{ name: 'X', quantity: 1, average_price: 100, evaluation_amount: null, sort_order: 0, source: 'ocr' }])
  assert.equal(roundTrip.evaluationAmount, '')
})
