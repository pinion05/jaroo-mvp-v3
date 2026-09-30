import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { originAllowedForStateChange } from '@/lib/http-origin-guard'

export const runtime = 'nodejs'

const NO_STORE_PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' }

// 회원 탈퇴(이용계약 해지). 로그인된 본인만 호출할 수 있다.
// 1) portfolio_holdings 은 auth.users 로의 FK 가 없어(스키마 캡처 테이블) 직접 삭제하고,
// 2) auth.users 삭제 시 profiles/결제/크레딧·구독 테이블이 ON DELETE CASCADE 로 정리된다.
// 결제 원장은 회사 보관 의무(전자상거래법) 소지가 있으나 MVP 정책은 전체 삭제 CASCADE 다.
export async function POST(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json(
      { error: { code: 'origin_not_allowed', message: '요청을 처리할 수 없어요.' } },
      { status: 403, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: '로그인 후 이용할 수 있어요.' } },
      { status: 401, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }

  try {
    const admin = createSupabaseServiceClient()

    const { error: holdingsError } = await admin.from('portfolio_holdings').delete().eq('user_id', user.id)
    if (holdingsError) throw holdingsError

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError

    // 세션 쿠키는 남은 토큰이 무효화됐어도 지워주는 게 안전하다(클라이언트가 /api/auth/logout 호출).
    return NextResponse.json({ ok: true }, { headers: NO_STORE_PRIVATE_HEADERS })
  } catch (error) {
    console.error('[api/account/delete] withdrawal failed', error)
    return NextResponse.json(
      { error: { code: 'delete_failed', message: '회원 탈퇴 처리 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' } },
      { status: 500, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }
}
