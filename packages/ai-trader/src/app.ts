// HTTP 앱 팩토리 — node:http 라우팅 + 에러 매핑. 프레임워크/Hono 없음(의존성 0, #378).
// 테스트·운영 모두 이 핸들러를 createServer로 띄워 구동한다 (paper-trade 계승).
//
// 응답 계약(불변): 성공 {ok:true,data}, 실패 {ok:false,error:{code,message,...details}}.
// 모든 응답 content-type은 application/json; charset=utf-8.
//
// #375(2026-11-23): judgments 필드 가드 — symbol 6자리·quantity/price 양의 정수·
// fact 8KB 상한·rationale 길이 상한. 쓰레기 로그가 UI·통계·기억 컴파일로 전파되지 않게.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_CHARACTERS } from './characters.ts'
import type { JudgmentInput } from './domain.ts'
import { ensureAccount, loadTurnContext, LoopError } from './loop.ts'
import type { LoopDeps } from './loop.ts'
import { nowKstIso } from './journal.ts'

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

/** 요청 바디 상한 — 32KB 초과 시 즉시 413(메모리 보호 가드, paper-trade 계승). */
const MAX_BODY_BYTES = 32 * 1024

/** #375 — fact 직렬화 상한(8KB). 32KB 바디 안에서도 fact 하나가 도배하지 못하게. */
const MAX_FACT_BYTES = 8 * 1024

type Params = Record<string, string>

/** 라우트 핸들러 — req/res를 받지 않고 원시값(params·body·query)만 받는다(클로저 장기 생존 방지). */
type RouteHandler = (
  params: Params,
  body: unknown,
  query: URLSearchParams,
) => Promise<{ status: 200 | 201; data: unknown }>

type Route = {
  method: 'GET' | 'POST'
  segments: string[]
  handler: RouteHandler
}

const SYMBOL_RE = /^\d{6}$/

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 1_000_000_000_000
}

export function createApp(deps: LoopDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const requireCharacter = (slug: string) => {
    const character = deps.store.getCharacter(slug)
    if (!character) {
      throw new LoopError(404, 'character_not_found', `존재하지 않는 캐릭터: ${slug}`)
    }
    return character
  }

  /** #375 — judgments 바디 검증. 통과 시 JudgmentInput, 실패 시 AppError(400). */
  function readJudgmentInput(body: unknown): JudgmentInput {
    const b = (body ?? {}) as Record<string, unknown>
    const order = (b.order ?? {}) as Record<string, unknown>

    const decision = b.decision
    if (decision !== 'buy' && decision !== 'sell' && decision !== 'hold') {
      throw new AppError(400, 'invalid_decision', "decision은 'buy'|'sell'|'hold'여야 합니다")
    }
    const rationale = typeof b.rationale === 'string' ? b.rationale.trim() : ''
    if (rationale.length === 0) {
      // B-2: filled인데 rationale 유실이면 로그가 버려진다 — 실행 계층은 fallback 서사를 보낼 것.
      throw new AppError(400, 'invalid_rationale', 'rationale(서사)은 필수입니다 — filled 판단이 유실됩니다')
    }
    if (rationale.length > 2_000) {
      // B-2: filled인데 유실되는 경로 중 하나 — 서사가 너무 길어도 로그가 버려진다.
      throw new AppError(400, 'invalid_rationale', 'rationale은 2000자 이하여야 합니다 — filled 판단이 유실됩니다')
    }
    if (b.symbol != null && (typeof b.symbol !== 'string' || !SYMBOL_RE.test(b.symbol))) {
      throw new AppError(400, 'invalid_symbol', 'symbol은 6자리 종목코드이거나 null이어야 합니다')
    }
    if (b.quantity != null && !isPositiveInt(b.quantity)) {
      throw new AppError(400, 'invalid_quantity', 'quantity는 양의 정수이거나 null이어야 합니다')
    }
    if (b.priceKrw != null && !isPositiveInt(b.priceKrw)) {
      throw new AppError(400, 'invalid_price', 'priceKrw는 양의 정수(원)이거나 null이어야 합니다')
    }
    const fact = b.fact && typeof b.fact === 'object' && !Array.isArray(b.fact) ? (b.fact as Record<string, unknown>) : {}
    if (Buffer.byteLength(JSON.stringify(fact), 'utf8') > MAX_FACT_BYTES) {
      throw new AppError(400, 'invalid_fact_size', `fact는 ${MAX_FACT_BYTES}바이트 이하여야 합니다`)
    }
    const reasonCodeRaw = typeof b.reasonCode === 'string' ? b.reasonCode.trim() : ''
    if (reasonCodeRaw.length > 100) {
      throw new AppError(400, 'invalid_reason_code', 'reasonCode는 100자 이하여야 합니다')
    }
    const orderStatus = order.orderStatus ?? 'skipped'
    if (orderStatus !== 'filled' && orderStatus !== 'skipped' && orderStatus !== 'failed') {
      throw new AppError(
        400,
        'invalid_order_status',
        "order.orderStatus는 'filled'|'skipped'|'failed'여야 합니다 (paper-trade는 즉시체결 — filled)",
      )
    }
    const orderId = order.orderId
    if (orderId != null && (typeof orderId !== 'string' || orderId.length > 64)) {
      throw new AppError(400, 'invalid_order_id', 'order.orderId는 64자 이하 문자열이거나 null이어야 합니다')
    }
    const errorMessage = order.errorMessage
    if (errorMessage != null && (typeof errorMessage !== 'string' || errorMessage.length > 500)) {
      throw new AppError(400, 'invalid_error_message', 'order.errorMessage는 500자 이하 문자열이거나 null이어야 합니다')
    }

    return {
      decision,
      symbol: (b.symbol as string | null) ?? null,
      quantity: (b.quantity as number | null) ?? null,
      priceKrw: (b.priceKrw as number | null) ?? null,
      reasonCode: reasonCodeRaw || 'untagged',
      fact,
      rationale,
      order: {
        orderId: (orderId as string | null) ?? null,
        orderStatus,
        errorMessage: (errorMessage as string | null) ?? null,
      },
    }
  }

  const routes: Route[] = [
    /** 캐릭터 목록 — 레지스트리 상태 */
    {
      method: 'GET',
      segments: ['v1', 'characters'],
      handler: async () => {
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
        return { status: 200, data: { items, count: items.length, seeded: DEFAULT_CHARACTERS.length } }
      },
    },
    /** 계좌 부트스트랩 — 캐릭터=계좌 1개. 매핑이 없으면 paper-trade 계좌 생성(멱등). */
    {
      method: 'POST',
      segments: ['v1', 'characters', ':slug', 'bootstrap'],
      handler: async (params) => {
        const character = await ensureAccount(deps, params.slug as string)
        return {
          status: 200,
          data: { slug: character.slug, displayName: character.displayName, accountId: character.paperTradeAccountId },
        }
      },
    },
    /** [phase=load] 턴 출발 상태 적재 — 원장×시세 fresh 스냅샷. 판단 없음(⑤는 실행 계층). */
    {
      method: 'POST',
      segments: ['v1', 'characters', ':slug', 'load'],
      handler: async (params) => {
        const context = await loadTurnContext(deps, params.slug as string)
        return { status: 201, data: context }
      },
    },
    /** 판단 로그 저장 — 실행 계층이 ⑤ 결정(+체결 결과)을 전달하면 검증 후 영속화 (D9 근거는 fact에) */
    {
      method: 'POST',
      segments: ['v1', 'characters', ':slug', 'judgments'],
      handler: async (params, body) => {
        requireCharacter(params.slug as string)
        const input = readJudgmentInput(body)
        const entry = deps.store.appendJudgment(params.slug as string, nowKstIso(), input)
        return { status: 201, data: entry }
      },
    },
    /** 판단 로그 조회 — "AI 판단 로그 공개" 원재료 */
    {
      method: 'GET',
      segments: ['v1', 'characters', ':slug', 'journal'],
      handler: async (params, _body, query) => {
        requireCharacter(params.slug as string)
        const limitRaw = Number(query.get('limit') ?? 50)
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? Math.floor(limitRaw) : 50
        return { status: 200, data: { items: deps.store.listJudgments(params.slug as string, limit) } }
      },
    },
    /** 매매 입증 피드 — paper-trade 원장 패스스루 (사실의 소스) */
    {
      method: 'GET',
      segments: ['v1', 'characters', ':slug', 'orders'],
      handler: async (params) => {
        const character = requireCharacter(params.slug as string)
        if (!character.paperTradeAccountId) {
          return { status: 200, data: { items: [], hint: 'bootstrap 먼저 실행 — 계좌 매핑이 없음' } }
        }
        const orders = await deps.paper.listOrders(character.paperTradeAccountId)
        return { status: 200, data: orders }
      },
    },
  ]

  function matchRoute(method: string, segments: string[]): { handler: RouteHandler; params: Params } | null {
    for (const route of routes) {
      if (route.method !== method) continue
      if (route.segments.length !== segments.length) continue
      const params: Params = {}
      const hit = route.segments.every((seg, i) => {
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(segments[i] as string)
          return true
        }
        return seg === segments[i]
      })
      if (hit) return { handler: route.handler, params }
    }
    return null
  }

  async function readBody(req: IncomingMessage, onTooLarge: () => void): Promise<string | null> {
    let size = 0
    const chunks: Buffer[] = []
    let aborted = false
    return await new Promise((resolve) => {
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          aborted = true
          onTooLarge()
          req.destroy()
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

    const fail = (status: number, error: Record<string, unknown>): void =>
      send(status, { ok: false, error })

    const notFound = (): void => fail(404, { code: 'not_found', message: 'unknown route' })

    const unhandled = (error: unknown): void => {
      console.error('[ai-trader] unhandled:', error)
      fail(500, { code: 'internal', message: 'internal server error' })
    }

    void (async () => {
      // 클라이언트가 요청 도중 끊어도 프로세스가 죽지 않게
      req.on('error', () => undefined)
      res.on('error', () => undefined)

      const method = req.method ?? 'GET'
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname as string
      const segments = path.startsWith('/') ? path.slice(1).split('/') : path.split('/')

      let body: unknown = null
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        const raw = await readBody(req, () => {
          send(
            413,
            { ok: false, error: { code: 'payload_too_large', message: `요청 바디가 ${MAX_BODY_BYTES}바이트 상한을 초과했습니다` } },
            true,
          )
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
        const { status, data } = await match.handler(match.params, body, url.searchParams)
        send(status, { ok: true, data })
      } catch (error) {
        if (error instanceof AppError) {
          fail(error.status, { code: error.code, message: error.message, ...error.details })
          return
        }
        if (error instanceof LoopError) {
          fail(error.status, { code: error.code, message: error.message })
          return
        }
        unhandled(error)
      }
    })().catch(unhandled)
  }
}
