import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// DEV ONLY: Orca 웹뷰에서 구글 OAuth가 "안전하지 않은 클라이언트"로 차단되는 문제를
// 우회하기 위해, 신뢰받는 브라우저(Chrome/BrowserOS)에서 얻은 access/refresh token 으로
// 이 브라우저(Orca)에 Supabase 세션 쿠키를 주입한다.
//
// 사용: GET /auth/dev-set-session?access_token=...&refresh_token=...
// production 빌드에서는 비활성화된다.
export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not Found', { status: 404 })
  }

  const url = new URL(request.url)
  const access_token = url.searchParams.get('access_token')
  const refresh_token = url.searchParams.get('refresh_token')

  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: 'access_token 과 refresh_token 이 필요합니다.' }, { status: 400 })
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error || !data.session) {
      console.error('[dev-set-session] setSession failed', error)
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('error', 'oauth')
      return NextResponse.redirect(loginUrl)
    }
    // 쿠키 동기화를 살짝 기다린 뒤 /home 로 이동.
    return NextResponse.redirect(new URL('/home', request.url))
  } catch (error) {
    console.error('[dev-set-session] unexpected error', error)
    return NextResponse.json({ error: '세션 주입 중 오류가 발생했어요.' }, { status: 500 })
  }
}
