import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveOAuthCallbackOrigin, safeOAuthNext } from '@/lib/supabase/oauth-callback-origin'

export const runtime = 'nodejs'



// Supabase PKCE OAuth 콜백: Google → Supabase → 여기로 code 가 돌아옴.
// code 를 세션으로 교환(쿠키 설정) 후 next(기본 /home)로 이동.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const redirectOrigin = resolveOAuthCallbackOrigin({
    requestUrl: request.url,
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
  })
  const code = url.searchParams.get('code')

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', error.code, error.message)
    }
    if (!error) {
      return NextResponse.redirect(new URL(safeOAuthNext(url.searchParams.get('next'), redirectOrigin), redirectOrigin))
    }
  }

  const loginUrl = new URL('/login', redirectOrigin)
  loginUrl.searchParams.set('error', 'oauth')
  return NextResponse.redirect(loginUrl)
}
