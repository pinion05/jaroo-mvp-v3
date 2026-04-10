import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHomeHoldingsFromOcrRows } from './jaroo-home-data'
import {
  enrichOcrRowsWithInstrumentInfo,
  getInstrumentUniverseStats,
  resolveHoldingInstrument,
} from './holding-instrument-lookup'

test('로컬 종목 유니버스가 한국/미국 종목을 충분히 포함한다', () => {
  const stats = getInstrumentUniverseStats()

  assert.ok(stats.krCount > 3000)
  assert.ok(stats.usCount > 10000)
  assert.ok(stats.totalCount > 13000)
})

test('한국 종목명은 fuzzy search로 종목코드까지 매핑한다', () => {
  const resolved = resolveHoldingInstrument('하이닉스')

  assert.equal(resolved?.name, 'SK하이닉스')
  assert.equal(resolved?.code, '000660')
  assert.equal(resolved?.market, 'KOSPI')
})

test('미국 회사명은 semantic search로 티커까지 매핑한다', () => {
  const resolved = resolveHoldingInstrument('Microsoft Corporation')

  assert.equal(resolved?.ticker, 'MSFT')
  assert.match(resolved?.name ?? '', /Microsoft/i)
})

test('OCR row를 하이브리드 검색으로 실제 종목 정보로 enrich 한다', () => {
  const [row] = enrichOcrRowsWithInstrumentInfo([
    {
      name: 'Microsoft Corporation',
      quantity: '3 shares',
      profitRate: '+18.4%',
      evaluationAmount: '$3,450.00',
      averagePrice: '$972.11',
    },
  ])

  assert.equal(row?.resolvedTicker, 'MSFT')
  assert.match(row?.resolvedName ?? '', /Microsoft/i)
})

test('home 보유종목 카드는 enrich 된 종목 식별자를 그대로 노출한다', () => {
  const [holding] = buildHomeHoldingsFromOcrRows([
    {
      name: '하이닉스',
      quantity: '12주',
      profitRate: '-3.2%',
      evaluationAmount: '845,000원',
      averagePrice: '72,000원',
      resolvedName: 'SK하이닉스',
      resolvedCode: '000660',
      resolvedMarket: 'KOSPI',
      resolvedMarketTone: 'kospi',
      resolvedKind: 'stock',
    },
  ])

  assert.equal(holding?.name, 'SK하이닉스')
  assert.equal(holding?.market, 'KOSPI')
  assert.match(holding?.metaLine ?? '', /000660/)
})
