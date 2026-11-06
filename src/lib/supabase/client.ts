import { createBrowserClient } from '@supabase/ssr'
import { assertSupabaseConfig } from './config'

// 브라우저 supabase 클라이언트는 OAuth/PKCE 시작(signInWithOAuth — code-verifier
// 쿠키 기록)과 비밀번호 재설정 메일 발송 용도로만 쓴다. 세션 쿠키 발급·갱신은
// 전적으로 서버(라우트 핸들러·proxy)가 한다(httpOnly 불가능한 document.cookie
// 발급 경로를 끊는다 — TC-BBS-003). 아래 두 플래그를 끄지 않으면 @supabase/ssr
// 기본값이 URL 코드 교환(detectSessionInUrl)·브라우저 토큰 자동 갱신
// (autoRefreshToken)으로 document.cookie 세션을 재발급할 수 있다.
export function createSupabaseBrowserClient() {
  const { url, anonKey } = assertSupabaseConfig()

  return createBrowserClient(url, anonKey, {
    auth: {
      detectSessionInUrl: false,
      autoRefreshToken: false,
    },
  })
}
