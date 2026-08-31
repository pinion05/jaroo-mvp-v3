import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { getTelegramWebhookSecret, hasTelegramBotConfig } from '@/lib/telegram/config'
import { sendTelegramMessage } from '@/lib/telegram/telegram-client'

export const runtime = 'nodejs'

// Telegram → Jaroo 웹훅. 오직 한 가지 일을 한다:
// 유저가 t.me/jaroowatcher_bot?start=<token> 으로 봇을 시작하면 1회용 토큰을 검증해
// telegram_links(user_id ↔ chat_id)를 확정하고 확인 메시지를 발송한다.
// 이 테이블이 채워져야 이후 감시 배치가 각 유저에게 개별 발송할 수 있다.
// Telegram 재시도 루프를 막기 위해 처리 결과와 무관하게(시크릿 위조 제외) 200 으로 응답한다.

type TelegramUpdate = {
  message?: {
    text?: string
    from?: { id?: number; username?: string }
    chat?: { id?: number; type?: string }
  }
}

function isWebhookSecretValid(received: string | null, expected: string): boolean {
  if (!received || !expected) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** "/start abc123" → "abc123" (인자 없으면 null) */
function parseStartToken(text: string): string | null {
  if (!text.startsWith('/start')) return null
  const rest = text.slice('/start'.length).trim()
  return rest || null
}

export async function POST(req: NextRequest) {
  if (!hasTelegramBotConfig()) {
    return NextResponse.json({ error: 'telegram-unconfigured' }, { status: 503 })
  }
  const expectedSecret = getTelegramWebhookSecret()
  if (!isWebhookSecretValid(req.headers.get('x-telegram-bot-api-secret-token'), expectedSecret)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 })
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null
  const message = update?.message
  if (!message?.chat?.id) {
    return NextResponse.json({ ok: true }) // 메시지 없는 업데이트는 무시
  }

  const chatId = String(message.chat.id)
  const telegramUsername = message.from?.username ?? null

  // 봇 개인 채팅만 지원. chat.id === from.id 가 개인 채팅 특성이지만, 채널/그룹 전송도 chat.id 로 차단.
  if (message.chat.type && message.chat.type !== 'private') {
    return NextResponse.json({ ok: true })
  }

  const token = parseStartToken(message.text ?? '')
  if (!token) {
    await sendTelegramMessage(
      chatId,
      'Jaroo 알림 봇이에요.\n연결은 Jaroo 앱 마이페이지의 "텔레그램 연결" 링크로 시작해주세요.',
    )
    return NextResponse.json({ ok: true })
  }

  const admin = createSupabaseServiceClient() // 세션이 없는 봇 요청이라 service role (RLS 우회)

  const { data: tokenRow, error: tokenError } = await admin
    .from('telegram_link_tokens')
    .select('user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (tokenError) {
    console.error('[telegram/webhook] token query failed', tokenError)
    return NextResponse.json({ ok: true }) // DB 장애 시 유저에게 오류 문구 대신 조용히 끝냄
  }

  const expiredOrUsed =
    !tokenRow ||
    Boolean(tokenRow.used_at) ||
    new Date(tokenRow.expires_at).getTime() <= Date.now()
  if (expiredOrUsed) {
    await sendTelegramMessage(
      chatId,
      '연결 링크가 만료되었거나 이미 사용되었어요.\nJaroo 앱 마이페이지에서 새 링크를 받아 다시 시작해주세요.',
    )
    return NextResponse.json({ ok: true })
  }

  // 한 텔레그램 계정 = 한 Jaroo 계정 (chat_id unique). 다른 계정에 묶여 있으면 거부.
  const { data: conflict, error: conflictError } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('chat_id', chatId)
    .maybeSingle()
  if (conflictError) {
    console.error('[telegram/webhook] conflict query failed', conflictError)
    return NextResponse.json({ ok: true })
  }
  if (conflict && conflict.user_id !== tokenRow.user_id) {
    await sendTelegramMessage(
      chatId,
      '이 텔레그램 계정은 이미 다른 Jaroo 계정에 연결되어 있어요.\n기존 계정에서 연결 해제 후 다시 시도해주세요.',
    )
    return NextResponse.json({ ok: true })
  }

  const nowIso = new Date().toISOString()
  const { error: upsertError } = await admin.from('telegram_links').upsert(
    {
      user_id: tokenRow.user_id,
      chat_id: chatId,
      username: telegramUsername,
      status: 'active',
      linked_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'user_id' },
  )
  if (upsertError) {
    console.error('[telegram/webhook] link upsert failed', upsertError)
    return NextResponse.json({ ok: true })
  }

  const { error: markUsedError } = await admin
    .from('telegram_link_tokens')
    .update({ used_at: nowIso })
    .eq('token', token)
  if (markUsedError) {
    console.error('[telegram/webhook] token mark-used failed', markUsedError)
    // 연결 자체는 성공. 토큰 소모 실패는 TTL(10분)이 있어 위험 낮음 — 로그만.
  }

  await sendTelegramMessage(
    chatId,
    'Jaroo 알림이 연결됐어요.\n이제 내 종목에 중요한 소식이 있으면 이 채팅으로 알려드릴게요.\n연결 해제는 Jaroo 앱 마이페이지에서 할 수 있어요.',
  )

  return NextResponse.json({ ok: true })
}
