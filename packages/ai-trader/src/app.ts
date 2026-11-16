// Hono 앱 팩토리 — 라우팅 + 에러 매핑. 테스트에서 app.request() 로 직접 구동한다 (paper-trade 계승).
// Phase 1: 수동 트리거 API. 서빙(주식일기·피드)은 Phase 3.

import { Hono } from 'hono'
import { DEFAULT_CHARACTERS } from './characters.ts'
import type { LoopDeps } from './loop.ts'
import { ensureAccount, runLoop, LoopError } from './loop.ts'

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

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

  /** 캐릭터 목록 — 레지스트리 상태 + 등록 시드 수 */
  app.get('/v1/characters', (c) => {
    const items = deps.store.listCharacters().map((ch) => ({
      slug: ch.slug,
      displayName: ch.displayName,
      temperament: ch.personaCard.temperament,
      narrativeGoal: ch.personaCard.narrativeGoal,
      cashGoalKrw: ch.cashGoalKrw,
      initialCashKrw: ch.initialCashKrw,
      paperTradeAccountId: ch.paperTradeAccountId,
      watchCount: ch.watchlist.length,
    }))
    return ok(c, { items, count: items.length, seeded: DEFAULT_CHARACTERS.length })
  })

  /** 계좌 부트스트랩 — 캐릭터=계좌 1개. 매핑이 없으면 paper-trade 계좌 생성(멱등). */
  app.post('/v1/characters/:slug/bootstrap', async (c) => {
    const character = await ensureAccount(deps, c.req.param('slug'))
    return ok(c, { slug: character.slug, displayName: character.displayName, accountId: character.paperTradeAccountId })
  })

  /** 매매 루프 1회 수동 실행 — 판단 로그(매수/매도/관망)를 남기고 결과를 반환 */
  app.post('/v1/characters/:slug/loop', async (c) => {
    const result = await runLoop(deps, c.req.param('slug'))
    return ok(c, result, 201)
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
