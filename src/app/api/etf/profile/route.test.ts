import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ETF_PROFILE_RATE_LIMIT_MAX,
  buildEtfProfileCacheBody,
  buildEtfProfileUpstreamUrl,
  isEtfProfileRateLimited,
  isValidEtfProfileCode,
} from './route'
import type { EtfProfileJson } from '@/lib/etf/etf-view-model'

// 재열람 캐시의 순수 계약 — DB·상류 IO는 라우트 통합 영역이라 여기서 다루지 않는다.

const profileFixture: EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1',
  code: '069500',
  name: 'KODEX 200',
  market: 'kospi',
  ok: true,
  quote: { changePct: -1.08 },
  product: {
    issuerName: '삼성자산운용(주)',
    baseIndexName: '코스피 200',
    totalFeePct: 0.15,
    firstSettleDate: '2002-10-11',
    aum: null,
    nav: 105_660.1,
    deviationPct: -0.24,
  },
  returns: null,
  holdings: null,
  daily: [{ date: '2026-09-15', close: 104_275 }],
}

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

test('buildEtfProfileCacheBody annotates a ledger payload with cache.hit marker', () => {
  const body = buildEtfProfileCacheBody(profileFixture, '2026-09-15T14:53:14.250Z')
  assert.ok(body)
  assert.equal(body.ok, true)
  assert.equal(body.cache.hit, true)
  assert.equal(body.cache.scannedAt, '2026-09-15T14:53:14.250Z')
  // payload는 원장 그대로 — 클라이언트가 parseEtfProfileResponse로 그대로 소비한다
  assert.equal(body.data, profileFixture)
})

test('buildEtfProfileCacheBody rejects non-ledger payloads (guard before response)', () => {
  assert.equal(buildEtfProfileCacheBody({ schemaVersion: 'other' }, 't'), null)
  assert.equal(buildEtfProfileCacheBody(null, 't'), null)
  assert.equal(buildEtfProfileCacheBody('jaroo-etf-profile-v1', 't'), null)
})
