// 체결 시뮬레이션 엔진 — 순수 함수만 둔다 (I/O 금지, DB·시세 조회 금지).
// 한국 주식(KRW). 장시간 무시: caller가 준 가격이 곧 체결가다 (시세 책임은 컨테이너 밖).
//
// 규칙:
//   매수) 평단가 = (기존수량×기존평단 + 체결수량×체결가) / 총수량   [반올림, centi-won]
//         현금 차감 = 체결액 + 수수료(매수)              ← 거래세 없음
//   매도) 평단가 불변·수량 감소
//         현금 증가 = 체결액 − 수수료(매도) − 증권거래세(매도)
//         실현손익 = 현금 증가액 − 기존평단×수량
//   수수료/세금 = 원 단위 올림. 모든 곱셈 중간값은 BigInt (부동소수점 배제).

import type { OrderInput, Position } from './domain.ts'

/** bps×10 정수 (0.015% = 1.5bps = feeX10 15) */
export type Rates = { feeBpsX10: number; taxBpsX10: number }

export const DEFAULT_RATES: Rates = { feeBpsX10: 15, taxBpsX10: 150 } // 수수료 0.015%, 거래세 0.15%

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/** 검증 상한 — Number 정확도(2^53) 보호. 1회 체결액 10조원 / 수량 10억주 / 주가 10억원. */
const MAX_GROSS_KRW = 10_000_000_000_000
const MAX_QTY = 1_000_000_000
const MAX_PRICE_KRW = 1_000_000_000

export function isKrSymbol(symbol: string): boolean {
  return /^[0-9A-Z]{6}$/.test(symbol)
}

export function validateOrderInput(order: OrderInput): void {
  if (!isKrSymbol(order.symbol)) {
    throw new EngineError('invalid_symbol', `한국 주식 종목코드(6자리)만 지원합니다: ${order.symbol}`, {
      symbol: order.symbol,
    })
  }
  if (order.side !== 'buy' && order.side !== 'sell') {
    throw new EngineError('invalid_side', `side must be 'buy' | 'sell': ${String(order.side)}`)
  }
  if (!Number.isInteger(order.quantity) || order.quantity <= 0 || order.quantity > MAX_QTY) {
    throw new EngineError('invalid_quantity', `quantity는 1 이상 ${MAX_QTY} 이하 정수: ${String(order.quantity)}`)
  }
  if (!Number.isInteger(order.priceKrw) || order.priceKrw <= 0 || order.priceKrw > MAX_PRICE_KRW) {
    throw new EngineError('invalid_price', `priceKrw는 1 이상 ${MAX_PRICE_KRW.toLocaleString()} 이하 정수(원): ${String(order.priceKrw)}`)
  }
}

/** 양수 BigInt 나눗셈 올림 */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

/** 양수 BigInt 나눗셈 반올림(half-up) */
function roundDiv(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n)
}

export function computeFeeKrw(grossKrw: number, rates: Rates): number {
  return Number(ceilDiv(BigInt(grossKrw) * BigInt(rates.feeBpsX10), 100_000n))
}

export function computeSellTaxKrw(grossKrw: number, rates: Rates): number {
  return Number(ceilDiv(BigInt(grossKrw) * BigInt(rates.taxBpsX10), 100_000n))
}

/** 매수 후 다음 평단가 (centi-won, 반올림) */
export function nextAvgPriceCenti(
  prevQty: number,
  prevAvgCenti: number,
  tradeQty: number,
  tradePriceKrw: number,
): number {
  const total = BigInt(prevQty) + BigInt(tradeQty)
  const numerator = BigInt(prevQty) * BigInt(prevAvgCenti) + BigInt(tradeQty) * BigInt(tradePriceKrw) * 100n
  return Number(roundDiv(numerator, total))
}

/** 보유 원본(매입 기준액) — 평단가×수량, 자기 소유 데이터만으로 계산 */
export function positionBasisKrw(position: Pick<Position, 'quantity' | 'avgPriceCenti'>): number {
  return Number(roundDiv(BigInt(position.avgPriceCenti) * BigInt(position.quantity), 100n))
}

export type Execution = {
  side: 'buy' | 'sell'
  symbol: string
  quantity: number
  executedPriceKrw: number
  grossKrw: number
  feeKrw: number
  taxKrw: number
  settlementKrw: number
  realizedPnlKrw: number | null
  positionAfter: { quantity: number; avgPriceCenti: number }
  cashAfterKrw: number
}

/**
 * 체결 시뮬레이션 — caller가 전달한 가격(order.priceKrw)으로 즉시 체결.
 * 시세 검증(신선도·거래정지 여부)은 시세 소유자(caller)의 책임이다.
 */
export function executeMarketOrder(params: {
  cashKrw: number
  position: Pick<Position, 'quantity' | 'avgPriceCenti'> | null
  order: OrderInput
  rates: Rates
}): Execution {
  const { cashKrw, position, order, rates } = params
  validateOrderInput(order)

  const price = order.priceKrw
  const qty = order.quantity
  const grossKrw = price * qty
  if (grossKrw > MAX_GROSS_KRW) {
    throw new EngineError('order_too_large', `1회 체결액 상한(${MAX_GROSS_KRW.toLocaleString()}원) 초과`, {
      grossKrw,
    })
  }

  const feeKrw = computeFeeKrw(grossKrw, rates)
  const prevQty = position?.quantity ?? 0
  const prevAvgCenti = position?.avgPriceCenti ?? 0

  if (order.side === 'buy') {
    const debit = grossKrw + feeKrw
    if (debit > cashKrw) {
      throw new EngineError('insufficient_cash', '주문 가능 현금이 부족합니다', {
        requiredKrw: debit,
        cashKrw,
      })
    }
    return {
      side: 'buy',
      symbol: order.symbol,
      quantity: qty,
      executedPriceKrw: price,
      grossKrw,
      feeKrw,
      taxKrw: 0,
      settlementKrw: -debit,
      realizedPnlKrw: null,
      positionAfter: {
        quantity: prevQty + qty,
        avgPriceCenti: nextAvgPriceCenti(prevQty, prevAvgCenti, qty, price),
      },
      cashAfterKrw: cashKrw - debit,
    }
  }

  // 매도
  if (qty > prevQty) {
    throw new EngineError('insufficient_quantity', '보유 수량을 초과하는 매도입니다', {
      held: prevQty,
      requested: qty,
    })
  }
  const taxKrw = computeSellTaxKrw(grossKrw, rates)
  const netProceeds = grossKrw - feeKrw - taxKrw
  // 매도 원본(과세 기준) = 평단×수량, centi → 원 반올림
  const basisKrw = Number(roundDiv(BigInt(prevAvgCenti) * BigInt(qty), 100n))
  return {
    side: 'sell',
    symbol: order.symbol,
    quantity: qty,
    executedPriceKrw: price,
    grossKrw,
    feeKrw,
    taxKrw,
    settlementKrw: netProceeds,
    realizedPnlKrw: netProceeds - basisKrw,
    positionAfter: {
      quantity: prevQty - qty,
      avgPriceCenti: prevQty - qty > 0 ? prevAvgCenti : 0,
    },
    cashAfterKrw: cashKrw + netProceeds,
  }
}
