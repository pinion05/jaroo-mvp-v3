// 도메인 타입 — 순수 데이터만 둔다.
// 이 컨테이너에는 '시세' 개념이 존재하지 않는다(quote ZERO).
// 체결가는 주문의 입력(priceKrw)으로 caller가 전달하고, 그 순간
// 'deepscan 소유의 시세'가 'paper-trade 소유의 체결 사실'로 귀속된다.
//
// 돈 표현 규칙:
//   - 금액(현금·체결액·수수료·세금): 원 단위 정수 (number, 검증 상한 내 안전)
//   - 평단가: centi-won(원×100) 정수 — DB의 avg_price_centiwon
//   - 가중평균·곱셈 중간값: BigInt (engine.ts 에서만)

export type Side = 'buy' | 'sell'

export type Account = {
  accountId: string
  name: string
  initialCashKrw: number
  cashKrw: number
  createdAt: string
}

export type Position = {
  accountId: string
  symbol: string
  name: string | null
  market: string | null
  quantity: number
  /** centi-won (원×100) */
  avgPriceCenti: number
  updatedAt: string
}

export type OrderRecord = {
  orderId: string
  accountId: string
  symbol: string
  name: string | null
  market: string | null
  side: Side
  type: 'market'
  quantity: number
  executedPriceKrw: number
  grossKrw: number
  feeKrw: number
  taxKrw: number
  /** 현금 변동 — 매수는 음수 */
  settlementKrw: number
  realizedPnlKrw: number | null
  positionAfter: { quantity: number; avgPriceCenti: number }
  cashAfterKrw: number
  at: string
}

export type LedgerEntry = {
  ledgerId: string
  accountId: string
  kind: 'deposit' | 'buy_settlement' | 'sell_settlement'
  amountKrw: number
  balanceAfterKrw: number
  refOrderId: string | null
  at: string
}

/** 요청별 주문 입력 — 체결가(priceKrw)는 caller가 deepscan에서 조회해 전달한다. */
export type OrderInput = {
  symbol: string
  side: Side
  quantity: number
  /** 체결 기준가 (원 단위 정수) — 이 컨테이너는 시세를 스스로 조회하지 않는다 */
  priceKrw: number
  name: string | null
  market: string | null
}
