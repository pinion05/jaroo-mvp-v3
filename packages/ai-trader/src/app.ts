// Hono 앱 팩토리 — 라우팅 + 에러 매핑. 테스트에서 app.request() 로 직접 구동한다 (paper-trade 계승).
// v2 C1 정리: 결정·실행 절차는 폐기. 생존 API = 계좌 부트스트랩·상태 적재(load)·판단 로그 저장/조회·원장 패스스루.

import { Hono } from 'hono'
import { DEFAULT_CHARACTERS } from './characters.ts'
import type { JudgmentInput } from './domain.ts'
import type { LoopDeps } from './loop.ts'
import { ensureAccount, loadTurnContext, LoopError } from './loop.ts'
import { nowKstIso } from './journal.ts'

export function createApp(deps: LoopDeps) {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof LoopError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status)
    }
    console.error('[ai-trader] unhandled:', error)
    return c.json({ ok: false, error: { code: 'internal', message: 'internal server error' } }, 500)
  })

  const ok = <T>(c: Parameters<ReturnType<typeof app.fetch>>[0], data: T, status: 200 | 201 = 200) =>
    c.json({ ok: true, data }, status)

  const requireCharacter = async (slug: string) => {
    const character = deps.store.getCharacter(slug)
    if (!character) {
      throw new LoopError(404, 'character_not_found', `존재하지 않는 캐릭터: ${slug}`)
    }
    return character
  }

  /** 캐릭터 목록 — 레지스트리 상태 */
  app.get('/v1/characters', (c) => {
    const items = deps.store.listCharacters().map((ch) => ({
      slug: ch.slug,
      displayName: ch.displayName,
      temperament: ch.personaCard.temperament,
      narrativeGoal: ch.personaCard.narrativeGoal,
      principles: ch.personaCard.principles,
      cashGoalKrw: ch.cashGoalKrw,
      initialCashKrw: ch.initialCashKrw,
      paperTradeAccountId: ch.paperTradeAccountId,
    }))
    return ok(c, { items, count: items.length, seeded: DEFAULT_CHARACTERS.length })
  })

  /** 계좌 부트스트랩 — 캐릭터=계좌 1개. 매핑이 없으면 paper-trade 계좌 생성(멱등). */
  app.post('/v1/characters/:slug/bootstrap', async (c) => {
    const character = await ensureAccount(deps, c.req.param('slug'))
    return ok(c, { slug: character.slug, displayName: character.displayName, accountId: character.paperTradeAccountId })
  })

  /** [phase=load] 턴 출발 상태 적재 — 원장×시세 fresh 스냅샷. 판단 없음(⑤는 2.5b). */
  app.post('/v1/characters/:slug/load', async (c) => {
    const context = await loadTurnContext(deps, c.req.param('slug'))
    return ok(c, context, 201)
  })

  /** 판단 로그 저장 — 실행 계층이 ⑤ 결정(+체결 결과)을 전달하면 그대로 영속화 (D9 근거는 fact에) */
  app.post('/v1/characters/:slug/judgments', async (c) => {
    await requireCharacter(c.req.param('slug'))
    const body = await c.req.json().catch(() => null) as Partial<JudgmentInput> | null
    const decision = body?.decision
    if (decision !== 'buy' && decision !== 'sell' && decision !== 'hold') {
      return c.json({ ok: false, error: { code: 'invalid_decision', message: "decision은 'buy'|'sell'|'hold'여야 합니다" } }, 400)
    }
    if (typeof body?.rationale !== 'string' || body.rationale.trim().length === 0) {
      return c.json({ ok: false, error: { code: 'invalid_rationale', message: 'rationale(서사)은 필수입니다' } }, 400)
    }
    const reasonCode = typeof body?.reasonCode === 'string' && body.reasonCode.trim() ? body.reasonCode.trim() : 'untagged'
    const entry = deps.store.appendJudgment(c.req.param('slug'), nowKstIso(), {
      decision,
      symbol: typeof body?.symbol === 'string' ? body.symbol : null,
      quantity: typeof body?.quantity === 'number' ? body.quantity : null,
      priceKrw: typeof body?.priceKrw === 'number' ? body.priceKrw : null,
      reasonCode,
      fact: (body?.fact && typeof body.fact === 'object' ? body.fact : {}) as Record<string, unknown>,
      rationale: body.rationale,
      order: {
        orderId: typeof body?.order?.orderId === 'string' ? body.order.orderId : null,
        orderStatus: body?.order?.orderStatus ?? 'skipped',
        errorMessage: body?.order?.errorMessage ?? null,
      },
    })
    return ok(c, entry, 201)
  })

  /** 판단 로그 조회 — "AI 판단 로그 공개" 원재료 */
  app.get('/v1/characters/:slug/journal', async (c) => {
    await requireCharacter(c.req.param('slug'))
    const limitRaw = Number(c.req.query('limit') ?? 50)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? Math.floor(limitRaw) : 50
    return ok(c, { items: deps.store.listJudgments(c.req.param('slug'), limit) })
  })

  /** 매매 입증 피드 — paper-trade 원장 패스스루 (사실의 소스) */
  app.get('/v1/characters/:slug/orders', async (c) => {
    const character = await requireCharacter(c.req.param('slug'))
    if (!character.paperTradeAccountId) {
      return ok(c, { items: [], hint: 'bootstrap 먼저 실행 — 계좌 매핑이 없음' })
    }
    const orders = await deps.paper.listOrders(character.paperTradeAccountId)
    return ok(c, orders)
  })

  app.notFound((c) => c.json({ ok: false, error: { code: 'not_found', message: 'unknown route' } }, 404))

  return app
}
