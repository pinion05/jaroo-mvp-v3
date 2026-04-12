import test from 'node:test'
import assert from 'node:assert/strict'

import { searchTickerMapCandidates } from './ticker-map-resolver'

test('ticker-map fuzzy search는 기본 로컬 repo fallback으로 후보를 반환한다', async () => {
  delete process.env.TICKER_MAP_REPO_ROOT

  const candidates = await searchTickerMapCandidates('마이크로소프트', 5)

  assert.ok(candidates.length >= 1)
  assert.equal(candidates[0]?.ticker, 'MSFT')
  assert.match(candidates[0]?.canonicalEn ?? '', /Microsoft/i)
})
