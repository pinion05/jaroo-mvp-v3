import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEtfPageState,
  buildEtfSessionFromDeepScanSnapshot,
  createInitialEtfPageState,
  isNotAnEtfProfileStatus,
  parseEtfProfileResponse,
  parseEtfQuoteResponse,
} from './etf-page-model'
import { resolveEtfPageTarget } from '@/lib/etf/etf-target'
import type { EtfProfileJson } from '@/lib/etf/etf-view-model'

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
    aum: 24_418_048_340_212,
    nav: 105_660.1,
    deviationPct: -0.24,
  },
  returns: null,
  holdings: null,
  daily: null,
}

const okTarget = { status: 'ok' as const, code: '069500', name: 'KODEX 200', holding: { shares: 100, averagePrice: 101_400 } }

const quotesBody = {
  ok: true,
  data: {
    items: [
      { market: 'KR', code: '005930', price: 60_000 },
      { market: 'KR', code: '069500', price: 104_275, asOf: '2026-09-15T20:20:19+09:00' },
    ],
  },
}

test('createInitialEtfPageState maps target status to page phases', () => {
  assert.equal(createInitialEtfPageState(okTarget).phase, 'loading')
  assert.equal(createInitialEtfPageState({ status: 'empty' }).phase, 'empty')
  assert.equal(createInitialEtfPageState({ status: 'invalid' }).phase, 'invalid')
})

test('buildEtfSessionFromDeepScanSnapshot adapts display-formatted home holding to etf session', () => {
  const session = buildEtfSessionFromDeepScanSnapshot({
    holding: {
      code: '069500',
      name: 'KODEX 200',
      kind: 'etf',
      market: 'ETF',
      marketTone: 'etf',
      shares: '100주',
      averagePrice: '101,400원',
    },
  })
  assert.ok(session)
  const resolved = resolveEtfPageTarget({ searchParams: new URLSearchParams(''), readSession: () => session })
  assert.equal(resolved.status, 'ok')
  if (resolved.status === 'ok') {
    assert.equal(resolved.code, '069500')
    assert.deepEqual(resolved.holding, { shares: 100, averagePrice: 101_400 })
  }
})

test('buildEtfSessionFromDeepScanSnapshot treats the server placeholder as no session (empty, not invalid)', () => {
  // 세션 미보유 시 resolveDeepScanTargetSession은 id:-1 '종목 미선택' 플레이스홀더를
  // 반환한다 — 이건 '고른 적 없음'이지 '잘못 고름'이 아니므로 null로 내린다.
  const session = buildEtfSessionFromDeepScanSnapshot({
    holding: { id: -1, code: '', name: '종목 미선택', kind: 'stock', shares: '-', averagePrice: '-' },
  })
  assert.equal(session, null)
})

test('buildEtfSessionFromDeepScanSnapshot keeps stock and US ETF sessions for the guard to reject', () => {  const stockSession = buildEtfSessionFromDeepScanSnapshot({
    holding: { code: '005930', name: '삼성전자', kind: 'stock', shares: '10주', averagePrice: '60,000원' },
  })
  assert.ok(stockSession)
  assert.equal(
    resolveEtfPageTarget({ searchParams: new URLSearchParams(''), readSession: () => stockSession }).status,
    'invalid',
  )

  // 미국 ETF: 6자리 코드 없음 → invalid로 판정되도록 빈 코드 세션을 내린다
  const usSession = buildEtfSessionFromDeepScanSnapshot({
    holding: { code: '', identifierTicker: 'SPY', name: 'SPY', kind: 'etf', marketTone: 'nasdaq' },
  })
  assert.ok(usSession)
  assert.equal(usSession.code, '')
  assert.equal(
    resolveEtfPageTarget({ searchParams: new URLSearchParams(''), readSession: () => usSession }).status,
    'invalid',
  )

  assert.equal(buildEtfSessionFromDeepScanSnapshot(null), null)
  assert.equal(buildEtfSessionFromDeepScanSnapshot({ holding: null }), null)
})

test('parseEtfQuoteResponse picks the matching item and rejects unusable payloads', () => {
  assert.deepEqual(parseEtfQuoteResponse(quotesBody, '069500'), {
    price: 104_275,
    asOf: '2026-09-15T20:20:19+09:00',
  })
  assert.equal(parseEtfQuoteResponse(quotesBody, '999999'), null)
  assert.equal(parseEtfQuoteResponse({ ok: true, data: { items: [] } }, '069500'), null)
  assert.equal(parseEtfQuoteResponse({ ok: false }, '069500'), null)
  assert.equal(parseEtfQuoteResponse({ ok: true, data: { items: [{ code: '069500', price: 0 }] } }, '069500'), null)
})

test('parseEtfProfileResponse accepts only the etf profile envelope', () => {
  assert.equal(parseEtfProfileResponse({ ok: true, data: profileFixture }), profileFixture)
  assert.equal(parseEtfProfileResponse({ ok: false, data: null }), null)
  assert.equal(parseEtfProfileResponse({ ok: true, data: { ...profileFixture, schemaVersion: 'other-v1' } }), null)
  assert.equal(parseEtfProfileResponse(null), null)
})

test('isNotAnEtfProfileStatus maps only crawler 400 to the invalid page state', () => {
  // ?code=005930처럼 가드를 통과한 주식 코드는 크롤러가 400(NOT_ETF)으로 판정한다.
  assert.equal(isNotAnEtfProfileStatus(400), true)
  assert.equal(isNotAnEtfProfileStatus(200), false)
  assert.equal(isNotAnEtfProfileStatus(429), false)
  assert.equal(isNotAnEtfProfileStatus(502), false)
})

test('buildEtfPageState distinguishes quote/profile failures and builds ready view model', () => {
  const quoteError = buildEtfPageState(okTarget, null, profileFixture)
  assert.equal(quoteError.phase, 'error')
  if (quoteError.phase === 'error') assert.match(quoteError.message, /시세/)

  const profileError = buildEtfPageState(okTarget, { price: 104_275 }, null)
  assert.equal(profileError.phase, 'error')
  if (profileError.phase === 'error') assert.match(profileError.message, /상품 정보/)

  const ready = buildEtfPageState(okTarget, { price: 104_275, asOf: '2026-09-15T20:20:19+09:00' }, profileFixture)
  assert.equal(ready.phase, 'ready')
  if (ready.phase === 'ready') {
    // 시세는 quotes에서, 등락률은 profile.quote에서 합성한다
    assert.equal(ready.vm.hero.price, '104,275원')
    assert.equal(ready.vm.hero.change, '−1.08%')
    assert.equal(ready.vm.hero.profitAmount, '+287,500원')
  }
})
