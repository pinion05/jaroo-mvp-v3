import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregateResolvedOcrReviewRows } from './ocr-review-aggregation'
import type { OcrReviewRow } from './workflow-types'

function row(overrides: Partial<OcrReviewRow>): OcrReviewRow {
  return {
    id: overrides.id ?? 'row-1',
    name: overrides.name ?? '삼성전자',
    quantity: overrides.quantity ?? '10',
    profitAmount: overrides.profitAmount,
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

test('aggregateResolvedOcrReviewRows sums profitAmount and derives exact merged return', () => {
  const [aggregated] = aggregateResolvedOcrReviewRows([
    row({ id: 'a', quantity: '3', evaluationAmount: '181137', profitAmount: '-13263', averagePrice: '64800' }),
    row({ id: 'b', quantity: '7', evaluationAmount: '124491', profitAmount: '-7459', averagePrice: '18850' }),
  ])

  assert.equal(aggregated?.profitAmount, '-20722')
  assert.equal(aggregated?.evaluationAmount, '305,628')
  assert.equal(aggregated?.profitRate, '−6.3%')
})

test('aggregateResolvedOcrReviewRows는 평가금액·손익금액 없이 평단 기반으로 지표를 유도한다', () => {
  const [aggregated] = aggregateResolvedOcrReviewRows([
    row({ id: 'a', quantity: '10', averagePrice: '100', profitRate: '+10%', evaluationAmount: '', profitAmount: undefined }),
    row({ id: 'b', quantity: '30', averagePrice: '200', profitRate: '-5%', evaluationAmount: '', profitAmount: undefined }),
  ])

  // 원금 1,000 + 6,000 = 7,000 · 손익 +100 − 300 = −200 · 평가 6,800 · 가중 수익률 −200/7,000
  assert.equal(aggregated?.quantity, '40')
  assert.equal(aggregated?.averagePrice, '175')
  assert.equal(aggregated?.profitAmount, '-200')
  assert.equal(aggregated?.evaluationAmount, '6,800')
  assert.equal(aggregated?.profitRate, '−2.9%')
})

test('aggregateResolvedOcrReviewRows는 단일 행의 평가금액·손익을 평단에서 유도한다', () => {
  const [aggregated] = aggregateResolvedOcrReviewRows([
    row({ id: 'solo', quantity: '3', averagePrice: '64800', profitRate: '-6.8%', evaluationAmount: '', profitAmount: undefined }),
  ])

  // 원금 194,400 · 평가 194,400×0.932 = 181,180.8 → 181,181 · 손익 −13,219.2
  assert.equal(aggregated?.isAccountMerged, false)
  assert.equal(aggregated?.evaluationAmount, '181,181')
  assert.equal(aggregated?.profitAmount, '-13219.2')
})
