import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldUseDeepScanLoadingHandoff } from './deepscan-navigation'

test('DeepScan loading handoff includes stock and ETF/ETN targets on the DeepScan route', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'stock' }), true)
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'etf' }), true)
  // ETN 카드는 항상 /deepscan으로 라우팅된다 — 핸드오프도 타야 한다(미탈 시 bare
  // router.push로 세션·스토어가 끊기는 기능 회귀).
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/deepscan', kind: 'etn' }), true)
})

test('DeepScan loading handoff still accepts legacy ETF analysis links', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/etf', kind: 'etf' }), true)
})

test('DeepScan loading handoff does not intercept unsupported routes or missing targets', () => {
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/etf', kind: 'stock' }), false)
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: null, kind: 'stock' }), false)
  // ETN은 /etf 게이트가 거부하는 상품이다 — /etf 액션은 핸드오프하지 않는다.
  assert.equal(shouldUseDeepScanLoadingHandoff({ actionHref: '/etf', kind: 'etn' }), false)
})
