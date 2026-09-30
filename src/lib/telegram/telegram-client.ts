import 'server-only'

import { assertTelegramBotConfig } from './config'

// 텔레그램 봇(jaroo-watcher) Bot API 서버 클라이언트 (https://core.telegram.org/bots/api)
// 봇 토큰 1개로 유저 N명의 개인 채팅에 발송한다. 각 유저의 발송 대상은 chat_id 이고,
// Jaroo user_id ↔ chat_id 매핑은 telegram_links 테이블이 관리한다.

const API_BASE = 'https://api.telegram.org'

export type TelegramApiResult =
  | { ok: true; result: unknown }
  | { ok: false; code: number; description: string }

/** Telegram Bot API 공통 호출. 네트워크 실패도 ok:false 로 정규화한다. */
async function callTelegramApi(method: string, payload: Record<string, unknown>): Promise<TelegramApiResult> {
  const { botToken } = assertTelegramBotConfig()
  try {
    const res = await fetch(`${API_BASE}/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string } | null
    if (res.ok && data?.ok) {
      return { ok: true, result: data.result }
    }
    return { ok: false, code: res.status, description: data?.description || `HTTP ${res.status}` }
  } catch (error) {
    console.error(`[telegram-client] ${method} network failed`, error)
    return { ok: false, code: 0, description: 'network-error' }
  }
}

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; code: number; description: string; blocked: boolean } // blocked: 유저가 봇을 차단(403)

/**
 * 개인 채팅 1곳에 메시지 발송. 지시사항 §6-3: 문구는 항상 종목명 등 유저 식별 정보로 시작.
 * parse_mode HTML 로 일부 태그(<b>, <code>)만 허용 — 유저 입력을 그대로 넣지 말 것.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<TelegramSendResult> {
  const res = await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  if (res.ok) return { ok: true }
  return { ok: false, code: res.code, description: res.description, blocked: res.code === 403 }
}

/** 운영 배포 후 웹훅 등록용. secret 은 요청 헤더(X-Telegram-Bot-Api-Secret-Token) 검증에 쓰인다. */
export async function setTelegramWebhook(url: string, secret: string): Promise<TelegramApiResult> {
  return callTelegramApi('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'],
  })
}

/** 봇 토큰 유효성 점검 (getMe). */
export async function getTelegramMe(): Promise<TelegramApiResult> {
  return callTelegramApi('getMe', {})
}
