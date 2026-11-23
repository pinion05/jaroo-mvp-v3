// 환경설정 — 불변 설정만 메모리에 둔다 (캐릭터 상태·판단 로그는 SQLite).
// 이 워커의 외부 의존은 딱 2개: paper-trade 원장 + 시세 API (spec §3).

export type Config = {
  port: number
  dbPath: string
  paperTradeBaseUrl: string
  quotesMode: 'web' | 'static'
  quotesBaseUrl: string
  /** QUOTES_MODE=static 전용 — "005930:70000:-2.5,000660:180000:0" (코드:원단위가격:일등락률%) */
  staticQuotes: string
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const quotesMode = env.QUOTES_MODE ?? 'web'
  if (quotesMode !== 'web' && quotesMode !== 'static') {
    throw new Error(`QUOTES_MODE 파싱 실패 (web|static): ${quotesMode}`)
  }
  return {
    // N-1(#381 리뷰): 공유 PORT는 절대 읽지 않는다(crawler/paper-trade 규칙) —
    // Railway가 웹에 주입하는 PORT와 충돌해 EADDRINUSE 사고가 난다.
    port: Number(env.AI_TRADER_PORT) || 3042,
    dbPath: env.DB_PATH || './data/ai-trader.db',
    paperTradeBaseUrl: env.PAPER_TRADE_BASE_URL || 'http://localhost:3041',
    quotesMode,
    quotesBaseUrl: env.QUOTES_BASE_URL || 'http://localhost:3000',
    staticQuotes: env.STATIC_QUOTES ?? '',
  }
}
