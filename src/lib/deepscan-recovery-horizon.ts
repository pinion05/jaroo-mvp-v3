// 원금회수 기간별(3개월~3년) 누적 복구확률 칩 모델 — 순수 함수만 담는다(React·CSS import 금지).
// 결과 카드(v4, #362)와 브리핑 카드 원금회수 섹션이 같은 순서·라벨·필터 규칙을 공유한다.
// core RECOVERY_PROBABILITY_HORIZONS와 같은 5버킷이며, 실효 horizon 너머(null)는 표시하지 않는다.

export const RECOVERY_HORIZON_CHIP_ORDER = [
  { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' },
  { key: '1y', label: '1년' },
  { key: '2y', label: '2년' },
  { key: '3y', label: '3년' },
] as const

export type RecoveryHorizonKey = (typeof RECOVERY_HORIZON_CHIP_ORDER)[number]['key']

export type RecoveryHorizonChip = {
  key: RecoveryHorizonKey
  label: string
  value: number
}

/**
 * payload 회복 블록(또는 그 일부)에서 표시할 기간별 칩을 뽑는다.
 * 필드가 없는 입력(브리핑 스냅샷 프리뷰·구형 스냅샷)은 빈 배열 → 호출자가 기존 렌더로 폴백한다.
 * 입력은 unknown으로 받아 런타임에서 좁힌다 — 블록 타입(로딩 프리뷰·payload)을 호출자가 신경 쓰지 않게.
 */
export function buildRecoveryHorizonChips(recovery: unknown): RecoveryHorizonChip[] {
  if (!recovery || typeof recovery !== 'object') {
    return []
  }
  const horizonProbabilities = (recovery as { recoveryHorizonProbabilities?: unknown }).recoveryHorizonProbabilities
  if (!horizonProbabilities || typeof horizonProbabilities !== 'object') {
    return []
  }
  const buckets = horizonProbabilities as Record<string, unknown>
  return RECOVERY_HORIZON_CHIP_ORDER
    .map(({ key, label }): RecoveryHorizonChip | { key: RecoveryHorizonKey; label: string; value: null } => ({
      key,
      label,
      value: typeof buckets[key] === 'number' ? (buckets[key] as number) : null,
    }))
    .filter((chip): chip is RecoveryHorizonChip => typeof chip.value === 'number')
}
