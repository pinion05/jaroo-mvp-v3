// 포트폴리오 서버 저장 실패 안내.
//
// 적용(/ocr·/merge)은 저장 요청을 기다리지 않고 홈으로 이동한다(2026-10-29 시세 프리페치 설계).
// 그래서 실패를 즉시 보여줄 수 없어, 실패 사실을 세션스토리지에 남기고 창 이벤트로 알린다.
// 홈은 마운트 때 한 번 읽고, 마운트 뒤 늦게 도착한 실패는 이벤트로 받는다.
// 이전에는 console.warn만 남겨 사용자가 "저장 안 됨"을 알 방법이 없었다.
//
// storage는 주입 가능하게 둬서 node:test에서 가짜 저장소로 검증한다.

export const PORTFOLIO_SYNC_NOTICE_STORAGE_KEY = 'jaroo:portfolio-sync-notice'
export const PORTFOLIO_SYNC_NOTICE_EVENT = 'jaroo:portfolio-sync-notice'
export const PORTFOLIO_SYNC_NOTICE_TTL_MS = 10 * 60_000
export const PORTFOLIO_SYNC_FAILURE_MESSAGE =
  '서버에 저장하지 못해서 지금 변경은 이 기기에만 보여요. 네트워크를 확인한 뒤 다시 시도해주세요.'

export type PortfolioSyncNoticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredPortfolioSyncNotice = {
  at?: unknown
  message?: unknown
}

function resolveStorage(storage?: PortfolioSyncNoticeStorage): PortfolioSyncNoticeStorage | null {
  if (storage) {
    return storage
  }
  return typeof window === 'undefined' ? null : window.sessionStorage
}

export function readPortfolioSyncNotice(storage?: PortfolioSyncNoticeStorage, now = Date.now()): string | null {
  const target = resolveStorage(storage)
  if (!target) {
    return null
  }

  try {
    const rawValue = target.getItem(PORTFOLIO_SYNC_NOTICE_STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    let parsedValue: StoredPortfolioSyncNotice | null = null
    try {
      parsedValue = JSON.parse(rawValue) as StoredPortfolioSyncNotice
    } catch {
      parsedValue = null
    }

    const createdAt = typeof parsedValue?.at === 'number' ? parsedValue.at : Number.NaN
    // 깨졌거나 오래된 알림(다른 흐름이 남긴 것)은 홈에 올리지 않고 치운다.
    if (
      typeof parsedValue?.message !== 'string'
      || !parsedValue.message.trim()
      || !Number.isFinite(createdAt)
      || now - createdAt > PORTFOLIO_SYNC_NOTICE_TTL_MS
    ) {
      target.removeItem(PORTFOLIO_SYNC_NOTICE_STORAGE_KEY)
      return null
    }

    return parsedValue.message
  } catch {
    return null
  }
}

export function writePortfolioSyncNotice(
  storage?: PortfolioSyncNoticeStorage,
  message: string = PORTFOLIO_SYNC_FAILURE_MESSAGE,
  now = Date.now(),
): boolean {
  const target = resolveStorage(storage)
  if (!target) {
    return false
  }

  try {
    target.setItem(PORTFOLIO_SYNC_NOTICE_STORAGE_KEY, JSON.stringify({ at: now, message }))
    return true
  } catch {
    // 세션스토리지가 가득 차거나 막혀 있어도 적용 흐름 자체는 막지 않는다.
    return false
  }
}

export function clearPortfolioSyncNotice(storage?: PortfolioSyncNoticeStorage): void {
  const target = resolveStorage(storage)
  if (!target) {
    return
  }

  try {
    target.removeItem(PORTFOLIO_SYNC_NOTICE_STORAGE_KEY)
  } catch {
    // 무시한다 — 다음 조회 때 유효하지 않은 값은 저절로 지워진다.
  }
}

export function notifyPortfolioSyncFailure(message: string = PORTFOLIO_SYNC_FAILURE_MESSAGE): void {
  if (typeof window === 'undefined') {
    return
  }

  writePortfolioSyncNotice(window.sessionStorage, message)
  window.dispatchEvent(new Event(PORTFOLIO_SYNC_NOTICE_EVENT))
}
