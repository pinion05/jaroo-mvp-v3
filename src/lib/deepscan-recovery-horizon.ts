// 원금회수 기간별(3개월~3년) 누적 복구확률 칩 모델 — 순수 함수만 담는다(React·CSS import 금지).
// 결과 카드(v4, #362)와 브리핑 카드 원금회수 섹션이 같은 순서·라벨·필터 규칙을 공유한다.
// core RECOVERY_PROBABILITY_HORIZONS와 같은 5버킷을 파싱하되, 2년 이후(3년) 꼬리는 화면에
// 내보내지 않고 마지막 표시 칩을 '2년+' 터미널로 묶는다(2026-11-18 — 2년 넘는 구간의 세부는 중요도가 낮다).

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
  /** 화면 문구 — 일반 칩은 '3개월 내', 마지막 칩은 터미널 표기 '2년+'(이 기간 또는 그 이후) */
  text: string
  value: number
}

/** 화면에 내보내지 않는 꼬리 버킷 — 마지막 표시 칩의 '+' 표기가 대신 묶어준다. */
const RECOVERY_HORIZON_TAIL_HIDDEN_KEYS: ReadonlySet<RecoveryHorizonKey> = new Set<RecoveryHorizonKey>(['3y'])

/** 파싱 직후 아직 화면 문구(text)를 붙이기 전의 칩 — value가 null인 버킷을 구분한다. */
type RecoveryHorizonParsedChip = {
  key: RecoveryHorizonKey
  label: string
  value: number | null
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
  const visible = RECOVERY_HORIZON_CHIP_ORDER
    .map(({ key, label }): RecoveryHorizonParsedChip => ({
      key,
      label,
      value: typeof buckets[key] === 'number' ? (buckets[key] as number) : null,
    }))
    .filter((chip): chip is RecoveryHorizonParsedChip & { value: number } => chip.value !== null)
    .filter(({ key }) => !RECOVERY_HORIZON_TAIL_HIDDEN_KEYS.has(key))
  return visible.map((chip, index) => ({
    ...chip,
    text: index === visible.length - 1 ? `${chip.label}+` : `${chip.label} 내`,
  }))
}
