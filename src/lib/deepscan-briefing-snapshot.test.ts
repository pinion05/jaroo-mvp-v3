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
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101])), { direction: 'up', count: 1 })
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101, 102])), { direction: 'up', count: 2 })
})

test('briefing short streak respects flat and direction changes', () => {
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101, 101])), { direction: 'flat', count: 0 })
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 101, 99])), { direction: 'down', count: 1 })
})

test('briefing short streak prefers explicit daily change percent when available', () => {
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 100, 100], [0, 2, 3])), { direction: 'up', count: 2 })
  assert.deepEqual(calculateBriefingShortStreak(rows([100, 100, 100], [0, -2, -3])), { direction: 'down', count: 2 })
})
