import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildConsensusLoadingQuickFact,
  buildTargetPriceStatusQuickFact,
  buildWeek52LoadingQuickFact,
  buildWeek52LoadingQuickFactFromBriefingSnapshot,
  getTargetPriceSubject,
  isExchangeProductMarket,
  isExchangeProductPayload,
  isNoDataToken,
  isTargetPriceFailureText,
  isTargetPriceMissingText,
  parseLoadingConsensusBody,
} from '../src/app/deepscan/deepscan-page-loading-facts'

import type { JarooDeepScanPayload } from '../packages/contracts/src/deepscan'

/**
 * These branches are not reachable from the browser regression suite, which
 * seeds a single KR KOSPI stock with healthy upstream data. They cover the
 * ETF, US and degraded-upstream paths instead.
 */

function payloadWith(instrument: { market?: string; kind?: string; name?: string }, targetPriceText = ''): JarooDeepScanPayload {
  return {
    input: {
      instrument: {
        name: instrument.name ?? '테스트종목',
        market: instrument.market ?? 'KOSPI',
        kind: instrument.kind ?? 'stock',
      },
    },
    strategy: { targetPriceText },
    insights: { items: [] },
  } as unknown as JarooDeepScanPayload
}

/* ----------------------------------------------------------------- *
 * Target price: "조회 실패" must stay distinct from "미제공"
 * ----------------------------------------------------------------- */

test('목표가 조회 실패와 미제공을 서로 다른 상태로 분류한다', () => {
  // Upstream fetch broke — we must not claim the stock has no target price.
  assert.equal(isTargetPriceFailureText('목표가 조회 실패'), true)
  assert.equal(isTargetPriceFailureText('수집 실패'), true)
  assert.equal(isTargetPriceFailureText('원천 차단'), true)
  assert.equal(isTargetPriceFailureText('source_unavailable'), true)
  assert.equal(isTargetPriceFailureText('source-unavailable'), true)

  // Analysts genuinely published nothing.
  assert.equal(isTargetPriceMissingText('목표가 미제공'), true)
  assert.equal(isTargetPriceMissingText('데이터가 존재하지 않습니다'), true)
  assert.equal(isTargetPriceMissingText('최근 3개월 이내에 제시된 의견이 없습니다'), true)
  assert.equal(isTargetPriceMissingText('ETF는 목표가 대신 NAV를 봅니다'), true)

  // The two states must not overlap.
  assert.equal(isTargetPriceMissingText('목표가 조회 실패'), false)
  assert.equal(isTargetPriceFailureText('목표가 미제공'), false)
})

test('조회 실패는 경고 톤과 분리 안내를 유지한다', () => {
  const fact = buildTargetPriceStatusQuickFact(payloadWith({}), '목표가 조회 실패')

  assert.equal(fact.key, 'analyst-consensus')
  assert.equal(fact.badge, '조회 실패')
  assert.equal(fact.tone, 'warning')
  assert.match(fact.detail ?? '', /확정하지 않고/u)
})

test('미제공은 경고가 아닌 정보 톤으로 표시한다', () => {
  const fact = buildTargetPriceStatusQuickFact(payloadWith({}), '목표가 미제공')

  assert.equal(fact.badge, '미제공')
  assert.equal(fact.tone, 'info')
  assert.equal(fact.detail, undefined)
})

test('정상 목표가가 있으면 목표가 값을 그대로 노출한다', () => {
  const fact = buildTargetPriceStatusQuickFact(payloadWith({}, '92,000원'))

  assert.equal(fact.badge, '확인 중')
  assert.equal(fact.body, '목표가 92,000원')
})

test('목표가가 N/A면 값으로 취급하지 않고 한국어 안내로 대체한다', () => {
  const fact = buildTargetPriceStatusQuickFact(payloadWith({ name: '삼성전자' }, 'N/A'))

  // 'N/A' must not be promoted into the "목표가 <값>" phrasing.
  assert.doesNotMatch(fact.body, /^목표가 /u)
  assert.equal(fact.badge, '확인 중')
  // The raw English placeholder must never reach the Korean UI.
  assert.doesNotMatch(fact.body, /N\/A/iu)
  assert.equal(fact.body, '삼성전자는 증권사 목표가를 확인하는 중입니다.')
  // Absent data is not an upstream failure, so the tone stays informational.
  assert.equal(fact.tone, 'info')
  assert.equal(fact.detail, undefined)
})

test('데이터 부재 플레이스홀더 변형을 모두 값 없음으로 본다', () => {
  assert.equal(isNoDataToken('N/A'), true)
  assert.equal(isNoDataToken('n/a'), true)
  assert.equal(isNoDataToken(' NA '), true)
  assert.equal(isNoDataToken('-'), true)
  assert.equal(isNoDataToken('—'), true)
  assert.equal(isNoDataToken('null'), true)
  assert.equal(isNoDataToken(undefined), true)

  // Real values must not be swallowed.
  assert.equal(isNoDataToken('92,000원'), false)
  assert.equal(isNoDataToken('목표가 미제공'), false)
  assert.equal(isNoDataToken('-8.2%'), false)
})

/* ----------------------------------------------------------------- *
 * ETF / ETN path
 * ----------------------------------------------------------------- */

test('ETF·ETN 시장 문자열을 상장상품으로 판별한다', () => {
  assert.equal(isExchangeProductMarket('ETF'), true)
  assert.equal(isExchangeProductMarket('KOSPI ETN'), true)
  assert.equal(isExchangeProductMarket('KOSPI'), false)
  assert.equal(isExchangeProductMarket(undefined), false)
})

test('payload kind가 etf면 시장 문자열과 무관하게 상장상품으로 본다', () => {
  assert.equal(isExchangeProductPayload(payloadWith({ market: 'KOSPI', kind: 'etf' })), true)
  assert.equal(isExchangeProductPayload(payloadWith({ market: 'KOSPI', kind: 'stock' })), false)
  // Fallbacks apply when the payload has not arrived yet.
  assert.equal(isExchangeProductPayload(null, 'ETF'), true)
  assert.equal(isExchangeProductPayload(null, 'KOSPI', 'etn'), true)
})

test('ETF는 목표가 대신 NAV·구성 기준으로 안내한다', () => {
  const fact = buildTargetPriceStatusQuickFact(payloadWith({ kind: 'etf', market: 'ETF' }), '목표가 미제공')

  assert.equal(fact.key, 'etf-product-context')
  assert.equal(fact.category, 'ETF 기준')
  assert.equal(fact.badge, 'NAV·구성')
  assert.match(fact.body, /NAV 괴리율/u)
  // ETF must never be flagged as a fetch failure.
  assert.equal(fact.tone, 'info')
})

test('ETF는 컨센서스 항목이 있어도 목표가 문구로 되돌아가지 않는다', () => {
  const fact = buildConsensusLoadingQuickFact(payloadWith({ kind: 'etf', market: 'ETF' }))

  assert.equal(fact?.key, 'etf-product-context')
})

/* ----------------------------------------------------------------- *
 * Korean particle selection (은/는)
 * ----------------------------------------------------------------- */

test('받침 유무에 따라 은·는 조사를 고른다', () => {
  // 삼성전자 → 자 has no 받침 → 는
  assert.equal(getTargetPriceSubject(payloadWith({ name: '삼성전자' })), '삼성전자는')
  // 코칩 → 칩 has 받침 → 은
  assert.equal(getTargetPriceSubject(payloadWith({ name: '코칩' })), '코칩은')
  // Non-Hangul names fall back to 는
  assert.equal(getTargetPriceSubject(payloadWith({ name: 'NVDA' })), 'NVDA는')
  // No name at all
  assert.equal(getTargetPriceSubject(null), '이 종목은')
})

/* ----------------------------------------------------------------- *
 * Consensus parsing: structured fields outrank regex fallback
 * ----------------------------------------------------------------- */

test('구조화 필드가 있으면 본문 정규식보다 우선한다', () => {
  const parsed = parseLoadingConsensusBody(
    '증권사 12곳 평균 목표가 90,000원, 현재가 대비 +10.0%, 투자의견 3.80',
    { targetPrice: 95_000, analystCount: 20, targetGapPct: 25, recommendationScore: 4.5, currency: 'KRW' },
  )

  assert.equal(parsed.targetPriceLabel, '95,000원')
  assert.equal(parsed.analystCountLabel, '증권사 20곳')
  assert.equal(parsed.upsidePct, 25)
  assert.equal(parsed.opinionScore, 4.5)
})

test('구조화 필드가 없으면 본문 정규식으로 복원한다', () => {
  const parsed = parseLoadingConsensusBody(
    '증권사 12곳 평균 목표가 90,000원, 현재가 대비 +10.0%, 투자의견 3.80, 최고 110,000 최저 70,000',
  )

  assert.equal(parsed.analystCountLabel, '증권사 12곳')
  assert.equal(parsed.targetPriceValue, 90_000)
  assert.equal(parsed.upsidePct, 10)
  assert.equal(parsed.highTargetValue, 110_000)
  assert.equal(parsed.lowTargetValue, 70_000)
  // Current price is back-derived from target and upside.
  assert.ok(parsed.currentPriceValue !== undefined)
  assert.ok(Math.abs(parsed.currentPriceValue - 81_818) < 2)
})

test('USD 표기 목표가는 달러 통화로 포맷한다', () => {
  const parsed = parseLoadingConsensusBody('평균 목표가 210.50 USD')

  assert.match(parsed.targetPriceLabel ?? '', /달러$/u)
})

/* ----------------------------------------------------------------- *
 * 52-week position: live quote vs briefing-snapshot fallback
 * ----------------------------------------------------------------- */

test('52주 위치는 최저·최고 대비 위치를 함께 계산한다', () => {
  const fact = buildWeek52LoadingQuickFact({
    targetKey: 'k',
    currentPrice: 150,
    week52High: 200,
    week52Low: 100,
  })

  assert.equal(fact?.key, 'week52-position')
  assert.equal(fact?.indicator?.positionPct, 50)
  assert.match(fact?.body ?? '', /최저 대비 \+50%/u)
  // formatLoadingPercent leaves the ASCII hyphen that Intl.NumberFormat emits.
  assert.match(fact?.body ?? '', /최고 대비 -25%/u)
})

test('52주 고저가가 유효하지 않으면 카드를 만들지 않는다', () => {
  assert.equal(buildWeek52LoadingQuickFact(null), null)
  // high must exceed low
  assert.equal(buildWeek52LoadingQuickFact({ targetKey: 'k', currentPrice: 10, week52High: 5, week52Low: 5 }), null)
  // zero/negative prices are rejected
  assert.equal(buildWeek52LoadingQuickFact({ targetKey: 'k', currentPrice: 0, week52High: 200, week52Low: 100 }), null)
})

test('52주 위치 라벨은 구간별 임계치를 지킨다', () => {
  const labelAt = (currentPrice: number) =>
    buildWeek52LoadingQuickFact({ targetKey: 'k', currentPrice, week52High: 200, week52Low: 100 })?.detail

  // highGapPct >= -10 → 고점 근처. 190/200 = -5%
  assert.equal(labelAt(190), '고점 근처예요')
  // lowGapPct <= 20 → 바닥권. 115/100 = +15%
  assert.equal(labelAt(115), '바닥권 근처예요')
  // lowGapPct <= 50 → 중하단. 140/100 = +40%
  assert.equal(labelAt(140), '중하단 구간이에요')
  // 그 위 구간은 위 셋과 달라야 한다. 175/100 = +75%, 175/200 = -12.5%
  const upper = labelAt(175)
  assert.ok(upper && !['고점 근처예요', '바닥권 근처예요', '중하단 구간이에요'].includes(upper))
})

test('실시간 시세가 없으면 브리핑 스냅샷 일봉으로 52주 위치를 복원한다', () => {
  const fact = buildWeek52LoadingQuickFactFromBriefingSnapshot({
    asOf: '2026-07-30',
    daily: [
      { date: '2026-05-01', close: 100, high: 105, low: 95 },
      { date: '2026-06-01', close: 180, high: 200, low: 170 },
      { date: '2026-07-01', close: 150, high: 155, low: 145 },
    ],
  } as never)

  assert.equal(fact?.key, 'week52-position')
  // high=200 (from the 2026-06 row), low=95 (from the 2026-05 row)
  assert.match(fact?.indicator?.rightLabel ?? '', /200/u)
  assert.match(fact?.indicator?.leftLabel ?? '', /95/u)
})

test('브리핑 스냅샷 일봉이 없으면 52주 카드를 만들지 않는다', () => {
  assert.equal(buildWeek52LoadingQuickFactFromBriefingSnapshot(null), null)
  assert.equal(buildWeek52LoadingQuickFactFromBriefingSnapshot({ daily: [] } as never), null)
})
