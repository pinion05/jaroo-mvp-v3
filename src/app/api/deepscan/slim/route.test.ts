import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveDeepScanSlimUpstreamPath, resolveKrDeepScanSlimVersion } from './route'

test('KR slim version resolver는 명시적 v1.2 요청만 canonical v1.2로 승격한다', () => {
  assert.equal(resolveKrDeepScanSlimVersion(null), 'v1.1')
  assert.equal(resolveKrDeepScanSlimVersion(''), 'v1.1')
  assert.equal(resolveKrDeepScanSlimVersion('v1.1'), 'v1.1')
  assert.equal(resolveKrDeepScanSlimVersion('1.1'), 'v1.1')
  assert.equal(resolveKrDeepScanSlimVersion('v1.2'), 'v1.2')
  assert.equal(resolveKrDeepScanSlimVersion('1.2'), 'v1.2')
})

test('deepscan slim proxy는 KR summary 기본값을 lightweight kr slim v1.1 path로 유지한다', () => {
  assert.equal(
    resolveDeepScanSlimUpstreamPath(new URLSearchParams('market=KR&code=005930')),
    '/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.1',
  )
})

test('deepscan slim proxy는 KR version=v1.1이면 kr slim v1.1 path를 반환한다', () => {
  assert.equal(
    resolveDeepScanSlimUpstreamPath(new URLSearchParams('market=KR&code=005930&version=v1.1')),
    '/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.1',
  )
})

test('deepscan slim proxy는 KR version=v1.2이면 kr slim v1.2 path를 반환한다', () => {
  assert.equal(
    resolveDeepScanSlimUpstreamPath(new URLSearchParams('market=KR&code=005930&version=v1.2')),
    '/api/major/wisereport-fnguide/kr/companies/005930/slim/v1.2',
  )
})

test('deepscan slim proxy는 US market이면 global slim path를 반환한다', () => {
  assert.equal(
    resolveDeepScanSlimUpstreamPath(new URLSearchParams('market=US&ticker=AAPL')),
    '/api/major/wisereport-global/us/companies/AAPL/slim/v1.1',
  )
})
