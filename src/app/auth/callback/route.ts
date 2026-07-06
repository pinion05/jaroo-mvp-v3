import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// next 가 same-origin 경로인지 검증 — 절대/프로토콜 상대 URL(//host, /\host, https://host)은 차단해
// OAuth 콜백 오픈 리다이렉트를 방어한다.
function safeNext(next: string | null, origin: string): string {
  if (!next || !next.startsWith('/')) return '/home'
  const parsed = new URL(next, origin)
  if (parsed.origin !== origin) return '/home'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

// Supabase PKCE OAuth 콜백: Google → Supabase → 여기로 code 가 돌아옴.
// code 를 세션으로 교환(쿠키 설정) 후 next(기본 /home)로 이동.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next'), url.origin), url.origin))
    }
  }

  const loginUrl = new URL('/login', url.origin)
  loginUrl.searchParams.set('error', 'oauth')
  return NextResponse.redirect(loginUrl)
}
