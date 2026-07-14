import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// DEV ONLY: 신뢰받는 브라우저에서 로그인된 세션의 access/refresh token 을 꺼내,
// Orca 웹뷰(dev-set-session 라우트)로 세션을 전이하기 위한 도구.
// production 빌드에서는 비활성화된다.
export const runtime = 'nodejs'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not Found', { status: 404 })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session) {
    return NextResponse.json({ error: '로그인된 세션이 없습니다.' }, { status: 401 })
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: {
      id: data.session.user.id,
      email: data.session.user.email,
    },
  })
}
