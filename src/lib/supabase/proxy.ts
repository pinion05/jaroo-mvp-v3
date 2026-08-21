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
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data } = await supabase.auth.getUser()

  // 보호 경로에 게스트면 로그인 페이지로 보낸다. 원래 경로는 next 파라미터로 보존.
  if (!data.user && isProtectedAppPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.search = ''
    redirectUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
