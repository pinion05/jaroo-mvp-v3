import { NextResponse } from 'next/server'

import { originAllowedForStateChange } from '@/lib/http-origin-guard'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// 새 비밀번호 설정. 브라우저의 supabase.auth.updateUser 를 서버로 옮긴다
// (이슈 #224 E1-b). /auth/reset-password/confirm 이 만든 세션 쿠키로 인증한다.
export async function POST(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: 'origin-not-allowed' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
  }
  const auth = await resolveApiUserId('account-password')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: '재설정 링크가 만료되었어요. 다시 받아주세요.' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8) {
    return NextResponse.json({ error: '비밀번호는 8자 이상이어야 해요.' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return NextResponse.json({ error: '비밀번호를 변경하지 못했어요. 링크를 다시 받아서 시도해주세요.' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_PRIVATE_HEADERS })
}
