import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveOAuthCallbackOrigin, safeOAuthNext } from '@/lib/supabase/oauth-callback-origin'
import { parseTermsConsentAt, termsConsentRow } from '@/lib/supabase/terms-consent'

export const runtime = 'nodejs'



// Supabase PKCE OAuth 콜백: Google → Supabase → 여기로 code 가 돌아옴.
// code 를 세션으로 교환(쿠키 설정) 후 next(기본 /home)로 이동.
// consent 쿼리(로그인 화면 동의 시점)가 유효하면 profiles 에 동의 기록을 남긴다.
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
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', error.code, error.message)
    }
    if (!error) {
      await recordTermsConsent(supabase, url.searchParams.get('consent'), data.user?.id ?? data.session?.user?.id ?? null)
      return NextResponse.redirect(new URL(safeOAuthNext(url.searchParams.get('next'), redirectOrigin), redirectOrigin))
    }
  }

  const loginUrl = new URL('/login', redirectOrigin)
  loginUrl.searchParams.set('error', 'oauth')
  return NextResponse.redirect(loginUrl)
}

// 세션이 성립된 직후의 클라이언트라 RLS 본인 정책(profiles_*_own)으로 upsert 가능.
// 기록 실패는 로그인 자체를 막지 않는다(동의 기록은 best-effort, 오류는 로그로 남김).
async function recordTermsConsent(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, rawConsent: string | null, userId: string | null) {
  const consentAt = parseTermsConsentAt(rawConsent)
  if (!consentAt || !userId) return
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...termsConsentRow(consentAt) }, { onConflict: 'id' })
  if (error) {
    console.error('[auth/callback] terms consent record failed', error.code, error.message)
  }
}
