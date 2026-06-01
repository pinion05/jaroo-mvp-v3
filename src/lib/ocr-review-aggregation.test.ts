import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregateResolvedOcrReviewRows } from './ocr-review-aggregation'
import type { OcrReviewRow } from './workflow-types'

function row(overrides: Partial<OcrReviewRow>): OcrReviewRow {
  return {
    id: overrides.id ?? 'row-1',
    name: overrides.name ?? '삼성전자',
    quantity: overrides.quantity ?? '10',
    profitRate: overrides.profitRate ?? '0%',
    evaluationAmount: overrides.evaluationAmount ?? '1,000',
    averagePrice: overrides.averagePrice ?? '100',
    resolvedName: overrides.resolvedName ?? '삼성전자',
    resolvedCode: overrides.resolvedCode ?? '005930',
    resolvedTicker: overrides.resolvedTicker ?? '005930.KS',
    resolvedMarket: overrides.resolvedMarket ?? 'KOSPI',
    resolvedMarketTone: overrides.resolvedMarketTone ?? 'kospi',
    resolvedKind: overrides.resolvedKind ?? 'stock',
    resolutionState: overrides.resolutionState ?? 'resolved',
    sourceFileName: overrides.sourceFileName,
    rowIndex: overrides.rowIndex,
  }
}

test('aggregateResolvedOcrReviewRows merges same resolved instrument while preserving source rows', () => {
  const [aggregated] = aggregateResolvedOcrReviewRows([
    row({ id: 'account-a', quantity: '10', evaluationAmount: '1,000', sourceFileName: 'a.png', rowIndex: 0 }),
    row({ id: 'account-b', quantity: '5', evaluationAmount: '500', sourceFileName: 'b.png', rowIndex: 1 }),
  ])

  assert.equal(aggregated?.isAccountMerged, true)
  assert.deepEqual(aggregated?.sourceRowIds, ['account-a', 'account-b'])
  assert.equal(aggregated?.accountDetails.length, 2)
  assert.equal(aggregated?.quantity, '15')
  assert.equal(aggregated?.evaluationAmount, '1,500')
})

test('aggregateResolvedOcrReviewRows uses normalized name fallback when identifiers are missing', () => {
  const rows = aggregateResolvedOcrReviewRows([
    row({ id: 'left', name: '# 삼성 전자', resolvedName: undefined, resolvedCode: undefined, resolvedTicker: undefined }),
    row({ id: 'right', name: '삼성전자', resolvedName: undefined, resolvedCode: undefined, resolvedTicker: undefined }),
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.isAccountMerged, true)
  assert.deepEqual(rows[0]?.sourceRowIds, ['left', 'right'])
})

test('aggregateResolvedOcrReviewRows computes weighted average price from account quantities', () => {
  const [aggregated] = aggregateResolvedOcrReviewRows([
    row({ id: 'cheap', quantity: '10', averagePrice: '100', evaluationAmount: '1,000' }),
    row({ id: 'expensive', quantity: '30', averagePrice: '200', evaluationAmount: '6,000' }),
  ])

  assert.equal(aggregated?.quantity, '40')
  assert.equal(aggregated?.averagePrice, '175')
})
