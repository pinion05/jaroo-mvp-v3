import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAnonKey, getSupabaseUrl } from './config'

// 로그인 없이는 접근할 수 없는 앱 경로.
// 홈/스크린샷/OCR/병합/ETF/쉐어카드는 게스트 체험 funnel(둘러보기 → 스크린샷 맛보기)로 개방.
// 마이페이지(계정·크레딧·구독)와 딥스캔(유료 가치 동작),
// 결제 결과 페이지(/payments/* — 주문은 로그인 사용자만 만들 수 있으므로)만 로그인 게이트.
const PROTECTED_APP_PATHS = ['/mypage', '/deepscan', '/payments']

function isProtectedAppPath(pathname: string): boolean {
  return PROTECTED_APP_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/** 보호 경로 리다이렉트의 next 값 — 원래 경로를 쿼리까지 통째로 보존한다.
 *  예전 구현은 pathname만 실어 ?code= 같은 딥링크 쿼리를 버렸다(로그인 후
 *  /deepscan?code=530092 링크가 /deepscan으로 죽는 문제). 소비자(login 페이지의
 *  same-origin 검증, OAuth 콜백의 safeOAuthNext — pathname+search+hash 보존)는
 *  모두 쿼리 포함 값을 이미 지원한다. */
export function buildLoginRedirectNext(pathname: string, search: string): string {
  const normalizedSearch = search.startsWith('?') ? search : ''
  return normalizedSearch ? `${pathname}${normalizedSearch}` : pathname
}

export async function updateSupabaseSession(request: NextRequest) {
  const url = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()

  if (!url || !anonKey) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            // 세션 토큰 회전 쿠키의 JS 노출 차단 — server.ts setAll 강제 패턴과 동일.
            // @supabase/ssr 기본값(httpOnly:false)을 그대로 쓰면 토큰이 document.cookie로
            // 열람된다. Secure는 운영(https)에서만, localhost 개발은 http 유지.
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
          }),
        )
      },
    },
  })

  const { data } = await supabase.auth.getUser()

  // 보호 경로에 게스트면 로그인 페이지로 보낸다. 원래 경로(쿼리 포함)는 next
  // 파라미터로 보존 — 로그인 성공 후 그 경로로 돌아온다.
  if (!data.user && isProtectedAppPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.search = ''
    redirectUrl.searchParams.set('next', buildLoginRedirectNext(request.nextUrl.pathname, request.nextUrl.search))
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
