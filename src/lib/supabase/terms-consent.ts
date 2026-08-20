import { TERMS_VERSION } from '@/lib/terms'

// 가입 동의 시점 검증·정규화. 클라이언트에서 보낸 값(로그인 화면 체크박스 시점)을
// 서버 동의 기록(profiles.terms_accepted_at)으로 신뢰하기 전에 통과해야 한다.
// - ISO 8601 로 파싱 가능해야 하고
// - 미래(5분 허용 오차)이거나 7일보다 오래된 값은 버린다.
export function parseTermsConsentAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return null
  const now = Date.now()
  const fiveMinutes = 5 * 60 * 1000
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  if (ts > now + fiveMinutes || ts < now - sevenDays) return null
  return new Date(ts).toISOString()
}

// profiles 에 남길 동의 기록 행(values). upsert 용도라 terms 컬럼만 담는다.
export function termsConsentRow(consentAt: string) {
  return { terms_accepted_at: consentAt, terms_version: TERMS_VERSION }
}
