import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveEtfPageTarget } from './etf-target'

test('query etf target with kospi code is accepted and parses holding', () => {
  const result = resolveEtfPageTarget({
    searchParams: new URLSearchParams('code=069500&name=KODEX%20200&market=kospi&kind=etf&averagePrice=101400&shares=100'),
    readSession: () => null,
  })
  assert.equal(result.status, 'ok')
  if (result.status === 'ok') {
    assert.equal(result.code, '069500')
    assert.equal(result.name, 'KODEX 200')
    assert.deepEqual(result.holding, { shares: 100, averagePrice: 101_400 })
  }
})

test('query etf target without optional holding still resolves', () => {
  const result = resolveEtfPageTarget({
    searchParams: new URLSearchParams('code=069500'),
    readSession: () => null,
  })
  assert.equal(result.status, 'ok')
  if (result.status === 'ok') assert.equal(result.holding, null)
})

test('non-etf kind and us market are rejected', () => {
  assert.equal(
    resolveEtfPageTarget({ searchParams: new URLSearchParams('code=005930&kind=stock'), readSession: () => null }).status,
    'invalid',
  )
  assert.equal(
    resolveEtfPageTarget({ searchParams: new URLSearchParams('ticker=SPY&kind=etf&market=nasdaq'), readSession: () => null })
      .status,
    'invalid',
  )
  assert.equal(
    resolveEtfPageTarget({ searchParams: new URLSearchParams('code=12345&kind=etf'), readSession: () => null }).status,
    'invalid',
  )
})

test('no query falls back to session, otherwise empty', () => {
  const fromSession = resolveEtfPageTarget({
    searchParams: new URLSearchParams(''),
    readSession: () => ({
      code: '069500',
      name: 'KODEX 200',
      market: 'kospi',
      kind: 'etf',
      holding: { shares: 10, averagePrice: 100_000 },
    }),
  })
  assert.equal(fromSession.status, 'ok')
  if (fromSession.status === 'ok') assert.deepEqual(fromSession.holding, { shares: 10, averagePrice: 100_000 })

  assert.equal(resolveEtfPageTarget({ searchParams: new URLSearchParams(''), readSession: () => null }).status, 'empty')

  const stockSession = resolveEtfPageTarget({
    searchParams: new URLSearchParams(''),
    readSession: () => ({ code: '005930', name: '삼성전자', kind: 'stock' }),
  })
  assert.equal(stockSession.status, 'invalid')
})
