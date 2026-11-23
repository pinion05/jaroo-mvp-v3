// paper-trade API 클라이언트 — 원장·체결의 유일한 입구 (HTTP 얇은 래퍼).
// 체결가는 항상 이 워커가 전달한다(quote ZERO): 시세는 여기서 조회하지 않는다.

export type PaperAccount = {
  accountId: string
  name: string
  initialCashKrw: number
  cashKrw: number
  createdAt: string
  positionCount?: number
  investedBasisKrw?: number
  realizedPnlTotalKrw?: number
  feeTotalKrw?: number
}

export type PaperPosition = {
  symbol: string
  name: string | null
  market: string | null
  quantity: number
  avgPriceKrw: number
  avgPriceCenti: number
  basisKrw: number
  updatedAt: string
}

export type PaperOrder = {
  orderId: string
  accountId: string
  symbol: string
  name: string | null
  market: string | null
  side: 'buy' | 'sell'
  type: 'market'
  quantity: number
  executedPriceKrw: number
  grossKrw: number
  feeKrw: number
  taxKrw: number
  settlementKrw: number
  realizedPnlKrw: number | null
  positionAfter: { quantity: number; avgPriceCenti: number }
  cashAfterKrw: number
  at: string
}

export class PaperTradeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PaperTradeError'
  }
}

/** 원장 게이트웨이 — 테스트 페이크 구현을 위한 구조 타입 (클래스 private 필드 회피). */
export type PaperGateway = {
  createAccount(name: string, initialCashKrw: number): Promise<PaperAccount>
  getAccount(accountId: string): Promise<PaperAccount>
  listPositions(accountId: string): Promise<{ items: PaperPosition[]; count: number }>
  listOrders(accountId: string): Promise<{ items: PaperOrder[] }>
  placeOrder(
    accountId: string,
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; priceKrw: number; name: string | null; market: string | null },
  ): Promise<PaperOrder>
}

export class PaperTradeClient implements PaperGateway {
  /** #378 P2 — 원장 행업 시 /load·judgments 체인이 무기한 묶이지 않게 하는 상한(ms). */
  private readonly timeoutMs: number

  constructor(
    private baseUrl: string,
    private fetcher: typeof fetch = fetch,
    timeoutMs = 10_000,
  ) {
    this.timeoutMs = timeoutMs
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null
    if (!body || body.ok !== true || body.data === undefined) {
      throw new PaperTradeError(
        body?.error?.code ?? 'paper_trade_unavailable',
        body?.error?.message ?? `paper-trade ${path} 실패 (status ${response.status})`,
      )
    }
    return body.data
  }

  createAccount(name: string, initialCashKrw: number): Promise<PaperAccount> {
    return this.request<PaperAccount>('/v1/accounts', {
      method: 'POST',
      body: JSON.stringify({ name, initialCashKrw }),
    })
  }

  getAccount(accountId: string): Promise<PaperAccount> {
    return this.request<PaperAccount>(`/v1/accounts/${accountId}`)
  }

  listPositions(accountId: string): Promise<{ items: PaperPosition[]; count: number }> {
    return this.request(`/v1/accounts/${accountId}/positions`)
  }

  listOrders(accountId: string): Promise<{ items: PaperOrder[] }> {
    return this.request(`/v1/accounts/${accountId}/orders`)
  }

  placeOrder(
    accountId: string,
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; priceKrw: number; name: string | null; market: string | null },
  ): Promise<PaperOrder> {
    return this.request<PaperOrder>(`/v1/accounts/${accountId}/orders`, {
      method: 'POST',
      body: JSON.stringify(order),
    })
  }
}
