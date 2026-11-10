import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DeepScanRecoveryForecastCard, readRecoveryForecastForLoss } from './deepscan-recovery-forecast-card'
import type { JarooDeepScanPayload, JarooDeepScanRecoveryForecastBlock } from '../../packages/contracts/src/deepscan'

function baseRecoveryBlock(overrides: Partial<JarooDeepScanRecoveryForecastBlock> = {}): JarooDeepScanRecoveryForecastBlock {
  return {
    blockState: 'ok',
    sourceRefs: [],
    fallback: null,
    error: null,
    statusText: '원금회수 예측',
    summaryText: '평단 ₩28,000 회복까지 약 74일로 추정돼요.',
    expectedRecoveryDaysText: '약 74일',
    recoveryProbabilityText: '61.1%',
    confidenceText: '보통',
    currentPriceText: '₩20,050',
    targetPriceText: '₩28,000',
    drawdownText: '28.4%',
    modelRows: [
      { label: '유사 패턴', recoveryDaysText: '96일', probabilityText: '60.3%', sampleText: '63건' },
      { label: 'GBM', recoveryDaysText: '57일', probabilityText: '58.2%' },
      { label: 'Jump-Diffusion', recoveryDaysText: '60일', probabilityText: '63.9%' },
    ],
    disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
    ...overrides,
  }
}

function payloadWithRecovery(block: JarooDeepScanRecoveryForecastBlock | null): JarooDeepScanPayload {
  const payload = {
    input: { instrument: { name: '코칩', code: '126730', market: 'KR' } },
  } as unknown as JarooDeepScanPayload
  if (block) {
    ;(payload as unknown as Record<string, unknown>).recoveryForecast = block
  }
  return payload
}

test('readRecoveryForecastForLoss returns the block for a loss position (positive drawdown)', () => {
  const block = readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock()))
  assert.ok(block)
  assert.equal(block?.expectedRecoveryDaysText, '약 74일')
})

test('readRecoveryForecastForLoss hides the card for a profit position (non-positive drawdown)', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock({ drawdownText: '-7.1%', summaryText: '현재가가 이미 평단 이상이라 원금회수 목표에 도달한 상태입니다.' }))), null)
})

test('readRecoveryForecastForLoss hides the card at break-even (0% drawdown)', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock({ drawdownText: '0.0%' }))), null)
})

test('readRecoveryForecastForLoss hides the card when the block is blocked', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(baseRecoveryBlock({ blockState: 'blocked' }))), null)
})

test('readRecoveryForecastForLoss hides the card when recoveryForecast is absent', () => {
  assert.equal(readRecoveryForecastForLoss(payloadWithRecovery(null)), null)
})

test('DeepScanRecoveryForecastCard renders the recovery forecast for a loss-making holding', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, { payload: payloadWithRecovery(baseRecoveryBlock()) }))
  assert.match(markup, /원금회수 예측/)
  assert.match(markup, /평단 도달 예상 기간/)
  assert.match(markup, /약 74일/)
  assert.match(markup, /1년 내 도달 비율/)
  assert.match(markup, /61\.1%/)
  assert.match(markup, /신뢰도 보통/)
  assert.doesNotMatch(markup, /예상 회수 기간/)
  assert.match(markup, /유사 패턴/)
  assert.match(markup, /투자 권유/)
  // 수치 원본이 있으면 확률 게이지가 렌더된다.
  assert.match(markup, /width:61\.1%/)
  // priceHistory가 없으면(구형 페이로드) 차트 섹션은 렌더되지 않는다.
  assert.doesNotMatch(markup, /최근 1년 종가와 유사 과거 패턴/)
})

test('DeepScanRecoveryForecastCard renders the 1-year chart with similar-pattern bands when history is present', () => {
  const priceHistory = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    close: 30000 - index * 800,
  }))
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({
      currentPrice: 21200,
      targetPrice: 28000,
      priceHistory,
      similarPatternSamples: [
        { date: '2026-01-04', close: 27600, drawdownPct: 8.1, recoveryDays: 42, recovered: true },
        { date: '2026-01-09', close: 23600, drawdownPct: 21.3, recoveryDays: null, recovered: false },
      ],
    })),
  }))
  assert.match(markup, /최근 1년 종가와 유사 과거 패턴/)
  assert.match(markup, /평단 2\.8만/)
  assert.match(markup, /유사 패턴 · 2026-01-04 · 당시 하락 8% → 약 42일 만에 회복/)
  assert.match(markup, /2026-01-09 · 당시 하락 21% → 1년\(252거래일\) 내 미회복/)
  assert.match(markup, /<title>현재가 ₩20,050<\/title>/)
})

test('DeepScanRecoveryForecastCard renders the 3-year chart label and year-month ticks for a 3-year history', () => {
  // KR 3년치 일봉(780봉) 페이로드 — 라벨·틱이 3년 표기로 전환되는지 확인한다.
  const priceHistory = Array.from({ length: 780 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 7, 14 + index)).toISOString().slice(0, 10),
    close: 30000 - (779 - index) * 10,
  }))
  const firstTickLabel = priceHistory[0]?.date.slice(0, 7).replace('-', '.') ?? ''
  const lastTickLabel = priceHistory[priceHistory.length - 1]?.date.slice(0, 7).replace('-', '.') ?? ''
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({
      currentPrice: 30000,
      targetPrice: 34000,
      priceHistory,
    })),
  }))

  assert.match(markup, /최근 3년 종가와 유사 과거 패턴/)
  assert.match(markup, /최근 3년 종가 차트\. 파란 점선은 평단가/)
  // 틱은 연·월(YYYY.MM) 서식으로 5개 그려진다.
  assert.match(markup, new RegExp(firstTickLabel))
  assert.match(markup, new RegExp(lastTickLabel))
  assert.doesNotMatch(markup, /최근 1년/)
})

test('DeepScanRecoveryForecastCard renders nothing for a profit position', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({ drawdownText: '-7.1%' })),
  }))
  assert.equal(markup, '')
})

test('DeepScanRecoveryForecastCard renders horizon probability chips (3m/6m/1y/2y/3y) when available', () => {
  // KR 3년 계열 — 실효 horizon 780거래일 → 5개 버킷 전부 표시. (#358)
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({
      recoveryProbabilityPct: 56.1,
      recoveryHorizonProbabilities: { '3m': 34.2, '6m': 41.5, '1y': 56.1, '2y': 71.3, '3y': 78.4 },
      recoveryProbabilityHeadlineText: '본전 회복 확률은 3개월 내 34%, 6개월 내 42%, 1년 내 56%, 2년 내 71%, 3년 내 78%입니다',
      summaryText: '세 가지 계산을 종합하면 본전 회복 확률은 3개월 내 34%, 6개월 내 42%, 1년 내 56%, 2년 내 71%, 3년 내 78%입니다. 평균적으로는 약 74거래일에 본전에 도달해요.',
    })),
  }))
  assert.match(markup, /기간별 본전 회복 확률/)
  assert.match(markup, /3개월 내/)
  assert.match(markup, /6개월 내/)
  assert.match(markup, /1년 내/)
  assert.match(markup, /2년 내/)
  assert.match(markup, /3년 내/)
  assert.match(markup, /34%/)
  assert.match(markup, /78%/)
  // 한 문장 헤드라인이 요약 문단에 그대로 노출된다.
  assert.match(markup, /본전 회복 확률은 3개월 내 34%, 6개월 내 42%, 1년 내 56%, 2년 내 71%, 3년 내 78%입니다/)
  // 칩 우선 — 레거시 단일 게이지("1년 내 도달 비율")는 미표시.
  assert.doesNotMatch(markup, /1년 내 도달 비율/)
})

test('DeepScanRecoveryForecastCard renders partial horizon chips (US 1-year horizon) without 2y/3y', () => {
  // US OHLC 계열 — 실효 horizon 252거래일 → 3m/6m/1y만. 2년/3년 칩은 렌더되지 않는다.
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({
      recoveryProbabilityPct: 55.2,
      recoveryHorizonProbabilities: { '3m': 22.0, '6m': 38.4, '1y': 55.2, '2y': null, '3y': null },
    })),
  }))
  assert.match(markup, /기간별 본전 회복 확률/)
  assert.match(markup, /3개월 내/)
  assert.match(markup, /1년 내/)
  assert.doesNotMatch(markup, /2년 내/)
  assert.doesNotMatch(markup, /3년 내/)
  assert.doesNotMatch(markup, /1년 내 도달 비율/)
})

test('DeepScanRecoveryForecastCard falls back to the legacy single-year gauge for old payloads', () => {
  // horizonProbabilities 없는 구형 저장 스냅샷 — 기존 1년 단일 게이지 유지.
  const markup = renderToStaticMarkup(createElement(DeepScanRecoveryForecastCard, {
    payload: payloadWithRecovery(baseRecoveryBlock({ recoveryProbabilityPct: 61.1 })),
  }))
  assert.match(markup, /1년 내 도달 비율/)
  assert.match(markup, /61\.1%/)
  assert.doesNotMatch(markup, /기간별 본전 회복 확률/)
})
