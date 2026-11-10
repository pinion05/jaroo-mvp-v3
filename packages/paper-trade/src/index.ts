// 진입점 — 설정 로드 → 스키마 마이그레이션 → Bun.serve + Hono 기동.
// 외부 데이터 의존 없음: 시세는 caller가 주문에 실어 보낸다(quote ZERO).

import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { Store } from './store.ts'

const config = loadConfig()

const schemaSql = await Bun.file(new URL('../migrations/0001_init.sql', import.meta.url)).text()
const store = new Store(config.dbPath, schemaSql)

const app = createApp({ store, rates: config.rates })

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
})

console.log(
  `[paper-trade] listening on :${server.port} | db=${config.dbPath} | quote=NONE(caller-supplied)` +
    ` | fee=${config.rates.feeBpsX10 / 10}bps tax=${config.rates.taxBpsX10 / 10}bps`,
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
