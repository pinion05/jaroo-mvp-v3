import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldUseDeepScanLoadingHandoff } from './deepscan-navigation'

test('DeepScan loading handoff includes stock and legacy ETF/ETN targets on the DeepScan route', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'stock' }), true)
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'etf' }), true)
})

test('DeepScan loading handoff includes ETF/ETN targets on the ETF analysis route', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/etf', kind: 'etf' }), true)
})

test('DeepScan loading handoff does not intercept unsupported routes or missing targets', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/etf', kind: 'stock' }), false)
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: null, kind: 'stock' }), false)
})
