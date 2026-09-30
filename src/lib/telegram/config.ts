// 텔레그램 봇(jaroo-watcher) 연동 설정 — BotFather 에서 발급한 토큰을 사용한다.
// 봇 토큰은 서버 전용이고 NEXT_PUBLIC_* 로 절대 노출하지 않는다.
// WEBHOOK_SECRET 은 setWebhook 시 Telegram 이 보내는 X-Telegram-Bot-Api-Secret-Token
// 헤더 검증용 (Telegram 웹훅 위조 방지).

export function getTelegramBotToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
}

export function getTelegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME?.trim() || ''
}

export function getTelegramWebhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || ''
}

/** 서버 사이드 텔레그램 API 호출 가능 여부 (라우트에서 그레이스풀 fallback 판정용) */
export function hasTelegramBotConfig(): boolean {
  return Boolean(getTelegramBotToken())
}

export function assertTelegramBotConfig(): { botToken: string } {
  const botToken = getTelegramBotToken()
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured')
  }
  return { botToken }
}
