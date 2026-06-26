import type { User } from '@supabase/supabase-js'

export const EXISTING_SIGNUP_MESSAGE = '이미 가입된 이메일일 수 있어요. 로그인하거나 비밀번호 재설정을 이용해주세요.'
export const EMAIL_RATE_LIMIT_MESSAGE = '확인 이메일 발송 제한에 걸렸어요. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.'

export function isLikelyExistingSignupUser(user: User): boolean {
  return Array.isArray(user.identities) && user.identities.length === 0
}

export function signupErrorMessage(message: string): string {
  return /rate limit/i.test(message) && /email/i.test(message) ? EMAIL_RATE_LIMIT_MESSAGE : message
}
