// 진입점 — 설정 로드 → 스키마 마이그레이션 → node:http 서버 기동.
// 외부 데이터 의존 없음: 시세는 caller가 주문에 실어 보낸다(quote ZERO).

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { Store } from './store.ts'

const config = loadConfig()

const schemaSql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
const store = new Store(config.dbPath, schemaSql)

const handleRequest = createApp({ store, rates: config.rates })
const server = createServer(handleRequest)

server.listen(config.port, '127.0.0.1', () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : config.port
  console.log(
    `[paper-trade] listening on :${port} | db=${config.dbPath} | quote=NONE(caller-supplied)` +
      ` | fee=${config.rates.feeBpsX10 / 10}bps tax=${config.rates.taxBpsX10 / 10}bps`,
  )
})

/** SIGINT/SIGTERM — 새 연결 거부 → 진행 중 요청 종료 대기 → DB 종료(WAL 체크포인트) → exit 0. */
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
