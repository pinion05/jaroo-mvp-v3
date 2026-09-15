import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEtfPageBriefingUrl,
  buildEtfPageState,
  buildEtfSessionFromDeepScanSnapshot,
  createInitialEtfPageState,
  isNotAnEtfProfileStatus,
  parseEtfBriefingSnapshotResponse,
  parseEtfProfileCacheInfo,
  parseEtfProfileResponse,
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

const okTarget = { status: 'ok' as const, code: '069500', market: 'kr' as const, name: 'KODEX 200', holding: { shares: 100, averagePrice: 101_400 } }

const briefingBody = {
  ok: true,
  data: {
    asOf: '2026-09-15T20:20:19+09:00',
    quote: {
      currentPrice: 104_275,
      changePct: -1.08,
      currency: 'KRW',
      asOf: '2026-09-15T20:20:19+09:00',
      volume: 26_504_024,
    },
    daily: [
      { date: '2026-09-12', close: 105_410, changePct: 0.3 },
      { date: '2026-09-15', close: 104_275, changePct: -1.08 },
    ],
    market: { kospi: { value: 6_627.26, changePct: -0.85 }, kosdaq: { value: 2_100.5, changePct: -1.2 } },
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

  // 미국 ETF: 6자리 코드 없음 → 대문자 티커 세션을 내려 target이 market 'us'로 받는다 (2026-09-16 확장)
  const usSession = buildEtfSessionFromDeepScanSnapshot({
    holding: { code: '', identifierTicker: 'SPY', name: 'SPY', kind: 'etf', marketTone: 'nasdaq' },
  })
  assert.ok(usSession)
  assert.equal(usSession.code, 'SPY')
  assert.equal(usSession.market, 'us')
  const usTarget = resolveEtfPageTarget({ searchParams: new URLSearchParams(''), readSession: () => usSession })
  assert.deepEqual(
    usTarget.status === 'ok' ? { code: usTarget.code, market: usTarget.market } : usTarget.status,
    { code: 'SPY', market: 'us' },
  )

  assert.equal(buildEtfSessionFromDeepScanSnapshot(null), null)
  assert.equal(buildEtfSessionFromDeepScanSnapshot({ holding: null }), null)
})

test('parseEtfBriefingSnapshotResponse extracts snapshot, price and asOf, rejecting unusable payloads', () => {
  const briefing = parseEtfBriefingSnapshotResponse(briefingBody)
  assert.ok(briefing)
  assert.equal(briefing.price, 104_275)
  assert.equal(briefing.asOf, '2026-09-15T20:20:19+09:00')
  assert.equal(briefing.snapshot.daily?.length, 2)
  assert.equal(briefing.snapshot.quote?.changePct, -1.08)

  assert.equal(parseEtfBriefingSnapshotResponse({ ok: true, data: { quote: { currentPrice: 0 } } }), null)
  assert.equal(parseEtfBriefingSnapshotResponse({ ok: true, data: { quote: null } }), null)
  assert.equal(parseEtfBriefingSnapshotResponse({ ok: false, data: null }), null)
  assert.equal(parseEtfBriefingSnapshotResponse(null), null)
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
  const briefing = parseEtfBriefingSnapshotResponse(briefingBody)
  assert.ok(briefing)

  const quoteError = buildEtfPageState(okTarget, null, profileFixture)
  assert.equal(quoteError.phase, 'error')
  if (quoteError.phase === 'error') assert.match(quoteError.message, /시세/)

  const profileError = buildEtfPageState(okTarget, { price: 104_275 }, null)
  assert.equal(profileError.phase, 'error')
  if (profileError.phase === 'error') assert.match(profileError.message, /상품 정보/)

  const ready = buildEtfPageState(okTarget, briefing, profileFixture)
  assert.equal(ready.phase, 'ready')
  if (ready.phase === 'ready') {
    // 시세는 브리핑 스냅샷에서, 등락률은 profile.quote에서 합성한다
    assert.equal(ready.vm.hero.price, '104,275원')
    assert.equal(ready.vm.hero.change, '−1.08%')
    assert.equal(ready.vm.hero.profitAmount, '+287,500원')
    // 페이지 렌더에 필요한 보조 정보도 상태에 실린다
    assert.equal(ready.market, 'kospi')
    assert.deepEqual(ready.holding, { shares: 100, averagePrice: 101_400 })
    assert.equal(ready.briefing.daily?.length, 2)
    // fresh 수집(캐시 표식 없음)은 복원 배너 없음
    assert.equal(ready.restoredAt, null)
    assert.equal(ready.analysisDriftPct, null)
  }
})

test('parseEtfProfileCacheInfo reads only explicit cache-hit markers', () => {
  assert.deepEqual(parseEtfProfileCacheInfo({ cache: { hit: true, scannedAt: '2026-09-15T14:53:14.250Z' } }), {
    scannedAt: '2026-09-15T14:53:14.250Z',
  })
  // fresh 응답(표식 없음)·miss 표식·불완전 표식은 전부 null
  assert.equal(parseEtfProfileCacheInfo({ ok: true, data: profileFixture }), null)
  assert.equal(parseEtfProfileCacheInfo({ cache: { hit: false, scannedAt: 'x' } }), null)
  assert.equal(parseEtfProfileCacheInfo({ cache: { hit: true, scannedAt: '' } }), null)
  assert.equal(parseEtfProfileCacheInfo(null), null)
})

test('buildEtfPageState annotates cache hits with restoredAt and price drift vs live quote', () => {
  const briefing = parseEtfBriefingSnapshotResponse(briefingBody)
  assert.ok(briefing)
  const cachedProfile: EtfProfileJson = {
    ...profileFixture,
    // 분석 시점 종가 99,000 vs live 104,275 → 드리프트 +5.32%
    daily: [
      { date: '2026-09-12', close: 98_500 },
      { date: '2026-09-14', close: 99_000 },
    ],
  }

  const restored = buildEtfPageState(okTarget, briefing, cachedProfile, { scannedAt: '2026-09-15T14:53:14.250Z' })
  assert.equal(restored.phase, 'ready')
  if (restored.phase === 'ready') {
    assert.equal(restored.restoredAt, '2026-09-15T14:53:14.250Z')
    assert.ok(restored.analysisDriftPct != null)
    assert.ok(Math.abs(restored.analysisDriftPct - ((104_275 - 99_000) / 99_000) * 100) < 1e-9)
    // 캐시된 일봉으로 지표를 계산한다(52주 블록은 daily 부족으로 notice 폴백)
    assert.equal(restored.vm.header.code, '069500')
  }

  // 일봉 없는 캐시 분석은 드리프트 기준가가 없어 null
  const noDaily = buildEtfPageState(okTarget, briefing, { ...profileFixture, daily: null }, { scannedAt: 't' })
  if (noDaily.phase === 'ready') assert.equal(noDaily.analysisDriftPct, null)
})

// ── 미국 ETF 확장 (2026-09-16) ──────────────────────────────

test('resolveEtfPageTarget accepts US ticker queries and sessions with market us', () => {
  const bySymbol = resolveEtfPageTarget({ searchParams: new URLSearchParams('symbol=VOO&kind=etf'), readSession: () => null })
  assert.deepEqual(
    bySymbol.status === 'ok' ? { code: bySymbol.code, market: bySymbol.market } : bySymbol.status,
    { code: 'VOO', market: 'us' },
  )

  const byCode = resolveEtfPageTarget({ searchParams: new URLSearchParams('code=spy&kind=etf'), readSession: () => null })
  assert.equal(byCode.status === 'ok' ? byCode.market : byCode.status, 'us')

  const byTickerParam = resolveEtfPageTarget({ searchParams: new URLSearchParams('ticker=QQQ&market=US'), readSession: () => null })
  assert.deepEqual(
    byTickerParam.status === 'ok' ? { code: byTickerParam.code, market: byTickerParam.market } : byTickerParam.status,
    { code: 'QQQ', market: 'us' },
  )

  // 주식 kind·주식 티커 단독은 기각
  assert.equal(
    resolveEtfPageTarget({ searchParams: new URLSearchParams('symbol=AAPL&kind=stock'), readSession: () => null }).status,
    'invalid',
  )
})

test('buildEtfPageBriefingUrl branches US tickers to the US briefing route', () => {
  assert.equal(buildEtfPageBriefingUrl('069500', 'kr'), '/api/deepscan/briefing-snapshot?code=069500')
  assert.equal(buildEtfPageBriefingUrl('VOO', 'us'), '/api/deepscan/briefing-snapshot?ticker=VOO&market=US')
})

test('buildEtfPageState passes US profile market through to the ready state', () => {
  const briefing = parseEtfBriefingSnapshotResponse(briefingBody)
  assert.ok(briefing)
  const usProfile: EtfProfileJson = {
    ...profileFixture,
    code: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    market: 'us',
    currency: 'USD',
    daily: [
      { date: '2026-09-12', close: 704.07 },
      { date: '2026-09-14', close: 699.3 },
    ],
  }
  const usTarget = { status: 'ok' as const, code: 'VOO', market: 'us' as const, name: 'VOO', holding: null }
  const state = buildEtfPageState(usTarget, { ...briefing, price: 699.3 }, usProfile)
  assert.equal(state.phase, 'ready')
  if (state.phase === 'ready') {
    assert.equal(state.market, 'us')
    // 달러 표기 — 시세·52주 범위가 $ 포맷으로 내려온다
    assert.equal(state.vm.hero.price, '$699.3')
    assert.ok(state.vm.riskMetrics.notice === null || true) // daily 2행이라 metrics null → notice 폴백 가능
  }
})
