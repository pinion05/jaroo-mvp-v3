import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDeepScanShortFlow } from './deepscan-short-flow'
import type { LoadingBriefingStreak } from './deepscan-briefing-snapshot'

function streak(direction: 'up' | 'down' | 'flat', count: number, previous?: LoadingBriefingStreak['previous']): LoadingBriefingStreak {
  return { direction, count, previous: previous ?? null }
}

test('short flow: 상승 연속 구간은 흐름 강도로 문구를 고른다', () => {
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 6)), {
    label: '6일 연속 상승',
    meaning: '단기 상승 흐름이 탄력 있게 이어지고 있어요.',
    tone: 'up',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 3)), {
    label: '3일 연속 상승',
    meaning: '짧게 봐도 흐름이 살아나고 있어요.',
    tone: 'up',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 2, { direction: 'down', count: 3 })), {
    label: '2일 연속 상승',
    meaning: '되받아 올리는 힘이 붙기 시작했어요.',
    tone: 'up',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 2, { direction: 'up', count: 2 })), {
    label: '2일 연속 상승',
    meaning: '상승 흐름이 숨 고르기를 마치고 다시 이어지고 있어요.',
    tone: 'up',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 2)), {
    label: '2일 연속 상승',
    meaning: '가벼운 상승 흐름이 이어지고 있어요.',
    tone: 'up',
  })
})

test('short flow: 하락하다 오늘 첫 상승 — 반등 맥락 문구로 바뀐다', () => {
  // 긴 내리막(4일+) 뒤 첫 상승
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 1, { direction: 'down', count: 4 })), {
    label: '하락 끊고 첫 상승',
    meaning: '긴 내리막을 오늘 멈췄어요. 반등으로 이어질지 지켜볼 시점이에요.',
    tone: 'up',
  })
  // 같은 상황에서 오늘 +3% 이상이면 큰 폭 반등 표현
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 1, { direction: 'down', count: 6 }), 4.2), {
    label: '하락 끊고 첫 상승',
    meaning: '긴 내리막을 오늘 큰 폭 반등으로 끊었어요. 반등의 시작인지 지켜볼 시점이에요.',
    tone: 'up',
  })
  // 짧은 내리막(2~3일) 뒤 첫 상승
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 1, { direction: 'down', count: 2 })), {
    label: '하락 끊고 첫 상승',
    meaning: '내리던 흐름이 오늘 되올랐어요. 반등으로 이어질지 확인이 필요해요.',
    tone: 'up',
  })
  // 어제 하락·오늘 상승 지그재그는 방향 정리 중
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 1, { direction: 'down', count: 1 })), {
    label: '오르내리는 흐름',
    meaning: '어제 내리고 오늘 오르는 등 방향이 아직 정리되고 있어요.',
    tone: 'neutral',
  })
})

test('short flow: 상승 1일의 나머지 맥락', () => {
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 1, { direction: 'up', count: 2 })), {
    label: '1일 상승',
    meaning: '오르던 흐름이 잠시 쉬었다 다시 살아났어요.',
    tone: 'up',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('up', 1)), {
    label: '1일 상승',
    meaning: '오늘 상승으로 단기 흐름이 살아났어요.',
    tone: 'up',
  })
})

test('short flow: 하락 연속 구간은 조정 길이로 문구를 고른다', () => {
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 5)), {
    label: '5일 연속 하락',
    meaning: '단기 조정이 길어지고 있어요. 밑받침 확인이 필요해요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 3)), {
    label: '3일 연속 하락',
    meaning: '단기적으로는 숨 고르기가 이어지고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 2, { direction: 'up', count: 3 })), {
    label: '2일 연속 하락',
    meaning: '오르던 흐름이 잠시 눌림을 주고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 2, { direction: 'down', count: 2 })), {
    label: '2일 연속 하락',
    meaning: '내리막이 잠시 쉬었다 다시 이어지고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 2)), {
    label: '2일 연속 하락',
    meaning: '단기 흐름이 아래로 기울고 있어요.',
    tone: 'down',
  })
})

test('short flow: 오르다 오늘 첫 눌림 — 상승 중 첫 눌림 문구', () => {
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 1, { direction: 'up', count: 5 })), {
    label: '상승 중 첫 눌림',
    meaning: '길게 오른 흐름이 오늘 처음 쉬고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 1, { direction: 'up', count: 4 }), -3.5), {
    label: '상승 중 첫 눌림',
    meaning: '가파르게 오른 흐름이 오늘 큰 폭으로 쉬고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 1, { direction: 'up', count: 2 })), {
    label: '상승 중 첫 눌림',
    meaning: '오르던 흐름이 오늘 잠시 숨을 고르고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 1, { direction: 'up', count: 1 })), {
    label: '오르내리는 흐름',
    meaning: '어제 오르고 오늘 내리는 등 방향이 아직 정리되고 있어요.',
    tone: 'neutral',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 1, { direction: 'down', count: 3 })), {
    label: '1일 하락',
    meaning: '내리막이 잠시 쉬었다 다시 이어지고 있어요.',
    tone: 'down',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('down', 1)), {
    label: '1일 하락',
    meaning: '단기 흐름이 오늘 아래로 꺾였어요.',
    tone: 'down',
  })
})

test('short flow: 오늘 보합은 멈춘 직전 흐름으로 문구를 고른다', () => {
  assert.deepEqual(buildDeepScanShortFlow(streak('flat', 0, { direction: 'up', count: 3 })), {
    label: '전일과 비슷한 흐름',
    meaning: '오르던 흐름이 잠시 멈춰 숨을 고르고 있어요.',
    tone: 'neutral',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('flat', 0, { direction: 'down', count: 3 })), {
    label: '전일과 비슷한 흐름',
    meaning: '내리던 흐름이 멈춰 밑받침을 점검하고 있어요.',
    tone: 'neutral',
  })
  assert.deepEqual(buildDeepScanShortFlow(streak('flat', 0)), {
    label: '전일과 비슷한 흐름',
    meaning: '아직 한쪽 방향으로 강하게 기울지는 않았어요.',
    tone: 'neutral',
  })
})
