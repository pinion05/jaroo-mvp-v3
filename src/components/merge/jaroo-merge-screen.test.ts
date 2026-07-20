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

test('prepareMergeRowsForApply는 평가손익 금액으로 정확한 평단을 보강한다', () => {
  const [prepared] = prepareMergeRowsForApply([{
    name: 'SOOP',
    quantity: '3주',
    profitAmount: '-13,263원',
    profitRate: '6.8%',
    evaluationAmount: '181,137원',
    averagePrice: '',
  }])

  assert.equal(prepared?.averagePrice, '64,800')
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

test('buildAppliedHomePortfolioRowsFromConfirmedHoldings는 원화 평가금액에서 계산한 미국 종목 평단을 KRW로 보존한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([
    createReviewRow({
      name: '바이두(ADR)',
      quantity: '22.729086주',
      profitRate: '+30.2%',
      evaluationAmount: '4,564,930원',
      averagePrice: '154,255.6806',
      resolvedName: 'Baidu, Inc.',
      resolvedTicker: 'BIDU',
      resolvedCode: undefined,
      resolvedMarket: 'US',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    }),
  ])
  const [appliedRow] = buildAppliedHomePortfolioRowsFromConfirmedHoldings([mergeRow])

  assert.equal(mergeRow?.averagePriceCurrency, 'KRW')
  assert.equal(appliedRow?.averagePriceCurrency, 'KRW')
  assert.equal(appliedRow?.averagePrice, '154,255.6806')
  assert.equal(appliedRow?.evaluationAmount, '4,564,930원')
})

test('buildAppliedHomePortfolioRowsFromConfirmedHoldings는 미국 종목의 명시되지 않은 달러 평단을 원화 평가금액만으로 KRW 처리하지 않는다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([
    createReviewRow({
      name: '테슬라',
      quantity: '10주',
      profitRate: '+20.0%',
      evaluationAmount: '4,200,000원',
      averagePrice: '300.50',
      resolvedName: 'Tesla, Inc.',
      resolvedTicker: 'TSLA',
      resolvedCode: undefined,
      resolvedMarket: 'US',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    }),
  ])
  const [appliedRow] = buildAppliedHomePortfolioRowsFromConfirmedHoldings([mergeRow])

  assert.equal(mergeRow?.averagePriceCurrency, undefined)
  assert.equal(appliedRow?.averagePriceCurrency, undefined)
  assert.equal(appliedRow?.averagePrice, '300.50')
})

test('MergeResultRowCard는 수익률 값을 한 번만 렌더링한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow()])
  const markup = renderToStaticMarkup(createElement(MergeResultRowCard, { row: mergeRow, isLast: true }))

  assert.equal(markup.match(/-23\.4%/g)?.length, 1)
  assert.match(markup, /text-\[color:var\(--jaroo-loss\)\]/)
})

test('MergeResultRowCard는 양수 수익률에 국내식 수익 색상을 적용한다', () => {
  const [mergeRow] = buildMergeRowsFromReviewRows([createReviewRow({ profitRate: '+12.3%' })])
  const markup = renderToStaticMarkup(createElement(MergeResultRowCard, { row: mergeRow, isLast: true }))

  assert.match(markup, /text-\[color:var\(--jaroo-profit\)\]/)
})
