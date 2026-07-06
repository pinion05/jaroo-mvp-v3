import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Supabase PKCE OAuth 콜백: Google → Supabase → 여기로 code 가 돌아옴.
// code 를 세션으로 교환(쿠키 설정) 후 next(기본 /home)로 이동.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/home'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }

  const loginUrl = new URL('/login', url.origin)
  loginUrl.searchParams.set('error', 'oauth')
  return NextResponse.redirect(loginUrl)
}
