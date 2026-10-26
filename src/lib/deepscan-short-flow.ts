// 단기 흐름 브리핑 문구 — 연속 상승/하락 스태크와 그 직전 반대 흐름(previous)을 조합해
// '하락하다 오늘 처음 상승' 같은 맥락까지 구분해 문구를 고른다.
import { isFiniteNumber, type LoadingBriefingStreak } from './deepscan-briefing-snapshot'

export type DeepScanShortFlow = {
  label: string
  meaning: string
  tone: 'up' | 'down' | 'neutral'
}

/** 오늘 등락률이 이 범위(%) 이상이면 '큰 폭' 표현을 얹는다. */
const BIG_MOVE_PCT = 3

export function buildDeepScanShortFlow(
  streak: LoadingBriefingStreak,
  todayChangePct?: number | null,
): DeepScanShortFlow {
  const previous = streak.previous
  const bigUp = isFiniteNumber(todayChangePct) && todayChangePct >= BIG_MOVE_PCT
  const bigDown = isFiniteNumber(todayChangePct) && todayChangePct <= -BIG_MOVE_PCT

  if (streak.direction === 'up') {
    if (streak.count >= 5) {
      return { label: `${streak.count}일 연속 상승`, meaning: '단기 상승 흐름이 탄력 있게 이어지고 있어요.', tone: 'up' }
    }
    if (streak.count >= 3) {
      return { label: `${streak.count}일 연속 상승`, meaning: '짧게 봐도 흐름이 살아나고 있어요.', tone: 'up' }
    }
    if (streak.count === 2) {
      if (previous?.direction === 'down') {
        return { label: '2일 연속 상승', meaning: '되받아 올리는 힘이 붙기 시작했어요.', tone: 'up' }
      }
      if (previous?.direction === 'up') {
        return { label: '2일 연속 상승', meaning: '상승 흐름이 숨 고르기를 마치고 다시 이어지고 있어요.', tone: 'up' }
      }
      return { label: '2일 연속 상승', meaning: '가벼운 상승 흐름이 이어지고 있어요.', tone: 'up' }
    }
    // 여기서부터 count === 1 — 직전 흐름이 무엇이었는지가 문구를 가른다.
    if (previous?.direction === 'down') {
      if (previous.count >= 4) {
        return {
          label: '하락 끊고 첫 상승',
          meaning: bigUp
            ? '긴 내리막을 오늘 큰 폭 반등으로 끊었어요. 반등의 시작인지 지켜볼 시점이에요.'
            : '긴 내리막을 오늘 멈췄어요. 반등으로 이어질지 지켜볼 시점이에요.',
          tone: 'up',
        }
      }
      if (previous.count >= 2) {
        return { label: '하락 끊고 첫 상승', meaning: '내리던 흐름이 오늘 되올랐어요. 반등으로 이어질지 확인이 필요해요.', tone: 'up' }
      }
      return { label: '오르내리는 흐름', meaning: '어제 내리고 오늘 오르는 등 방향이 아직 정리되고 있어요.', tone: 'neutral' }
    }
    if (previous?.direction === 'up') {
      return { label: '1일 상승', meaning: '오르던 흐름이 잠시 쉬었다 다시 살아났어요.', tone: 'up' }
    }
    return { label: '1일 상승', meaning: '오늘 상승으로 단기 흐름이 살아났어요.', tone: 'up' }
  }

  if (streak.direction === 'down') {
    if (streak.count >= 5) {
      return { label: `${streak.count}일 연속 하락`, meaning: '단기 조정이 길어지고 있어요. 밑받침 확인이 필요해요.', tone: 'down' }
    }
    if (streak.count >= 3) {
      return { label: `${streak.count}일 연속 하락`, meaning: '단기적으로는 숨 고르기가 이어지고 있어요.', tone: 'down' }
    }
    if (streak.count === 2) {
      if (previous?.direction === 'up') {
        return { label: '2일 연속 하락', meaning: '오르던 흐름이 잠시 눌림을 주고 있어요.', tone: 'down' }
      }
      if (previous?.direction === 'down') {
        return { label: '2일 연속 하락', meaning: '내리막이 잠시 쉬었다 다시 이어지고 있어요.', tone: 'down' }
      }
      return { label: '2일 연속 하락', meaning: '단기 흐름이 아래로 기울고 있어요.', tone: 'down' }
    }
    if (previous?.direction === 'up') {
      if (previous.count >= 4) {
        return {
          label: '상승 중 첫 눌림',
          meaning: bigDown
            ? '가파르게 오른 흐름이 오늘 큰 폭으로 쉬고 있어요.'
            : '길게 오른 흐름이 오늘 처음 쉬고 있어요.',
          tone: 'down',
        }
      }
      if (previous.count >= 2) {
        return { label: '상승 중 첫 눌림', meaning: '오르던 흐름이 오늘 잠시 숨을 고르고 있어요.', tone: 'down' }
      }
      return { label: '오르내리는 흐름', meaning: '어제 오르고 오늘 내리는 등 방향이 아직 정리되고 있어요.', tone: 'neutral' }
    }
    if (previous?.direction === 'down') {
      return { label: '1일 하락', meaning: '내리막이 잠시 쉬었다 다시 이어지고 있어요.', tone: 'down' }
    }
    return { label: '1일 하락', meaning: '단기 흐름이 오늘 아래로 꺾였어요.', tone: 'down' }
  }

  // 오늘이 보합 — 직전에 어떤 흐름이 멈춘 것인지로 문구를 고른다.
  if (previous?.direction === 'up') {
    return { label: '전일과 비슷한 흐름', meaning: '오르던 흐름이 잠시 멈춰 숨을 고르고 있어요.', tone: 'neutral' }
  }
  if (previous?.direction === 'down') {
    return { label: '전일과 비슷한 흐름', meaning: '내리던 흐름이 멈춰 밑받침을 점검하고 있어요.', tone: 'neutral' }
  }
  return { label: '전일과 비슷한 흐름', meaning: '아직 한쪽 방향으로 강하게 기울지는 않았어요.', tone: 'neutral' }
}
