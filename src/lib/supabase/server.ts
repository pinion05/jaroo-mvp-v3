import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { assertSupabaseConfig } from './config'

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
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              // 세션 토큰의 JS 노출 차단(이슈 #224 E1). 서버 교환으로만 쓰이므로
              // 브라우저 직접 읽기 경로는 더 이상 없다(프로필/재설정 서버 이전 완료).
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
            }),
          )
        } catch (error) {
          // Server Components cannot set cookies. Route handlers and proxy can.
          console.warn('[supabase/server] Cookie write failed', error)
        }
      },
    },
  })
}
