import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasResolvedIdentifier,
  resolveIdentifierRowsWithRetry,
  shouldRetryEmptyIdentifierResolution,
  type OcrIdentifierResolutionResult,
} from './ocr-identifier-resolution'
import type { OcrSourceRow } from './screenshot-ocr'

function createSourceRow(overrides: Partial<OcrSourceRow> = {}): OcrSourceRow {
  return {
    id: 'upload-1:0',
    uploadId: 'upload-1',
    fileName: 'holdings.png',
    uploadIndex: 0,
    rowIndex: 0,
    normalizedName: '삼성전자',
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-5%',
    evaluationAmount: '800,000원',
    averagePrice: '84,210',
    ...overrides,
  }
}

test('hasResolvedIdentifier는 이름, ticker, code 중 하나라도 있으면 true를 반환한다', () => {
  assert.equal(hasResolvedIdentifier(createSourceRow({ resolvedName: '삼성전자' })), true)
  assert.equal(hasResolvedIdentifier(createSourceRow({ resolvedName: undefined, resolvedTicker: '005930.KS' })), true)
  assert.equal(hasResolvedIdentifier(createSourceRow({ resolvedName: undefined, resolvedCode: '005930' })), true)
  assert.equal(hasResolvedIdentifier(createSourceRow({ resolvedName: ' ', resolvedTicker: ' ', resolvedCode: ' ' })), false)
})

test('shouldRetryEmptyIdentifierResolution은 모든 행이 식별자/후보 없이 돌아온 경우에만 true다', () => {
  const row = createSourceRow()

  assert.equal(shouldRetryEmptyIdentifierResolution([row], { rows: [row], candidatesByRowId: { [row.id]: [] } }), true)
  assert.equal(shouldRetryEmptyIdentifierResolution([row], { rows: [{ ...row, resolvedCode: '005930' }], candidatesByRowId: { [row.id]: [] } }), false)
  assert.equal(shouldRetryEmptyIdentifierResolution([row], {
    rows: [row],
    candidatesByRowId: {
      [row.id]: [{ id: '005930::삼성전자', resolvedName: '삼성전자', resolvedCode: '005930', source: 'local' }],
    },
  }), false)
})

test('resolveIdentifierRowsWithRetry는 첫 시도에서 전체 미식별이면 한 번 더 식별자 검색을 시도한다', async () => {
  const row = createSourceRow()
  const emptyResult: OcrIdentifierResolutionResult = { rows: [row], candidatesByRowId: { [row.id]: [] } }
  const resolvedResult: OcrIdentifierResolutionResult = {
    rows: [{ ...row, resolvedName: '삼성전자', resolvedCode: '005930', resolvedMarket: 'KOSPI', resolvedKind: 'stock' }],
    candidatesByRowId: {
      [row.id]: [{ id: '005930::삼성전자', resolvedName: '삼성전자', resolvedCode: '005930', resolvedMarket: 'KOSPI', resolvedKind: 'stock', source: 'local' }],
    },
  }
  const calls: OcrSourceRow[][] = []
  const waits: number[] = []

  const result = await resolveIdentifierRowsWithRetry(
    [row],
    async (rows) => {
      calls.push(rows)
      return calls.length === 1 ? emptyResult : resolvedResult
    },
    { retryDelayMs: 25, wait: async (delayMs) => { waits.push(delayMs) } },
  )

  assert.equal(calls.length, 2)
  assert.deepEqual(waits, [25])
  assert.equal(result.rows[0]?.resolvedCode, '005930')
})

test('resolveIdentifierRowsWithRetry는 후보가 일부라도 있으면 불필요하게 재시도하지 않는다', async () => {
  const row = createSourceRow()
  const resultWithCandidate: OcrIdentifierResolutionResult = {
    rows: [row],
    candidatesByRowId: {
      [row.id]: [{ id: '005930::삼성전자', resolvedName: '삼성전자', resolvedCode: '005930', source: 'local' }],
    },
  }
  let callCount = 0

  const result = await resolveIdentifierRowsWithRetry(
    [row],
    async () => {
      callCount += 1
      return resultWithCandidate
    },
    { wait: async () => undefined },
  )

  assert.equal(callCount, 1)
  assert.equal(result.candidatesByRowId[row.id]?.[0]?.resolvedCode, '005930')
})
