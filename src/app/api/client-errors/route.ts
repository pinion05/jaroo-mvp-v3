import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { originAllowedForStateChange } from '@/lib/http-origin-guard'

// 클라이언트 렌더 크래시 리포트 수신 (global-error.tsx → 이 라우트 → client_error_logs).
// 로그인 여부와 무관하게 동작해야 하므로 user_id 는 세션이 있을 때만 남긴다.

const MAX_FIELD_LENGTH = 2000

function clampText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_FIELD_LENGTH)
}

export async function POST(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const body = (payload ?? {}) as Record<string, unknown>
  const message = clampText(body.message)
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  // user_id 귀속: 세션이 있을 때만 (로그아웃 상태 크래시도 수용해야 하므로)
  const sessionClient = await createSupabaseServerClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser().catch(() => ({ data: { user: null } }))

  // 적재는 서비스 롤 — RLS deny-all 이므로 anon/쿠키 클라이언트로는 쓸 수 없다
  const serviceClient = createSupabaseServiceClient()
  const { error } = await serviceClient.from('client_error_logs').insert({
    message,
    stack: clampText(body.stack),
    digest: clampText(body.digest),
    page_url: clampText(body.page_url),
    user_agent: clampText(body.userAgent),
    user_id: user?.id ?? null,
  })
  // 로그 적재 실패가 사용자 경험을 해치지 않도록 항상 200 계열로 응답
  return NextResponse.json({ ok: error === null }, { status: 200 })
}
