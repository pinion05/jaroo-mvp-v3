// 토스페이먼츠 연동 설정 — 개발자센터(https://developers.tosspayments.com/my/api-keys)에서 발급.
// 시크릿 키는 서버 전용이고 NEXT_PUBLIC_* 로 절대 노출하지 않는다.

export function getTossClientKey(): string {
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() || ''
}

export function getTossSecretKey(): string {
  return process.env.TOSS_SECRET_KEY?.trim() || ''
}

/** 서버 사이드 토스 API 호출 가능 여부 (라우트에서 그레이스풀 fallback 판정용) */
export function hasTossServerConfig(): boolean {
  return Boolean(getTossSecretKey())
}

export function assertTossServerConfig(): { secretKey: string } {
  const secretKey = getTossSecretKey()
  if (!secretKey) {
    throw new Error('TOSS_SECRET_KEY is not configured')
  }
  return { secretKey }
}
