// 딥스캔 실행 의도 표식(원샷) — "유료 실행은 명시적 사용자 액션 뒤에만" 계약의
// 클라이언트 장치(2026-11-09 운영 블랙박스 실측 §5-A/B, docs/tc PR #351).
//
// 문제의 원인: /deepscan 방문 자체가 하이드레이션 복원 타깃으로 자동 실행을
// 발사했고, 스냅샷이 없으면(또는 24h TTL 경과) 서버가 유료 파이프라인을 돌려
// 크레딧을 차감했다. 페이지 "방문"과 사용자의 "분석 클릭"을 구분할 장치가 없었다.
//
// 계약: 홈 종목카드 "딥스캔 분석"처럼 유료 실행을 의미하는 클릭만 이 표식을
// 남기고, /deepscan 마운트는 표식이 신선할 때만 자동 실행을 허용한다.
// 표식이 없는 방문(재방문·기록 열람·직접 URL)은 읽기 전용(cacheOnly) 조회로
// 저장된 결과만 열람한다 — 스냅샷 미스는 과금 없이 snapshot-miss로 응답된다.

export const DEEPSCAN_RUN_INTENT_STORAGE_KEY = 'jaroo:deepscan-run-intent'

/** 클릭→페이지 마운트 손실 시간(직접 내비게이션은 1초 이내). 재방문과 구분하는 상한 */
export const DEEPSCAN_RUN_INTENT_MAX_AGE_MS = 30_000

function readIntentTimestamp(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(DEEPSCAN_RUN_INTENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

/** 명시적 실행 클릭 표식 — 홈 종목카드 → "딥스캔 분석" 핸드오프에서만 호출한다. */
export function markDeepScanRunIntent(nowMs: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.sessionStorage.setItem(DEEPSCAN_RUN_INTENT_STORAGE_KEY, String(nowMs))
    return true
  } catch {
    return false
  }
}

/** 표식이 신선한가(=이 방문이 명시적 클릭에서 이어졌는가). 읽기만 하고 지우지 않는다. */
export function readDeepScanRunIntent(
  nowMs: number = Date.now(),
  maxAgeMs: number = DEEPSCAN_RUN_INTENT_MAX_AGE_MS,
): boolean {
  const markedAt = readIntentTimestamp()
  if (markedAt == null) return false
  return nowMs - markedAt >= 0 && nowMs - markedAt <= maxAgeMs
}

/** 표식 소멸 — 자동 실행이 발사됐거나(원샷), 기록 열람 등 다른 의도로 대체됐을 때. */
export function clearDeepScanRunIntent(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(DEEPSCAN_RUN_INTENT_STORAGE_KEY)
  } catch {
    // 세션 저장소 접근 불가(쿼타 등)는 무시한다 — 표식은 어차피 시간 만료된다.
  }
}
