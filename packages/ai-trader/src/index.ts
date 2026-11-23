// 진입점 — 설정 로드 → 스키마 마이그레이션 → 캐릭터 시드 → node:http 서버 기동.
// 외부 의존: paper-trade 원장(HTTP) + 시세 API(HTTP) — Phase 1 은 수동 트리거만.
//
// #378 Node 전환(2026-11-23): Bun.serve+Hono → node:http (paper-trade #368 패턴 계승).
//   - 바인딩 127.0.0.1 루프백: 무인증 API 노출 방지(#374 합의 유지)
//   - 바디 32KB 상한: app.ts readBody 가드
//   - SIGTERM drain: 새 연결 거부 → 진행 중 판단 로그 POST 종료 대기 → DB 종료 → exit 0

import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { DEFAULT_CHARACTERS } from './characters.ts'
import { loadConfig } from './config.ts'
import { Store } from './journal.ts'
import { loadMigrationsSql } from './migrations.ts'
import type { LoopDeps } from './loop.ts'
import { PaperTradeClient } from './papertrade.ts'
import { createStaticQuotesProvider, createWebQuotesProvider } from './quotes.ts'

const config = loadConfig()

// #378 P2 — Store 생성 실패는 컨텍스트(dbPath·SQLite 코드)가 담긴 메시지로 죽는다(journal.ts).
const schemaSql = loadMigrationsSql()
const store = new Store(config.dbPath, schemaSql)
store.seedCharacters(DEFAULT_CHARACTERS)

const deps: LoopDeps = {
  store,
  paper: new PaperTradeClient(config.paperTradeBaseUrl),
  quotes:
    config.quotesMode === 'static'
      ? createStaticQuotesProvider(config.staticQuotes)
      : createWebQuotesProvider(config.quotesBaseUrl),
}

const handleRequest = createApp(deps)
const server = createServer(handleRequest)

server.listen(config.port, '127.0.0.1', () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : config.port
  console.log(
    `[ai-trader] listening on 127.0.0.1:${port} | db=${config.dbPath}` +
      ` | paper-trade=${config.paperTradeBaseUrl} | quotes=${config.quotesMode}` +
      (config.quotesMode === 'static' ? ` (${config.staticQuotes})` : ` (${config.quotesBaseUrl})`) +
      ` | characters=${DEFAULT_CHARACTERS.map((c) => c.slug).join(',')}`,
  )
})

/** SIGINT/SIGTERM — 새 연결 거부 → 진행 중 요청(판단 로그 POST) drain → DB 종료(WAL 체크포인트) → exit 0. */
let storeClosed = false
const closeStore = (): void => {
  if (!storeClosed) {
    storeClosed = true
    store.close()
  }
}
const shutdown = (): void => {
  server.close(() => {
    closeStore()
    process.exit(0)
  })
  // 안전망: keep-alive 잔여 커넥션 때문에 close 콜백이 늦어지면 강제 종료.
  const forceExit = setTimeout(() => {
    closeStore()
    process.exit(0)
  }, 5_000)
  forceExit.unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
