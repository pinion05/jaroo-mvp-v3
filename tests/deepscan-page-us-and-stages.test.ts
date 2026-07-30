import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLoadingBriefingSnapshotUrl,
  buildLoadingQuickQuoteUrl,
  buildUsLoadingMarketSnapshot,
  isDeepScanUsTarget,
  normalizeQuoteCurrency,
  selectLoadingQuickQuoteItem,
} from '../src/app/deepscan/deepscan-page-fetchers'

import {
  extractLoadingStageKeysFromCommitteeAxes,
  extractLoadingStageKeysFromCommitteeResults,
  uniqueLoadingStageKeys,
} from '../src/app/deepscan/deepscan-page-stages'

/**
 * The browser regression suite seeds a single KR KOSPI stock, so the US market
 * branches below never execute there. These tests cover that gap.
 */

/* ----------------------------------------------------------------- *
 * US target detection
 * ----------------------------------------------------------------- */

test('US 종목은 marketTone·market 어느 쪽 신호로도 판별한다', () => {
  assert.equal(isDeepScanUsTarget({ ticker: 'NVDA', marketTone: 'nasdaq' }), true)
  assert.equal(isDeepScanUsTarget({ ticker: 'NVDA', market: 'US' }), true)
  assert.equal(isDeepScanUsTarget({ ticker: 'NVDA', market: 'nasdaq' }), true)
})

test('ticker가 없거나 국내 종목이면 US로 보지 않는다', () => {
  assert.equal(isDeepScanUsTarget({ market: 'US' }), false)
  assert.equal(isDeepScanUsTarget({ ticker: '   ', market: 'US' }), false)
  assert.equal(isDeepScanUsTarget({ ticker: '005930', marketTone: 'kospi' }), false)
  assert.equal(isDeepScanUsTarget(null), false)
})

/* ----------------------------------------------------------------- *
 * Quote / briefing URLs: KR code takes precedence over US ticker
 * ----------------------------------------------------------------- */

test('KR 코드가 있으면 코드 기준으로 시세 URL을 만든다', () => {
  const url = buildLoadingQuickQuoteUrl({ code: '005930', ticker: 'SSNLF' })

  assert.match(url ?? '', /codes=005930/u)
  assert.match(url ?? '', /includeContext=1/u)
  assert.doesNotMatch(url ?? '', /tickers=/u)
})

test('코드가 없으면 ticker 기준으로 시세 URL을 만든다', () => {
  const url = buildLoadingQuickQuoteUrl({ ticker: 'nvda' })

  assert.match(url ?? '', /tickers=NVDA/u)
  assert.doesNotMatch(url ?? '', /includeContext/u)
})

test('식별자가 전혀 없으면 시세 URL을 만들지 않는다', () => {
  assert.equal(buildLoadingQuickQuoteUrl(null), undefined)
  assert.equal(buildLoadingQuickQuoteUrl({}), undefined)
})

test('US 종목만 ticker 기반 브리핑 스냅샷 URL을 받는다', () => {
  assert.match(
    buildLoadingBriefingSnapshotUrl({ ticker: 'NVDA', marketTone: 'nasdaq' }) ?? '',
    /ticker=NVDA&market=US/u,
  )
  // A bare ticker without a US signal must not hit the US branch.
  assert.equal(buildLoadingBriefingSnapshotUrl({ ticker: 'NVDA' }), undefined)
  // KR code wins.
  assert.match(buildLoadingBriefingSnapshotUrl({ code: '005930' }) ?? '', /code=005930/u)
})

/* ----------------------------------------------------------------- *
 * US market indicators
 * ----------------------------------------------------------------- */

test('US 지표는 close를 우선하고 없으면 value를 쓴다', () => {
  const snapshot = buildUsLoadingMarketSnapshot(
    {
      ok: true,
      data: {
        // Both fields present: `close` must win. Without this the precedence
        // could be swapped without any test noticing.
        sp500: { close: 5_600, value: 9_999, changePct: 1.2, timestamp: '2026-07-30T00:00:00Z' },
        nasdaq: { value: 18_000, changePct: -0.4, timestamp: 1_785_000_000_000 },
        vix: { close: 14.2, changePct: null, timestamp: null },
      },
    },
    'target-key',
  )

  assert.equal(snapshot?.targetKey, 'target-key')
  assert.equal(snapshot?.market?.sp500?.value, 5_600)
  assert.equal(snapshot?.market?.nasdaq?.value, 18_000)
  assert.equal(snapshot?.market?.vix?.value, 14.2)
  // A null changePct must stay null rather than becoming 0.
  assert.equal(snapshot?.market?.vix?.changePct, null)
  // Numeric timestamps are normalised into ISO strings.
  assert.match(snapshot?.market?.nasdaq?.asOf ?? '', /^\d{4}-\d{2}-\d{2}T/u)
})

test('US 지표가 전부 비어 있으면 스냅샷을 만들지 않는다', () => {
  assert.equal(buildUsLoadingMarketSnapshot({ ok: true, data: {} }, 'k'), null)
  assert.equal(buildUsLoadingMarketSnapshot({ ok: false, data: null }, 'k'), null)
  assert.equal(
    buildUsLoadingMarketSnapshot({ ok: true, data: { sp500: null, nasdaq: null, vix: null } }, 'k'),
    null,
  )
})

test('ok=false면 데이터가 실려 있어도 스냅샷을 만들지 않는다', () => {
  // Guards against dropping the `ok` check: a failed upstream response can
  // still carry a stale/partial payload, which must not be rendered.
  assert.equal(
    buildUsLoadingMarketSnapshot(
      { ok: false, data: { sp500: { close: 100, changePct: 1, timestamp: null } } },
      'k',
    ),
    null,
  )
})

/* ----------------------------------------------------------------- *
 * Quote item selection
 * ----------------------------------------------------------------- */

test('시세 응답에서 코드 일치 항목을 우선 선택한다', () => {
  const item = selectLoadingQuickQuoteItem(
    { data: { items: [{ ticker: 'NVDA', price: 1 }, { code: '005930', price: 2 }] } },
    { code: '005930', ticker: 'NVDA' },
  )

  assert.equal(item?.price, 2)
})

test('코드가 없으면 ticker 일치 항목을 선택한다', () => {
  const item = selectLoadingQuickQuoteItem(
    { data: { items: [{ ticker: 'AAPL', price: 1 }, { ticker: 'NVDA', price: 2 }] } },
    { ticker: 'nvda' },
  )

  assert.equal(item?.price, 2)
})

test('일치 항목이 없으면 첫 항목으로 폴백한다', () => {
  const item = selectLoadingQuickQuoteItem(
    { data: { items: [{ ticker: 'AAPL', price: 1 }] } },
    { code: '005930' },
  )

  assert.equal(item?.price, 1)
})

test('통화는 KRW·USD만 허용한다', () => {
  assert.equal(normalizeQuoteCurrency('KRW'), 'KRW')
  assert.equal(normalizeQuoteCurrency('USD'), 'USD')
  assert.equal(normalizeQuoteCurrency('JPY'), undefined)
  assert.equal(normalizeQuoteCurrency(null), undefined)
})

/* ----------------------------------------------------------------- *
 * Committee stage extraction (drives the loading timeline)
 * ----------------------------------------------------------------- */

test('위원 결과 키를 팀 stage로 매핑한다', () => {
  const stages = extractLoadingStageKeysFromCommitteeResults({
    valuation: {},
    momentum: {},
    'portfolio-fit': {},
  })

  assert.deepEqual([...stages].sort(), ['contextTeam', 'fundamentalTeam', 'marketTeam'])
})

test('알 수 없는 위원 키는 stage로 만들지 않는다', () => {
  assert.deepEqual(extractLoadingStageKeysFromCommitteeResults({ unknownMember: {} }), [])
  assert.deepEqual(extractLoadingStageKeysFromCommitteeResults(undefined), [])
})

test('위원 title로도 stage를 매핑한다', () => {
  const stages = extractLoadingStageKeysFromCommitteeAxes([
    { label: 'x', members: [{ title: '밸류에이션', status: 'success' }] },
    { label: 'y', members: [{ title: '가격 위치', status: 'success' }] },
  ] as never)

  assert.deepEqual([...stages].sort(), ['fundamentalTeam', 'marketTeam'])
})

test('stage 키는 중복을 제거하고 순서를 유지한다', () => {
  assert.deepEqual(
    uniqueLoadingStageKeys(['marketTeam', 'fundamentalTeam', 'marketTeam']),
    ['marketTeam', 'fundamentalTeam'],
  )
})
