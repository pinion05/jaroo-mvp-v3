// 성향 규칙 엔진 — 순수 함수, I/O 없음 (spec D7: 매매 결정=규칙, LLM은 서사만).
// 결정론: watchlist 순서대로 순회하며 같은 입력에 항상 같은 출력을 낸다.
//
// 규칙 우선순위:
//   1. 위험 관리(매도) — 손절/익절은 빈도 게이트에 걸리지 않는다 (리스크 관리는 대기하지 않는다)
//   2. 빈도 게이트(매수) — 마지막 체결로부터 tradeFrequency 창이 지나지 않았으면 신규 매수 없음
//   3. 배분 매수(매수) — 종목당 maxPositionPct 한도, maxSymbols 상한, dip 조건(등락률 있을 때만)
//
// 매수 예산은 로컬로 차감해가며 계산한다(현금 초과 주문 방지) — 최종 사실은 paper-trade 체결이 보증.

import type { Decision, DecisionFact, PortfolioSnapshot, Quote, StrategyParams, WatchItem } from './domain.ts'

export const FREQ_WINDOW_HOURS: Record<StrategyParams['tradeFrequency'], number> = {
  daily: 24,
  weekly: 168,
}

/** 수수료(0.015%)+거래세 여유를 포함한 매수 가능 판정 배수 */
const CASH_BUFFER = 1.002

export function equityKrw(snapshot: PortfolioSnapshot, quotes: Map<string, Quote>): number {
  const positionsValue = snapshot.positions.reduce((sum, p) => {
    const price = quotes.get(p.symbol)?.priceKrw ?? p.avgPriceKrw
    return sum + p.quantity * price
  }, 0)
  return snapshot.cashKrw + positionsValue
}

export function hoursSinceLastOrder(snapshot: PortfolioSnapshot, nowMs: number): number | null {
  if (!snapshot.lastOrderAt) return null
  const at = Date.parse(snapshot.lastOrderAt)
  if (!Number.isFinite(at)) return null
  return (nowMs - at) / 3_600_000
}

function hold(symbol: string | null, reasonCode: Decision['reasonCode'], fact: DecisionFact): Decision {
  return { kind: 'hold', symbol, quantity: 0, priceKrw: 0, reasonCode, fact }
}

export type SynthesisInput = {
  params: StrategyParams
  watchlist: WatchItem[]
  snapshot: PortfolioSnapshot
  quotes: Map<string, Quote>
  nowMs: number
}

export function synthesizeDecisions(input: SynthesisInput): Decision[] {
  const { params, watchlist, snapshot, quotes, nowMs } = input
  const decisions: Decision[] = []
  const equity = equityKrw(snapshot, quotes)
  const windowHours = FREQ_WINDOW_HOURS[params.tradeFrequency]
  const sinceLast = hoursSinceLastOrder(snapshot, nowMs)

  // 1) 위험 관리 매도 — 보유 종목(심볼 오름차순) 결정론 순회
  const heldSymbols = snapshot.positions.map((p) => p.symbol).sort()
  for (const symbol of heldSymbols) {
    const position = snapshot.positions.find((p) => p.symbol === symbol)
    if (!position) continue
    const quote = quotes.get(symbol)
    if (!quote) {
      decisions.push(hold(symbol, 'quote_missing', {}))
      continue
    }
    const returnPct = (quote.priceKrw - position.avgPriceKrw) / position.avgPriceKrw
    const baseFact: DecisionFact = {
      avgPriceKrw: position.avgPriceKrw,
      currentPriceKrw: quote.priceKrw,
      returnPct: round4(returnPct),
    }
    if (returnPct <= -params.maxDrawdownPct) {
      decisions.push({
        kind: 'sell',
        symbol,
        quantity: position.quantity,
        priceKrw: quote.priceKrw,
        reasonCode: 'stop_loss',
        fact: { ...baseFact, thresholdPct: -params.maxDrawdownPct },
      })
    } else if (returnPct >= params.takeProfitPct) {
      decisions.push({
        kind: 'sell',
        symbol,
        quantity: position.quantity,
        priceKrw: quote.priceKrw,
        reasonCode: 'take_profit',
        fact: { ...baseFact, thresholdPct: params.takeProfitPct },
      })
    }
    // 밴드 내 보유는 판단 로그를 남기지 않는다(노이즈) — 매도/매도보류의 경계만 기록
  }

  // 2) 빈도 게이트 — 창이 안 지났으면 신규 매수 1건의 관망 판단만 남긴다
  const buysAllowed = sinceLast === null || sinceLast >= windowHours
  const firstCandidate = watchlist.find((w) => !snapshot.positions.some((p) => p.symbol === w.symbol))
  if (!buysAllowed) {
    if (firstCandidate) {
      decisions.push(
        hold(firstCandidate.symbol, 'frequency_gate', {
          windowHours,
          hoursSinceLastOrder: round1(sinceLast),
        }),
      )
    }
    return decisions
  }

  // 3) 배분 매수 — watchlist 순서(설정 순서) 결정론 순회
  let cash = snapshot.cashKrw
  let positionCount = snapshot.positions.length
  let cashExhausted = false
  let capped = false

  for (const item of watchlist) {
    if (snapshot.positions.some((p) => p.symbol === item.symbol)) continue
    if (capped) break
    if (cashExhausted) break

    if (positionCount >= params.maxSymbols) {
      decisions.push(
        hold(item.symbol, 'position_cap', { positionCount, maxSymbols: params.maxSymbols }),
      )
      capped = true
      break
    }

    const quote = quotes.get(item.symbol)
    if (!quote) {
      decisions.push(hold(item.symbol, 'quote_missing', {}))
      continue
    }

    // dip 게이트 — 등락률이 있을 때만 적용 (현재 시세 소스는 미제공 → allocation_buy 경로)
    if (quote.changePct !== null && quote.changePct > params.buyDipPct) {
      decisions.push(
        hold(item.symbol, 'no_signal', {
          changePct: round4(quote.changePct),
          thresholdPct: params.buyDipPct,
          currentPriceKrw: quote.priceKrw,
        }),
      )
      continue
    }

    // 종목당 한도가 주가 1주에 못 미치면 매수 불가 — 현금과 무관하므로 순회 유지
    const targetAmount = Math.round(equity * params.maxPositionPct)
    const capQuantity = Math.floor(targetAmount / quote.priceKrw)
    if (capQuantity < 1) {
      decisions.push(
        hold(item.symbol, 'cap_below_minimum', {
          equityKrw: equity,
          targetAmountKrw: targetAmount,
          currentPriceKrw: quote.priceKrw,
        }),
      )
      continue
    }

    const affordable = Math.floor((cash / CASH_BUFFER) / quote.priceKrw)
    const quantity = Math.min(capQuantity, affordable)
    if (quantity < 1) {
      decisions.push(
        hold(item.symbol, 'insufficient_cash', {
          equityKrw: equity,
          targetAmountKrw: targetAmount,
          cashKrw: cash,
          currentPriceKrw: quote.priceKrw,
        }),
      )
      cashExhausted = true
      break
    }

    const cost = Math.round(quantity * quote.priceKrw * CASH_BUFFER)
    decisions.push({
      kind: 'buy',
      symbol: item.symbol,
      quantity,
      priceKrw: quote.priceKrw,
      reasonCode: quote.changePct !== null ? 'dip_buy' : 'allocation_buy',
      fact: {
        changePct: quote.changePct === null ? null : round4(quote.changePct),
        equityKrw: equity,
        targetAmountKrw: targetAmount,
        cashKrw: cash,
        currentPriceKrw: quote.priceKrw,
      },
    })
    cash -= cost
    positionCount += 1
  }

  // 4) 아무 판단도 없었다면 — 관망 1건 (판단 로그는 빈 루프를 남기지 않는다)
  if (decisions.length === 0) {
    decisions.push(hold(null, 'no_signal', { cashKrw: snapshot.cashKrw, equityKrw: equity }))
  }
  return decisions
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10
}
