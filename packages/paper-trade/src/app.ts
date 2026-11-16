// HTTP 앱 팩토리 — node:http 라우팅 + 에러 매핑. 프레임워크/Hono 없음(의존성 0).
// 테스트·운영 모두 이 핸들러를 createServer로 띄워 구동한다.
// 이 컨테이너는 시세를 조회하거나 노출하지 않는다(quote ZERO):
//   - 주문: caller가 전달한 priceKrw로 체결
//   - 포지션/요약: 자기 소유 데이터(수량·평단·원본)만 반환. 평가손익은 caller가 deepscan 시세로 계산
//
// 응답 계약(불변): 성공 {ok:true,data}, 실패 {ok:false,error:{code,message,...details}}.
// 모든 응답 content-type은 application/json; charset=utf-8.

import type { IncomingMessage, ServerResponse } from 'node:http'
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

/** 요청 바디 상한 — 32KB 초과 시 즉시 413(메모리 보호 가드). */
const MAX_BODY_BYTES = 32 * 1024

type Params = Record<string, string>

/** 라우트 핸들러 — req/res를 받지 않고 원시값(params·body)만 받는다(클로저 장기 생존 방지). */
type RouteHandler = (params: Params, body: unknown) => { status: 200 | 201; data: unknown }

type Route = {
  method: 'GET' | 'POST'
  segments: string[]
  handler: RouteHandler
}

export function createApp({ store, rates }: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const requireAccount = (accountId: string): Account => {
    const account = store.getAccount(accountId)
    if (!account) {
      throw new AppError(404, 'account_not_found', `존재하지 않는 계좌: ${accountId}`)
    }
    return account
  }

  const routes: Route[] = [
    {
      method: 'POST',
      segments: ['v1', 'accounts'],
      handler: (_params, body) => {
        const b = body as { name?: unknown; initialCashKrw?: unknown } | null
        const name = typeof b?.name === 'string' ? b.name.trim() : ''
        if (name.length === 0 || name.length > 100) {
          throw new AppError(400, 'invalid_name', 'name은 1~100자 문자열이어야 합니다')
        }
        const initialCashKrw = b?.initialCashKrw
        if (typeof initialCashKrw !== 'number' || !Number.isInteger(initialCashKrw) || initialCashKrw < 0 || initialCashKrw > 10_000_000_000_000) {
          throw new AppError(400, 'invalid_initial_cash', 'initialCashKrw는 0 이상 정수(원)여야 합니다')
        }
        return { status: 201, data: store.createAccount(name, initialCashKrw) }
      },
    },
    {
      method: 'GET',
      segments: ['v1', 'accounts'],
      handler: () => ({ status: 200, data: store.listAccounts() }),
    },
    /** 계좌 요약 — 자기 데이터만: 현금·포지션 수·매입원본·실현손익 누계. 시세 평가는 caller 몫. */
    {
      method: 'GET',
      segments: ['v1', 'accounts', ':id'],
      handler: (params) => {
        const account = requireAccount(params['id'] as string)
        const positions = store.listPositions(account.accountId)
        const orders = store.listOrders(account.accountId)
        const investedBasisKrw = positions.reduce((sum, p) => sum + positionBasisKrw(p), 0)
        const realizedPnlTotalKrw = orders.reduce((sum, o) => sum + (o.realizedPnlKrw ?? 0), 0)
        const feeTotalKrw = orders.reduce((sum, o) => sum + o.feeKrw + o.taxKrw, 0)
        return {
          status: 200,
          data: {
            ...account,
            positionCount: positions.length,
            investedBasisKrw,
            realizedPnlTotalKrw,
            feeTotalKrw,
          },
        }
      },
    },
    /** 보유종목 — 수량·평단·매입원본만. currentPrice/pnl 은 의도적으로 없음(시세 노출 금지). */
    {
      method: 'GET',
      segments: ['v1', 'accounts', ':id', 'positions'],
      handler: (params) => {
        const account = requireAccount(params['id'] as string)
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
        return { status: 200, data: { items, count: items.length } }
      },
    },
    {
      method: 'POST',
      segments: ['v1', 'accounts', ':id', 'orders'],
      handler: (params, body) => {
        const account = requireAccount(params['id'] as string)
        const b = body as {
          symbol?: unknown
          side?: unknown
          quantity?: unknown
          priceKrw?: unknown
          name?: unknown
          market?: unknown
        } | null

        const symbol = typeof b?.symbol === 'string' ? b.symbol.trim().toUpperCase() : ''
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
          side: b?.side as 'buy' | 'sell',
          quantity: b?.quantity as number,
          priceKrw: b?.priceKrw as number,
          name: typeof b?.name === 'string' ? b.name : null,
          market: typeof b?.market === 'string' ? b.market : null,
        }

        const position = store.getPosition(account.accountId, order.symbol)
        const execution = executeMarketOrder({ cashKrw: account.cashKrw, position, order, rates })
        const record: OrderRecord = store.applyExecution(account.accountId, order, execution)
        return { status: 201, data: record }
      },
    },
    {
      method: 'GET',
      segments: ['v1', 'accounts', ':id', 'orders'],
      handler: (params) => {
        const account = requireAccount(params['id'] as string)
        return { status: 200, data: { items: store.listOrders(account.accountId) } }
      },
    },
    {
      method: 'GET',
      segments: ['v1', 'accounts', ':id', 'ledger'],
      handler: (params) => {
        const account = requireAccount(params['id'] as string)
        return { status: 200, data: { items: store.listLedger(account.accountId) } }
      },
    },
  ]

  /** 메서드+경로 매칭 — 빈 세그먼트(후행 슬래시 등)는 매칭 실패(기존 Hono strict 동작과 동일). */
  function matchRoute(method: string, segments: string[]): { handler: RouteHandler; params: Params } | null {
    const effectiveMethod = method === 'HEAD' ? 'GET' : method
    outer: for (const route of routes) {
      if (route.method !== effectiveMethod) continue
      if (route.segments.length !== segments.length) continue
      const params: Params = {}
      for (let i = 0; i < route.segments.length; i++) {
        const pattern = route.segments[i] as string
        const segment = segments[i]
        if (segment === undefined || segment === '') continue outer
        if (pattern.startsWith(':')) {
          try {
            params[pattern.slice(1)] = decodeURIComponent(segment)
          } catch {
            params[pattern.slice(1)] = segment // 잘못된 퍼센트 인코딩은 원시값 사용
          }
        } else if (pattern !== segment) {
          continue outer
        }
      }
      return { handler: route.handler, params }
    }
    return null
  }

  /** 바디를 최대 32KB까지 읽어 원시 문자열로 반환. 초과/에러 시 onTooLarge 호출 후 null. */
  function readBody(req: IncomingMessage, onTooLarge: () => void): Promise<string | null> {
    return new Promise((resolve) => {
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        onTooLarge()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      let aborted = false
      req.on('data', (chunk: Buffer) => {
        if (aborted) return
        total += chunk.length
        if (total > MAX_BODY_BYTES) {
          aborted = true
          chunks.length = 0
          req.pause()
          onTooLarge()
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'))
      })
      req.on('error', () => {
        if (!aborted) resolve(null)
      })
    })
  }

  /** JSON 파싱 실패는 null 취급(기존 .catch(() => null) 의미 유지). */
  function parseJsonBody(raw: string | null): unknown {
    if (raw === null) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, payload: unknown, close = false): void => {
      if (res.headersSent) return
      const body = JSON.stringify(payload)
      const headers: Record<string, string | number> = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      }
      if (close) headers['connection'] = 'close'
      res.writeHead(status, headers)
      if (close) {
        res.end(body, () => res.socket?.destroy())
      } else {
        res.end(body)
      }
    }

    const ok = (data: unknown, status: 200 | 201 = 200): void => send(status, { ok: true, data })

    const fail = (status: number, error: Record<string, unknown>): void =>
      send(status, { ok: false, error })

    const notFound = (): void => fail(404, { code: 'not_found', message: 'unknown route' })

    const unhandled = (error: unknown): void => {
      console.error('[paper-trade] unhandled:', error)
      fail(500, { code: 'internal', message: 'internal server error' })
    }

    void (async () => {
      // 클라이언트가 요청 도중 끊어도 프로세스가 죽지 않게
      req.on('error', () => undefined)
      res.on('error', () => undefined)

      const method = req.method ?? 'GET'
      const path = (req.url ?? '/').split('?')[0] as string
      const segments = path.startsWith('/') ? path.slice(1).split('/') : path.split('/')

      // 바디를 실을 수 있는 메서드만 읽는다. GET/HEAD/OPTIONS은 잔여 바디를 버린다.
      let body: unknown = null
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        const raw = await readBody(req, () => {
          // 413 — 응답 후 연결 종료. 남은 바디는 읽지 않는다(메모리 보호).
          send(413, { ok: false, error: { code: 'payload_too_large', message: `요청 바디가 ${MAX_BODY_BYTES}바이트 상한을 초과했습니다` } }, true)
        })
        if (res.writableEnded) return
        body = parseJsonBody(raw)
      } else {
        req.resume()
      }

      const match = matchRoute(method, segments)
      if (!match) {
        notFound()
        return
      }

      try {
        const { status, data } = match.handler(match.params, body)
        ok(data, status)
      } catch (error) {
        if (error instanceof AppError) {
          fail(error.status, { code: error.code, message: error.message, ...error.details })
          return
        }
        if (error instanceof EngineError) {
          const status = error.code === 'trade_halted' ? 409 : 400
          fail(status, { code: error.code, message: error.message, ...error.details })
          return
        }
        unhandled(error)
      }
    })().catch(unhandled)
  }
}
