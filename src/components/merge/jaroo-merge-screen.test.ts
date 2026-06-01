import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MergeResultRowCard } from './jaroo-merge-screen'
import { buildAppliedHomePortfolioRowsFromConfirmedHoldings, buildMergeRowsFromReviewRows, prepareMergeRowsForApply } from '@/lib/ocr-portfolio-apply'
import type { OcrReviewRow } from '@/lib/workflow-types'

function createReviewRow(overrides: Partial<OcrReviewRow> = {}): OcrReviewRow {
  return {
    id: overrides.id ?? 'review-1',
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: ' ',
    resolvedName: '삼성전자',
    resolvedCode: '005930',
    resolvedTicker: '005930.KS',
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    resolutionState: 'resolved',
    selectedCandidateId: 'candidate-1',
    sourceFileName: 'holding-1.png',
    ...overrides,
  }
}

test('prepareMergeRowsForApply는 averagePrice가 비어 있으면 apply 직전에 1회 보강한다', () => {
  const rows = [{
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: ' ',
  }]

  const preparedRows = prepareMergeRowsForApply(rows)

  assert.notStrictEqual(preparedRows, rows)
  assert.equal(preparedRows[0]?.averagePrice, '100,000')
  assert.equal(rows[0]?.averagePrice, ' ')
})

test('prepareMergeRowsForApply는 dash/N-A placeholder averagePrice도 apply 직전에 1회 보강한다', () => {
  const dashRows = [{
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: '-',
  }]
  const naRows = [{
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: 'N/A',
  }]

  assert.equal(prepareMergeRowsForApply(dashRows)[0]?.averagePrice, '100,000')
  assert.equal(prepareMergeRowsForApply(naRows)[0]?.averagePrice, '100,000')
})

test('prepareMergeRowsForApply는 기존 averagePrice가 있으면 그대로 유지한다', () => {
  const rows = [{
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: '88,000원',
  }]

  const preparedRows = prepareMergeRowsForApply(rows)

  assert.equal(preparedRows[0]?.averagePrice, '88,000원')
})

test('buildMergeRowsFromReviewRows는 정규화할 수 없는 행을 error row로 남긴다', () => {
  const [errorRow] = buildMergeRowsFromReviewRows([
    createReviewRow({
      averagePrice: '',
      quantity: '',
      evaluationAmount: '',
      profitRate: '',
    }),
  ])

  assert.equal(errorRow?.status, 'error')
  assert.equal(errorRow?.errorCode, 'merge-normalization-failed')
})

test('buildAppliedHomePortfolioRowsFromConfirmedHoldings는 홈 호환 payload로 변환한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow()])
  const [appliedRow] = buildAppliedHomePortfolioRowsFromConfirmedHoldings([mergeRow])

  assert.equal(appliedRow?.name, '삼성전자')
  assert.equal(appliedRow?.resolvedCode, '005930')
  assert.equal(appliedRow?.resolvedTicker, '005930.KS')
  assert.equal(appliedRow?.averagePriceCurrency, 'KRW')
})

test('MergeResultRowCard는 수익률 값을 한 번만 렌더링한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow()])
  const markup = renderToStaticMarkup(createElement(MergeResultRowCard, { row: mergeRow, isLast: true }))

  assert.equal(markup.match(/-23\.4%/g)?.length, 1)
})
