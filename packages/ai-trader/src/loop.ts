// 매매 루프 — 오케스트레이터의 심장 (spec §5).
// ① 원장에서 계좌·포지션·마지막 체결 조회 → ② 시세 조회 → ③ 규칙 엔진 판단
// → ④ paper-trade 체결(가격을 실어 보냄) → ⑤ 판단 로그 저장.
// Phase 1 은 수동 트리거(POST /v1/characters/:slug/loop). 정기 실행은 Phase 2 스케줄러.

import type { Character, Decision, JudgmentEntry } from './domain.ts'
import { renderRationale } from './rationale.ts'
import { nowKstIso, Store } from './journal.ts'
import type { PaperGateway } from './papertrade.ts'
import { synthesizeDecisions } from './strategy.ts'
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
  now?: () => number
}

/** 계좌 부트스트랩 — 캐릭터=계좌 1개(spec D1). 매핑이 없으면 생성해 등록(멱등). */
export async function ensureAccount(deps: LoopDeps, slug: string): Promise<Character> {
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

export type LoopResult = {
  character: { slug: string; displayName: string; accountId: string }
  loopAt: string
  decisions: JudgmentEntry[]
}

export async function runLoop(deps: LoopDeps, slug: string): Promise<LoopResult> {
  const character = await ensureAccount(deps, slug)
  const accountId = character.paperTradeAccountId
  if (!accountId) {
    throw new LoopError(500, 'account_missing', `계좌 매핑이 없음: ${slug}`)
  }

  // ① 원장 상태 — 사실의 소스
  const [account, positionsResult, ordersResult] = await Promise.all([
    deps.paper.getAccount(accountId),
    deps.paper.listPositions(accountId),
    deps.paper.listOrders(accountId),
  ])
  const lastOrderAt = ordersResult.items.reduce<string | null>((latest, order) => {
    if (!latest) return order.at
    return Date.parse(order.at) > Date.parse(latest) ? order.at : latest
  }, null)

  // ② 시세 — 시세 소유자에게서만
  const symbols = Array.from(
    new Set([...character.watchlist.map((w) => w.symbol), ...positionsResult.items.map((p) => p.symbol)]),
  )
  const quotes = await deps.quotes.getQuotes(symbols)

  // ③ 규칙 엔진 (순수)
  const decisions = synthesizeDecisions({
    params: character.strategyParams,
    watchlist: character.watchlist,
    snapshot: {
      cashKrw: account.cashKrw,
      positions: positionsResult.items.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        quantity: p.quantity,
        avgPriceKrw: p.avgPriceKrw,
      })),
      lastOrderAt,
    },
    quotes,
    nowMs: (deps.now ?? Date.now)(),
  })

  // ④⑤ 체결 + 판단 로그 — 매수/매도/관망 전부 기록한다("AI 판단 로그 공개")
  const loopAt = nowKstIso()
  const entries: JudgmentEntry[] = []
  for (const decision of decisions) {
    const rationale = renderRationale(character, decision)
    if (decision.kind === 'hold') {
      entries.push(deps.store.appendJudgment(slug, loopAt, decision, rationale, { orderId: null, orderStatus: 'skipped', errorMessage: null }))
      continue
    }
    const watchName = character.watchlist.find((w) => w.symbol === decision.symbol)?.name ?? null
    try {
      const order = await deps.paper.placeOrder(accountId, {
        symbol: decision.symbol,
        side: decision.kind,
        quantity: decision.quantity,
        priceKrw: decision.priceKrw,
        name: watchName,
        market: 'KR',
      })
      entries.push(deps.store.appendJudgment(slug, loopAt, decision, rationale, { orderId: order.orderId, orderStatus: 'placed', errorMessage: null }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entries.push(deps.store.appendJudgment(slug, loopAt, decision, rationale, { orderId: null, orderStatus: 'failed', errorMessage: message }))
    }
  }

  return {
    character: { slug: character.slug, displayName: character.displayName, accountId },
    loopAt,
    decisions: entries,
  }
}

export type { Decision }
