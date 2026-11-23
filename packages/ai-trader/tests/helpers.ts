// 테스트 공용 페이크 — loop.test.ts / api.test.ts 공유.
// FakePaper: paper-trade 체결 로직의 단순화 모사(수수료 0.015%/거래세 0.15%).
// 진짜 체결 보증은 paper-trade 패키지의 27/27 테스트가 담당 — 여기선 오케스트레이션 검증용.

import type { Quote } from '../src/domain.ts'
import type { PaperAccount, PaperGateway, PaperOrder, PaperPosition } from '../src/papertrade.ts'

export class FakePaper implements PaperGateway {
  accounts = new Map<string, PaperAccount & { positions: Map<string, PaperPosition> }>()
  orders = new Map<string, PaperOrder[]>()
  createAccountCalls: string[] = []

  async createAccount(name: string, initialCashKrw: number): Promise<PaperAccount> {
    this.createAccountCalls.push(name)
    const accountId = `ac_fake_${this.createAccountCalls.length}`
    this.accounts.set(accountId, {
      accountId,
      name,
      initialCashKrw,
      cashKrw: initialCashKrw,
      createdAt: '2026-11-16T09:00:00.000+09:00',
      positions: new Map(),
    })
    this.orders.set(accountId, [])
    return this.getAccount(accountId)
  }

  async getAccount(accountId: string): Promise<PaperAccount> {
    const account = this.accounts.get(accountId)
    if (!account) throw new Error('account_not_found')
    const { positions, ...rest } = account
    return { ...rest, positionCount: positions.size, investedBasisKrw: 0, realizedPnlTotalKrw: 0, feeTotalKrw: 0 }
  }

  async listPositions(accountId: string): Promise<{ items: PaperPosition[]; count: number }> {
    const account = this.accounts.get(accountId)
    if (!account) throw new Error('account_not_found')
    const items = Array.from(account.positions.values()).map((p) => ({
      ...p,
      avgPriceKrw: p.avgPriceCenti / 100, // paper-trade 실제 응답 필드 계승
      basisKrw: Math.round((p.avgPriceCenti * p.quantity) / 100),
    }))
    return { items, count: items.length }
  }

  async listOrders(accountId: string): Promise<{ items: PaperOrder[] }> {
    return { items: this.orders.get(accountId) ?? [] }
  }

  async placeOrder(
    accountId: string,
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; priceKrw: number; name: string | null; market: string | null },
  ): Promise<PaperOrder> {
    const account = this.accounts.get(accountId)
    if (!account) throw new Error('account_not_found')
    const gross = order.quantity * order.priceKrw
    const fee = Math.ceil(gross * 0.00015)
    const tax = order.side === 'sell' ? Math.ceil(gross * 0.0015) : 0
    const settlement = order.side === 'buy' ? -(gross + fee) : gross - fee - tax

    const existing = account.positions.get(order.symbol)
    const position: PaperPosition = existing ?? {
      symbol: order.symbol, name: order.name, market: order.market, quantity: 0, avgPriceCenti: 0, avgPriceKrw: 0, basisKrw: 0, updatedAt: '',
    }
    if (!existing) account.positions.set(order.symbol, position)

    const record: PaperOrder = {
      orderId: `od_fake_${(this.orders.get(accountId)?.length ?? 0) + 1}`,
      accountId,
      symbol: order.symbol,
      name: order.name,
      market: order.market,
      side: order.side,
      type: 'market',
      quantity: order.quantity,
      executedPriceKrw: order.priceKrw,
      grossKrw: gross,
      feeKrw: fee,
      taxKrw: tax,
      settlementKrw: settlement,
      realizedPnlKrw: null,
      positionAfter: { quantity: 0, avgPriceCenti: 0 },
      cashAfterKrw: 0,
      at: new Date(Date.now()).toISOString().replace('Z', '+09:00'),
    }

    if (order.side === 'buy') {
      account.cashKrw += settlement
      const totalQty = position.quantity + order.quantity
      position.avgPriceCenti = Math.round((position.quantity * position.avgPriceCenti + order.quantity * order.priceKrw * 100) / totalQty)
      position.quantity = totalQty
    } else {
      account.cashKrw += settlement
      position.quantity -= order.quantity
      if (position.quantity === 0) account.positions.delete(order.symbol)
    }
    record.positionAfter = { quantity: position.quantity, avgPriceCenti: position.avgPriceCenti }
    record.cashAfterKrw = account.cashKrw
    this.orders.get(accountId)?.push(record)
    return record
  }
}

export function fakeQuotes(quotes: Record<string, [number, number | null]>): { getQuotes: (symbols: string[]) => Promise<Map<string, Quote>> } {
  return {
    async getQuotes(symbols) {
      const map = new Map<string, Quote>()
      for (const symbol of symbols) {
        const found = quotes[symbol]
        if (found) map.set(symbol, { symbol, priceKrw: found[0], changePct: found[1] })
      }
      return map
    },
  }
}
