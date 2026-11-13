// Hono 앱 팩토리 — 라우팅 + 에러 매핑. 테스트에서 app.request() 로 직접 구동한다.
// 이 컨테이너는 시세를 조회하거나 노출하지 않는다(quote ZERO):
//   - 주문: caller가 전달한 priceKrw로 체결
//   - 포지션/요약: 자기 소유 데이터(수량·평단·원본)만 반환. 평가손익은 caller가 deepscan 시세로 계산

import { Hono } from 'hono'
import type { Account, OrderRecord } from './domain.ts'
import { EngineError, executeMarketOrder, isKrSymbol, positionBasisKrw } from './engine.ts'
import type { Rates } from './engine.ts'
import type { Store } from './store.ts'

export type AppDeps = {
  store: Store
  rates: Rates
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function createApp({ store, rates }: AppDeps) {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message, ...error.details } }, error.status)
    }
    if (error instanceof EngineError) {
      const status = error.code === 'trade_halted' ? 409 : 400
      return c.json({ ok: false, error: { code: error.code, message: error.message, ...error.details } }, status)
    }
    console.error('[paper-trade] unhandled:', error)
    return c.json({ ok: false, error: { code: 'internal', message: 'internal server error' } }, 500)
  })

  const ok = <T>(c: Parameters<ReturnType<typeof app.fetch>>[0], data: T, status: 200 | 201 = 200) =>
    c.json({ ok: true, data }, status)

  const requireAccount = (accountId: string): Account => {
    const account = store.getAccount(accountId)
    if (!account) {
      throw new AppError(404, 'account_not_found', `존재하지 않는 계좌: ${accountId}`)
    }
    return account
  }

  app.post('/v1/accounts', async (c) => {
    const body = await c.req.json().catch(() => null) as { name?: unknown; initialCashKrw?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (name.length === 0 || name.length > 100) {
      throw new AppError(400, 'invalid_name', 'name은 1~100자 문자열이어야 합니다')
    }
    const initialCashKrw = body?.initialCashKrw
    if (typeof initialCashKrw !== 'number' || !Number.isInteger(initialCashKrw) || initialCashKrw < 0 || initialCashKrw > 10_000_000_000_000) {
      throw new AppError(400, 'invalid_initial_cash', 'initialCashKrw는 0 이상 정수(원)여야 합니다')
    }
    return ok(c, store.createAccount(name, initialCashKrw), 201)
  })

  app.get('/v1/accounts', (c) => ok(c, store.listAccounts()))

  /** 계좌 요약 — 자기 데이터만: 현금·포지션 수·매입원본·실현손익 누계. 시세 평가는 caller 몫. */
  app.get('/v1/accounts/:id', (c) => {
    const account = requireAccount(c.req.param('id'))
    const positions = store.listPositions(account.accountId)
    const orders = store.listOrders(account.accountId)
    const investedBasisKrw = positions.reduce((sum, p) => sum + positionBasisKrw(p), 0)
    const realizedPnlTotalKrw = orders.reduce((sum, o) => sum + (o.realizedPnlKrw ?? 0), 0)
    const feeTotalKrw = orders.reduce((sum, o) => sum + o.feeKrw + o.taxKrw, 0)
    return ok(c, {
      ...account,
      positionCount: positions.length,
      investedBasisKrw,
      realizedPnlTotalKrw,
      feeTotalKrw,
    })
  })

  /** 보유종목 — 수량·평단·매입원본만. currentPrice/pnl 은 의도적으로 없음(시세 노출 금지). */
  app.get('/v1/accounts/:id/positions', (c) => {
    const account = requireAccount(c.req.param('id'))
    const items = store.listPositions(account.accountId).map((p) => ({
      symbol: p.symbol,
      name: p.name,
      market: p.market,
      quantity: p.quantity,
      avgPriceKrw: p.avgPriceCenti / 100,
      avgPriceCenti: p.avgPriceCenti,
      basisKrw: positionBasisKrw(p),
      updatedAt: p.updatedAt,
    }))
    return ok(c, { items, count: items.length })
  })

  app.post('/v1/accounts/:id/orders', async (c) => {
    const account = requireAccount(c.req.param('id'))
    const body = await c.req.json().catch(() => null) as {
      symbol?: unknown
      side?: unknown
      quantity?: unknown
      priceKrw?: unknown
      name?: unknown
      market?: unknown
    } | null

    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
    if (symbol && !isKrSymbol(symbol)) {
      throw new AppError(
        501,
        'kr_symbol_only',
        '한국 주식(6자리 종목코드)만 지원합니다',
        { symbol },
      )
    }

    const order = {
      symbol,
      side: body?.side as 'buy' | 'sell',
      quantity: body?.quantity as number,
      priceKrw: body?.priceKrw as number,
      name: typeof body?.name === 'string' ? body.name : null,
      market: typeof body?.market === 'string' ? body.market : null,
    }

    const position = store.getPosition(account.accountId, order.symbol)
    const execution = executeMarketOrder({ cashKrw: account.cashKrw, position, order, rates })
    const record: OrderRecord = store.applyExecution(account.accountId, order, execution)
    return ok(c, record, 201)
  })

  app.get('/v1/accounts/:id/orders', (c) => {
    const account = requireAccount(c.req.param('id'))
    return ok(c, { items: store.listOrders(account.accountId) })
  })

  app.get('/v1/accounts/:id/ledger', (c) => {
    const account = requireAccount(c.req.param('id'))
    return ok(c, { items: store.listLedger(account.accountId) })
  })

  app.notFound((c) => c.json({ ok: false, error: { code: 'not_found', message: 'unknown route' } }, 404))

  return app
}
