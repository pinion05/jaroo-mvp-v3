import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveDeepScanSlimUpstreamPath } from './route'

test('deepscan slim proxy는 KR market이면 kr slim path를 반환한다', () => {
  assert.equal(
    resolveDeepScanSlimUpstreamPath(new URLSearchParams('market=KR&code=005930')),
    '/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.1',
  )
})

test('deepscan slim proxy는 US market이면 global slim path를 반환한다', () => {
  assert.equal(
    resolveDeepScanSlimUpstreamPath(new URLSearchParams('market=US&ticker=AAPL')),
    '/api/major/wisereport-global/us/companies/AAPL/slim/v1.1',
  )
})
