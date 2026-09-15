import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ETF_PROFILE_RATE_LIMIT_MAX,
  buildEtfProfileUpstreamUrl,
  isEtfProfileRateLimited,
  isValidEtfProfileCode,
} from './route'

test('isValidEtfProfileCode accepts 6-digit KR codes only', () => {
  assert.equal(isValidEtfProfileCode('069500'), true)
  assert.equal(isValidEtfProfileCode('226490'), true)
  assert.equal(isValidEtfProfileCode('00593'), false)
  assert.equal(isValidEtfProfileCode('0059301'), false)
  assert.equal(isValidEtfProfileCode('SPY'), false)
  assert.equal(isValidEtfProfileCode(''), false)
  assert.equal(isValidEtfProfileCode('005930;drop'), false)
})

test('buildEtfProfileUpstreamUrl targets crawler source route with code path segment', () => {
  assert.equal(
    buildEtfProfileUpstreamUrl('http://127.0.0.1:3040', '069500'),
    'http://127.0.0.1:3040/api/source/naver-wisereport/kr/etf/069500/profile',
  )
})

test('isEtfProfileRateLimited allows up to max per window then blocks', () => {
  const key = `test-ip-${Math.random().toString(36).slice(2)}`
  const base = Date.now()
  for (let i = 0; i < ETF_PROFILE_RATE_LIMIT_MAX; i += 1) {
    assert.equal(isEtfProfileRateLimited(key, base + i), false)
  }
  assert.equal(isEtfProfileRateLimited(key, base + ETF_PROFILE_RATE_LIMIT_MAX), true)
  // 윈도 밖은 다시 허용
  assert.equal(isEtfProfileRateLimited(key, base + ETF_PROFILE_RATE_LIMIT_MAX + 5 * 60_000 + 1), false)
})
