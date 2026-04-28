import test from 'node:test'
import assert from 'node:assert/strict'

import type { OcrSourceRow } from '@/lib/screenshot-ocr'
import type { OcrReviewRow, ResolveCandidate } from '@/lib/workflow-types'
import {
  applyInstrumentResolutionFailure,
  applyInstrumentResolutionResult,
  applyReviewCandidate,
  getRowsNeedingInstrumentResolution,
  toReviewRow,
} from './ocr-review-resolution'

function createSourceRow(overrides: Partial<OcrSourceRow> = {}): OcrSourceRow {
  return {
    id: 'row-1',
    uploadId: 'upload-1',
    fileName: 'holdings.png',
    uploadIndex: 0,
    rowIndex: 0,
    normalizedName: 'microsoft',
    name: 'Microsoft',
    quantity: '1',
    profitRate: '0%',
    evaluationAmount: '$100',
    averagePrice: '$100',
    ...overrides,
  }
}

function createCandidate(overrides: Partial<ResolveCandidate> = {}): ResolveCandidate {
  return {
    id: 'US5949181045::MSFT::microsoft corporation',
    resolvedName: 'Microsoft Corporation',
    resolvedTicker: 'MSFT',
    resolvedCode: 'US5949181045',
    resolvedMarket: 'NASDAQ',
    resolvedMarketTone: 'nasdaq',
    resolvedKind: 'stock',
    source: 'ticker-map',
    score: 0.97,
    ...overrides,
  }
}

test('instrument resolution auto-applies the first candidate into the review row fields', () => {
  const unresolvedRow = toReviewRow(createSourceRow())
  const candidate = createCandidate()
  const [nextRow] = applyInstrumentResolutionResult(
    [unresolvedRow],
    {
      rows: [createSourceRow()],
      candidatesByRowId: { [unresolvedRow.id]: [candidate] },
    },
    {},
  )

  assert.equal(nextRow?.selectedCandidateId, candidate.id)
  assert.equal(nextRow?.resolutionState, 'resolved')
  assert.equal(nextRow?.resolvedName, 'Microsoft Corporation')
  assert.equal(nextRow?.resolvedTicker, 'MSFT')
  assert.equal(nextRow?.resolvedCode, 'US5949181045')
  assert.equal(nextRow?.resolvedMarket, 'NASDAQ')
  assert.equal(nextRow?.resolvedKind, 'stock')
})

test('instrument resolution sends unresolved rows without candidates to the manual path', () => {
  const unresolvedRow = toReviewRow(createSourceRow())
  const [nextRow] = applyInstrumentResolutionResult(
    [unresolvedRow],
    {
      rows: [createSourceRow()],
      candidatesByRowId: { [unresolvedRow.id]: [] },
    },
    {},
  )

  assert.equal(nextRow?.selectedCandidateId, null)
  assert.equal(nextRow?.resolutionState, 'manual-required')
  assert.equal(nextRow?.resolvedTicker, undefined)
})

test('instrument resolution only retries rows that are still unresolved and have no candidate result', () => {
  const unresolvedSourceRow = createSourceRow()
  const unresolvedRow = toReviewRow(unresolvedSourceRow)
  const manualRequiredSourceRow = createSourceRow({ id: 'row-2', name: 'Unknown ETF', normalizedName: 'unknown etf' })
  const manualRequiredRow: OcrReviewRow = {
    ...toReviewRow(manualRequiredSourceRow),
    resolutionState: 'manual-required',
  }
  const candidateKnownSourceRow = createSourceRow({ id: 'row-3', name: 'Apple', normalizedName: 'apple' })
  const candidateKnownRow = toReviewRow(candidateKnownSourceRow)

  const rowsNeedingResolution = getRowsNeedingInstrumentResolution(
    [unresolvedSourceRow, manualRequiredSourceRow, candidateKnownSourceRow],
    [unresolvedRow, manualRequiredRow, candidateKnownRow],
    { [candidateKnownRow.id]: [] },
  )

  assert.deepEqual(rowsNeedingResolution.map((row) => row.id), [unresolvedRow.id])
})

test('instrument resolution failure exposes unresolved rows as manual-required instead of unresolved', () => {
  const unresolvedRow = toReviewRow(createSourceRow())
  const resolvedRow = toReviewRow(createSourceRow({
    id: 'row-2',
    resolvedName: '삼성전자',
    resolvedCode: '005930',
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
  }))

  const nextRows = applyInstrumentResolutionFailure([unresolvedRow, resolvedRow])

  assert.equal(nextRows[0]?.resolutionState, 'manual-required')
  assert.equal(nextRows[1]?.resolutionState, 'resolved')
})

test('candidate application preserves existing row values when candidate is partial', () => {
  const row = toReviewRow(createSourceRow({ resolvedMarket: 'NASDAQ', resolvedKind: 'stock' })) as OcrReviewRow
  const nextRow = applyReviewCandidate(row, createCandidate({ resolvedMarket: undefined, resolvedKind: undefined }))

  assert.equal(nextRow.resolvedTicker, 'MSFT')
  assert.equal(nextRow.resolvedMarket, 'NASDAQ')
  assert.equal(nextRow.resolvedKind, 'stock')
})
