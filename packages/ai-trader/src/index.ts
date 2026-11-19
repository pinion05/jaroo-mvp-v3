// 진입점 — 설정 로드 → 스키마 마이그레이션 → 캐릭터 시드 → Bun.serve + Hono 기동.
// 외부 의존: paper-trade 원장(HTTP) + 시세 API(HTTP) — Phase 1 은 수동 트리거만.

import { createApp } from './app.ts'
import { DEFAULT_CHARACTERS } from './characters.ts'
import { loadConfig } from './config.ts'
import { Store } from './journal.ts'
import type { LoopDeps } from './loop.ts'
import { createStaticQuotesProvider, createWebQuotesProvider } from './quotes.ts'
import { PaperTradeClient } from './papertrade.ts'

const config = loadConfig()

const schemaSql = await Bun.file(new URL('../migrations/0001_init.sql', import.meta.url)).text()
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

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
})

console.log(
  `[ai-trader] listening on :${server.port} | db=${config.dbPath}` +
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
