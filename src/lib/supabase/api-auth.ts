import 'server-only'

import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from './server'
import { isExpectedSupabaseAuthMiss } from './auth-error'

// 보호 API 라우트용 인증 해석 단일 소스.
// 과거 payments/server.ts(resolvePaymentUserId)·portfolio(resolvePortfolioUserId)·
// auth/me·payments/cancel 에 각자 복제돼 있던 같은 로직을 한 곳으로 모았다.
// 인증 정책(미로그인=unauthorized, Supabase 장애=unavailable 구분, no-store 헤더)을
// 바꿀 때 이 파일만 수정하면 된다.
//
// 상태:
//   authenticated — 로그인 확정(userId + user 객체)
//   unauthorized  — 미로그인. 세션 없음은 정상 상황이라 5xx가 아니다.
//   unavailable   — Supabase 장애. 503으로 응답해야 하는 상황.

export const NO_STORE_PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' } as const

export type ApiAuthResult =
  | { status: 'authenticated'; userId: string; user: User }
  | { status: 'unauthorized' }
  | { status: 'unavailable' }

export async function resolveApiUserId(logLabel = 'api'): Promise<ApiAuthResult> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      if (isExpectedSupabaseAuthMiss(error)) {
        return { status: 'unauthorized' }
      }
      console.error(`[${logLabel}] Supabase auth resolution failed`, error)
      return { status: 'unavailable' }
    }
    if (!data.user) {
      return { status: 'unauthorized' }
    }
    return { status: 'authenticated', userId: data.user.id, user: data.user }
  } catch (error) {
    console.error(`[${logLabel}] Supabase auth infrastructure failed`, error)
    return { status: 'unavailable' }
  }
}
