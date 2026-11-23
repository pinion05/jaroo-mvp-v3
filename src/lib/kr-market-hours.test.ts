import test from 'node:test'
import assert from 'node:assert/strict'

import { isKrRegularMarketWindow } from './kr-market-hours'

// KST(UTC+9) 고정 시각 픽스처 — 2026-10-30(금), 10-31(토), 11-01(일), 11-02(월).
// 서버 타임존과 무관하게 판정되는지 검증한다(UTC 표기 → KST 환산 주석).
const KST_FRIDAY_08_02 = new Date('2026-10-29T23:02:00.000Z') // 금 08:02 (장전 롤오버 시간대)
const KST_FRIDAY_08_59 = new Date('2026-10-29T23:59:00.000Z') // 금 08:59
const KST_FRIDAY_09_00 = new Date('2026-10-30T00:00:00.000Z') // 금 09:00 (개장)
const KST_FRIDAY_10_00 = new Date('2026-10-30T01:00:00.000Z') // 금 10:00 (장중)
const KST_FRIDAY_15_29 = new Date('2026-10-30T06:29:00.000Z') // 금 15:29
const KST_FRIDAY_15_30 = new Date('2026-10-30T06:30:00.000Z') // 금 15:30 (동시호가 마감 경계)
const KST_FRIDAY_15_31 = new Date('2026-10-30T06:31:00.000Z') // 금 15:31
const KST_FRIDAY_23_00 = new Date('2026-10-30T14:00:00.000Z') // 금 23:00
const KST_SATURDAY_10_00 = new Date('2026-10-31T01:00:00.000Z') // 토 10:00
const KST_SUNDAY_12_00 = new Date('2026-11-01T03:00:00.000Z') // 일 12:00
const KST_MONDAY_09_00 = new Date('2026-11-02T00:00:00.000Z') // 월 09:00

test('isKrRegularMarketWindow — 평일 09:00~15:30(KST)만 정규장으로 본다', () => {
  // 장전
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_08_02), false)
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_08_59), false)
  // 경계·장중
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_09_00), true)
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_10_00), true)
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_15_29), true)
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_15_30), true)
  // 장 마감 후
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_15_31), false)
  assert.equal(isKrRegularMarketWindow(KST_FRIDAY_23_00), false)
})

test('isKrRegularMarketWindow — 주말은 시각과 무관하게 정규장이 아니다', () => {
  assert.equal(isKrRegularMarketWindow(KST_SATURDAY_10_00), false)
  assert.equal(isKrRegularMarketWindow(KST_SUNDAY_12_00), false)
  // 월요일 개장 시각은 다시 정규장
  assert.equal(isKrRegularMarketWindow(KST_MONDAY_09_00), true)
})
