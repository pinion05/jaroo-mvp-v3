import test from 'node:test'
import assert from 'node:assert/strict'

import { prepareMergeRowsForApply } from './jaroo-merge-screen'

test('prepareMergeRowsForApply는 averagePrice가 비어 있으면 apply 직전에 1회 보강한다', () => {
  const rows = [{
    fileName: 'holding-1.png',
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: ' ',
    resolvedName: '삼성전자',
    resolvedCode: '005930',
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi' as const,
    resolvedKind: 'stock' as const,
  }]

  const preparedRows = prepareMergeRowsForApply(rows)

  assert.notStrictEqual(preparedRows, rows)
  assert.equal(preparedRows[0]?.averagePrice, '100,000')
  assert.equal(rows[0]?.averagePrice, ' ')
})

test('prepareMergeRowsForApply는 dash/N-A placeholder averagePrice도 apply 직전에 1회 보강한다', () => {
  const dashRows = [{
    fileName: 'holding-1.png',
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: '-',
  }]
  const naRows = [{
    fileName: 'holding-2.png',
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
    fileName: 'holding-1.png',
    name: '삼성전자',
    quantity: '10주',
    profitRate: '-23.4%',
    evaluationAmount: '766,000원',
    averagePrice: '88,000원',
  }]

  const preparedRows = prepareMergeRowsForApply(rows)

  assert.equal(preparedRows[0]?.averagePrice, '88,000원')
})
