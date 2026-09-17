import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ETF_COMMITTEE_RATE_LIMIT_MAX,
  buildEtfCommitteeUpstreamUrl,
  isEtfCommitteeRateLimited,
  isValidEtfCommitteeCode,
} from './route'
import { buildEtfCommitteeStatusUpstreamUrl } from '../committee-status/route'

// 순수 계약 — 상류 프록시 IO는 라우트 통합 영역이라 여기서 다루지 않는다.

test('isValidEtfCommitteeCode accepts 6-digit KR codes only', () => {
  assert.equal(isValidEtfCommitteeCode('069500'), true)
  assert.equal(isValidEtfCommitteeCode('226490'), true)
  assert.equal(isValidEtfCommitteeCode('VOO'), false)
  assert.equal(isValidEtfCommitteeCode('00593'), false)
  assert.equal(isValidEtfCommitteeCode(''), false)
  assert.equal(isValidEtfCommitteeCode('069500?x=1'), false)
})

test('buildEtfCommitteeUpstreamUrl targets crawler etf committee route with optional holding and refresh', () => {
  assert.equal(
    buildEtfCommitteeUpstreamUrl('http://127.0.0.1:3040', '069500'),
    'http://127.0.0.1:3040/api/source/deepscan/kr/etf/069500/committee',
  )
  assert.equal(
    buildEtfCommitteeUpstreamUrl('http://127.0.0.1:3040', '069500', { shares: '10', averagePrice: '40000' }),
    'http://127.0.0.1:3040/api/source/deepscan/kr/etf/069500/committee?shares=10&averagePrice=40000',
  )
  assert.equal(
    buildEtfCommitteeUpstreamUrl('http://127.0.0.1:3040', '069500', { refresh: true }),
    'http://127.0.0.1:3040/api/source/deepscan/kr/etf/069500/committee?crawlerCacheBypass=1',
  )
  // 코드는 경로 세그먼트로 인코딩 — 쿼리 주입 여지가 없다
  assert.equal(
    buildEtfCommitteeUpstreamUrl('http://127.0.0.1:3040', '06/95?x'),
    'http://127.0.0.1:3040/api/source/deepscan/kr/etf/06%2F95%3Fx/committee',
  )
})

test('isEtfCommitteeRateLimited allows up to max per window then blocks', () => {
  const key = `test-ip-${Math.random().toString(36).slice(2)}`
  const base = Date.now()
  for (let i = 0; i < ETF_COMMITTEE_RATE_LIMIT_MAX; i += 1) {
    assert.equal(isEtfCommitteeRateLimited(key, base + i), false)
  }
  assert.equal(isEtfCommitteeRateLimited(key, base + ETF_COMMITTEE_RATE_LIMIT_MAX), true)
  assert.equal(isEtfCommitteeRateLimited(key, base + ETF_COMMITTEE_RATE_LIMIT_MAX + 5 * 60_000 + 1), false)
})

test('buildEtfCommitteeStatusUpstreamUrl relays requestId to the shared committee-status route', () => {
  assert.equal(
    buildEtfCommitteeStatusUpstreamUrl('http://127.0.0.1:3040', 'kr-committee-226490-1'),
    'http://127.0.0.1:3040/api/source/deepscan/kr/committee-status?requestId=kr-committee-226490-1',
  )
  assert.equal(
    buildEtfCommitteeStatusUpstreamUrl('http://127.0.0.1:3040', 'id with space&x=1'),
    'http://127.0.0.1:3040/api/source/deepscan/kr/committee-status?requestId=id%20with%20space%26x%3D1',
  )
})
