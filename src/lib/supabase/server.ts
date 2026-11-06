import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { assertSupabaseConfig } from './config'
import { hardenSessionCookieOptions } from './session-cookie'

export async function createSupabaseServerClient() {
  const { url, anonKey } = assertSupabaseConfig()
  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          // 세션 쿠키 발급·갱신·삭제 속성의 단일 소스(session-cookie.ts)를 통과한다.
          // httpOnly+Secure+SameSite=Lax, 만료 30일 슬라이딩(TC-BBS-001/002/003, 이슈 #224 E1).
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, hardenSessionCookieOptions(options ?? {})),
          )
        } catch (error) {
          // Server Components cannot set cookies. Route handlers and proxy can.
          console.warn('[supabase/server] Cookie write failed', error)
        }
      },
    },
  })
}
