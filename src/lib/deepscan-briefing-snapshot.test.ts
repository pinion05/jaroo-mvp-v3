import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateBriefingShortStreak, type LoadingBriefingDailyRow } from './deepscan-briefing-snapshot'

function rows(closes: number[], changePcts?: (number | null)[]): LoadingBriefingDailyRow[] {
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

test('briefing short streak counts the window-first row in the previous run', () => {
  // 직전 구간이 데이터 첫 행(index 0)까지 이어져도 빠짐없이 센다 — 경계 카운트 결함 회귀 방지
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 101], [-2, 1])),
    { direction: 'up', count: 1, previous: { direction: 'down', count: 1 } },
  )
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 100, 100, 100, 100], [-2, -2, -1.5, -1, 2])),
    { direction: 'up', count: 1, previous: { direction: 'down', count: 4 } },
  )
  // 하락 반대편 미러: 첫 행까지 이어진 직전 상승 구간
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 100, 100, 100, 100], [2, 2, 1.5, 1, -2])),
    { direction: 'down', count: 1, previous: { direction: 'up', count: 4 } },
  )
})

test('briefing short streak keeps previous null when the first row has no changePct', () => {
  // 첫 행의 방향을 알 수 없으면(changePct 결측·보합) '알 수 없음' null을 보존한다
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 100, 103], [null, 0, 3])),
    { direction: 'up', count: 1, previous: null },
  )
})

test('briefing short streak counts the window-first row in the current run too', () => {
  // 전 구간이 한 방향인 짧은 윈도우 — 현재 streak도 첫 행을 포함해 센다
  assert.deepEqual(
    calculateBriefingShortStreak(rows([100, 100, 100], [-2, -2, -2])),
    { direction: 'down', count: 3, previous: null },
  )
})
