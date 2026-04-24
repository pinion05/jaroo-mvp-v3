import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeOcrProfitRate, parseOcrNumber, sanitizeOcrRows } from './screenshot-ocr'

test('normalizeOcrProfitRate extracts parenthesized brokerage returns with the visible P/L sign', () => {
  assert.equal(normalizeOcrProfitRate('+262,740 (12.7%)'), '+12.7%')
  assert.equal(normalizeOcrProfitRate('-13,263 (6.8%)'), '-6.8%')
  assert.equal(normalizeOcrProfitRate('−5,826 (62.6%)'), '-62.6%')
  assert.equal(normalizeOcrProfitRate('(3.2%)'), '-3.2%')
  assert.equal(normalizeOcrProfitRate('+219.8%'), '+219.8%')
})

test('sanitizeOcrRows preserves the attached Korean brokerage OCR rows and computes average prices', () => {
  const rows = sanitizeOcrRows([
    {
      name: 'KODEX 코스피',
      quantity: '35주',
      profitRate: '+262,740 (12.7%)',
      evaluationAmount: '2,320,500원',
    },
    {
      name: 'SNT에너지',
      quantity: '32주',
      profitRate: '+135,770 (8.6%)',
      evaluationAmount: '1,711,770원',
    },
    {
      name: '한미반도체',
      quantity: '5주',
      profitRate: '+1,003,293 (219.8%)',
      evaluationAmount: '1,459,575원',
    },
    {
      name: '삼영',
      quantity: '85주',
      profitRate: '+240,901 (40.7%)',
      evaluationAmount: '832,183원',
    },
    {
      name: 'SOOP',
      quantity: '3주',
      profitRate: '-13,263 (6.8%)',
      evaluationAmount: '181,137원',
    },
    {
      name: '파미셀',
      quantity: '7주',
      profitRate: '-7,459 (5.6%)',
      evaluationAmount: '124,491원',
    },
    {
      name: '삼성 인버스 코스피 200 선물 ETN',
      quantity: '1주',
      profitRate: '-5,826 (62.6%)',
      evaluationAmount: '3,474원',
    },
  ])

  assert.deepEqual(
    rows.map(({ name, quantity, profitRate, evaluationAmount }) => ({ name, quantity, profitRate, evaluationAmount })),
    [
      { name: 'KODEX 코스피', quantity: '35주', profitRate: '+12.7%', evaluationAmount: '2,320,500원' },
      { name: 'SNT에너지', quantity: '32주', profitRate: '+8.6%', evaluationAmount: '1,711,770원' },
      { name: '한미반도체', quantity: '5주', profitRate: '+219.8%', evaluationAmount: '1,459,575원' },
      { name: '삼영', quantity: '85주', profitRate: '+40.7%', evaluationAmount: '832,183원' },
      { name: 'SOOP', quantity: '3주', profitRate: '-6.8%', evaluationAmount: '181,137원' },
      { name: '파미셀', quantity: '7주', profitRate: '-5.6%', evaluationAmount: '124,491원' },
      { name: '삼성 인버스 코스피 200 선물 ETN', quantity: '1주', profitRate: '-62.6%', evaluationAmount: '3,474원' },
    ],
  )

  assert.equal(rows[0]?.averagePrice, '58,828.7489')
  assert.equal(rows[2]?.averagePrice, '91,280.4878')
  assert.equal(rows[6]?.averagePrice, '9,288.7701')
  assert.equal(parseOcrNumber(rows[4]?.profitRate ?? ''), -6.8)
  assert.equal(parseOcrNumber(rows[6]?.profitRate ?? ''), -62.6)
})
