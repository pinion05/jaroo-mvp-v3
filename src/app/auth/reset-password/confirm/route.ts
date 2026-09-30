import { NextResponse, type NextRequest } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// 비밀번호 재설정 링크의 code 교환을 서버에서 수행한다(이슈 #224 E1-b).
// 과거에는 브라우저에서 exchangeCodeForSession 으로 세션 쿠키를 직접 썼다.
// PKCE code_verifier 쿠키가 동일 오리진에 있으므로 서버 교환이 가능하다.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const failedUrl = new URL('/auth/reset-password?error=link', url.origin)
  const successUrl = new URL('/auth/reset-password', url.origin)

  if (url.searchParams.get('error')) {
    return NextResponse.redirect(failedUrl)
  }

  const code = url.searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(failedUrl)
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(failedUrl)
    }
    return NextResponse.redirect(successUrl)
  } catch {
    return NextResponse.redirect(failedUrl)
  }
}
