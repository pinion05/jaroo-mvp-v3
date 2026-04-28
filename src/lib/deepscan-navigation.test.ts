import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldUseDeepScanLoadingHandoff } from './deepscan-navigation'

test('DeepScan loading handoff includes stock and ETF/ETN targets on the DeepScan route', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'stock' }), true)
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'etf' }), true)
})

test('DeepScan loading handoff does not intercept non-DeepScan routes', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/etf', kind: 'etf' }), false)
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: null, kind: 'stock' }), false)
})

