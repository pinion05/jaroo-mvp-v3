// 진입점 — 설정 로드 → 스키마 마이그레이션 → 캐릭터 시드 → Bun.serve + Hono 기동.
// 외부 의존: paper-trade 원장(HTTP) + 시세 API(HTTP) — Phase 1 은 수동 트리거만.

import { createApp } from './app.ts'
import { DEFAULT_CHARACTERS } from './characters.ts'
import { loadConfig } from './config.ts'
import { Store } from './journal.ts'
import { loadMigrationsSql } from './migrations.ts'
import type { LoopDeps } from './loop.ts'
import { createStaticQuotesProvider, createWebQuotesProvider } from './quotes.ts'
import { PaperTradeClient } from './papertrade.ts'

const config = loadConfig()

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

const app = createApp(deps)

// 바인딩·바디 상한 — 리뷰팀 합의(보안 S-1/S-2·SRE P0-1/P0-2):
//   hostname 127.0.0.1: 무인증 API를 루프백으로 제한(paper-trade #368 패리티.
//   Bun.serve 기본값은 전 인터페이스(*:) — tailnet 노출 실측)
//   maxRequestBodySize 32KB: paper-trade 가드 계승 — 무제한 바디는 디스크 풀
//   크래시 루프의 입구(64MB 저장 실측)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: config.port,
  fetch: app.fetch,
  maxRequestBodySize: 32 * 1024,
})

console.log(
  `[ai-trader] listening on 127.0.0.1:${server.port} | db=${config.dbPath}` +
    ` | paper-trade=${config.paperTradeBaseUrl} | quotes=${config.quotesMode}` +
    (config.quotesMode === 'static' ? ` (${config.staticQuotes})` : ` (${config.quotesBaseUrl})`) +
    ` | characters=${DEFAULT_CHARACTERS.map((c) => c.slug).join(',')}`,
)

process.on('SIGINT', () => {
  server.stop(true)
  store.close()
  process.exit(0)
})
process.on('SIGTERM', () => {
  server.stop(true)
  store.close()
  process.exit(0)
})
