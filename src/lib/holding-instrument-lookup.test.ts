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

test('미국 한글 종목명도 공개 별칭으로 티커까지 매핑한다', () => {
  const resolved = resolveHoldingInstrument('팔란티어')

  assert.equal(resolved?.ticker, 'PLTR')
  assert.match(resolved?.name ?? '', /Palantir/i)
})

test('한국어 오타도 벡터 fallback으로 미국 티커까지 매핑한다', () => {
  const palantir = resolveHoldingInstrument('파란티어')
  const broadcom = resolveHoldingInstrument('브로드콤')

  assert.equal(palantir?.ticker, 'PLTR')
  assert.match(palantir?.name ?? '', /Palantir/i)
  assert.equal(broadcom?.ticker, 'AVGO')
  assert.match(broadcom?.name ?? '', /Broadcom/i)
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

test('home 보유종목은 resolve 된 ticker/code를 함께 유지한다', () => {
  const [holding] = buildHomeHoldingsFromOcrRows([
    {
      name: '마이크로소프트',
      quantity: '3주',
      profitRate: '+18.4%',
      evaluationAmount: '$3,450.00',
      averagePrice: '$972.11',
      resolvedName: 'Microsoft Corporation',
      resolvedTicker: 'MSFT',
      resolvedCode: 'US5949181045',
      resolvedMarket: 'NASDAQ',
      resolvedMarketTone: 'nasdaq',
      resolvedKind: 'stock',
    },
  ])

  assert.equal(holding?.name, 'Microsoft Corporation')
  assert.equal(holding?.market, 'NASDAQ')
  assert.equal(holding?.identifierTicker, 'MSFT')
  assert.equal(holding?.identifierCode, 'US5949181045')
  assert.equal(holding?.identifierLabel, 'MSFT · US5949181045')
  assert.match(holding?.metaLine ?? '', /티커 MSFT/)
  assert.match(holding?.metaLine ?? '', /종목코드 US5949181045/)
})
