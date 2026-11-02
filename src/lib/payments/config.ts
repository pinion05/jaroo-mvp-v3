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

/** 결제 파이프라인 완비 여부 — 클라이언트 키·시크릿 키·웹훅 시크릿이 모두 있어야 오픈으로 본다.
 *  클라이언트 키만 env에 남아 있고 웹훅 시크릿이 없으면 결제는 아직 오픈될 수 없다(웹훅 fail-closed).
 *  이 판정이 결제 UI 오픈·무료 크레딧 밸브 폐초의 단일 기준이다. */
export function isPaymentsPipelineConfigured(): boolean {
  return Boolean(getTossClientKey() && getTossSecretKey() && process.env.PAYMENTS_WEBHOOK_SECRET?.trim())
}

export function assertTossServerConfig(): { secretKey: string } {
  const secretKey = getTossSecretKey()
  if (!secretKey) {
    throw new Error('TOSS_SECRET_KEY is not configured')
  }
  return { secretKey }
}
