import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldHydrateHomeQuotes } from './home-quote-refresh'

test('shouldHydrateHomeQuotes skips an initial fetch when current query is already loading or loaded', () => {
  for (const quoteStatus of ['loading', 'success'] as const) {
    assert.equal(
      shouldHydrateHomeQuotes({
        quoteSurfaceEnabled: true,
        quoteQuery: 'codes=005930',
        quoteQueryKey: 'codes=005930',
        quoteStatus,
        refreshVersion: 0,
      }),
      false,
    )
  }
})

test('shouldHydrateHomeQuotes allows target changes during initial hydration checks', () => {
  assert.equal(
    shouldHydrateHomeQuotes({
      quoteSurfaceEnabled: true,
      quoteQuery: 'codes=000660',
      quoteQueryKey: 'codes=005930',
      quoteStatus: 'success',
      refreshVersion: 0,
    }),
    true,
  )
})

test('shouldHydrateHomeQuotes treats manual refresh versions as one explicit fetch request', () => {
  assert.equal(
    shouldHydrateHomeQuotes({
      quoteSurfaceEnabled: true,
      quoteQuery: 'codes=005930',
      quoteQueryKey: 'codes=005930',
      quoteStatus: 'success',
      refreshVersion: 1,
    }),
    true,
  )
})

test('JarooHomeScreen quote hydration effect is not retriggered by request-owned status updates', async () => {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const sourceDir = dirname(fileURLToPath(import.meta.url))
  const source = await readFile(join(sourceDir, '../components/home/jaroo-home-screen.tsx'), 'utf8')
  const effectMatch = source.match(/void hydrateQuotes\(\)[\s\S]*?\n  }, \[([^\]]+)\]\)/)

  assert.ok(effectMatch, 'expected to find the quote hydration effect dependency list')
  const deps = effectMatch[1] ?? ''

  assert.doesNotMatch(deps, /\bquoteStatus\b/)
  assert.doesNotMatch(deps, /\bquoteQueryKey\b/)
})
