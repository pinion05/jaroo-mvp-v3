import test from 'node:test'
import assert from 'node:assert/strict'

import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import {
  mapAppliedRowsToSaveRows,
  mapDbRowsToAppliedRows,
  parsePortfolioFetchResponse,
  parsePortfolioSyncResponse,
  shouldUsePortfolioSessionFallback,
} from './portfolio-sync'

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

function createResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('parsePortfolioFetchResponse: 401 → logged-out', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(401, { error: 'unauthorized' }))
  assert.equal(result.status, 'logged-out')
})

test('parsePortfolioFetchResponse: 200 + rows → rows(AppliedHomePortfolioRow[])', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(200, { rows: [{ name: 'A', quantity: 1, average_price: 100, sort_order: 0, source: 'ocr' }] }))
  assert.equal(result.status, 'rows')
  if (result.status === 'rows') {
    assert.equal(result.rows[0].name, 'A')
    assert.equal(result.rows[0].quantity, '1')
  }
})

test('parsePortfolioFetchResponse: 200 + 빈 배열 → empty', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(200, { rows: [] }))
  assert.equal(result.status, 'empty')
})

test('parsePortfolioFetchResponse: 500 → error', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(500, { error: 'load-failed' }))
  assert.equal(result.status, 'error')
})

test('DB의 빈 포트폴리오는 세션 fallback으로 되살리지 않는다', async () => {
  const emptyResult = await parsePortfolioFetchResponse(createResponse(200, { rows: [] }))
  const loggedOutResult = await parsePortfolioFetchResponse(createResponse(401, { error: 'unauthorized' }))
  const errorResult = await parsePortfolioFetchResponse(createResponse(500, { error: 'load-failed' }))

  assert.equal(shouldUsePortfolioSessionFallback(emptyResult), false)
  assert.equal(shouldUsePortfolioSessionFallback(loggedOutResult), true)
  assert.equal(shouldUsePortfolioSessionFallback(errorResult), true)
})

test('parsePortfolioSyncResponse는 저장, 로그아웃, 서버 오류를 구분한다', async () => {
  assert.deepEqual(
    await parsePortfolioSyncResponse(createResponse(200, { saved: 2 })),
    { ok: true, saved: 2 },
  )
  assert.deepEqual(
    await parsePortfolioSyncResponse(createResponse(401, { error: 'unauthorized' })),
    { ok: false, reason: 'logged-out' },
  )
  assert.deepEqual(
    await parsePortfolioSyncResponse(createResponse(500, { error: 'sync-failed' })),
    { ok: false, reason: 'error' },
  )
})
