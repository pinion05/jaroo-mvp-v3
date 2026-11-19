// [phase=load] 상태 적재 — v2 턴 파이프라인의 첫 단계만 담당 (2026-11-19 C1 정리).
// 결정(⑤ 페르소나 LLM)·실행(물리 가드레일)·컴파일은 2.5a/2.5b/3에서 합류한다.
//
// 이 패키지의 생존 자산: 계좌 매핑(=캐릭터), 원장·시세 상태 적재, 판단 로그 저장.
// 폐기됨: 시세 규칙 결정 엔진·템플릿 서사·정적 reason_code (spec D7/D8/D10 v2 개정).

import type { TurnContext } from './domain.ts'
import { nowKstIso, Store } from './journal.ts'
import type { PaperGateway } from './papertrade.ts'
import type { QuotesProvider } from './quotes.ts'

export class LoopError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LoopError'
  }
}

export type LoopDeps = {
  store: Store
  paper: PaperGateway
  quotes: QuotesProvider
}

/** 계좌 부트스트랩 — 캐릭터=계좌 1개(spec D1). 매핑이 없으면 생성해 등록(멱등). */
export async function ensureAccount(deps: LoopDeps, slug: string) {
  const character = deps.store.getCharacter(slug)
  if (!character) {
    throw new LoopError(404, 'character_not_found', `존재하지 않는 캐릭터: ${slug}`)
  }
  if (character.paperTradeAccountId) return character

  const account = await deps.paper.createAccount(character.displayName, character.initialCashKrw)
  deps.store.attachAccount(slug, account.accountId)
  const attached = deps.store.getCharacter(slug)
  if (!attached) {
    throw new LoopError(500, 'character_attach_failed', `계좌 매핑 저장 실패: ${slug}`)
  }
  return attached
}

/** 턴 출발 상태 적재 — 원장(진실 소스) × 시세(체결가·평가용) → fresh 파생값(D5). 판단은 하지 않는다. */
export async function loadTurnContext(deps: LoopDeps, slug: string): Promise<TurnContext> {
  const character = await ensureAccount(deps, slug)
  const accountId = character.paperTradeAccountId
  if (!accountId) {
    throw new LoopError(500, 'account_missing', `계좌 매핑이 없음: ${slug}`)
  }

  const [account, positionsResult, ordersResult] = await Promise.all([
    deps.paper.getAccount(accountId),
    deps.paper.listPositions(accountId),
    deps.paper.listOrders(accountId),
  ])
  const lastOrderAt = ordersResult.items.reduce<string | null>((latest, order) => {
    if (!latest) return order.at
    return Date.parse(order.at) > Date.parse(latest) ? order.at : latest
  }, null)

  const symbols = positionsResult.items.map((p) => p.symbol)
  const quoteMap = await deps.quotes.getQuotes(symbols)
  const quotes = Array.from(quoteMap.values())

  const unrealizedPctBySymbol: Record<string, number> = {}
  const positionsValueKrw = positionsResult.items.reduce((sum, p) => {
    const price = quoteMap.get(p.symbol)?.priceKrw
    if (price !== undefined && p.avgPriceKrw > 0) {
      unrealizedPctBySymbol[p.symbol] = Math.round(((price - p.avgPriceKrw) / p.avgPriceKrw) * 10_000) / 10_000
    }
    return sum + p.quantity * (price ?? p.avgPriceKrw)
  }, 0)
  const equityKrw = account.cashKrw + positionsValueKrw
  const cashGoalProgressPct =
    character.cashGoalKrw && character.cashGoalKrw > 0
      ? Math.min(1, equityKrw / character.cashGoalKrw)
      : null

  return {
    character: { slug: character.slug, displayName: character.displayName, accountId },
    loadedAt: nowKstIso(),
    ledger: {
      cashKrw: account.cashKrw,
      investedBasisKrw: account.investedBasisKrw ?? 0,
      realizedPnlTotalKrw: account.realizedPnlTotalKrw ?? 0,
      feeTotalKrw: account.feeTotalKrw ?? 0,
      orderCount: ordersResult.items.length,
      lastOrderAt,
      positions: positionsResult.items.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        quantity: p.quantity,
        avgPriceKrw: p.avgPriceKrw,
      })),
    },
    quotes,
    valuation: { positionsValueKrw, equityKrw, unrealizedPctBySymbol, cashGoalProgressPct },
  }
}
