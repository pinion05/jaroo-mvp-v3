// 환경설정 — 불변 설정만 메모리에 둔다 (계좌 등 상태는 캐시 금지).
// 시세 관련 설정은 존재하지 않는다: 이 컨테이너는 시세를 조회하지 않는다(quote ZERO).

import type { Rates } from './engine.ts'

export type Config = {
  port: number
  dbPath: string
  rates: Rates
}

/** "1.5" bps → x10 정수 15 (0.015%). 파싱 실패/범위 밖이면 에러. */
function parseBpsX10(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1_000) {
    throw new Error(`${label} 파싱 실패 (0~100 bps 소수 가능): ${raw}`)
  }
  return Math.round(value * 10)
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT) || 3041,
    dbPath: env.DB_PATH || './data/paper-trade.db',
    rates: {
      feeBpsX10: parseBpsX10(env.BROKER_FEE_BPS, 15, 'BROKER_FEE_BPS'),
      taxBpsX10: parseBpsX10(env.SELL_TAX_BPS, 150, 'SELL_TAX_BPS'),
    },
  }
}
