import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveHoldingInstrument, searchHoldingInstrumentCandidates } from './holding-instrument-lookup'

test('단일 문자 티커는 standalone query 에서만 exact shortcut 으로 유지한다', () => {
  const resolved = resolveHoldingInstrument('B')

  assert.equal(resolved?.ticker, 'B')
  assert.match(resolved?.name ?? '', /Barrick/i)
})

test('자연어 multi-token query 안의 단일 문자 embedded ticker 는 조기 exact 선택에서 제외한다', () => {
  const resolved = resolveHoldingInstrument('Berkshire Hathaway B')

  assert.equal(resolved?.ticker, 'BRK-B')
  assert.match(resolved?.name ?? '', /Berkshire/i)
})

test('pure ticker exact miss 는 더 짧은 ticker prefix/contains fuzzy 로 붙지 않는다', () => {
  const resolved = resolveHoldingInstrument('BITX')
  const candidates = searchHoldingInstrumentCandidates('BITX', 3)

  assert.equal(resolved, null)
  assert.equal(candidates.length, 0)
})
