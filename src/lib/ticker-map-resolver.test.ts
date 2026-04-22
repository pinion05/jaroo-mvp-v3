import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resetTickerMapResolverCacheForTests, searchTickerMapCandidates } from './ticker-map-resolver'

const fixtureRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/ticker-map')
const mutableProcessEnv = process.env as Record<string, string | undefined>

function restoreEnvValue(key: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete mutableProcessEnv[key]
    return
  }

  mutableProcessEnv[key] = value
}

test('ticker-map fuzzy search는 fixture repo root에서 후보를 반환한다', async () => {
  const previousRepoRoot = process.env.TICKER_MAP_REPO_ROOT
  const previousNodeEnv = process.env.NODE_ENV

  mutableProcessEnv.TICKER_MAP_REPO_ROOT = fixtureRepoRoot
  delete mutableProcessEnv.NODE_ENV
  resetTickerMapResolverCacheForTests()

  try {
    const candidates = await searchTickerMapCandidates('마이크로소프트', 5)

    assert.ok(candidates.length >= 1)
    assert.equal(candidates[0]?.ticker, 'MSFT')
    assert.match(candidates[0]?.canonicalEn ?? '', /Microsoft/i)
  } finally {
    restoreEnvValue('TICKER_MAP_REPO_ROOT', previousRepoRoot)
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    resetTickerMapResolverCacheForTests()
  }
})

test('production에서는 명시적 repo root 없이 fallback discovery를 사용하지 않는다', async () => {
  const previousRepoRoot = process.env.TICKER_MAP_REPO_ROOT
  const previousNodeEnv = process.env.NODE_ENV

  delete mutableProcessEnv.TICKER_MAP_REPO_ROOT
  mutableProcessEnv.NODE_ENV = 'production'
  resetTickerMapResolverCacheForTests()

  try {
    const candidates = await searchTickerMapCandidates('마이크로소프트', 5)

    assert.deepEqual(candidates, [])
  } finally {
    restoreEnvValue('TICKER_MAP_REPO_ROOT', previousRepoRoot)
    restoreEnvValue('NODE_ENV', previousNodeEnv)
    resetTickerMapResolverCacheForTests()
  }
})
