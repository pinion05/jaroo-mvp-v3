import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAppleVisionOcrText } from './apple-vision-ocr'

test('parseAppleVisionOcrText parses English holdings rows', () => {
  const rows = parseAppleVisionOcrText([
    'Name Qty Return Value',
    'Samsung Elec 10 +12.4% 1,234,000',
    'AAPL 5 -3.1% $845.12',
  ].join('\n'))

  assert.deepEqual(rows.map((row) => ({
    name: row.name,
    quantity: row.quantity,
    profitRate: row.profitRate,
    evaluationAmount: row.evaluationAmount,
  })), [
    { name: 'Samsung Elec', quantity: '10', profitRate: '+12.4%', evaluationAmount: '1,234,000' },
    { name: 'AAPL', quantity: '5', profitRate: '-3.1%', evaluationAmount: '$845.12' },
  ])
})

test('parseAppleVisionOcrText parses Korean rows with units', () => {
  const rows = parseAppleVisionOcrText([
    '종목명 수량 수익률 평가금액',
    '삼성전자 10주 +12.4% 1,234,000원',
    '애플 5주 -3.1% $845.12',
  ].join('\n'))

  assert.deepEqual(rows.map((row) => ({
    name: row.name,
    quantity: row.quantity,
    profitRate: row.profitRate,
    evaluationAmount: row.evaluationAmount,
  })), [
    { name: '삼성전자', quantity: '10주', profitRate: '+12.4%', evaluationAmount: '1,234,000원' },
    { name: '애플', quantity: '5주', profitRate: '-3.1%', evaluationAmount: '$845.12' },
  ])
})

test('parseAppleVisionOcrText ignores lines without the required row shape', () => {
  const rows = parseAppleVisionOcrText([
    '총 평가금액 3,000,000원',
    '보유 종목 2개',
    'AAPL 5 -3.1% $845.12',
  ].join('\n'))

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.name, 'AAPL')
})
