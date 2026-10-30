import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendSubjectJosa,
  buildHaltHoldingFacts,
  buildHaltSeverityHelperText,
  formatHaltFilingDate,
  isHaltedHomeHolding,
  resolveDeepScanHaltVerdict,
  resolveHaltedQuoteVolume,
  resolveHaltMeterColors,
  resolveHaltSeverityDisplay,
  resolveHaltSeverityLevel,
} from './deepscan-halt'

test('isHaltedHomeHolding — cardTone halt만 정지 힌트로 인정한다', () => {
  assert.equal(isHaltedHomeHolding({ cardTone: 'halt' }), true)
  assert.equal(isHaltedHomeHolding({ cardTone: 'profit' }), false)
  assert.equal(isHaltedHomeHolding({ cardTone: 'danger' }), false)
  assert.equal(isHaltedHomeHolding(null), false)
  assert.equal(isHaltedHomeHolding(undefined), false)
})

test('resolveHaltedQuoteVolume — 0은 정지, 양수는 거래 중, 미제공은 null', () => {
  assert.equal(resolveHaltedQuoteVolume(0), true)
  assert.equal(resolveHaltedQuoteVolume(1_234), false)
  assert.equal(resolveHaltedQuoteVolume(null), null)
  assert.equal(resolveHaltedQuoteVolume(undefined), null)
  assert.equal(resolveHaltedQuoteVolume(Number.NaN), null)
})

test('resolveDeepScanHaltVerdict — 퀵시세 거래량이 힌트보다 우선한다(해제 감지)', () => {
  const base = {
    targetKey: 'KR:030350',
    isUsTarget: false,
    instrumentKind: 'stock' as const,
    haltHint: true,
    checkExpired: false,
    // 정규장 중(금 10:00 KST) 고정 — volume 0 폴백 판정이 도는 조건을 고정한다
    now: new Date('2026-10-30T01:00:00.000Z'),
  }

  // 힌트만 있으면 즉시 정지 화면
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: undefined }), 'halted')
  // 거래량 0이면 정지
  assert.equal(resolveDeepScanHaltVerdict({ ...base, haltHint: false, quickQuoteVolume: 0 }), 'halted')
  // 힌트가 있어도 거래량이 살아있으면(해제) 일반 플로우
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 500 }), 'active')
  // 둘 다 없으면 대기, 제한 시간 지나면 fail-open
  assert.equal(resolveDeepScanHaltVerdict({ ...base, haltHint: false, quickQuoteVolume: undefined }), 'pending')
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, haltHint: false, quickQuoteVolume: undefined, checkExpired: true }),
    'active',
  )
})

test('resolveDeepScanHaltVerdict — 권위 필드(tradeHalted)는 시각과 무관하게 즉시 확정한다', () => {
  const base = {
    targetKey: 'KR:263050',
    isUsTarget: false,
    instrumentKind: 'stock' as const,
    haltHint: false,
    checkExpired: false,
    // 장전(금 08:02 KST) — 시간 게이트 밖에서도 권위 필드는 즉시 확정되어야 한다
    now: new Date('2026-10-29T23:02:00.000Z'),
  }

  // 네이버가 정지(HALTED/halt)로 알림 → 장전이라도 즉시 정지
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteTradeHalted: true, quickQuoteVolume: 0 }), 'halted')
  // 네이버가 거래 중(TRADING/tradable)으로 알림 → 장전 volume 0(롤오버 행)과 무관하게 일반 플로우
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteTradeHalted: false, quickQuoteVolume: 0 }), 'active')
  // 정지 힌트가 있어도 권위 필드가 거래 중이면 해제로 판정(정지→해제 전환)
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, haltHint: true, quickQuoteTradeHalted: false, quickQuoteVolume: 0 }),
    'active',
  )
  // 권위 필드만 있고 거래량 미제공이어도 즉시 확정
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteTradeHalted: true, quickQuoteVolume: undefined }), 'halted')
})

test('resolveDeepScanHaltVerdict — 권위 필드 없으면 거래량 0 폴백은 정규장 시간 게이트를 지난다', () => {
  const base = {
    targetKey: 'KR:030350',
    isUsTarget: false,
    instrumentKind: 'stock' as const,
    haltHint: false,
    checkExpired: false,
  }

  // 정규장 중(금 10:00 KST) volume 0 → 기존대로 정지
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 0, now: new Date('2026-10-30T01:00:00.000Z') }),
    'halted',
  )
  // 장전(금 08:02 KST) volume 0(일별 행 롤오버) → 정지 아님, 즉시 일반 플로우
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 0, now: new Date('2026-10-29T23:02:00.000Z') }),
    'active',
  )
  // 주말(토 10:00 KST) volume 0 → 정지 아님
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 0, now: new Date('2026-10-31T01:00:00.000Z') }),
    'active',
  )
  // 정규장 밖 volume 0에 정지 힌트(권위 필드 유래)가 있으면 유지 — 밤/장전에도 실제 정지는 정지
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, haltHint: true, quickQuoteVolume: 0, now: new Date('2026-10-29T23:02:00.000Z') }),
    'halted',
  )
  // 거래량 > 0은 시각과 무관하게 거래 중
  assert.equal(
    resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 500, now: new Date('2026-10-29T23:02:00.000Z') }),
    'active',
  )
})

test('resolveDeepScanHaltVerdict — 대상 없음·미국·KR ETF는 판정 없이 일반 플로우', () => {
  assert.equal(resolveDeepScanHaltVerdict({
    targetKey: null,
    isUsTarget: false,
    instrumentKind: 'stock',
    haltHint: true,
    quickQuoteVolume: 0,
    checkExpired: false,
  }), 'active')

  assert.equal(resolveDeepScanHaltVerdict({
    targetKey: 'US:AAPL',
    isUsTarget: true,
    instrumentKind: 'stock',
    haltHint: false,
    quickQuoteVolume: 0,
    checkExpired: false,
  }), 'active')

  assert.equal(resolveDeepScanHaltVerdict({
    targetKey: 'KR:379800',
    isUsTarget: false,
    instrumentKind: 'etf',
    haltHint: false,
    quickQuoteVolume: 0,
    checkExpired: false,
  }), 'active')
})

test('resolveDeepScanHaltVerdict — ETN은 etf 조기리턴을 타지 않고 거래량 판정 흐름에 들어간다', () => {
  const base = {
    targetKey: 'KR:530092',
    isUsTarget: false,
    instrumentKind: 'etn' as const,
    haltHint: false,
    checkExpired: false,
  }

  // 만기·상환 정지(거래량 0)는 검출된다 — 레거시(kind 'etf')은 skip이었으나
  // kind 'etn'은 주식과 동일한 거래량 판정 흐름으로(의도된 동작 변화)
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 0 }), 'halted')
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: 64_202 }), 'active')
  assert.equal(resolveDeepScanHaltVerdict({ ...base, quickQuoteVolume: undefined }), 'pending')
})

test('appendSubjectJosa — 받침 여부로 은/는을 붙인다', () => {
  assert.equal(appendSubjectJosa('드래곤플라이'), '드래곤플라이는')
  assert.equal(appendSubjectJosa('삼성전자'), '삼성전자는')
  assert.equal(appendSubjectJosa('셀트리온'), '셀트리온은')
  assert.equal(appendSubjectJosa('SFA반도체'), 'SFA반도체는')
  // 한글 음절이 아닌 문자로 끝나면 '은' 디폴트
  assert.equal(appendSubjectJosa('KODEX 200'), 'KODEX 200은')
})

test('심각도 단계 매핑 — critical→4, high→3, medium→2, low→1', () => {
  assert.equal(resolveHaltSeverityLevel('critical'), 4)
  assert.equal(resolveHaltSeverityLevel('high'), 3)
  assert.equal(resolveHaltSeverityLevel('medium'), 2)
  assert.equal(resolveHaltSeverityLevel('low'), 1)
})

test('resolveHaltSeverityDisplay — 4단계 표기와 헬퍼 문구', () => {
  const display = resolveHaltSeverityDisplay(4)
  assert.equal(display.label, '매우 심각')
  assert.equal(display.badge, '위험')
  assert.equal(display.tone, 'danger')
  assert.equal(buildHaltSeverityHelperText(4), '4단계 중 4단계 · 상폐 절차 가능성 구간')
  assert.equal(buildHaltSeverityHelperText(3), '4단계 중 3단계 · 정리매매 전 단계 가능성')
})

test('buildHaltHoldingFacts — 마지막 체결가 기준 손익 계산과 표기', () => {
  const facts = buildHaltHoldingFacts({
    name: '드래곤플라이',
    lastTradedPrice: 973,
    currency: 'KRW',
    quantity: 500,
    averagePrice: 1840,
    averagePriceCurrency: 'KRW',
  })

  assert.equal(facts.lastTradedPriceText, '973원')
  assert.equal(facts.averagePriceText, '1,840원')
  assert.equal(facts.quantityText, '500주')
  assert.equal(facts.evaluationText, '486,500원')
  assert.ok(facts.profitRatePct !== null && facts.profitRatePct < -47 && facts.profitRatePct > -48)
  assert.equal(facts.profitRateText, '-47.1%')
})

test('buildHaltHoldingFacts — 가격·평단이 없으면 폴백 손익률을 쓰고 나머지는 null', () => {
  const facts = buildHaltHoldingFacts({
    name: '테스트',
    lastTradedPrice: null,
    quantity: null,
    averagePrice: null,
    fallbackProfitRatePct: -12.3,
  })

  assert.equal(facts.lastTradedPriceText, null)
  assert.equal(facts.evaluationText, null)
  assert.equal(facts.profitRatePct, -12.3)
  assert.equal(facts.profitRateText, '-12.3%')
})

test('buildHaltHoldingFacts — 플러스 손익에는 부호가 붙는다', () => {
  const facts = buildHaltHoldingFacts({
    name: '테스트',
    lastTradedPrice: 1200,
    quantity: 10,
    averagePrice: 1000,
  })

  assert.equal(facts.profitRateText, '+20.0%')
  assert.equal(facts.evaluationText, '12,000원')
})

test('resolveHaltMeterColors — 단계만큼 채우고 상위 두 칸은 단계색', () => {
  assert.deepEqual(resolveHaltMeterColors(4), ['#97a0ae', '#e5a23d', '#e5484d', '#e5484d'])
  assert.deepEqual(resolveHaltMeterColors(3), ['#97a0ae', '#e5a23d', '#e5a23d'])
  assert.deepEqual(resolveHaltMeterColors(2), ['#97a0ae', '#e5a23d'])
  assert.deepEqual(resolveHaltMeterColors(1), ['#97a0ae'])
})

test('formatHaltFilingDate — YYYY-MM-DD와 YYYYMMDD 모두 MM.DD로 표기', () => {
  assert.equal(formatHaltFilingDate('2026-09-19'), '09.19')
  assert.equal(formatHaltFilingDate('20260814'), '08.14')
  assert.equal(formatHaltFilingDate('2026-09-19T10:00:00+09:00'), '09.19')
  assert.equal(formatHaltFilingDate(null), null)
  assert.equal(formatHaltFilingDate(''), null)
})
