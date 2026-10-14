import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateBriefingShortStreak, type LoadingBriefingDailyRow } from './deepscan-briefing-snapshot'

function rows(closes: number[], changePcts?: number[]): LoadingBriefingDailyRow[] {
  return closes.map((close, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, '0')}`,
    close,
    ...(changePcts?.[index] !== undefined ? { changePct: changePcts[index] } : {}),
  }))
}

test('briefing short streak counts moved days, not row count', () => {
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101])), { direction: 'up', count: 1, previous: null })
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101, 102])), { direction: 'up', count: 2, previous: null })
})

test('briefing short streak respects flat and direction changes', () => {
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101, 101])), { direction: 'flat', count: 0, previous: { direction: 'up', count: 1 } })
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101, 99])), { direction: 'down', count: 1, previous: { direction: 'up', count: 1 } })
})

test('briefing short streak prefers explicit daily change percent when available', () => {
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 100, 100], [0, 2, 3])), { direction: 'up', count: 2, previous: null })
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 100, 100], [0, -2, -3])), { direction: 'down', count: 2, previous: null })
})

test('briefing short streak reports the opposite run before the current one', () => {
  // 내리막(3일) 뒤 오늘 첫 상승 — 반등 맥락 판단의 핵심 입력
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 104, 103, 102, 101, 103])),
    { direction: 'up', count: 1, previous: { direction: 'down', count: 3 } },
  )
  // 오름(2일) 뒤 오늘 첫 하락
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 101, 102, 101])),
    { direction: 'down', count: 1, previous: { direction: 'up', count: 2 } },
  )
})

test('briefing short streak skips flat bars when finding the previous run', () => {
  // 상승 - 보합 - 상승: 직전 구간도 상승(플랫 봉은 구간을 끊지 않고 건너뛴다)
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 102, 102, 103])),
    { direction: 'up', count: 1, previous: { direction: 'up', count: 1 } },
  )
  // 오늘이 보합이면 직전 마지막 방향 구간이 previous로 노출된다
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 102, 101, 100, 100])),
    { direction: 'flat', count: 0, previous: { direction: 'down', count: 2 } },
  )
})
