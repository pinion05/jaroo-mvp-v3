import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectStockEvents,
  filterEventsForLevel,
  normalizeAlertLevel,
  parsePriceFromText,
  priceChangePctBetween,
  shouldSendWeeklySummary,
} from './levels'
import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

type InsightItem = { sourceLabel: string; label: string; title: string; date: string }

function payloadWith(insights: InsightItem[], currentPriceText: string | null): JarooDeepScanPayload {
  return {
    strategy: { currentPriceText },
    insights: { items: insights },
  } as unknown as JarooDeepScanPayload
}

const 공시 = (title: string): InsightItem => ({ sourceLabel: '공시', label: '공시', title, date: '2026-09-08' })

test('normalizeAlertLevel — 알 수 없는 값은 기본(normal)', () => {
  assert.equal(normalizeAlertLevel('detail'), 'detail')
  assert.equal(normalizeAlertLevel('minimal'), 'minimal')
  assert.equal(normalizeAlertLevel(undefined), 'normal')
  assert.equal(normalizeAlertLevel('super'), 'normal')
})

test('parsePriceFromText — 콤마·원 표기에서 숫자 추출', () => {
  assert.equal(parsePriceFromText('274,250원'), 274250)
  assert.equal(parsePriceFromText(null), null)
  assert.equal(parsePriceFromText('가격 정보 없음'), null)
})

test('어제 대비 신규 공시만 이벤트가 된다', () => {
  const yesterday = payloadWith([공시('기존 공시'), 공시('자본변동 공시')], '274,250원')
  const today = payloadWith([공시('기존 공시'), 공시('자본변동 공시'), 공시('유상증자 결정')], '280,000원')
  const events = detectStockEvents(today, yesterday)
  assert.deepEqual(
    events.map((event) => event.title),
    ['유상증자 결정'],
  )
})

test('상장폐지·거래정지 공시는 안전 하한선 이벤트로 분류된다', () => {
  const today = payloadWith([공시('상장폐지 적합성 심사 대상 지정')], '100원')
  const events = detectStockEvents(today, null)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'safety')
})

test('가격 변화율 — 부호 있는 퍼센트', () => {
  const before = payloadWith([], '200원')
  const after = payloadWith([], '190원')
  assert.equal(priceChangePctBetween(after, before), -5)
})

test('강도 게이트 — minimal은 안전만, normal은 공시 포함, detail은 급등락 추가', () => {
  const events = detectStockEvents(
    payloadWith([공시('유상증자 결정')], '105원'),
    payloadWith([], '100원'),
  )
  // 5% 상승이지만 공시 이벤트가 층1 — 급등락은 detail 전용.
  assert.equal(filterEventsForLevel(events, 'minimal', 5).events.length, 0)
  assert.equal(filterEventsForLevel(events, 'normal', 5).events.length, 1)
  const detail = filterEventsForLevel(events, 'detail', 5).events
  assert.equal(detail.length, 2)
  assert.ok(detail.some((event) => event.kind === 'spike'))
})

test('주간 요약은 minimal이면 보내지 않는다', () => {
  assert.equal(shouldSendWeeklySummary('minimal'), false)
  assert.equal(shouldSendWeeklySummary('normal'), true)
  assert.equal(shouldSendWeeklySummary('detail'), true)
})
