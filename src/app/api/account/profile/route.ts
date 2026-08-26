import { NextResponse } from 'next/server'

import { originAllowedForStateChange } from '@/lib/http-origin-guard'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// 프로필 표시명 수정. 과거 브라우저에서 supabase.auth.updateUser 를 직접
// 호출했던 흐름을 서버로 옮긴다(이슈 #224 E1 — 세션 쿠키 httpOnly 전환 전제).
export async function POST(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: 'origin-not-allowed' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
  }
  const auth = await resolveApiUserId('account-profile')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: '로그인 후 이용할 수 있어요.' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as { displayName?: unknown } | null
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName || displayName.length > 30) {
    return NextResponse.json({ error: '닉네임은 1~30자로 입력해주세요.' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } })
  if (error) {
    return NextResponse.json({ error: error.message || '저장하지 못했어요.' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_PRIVATE_HEADERS })
}
