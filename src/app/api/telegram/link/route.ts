import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { originAllowedForStateChange } from '@/lib/http-origin-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveApiUserId, NO_STORE_PRIVATE_HEADERS } from '@/lib/supabase/api-auth'
import { getTelegramBotUsername, hasTelegramBotConfig } from '@/lib/telegram/config'

export const runtime = 'nodejs'

// 텔레그램 알림 연동: 마이페이지 "텔레그램 연결" 플로우의 서버 측.
// GET    — 연결 상태 조회 (telegram_links 읽기, RLS select_own)
// POST   — 1회용 연동 토큰 발급 + t.me 딥링크 URL 반환 (10분 유효)
// DELETE — 연결 해제
// 실제 chat_id 확정은 유저가 딥링크로 봇을 시작할 때 webhook 라우트가 한다.

const LINK_TOKEN_TTL_MS = 10 * 60 * 1000

export async function GET() {
  const auth = await resolveApiUserId('telegram/link')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ authScope: 'guest', linked: false }, { headers: NO_STORE_PRIVATE_HEADERS })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('telegram_links')
    .select('chat_id, username, status, linked_at')
    .eq('user_id', auth.userId)
    .maybeSingle()

  if (error) {
    console.error('[telegram/link] status query failed', error)
    return NextResponse.json({ error: 'query-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }

  return NextResponse.json(
    {
      authScope: 'authenticated',
      linked: Boolean(data),
      status: data?.status ?? null,
      telegram_username: data?.username ?? null,
      linked_at: data?.linked_at ?? null,
    },
    { headers: NO_STORE_PRIVATE_HEADERS },
  )
}

export async function POST(req: NextRequest) {
  // 상태 변경 라우트 공통 2차 계층 CSRF 방어 (이슈 #224 E3, portfolio/account 컨벤션)
  if (!originAllowedForStateChange(req)) {
    return NextResponse.json({ error: 'forbidden-origin' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
  }
  const auth = await resolveApiUserId('telegram/link')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  // 봇 설정이 없으면 UI 가 연결 플로우 자체를 숨기도록 503 로 구분해서 내려준다.
  if (!hasTelegramBotConfig() || !getTelegramBotUsername()) {
    return NextResponse.json({ error: 'telegram-unconfigured' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const supabase = await createSupabaseServerClient()
  const token = randomBytes(24).toString('base64url') // 1회용 연동 토큰
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS)

  // 이전 미사용 토큰은 모두 무효화 (링크 재발급 시 이전 링크 즉시 죽음)
  const { error: cleanupError } = await supabase
    .from('telegram_link_tokens')
    .delete()
    .eq('user_id', auth.userId)
    .is('used_at', null)
  const { error: insertError } = await supabase
    .from('telegram_link_tokens')
    .insert({ token, user_id: auth.userId, expires_at: expiresAt.toISOString() })

  if (cleanupError || insertError) {
    console.error('[telegram/link] token issue failed', cleanupError ?? insertError)
    return NextResponse.json({ error: 'query-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const linkUrl = `https://t.me/${getTelegramBotUsername()}?start=${token}`
  return NextResponse.json(
    { link_url: linkUrl, expires_at: expiresAt.toISOString() },
    { headers: NO_STORE_PRIVATE_HEADERS },
  )
}

export async function DELETE(req: NextRequest) {
  if (!originAllowedForStateChange(req)) {
    return NextResponse.json({ error: 'forbidden-origin' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
  }
  const auth = await resolveApiUserId('telegram/link')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('telegram_links').delete().eq('user_id', auth.userId)
  if (error) {
    console.error('[telegram/link] unlink failed', error)
    return NextResponse.json({ error: 'query-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }

  // 남은 미사용 토큰도 정리
  await supabase.from('telegram_link_tokens').delete().eq('user_id', auth.userId).is('used_at', null)

  return NextResponse.json({ ok: true }, { headers: NO_STORE_PRIVATE_HEADERS })
}
