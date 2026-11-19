// SQLite 저장소 (bun:sqlite) — cache ZERO / DB fetch only.
// 클래스는 커넥션을 들고 있을 뿐 상태를 캐시하지 않는다: 모든 읽기는 SELECT,
// 체결 반영은 하나의 트랜잭션으로 원자적 수행한다.

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Account, LedgerEntry, OrderInput, OrderRecord, Position } from './domain.ts'
import { EngineError, executeMarketOrder, fitBuyQuantity, resolveRatioQuantity, type Execution, type Rates } from './engine.ts'

export function newId(prefix: string): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** 매매·원장 기록용 타임스탬프 — 한국 표준시(KST, UTC+9·서머타임 없음) 기준 ISO8601. */
function nowKstIso(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
}

export class Store {
  readonly db: Database

  constructor(dbPath: string, schemaSql: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(schemaSql)
  }

  close(): void {
    this.db.close()
  }

  createAccount(name: string, initialCashKrw: number): Account {
    const accountId = newId('ac')
    const at = nowKstIso()
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO accounts (account_id, name, initial_cash_won, cash_won, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(accountId, name, initialCashKrw, initialCashKrw, at)
      this.db
        .prepare('INSERT INTO ledger (ledger_id, account_id, kind, amount_won, balance_after_won, ref_order_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)')
        .run(newId('lg'), accountId, 'deposit', initialCashKrw, initialCashKrw, at)
    })
    tx()
    return { accountId, name, initialCashKrw, cashKrw: initialCashKrw, createdAt: at }
  }

  getAccount(accountId: string): Account | null {
    return (
      this.db
        .prepare('SELECT account_id AS accountId, name, initial_cash_won AS initialCashKrw, cash_won AS cashKrw, created_at AS createdAt FROM accounts WHERE account_id = ?')
        .get(accountId) as Account | null ?? null
    )
  }

  listAccounts(): Account[] {
    return this.db
      .prepare('SELECT account_id AS accountId, name, initial_cash_won AS initialCashKrw, cash_won AS cashKrw, created_at AS createdAt FROM accounts ORDER BY created_at')
      .all() as Account[]
  }

  getPosition(accountId: string, symbol: string): Position | null {
    return (
      this.db
        .prepare('SELECT account_id AS accountId, symbol, symbol_name AS name, market, quantity, avg_price_centiwon AS avgPriceCenti, updated_at AS updatedAt FROM positions WHERE account_id = ? AND symbol = ?')
        .get(accountId, symbol) as Position | null ?? null
    )
  }

  listPositions(accountId: string): Position[] {
    return this.db
      .prepare('SELECT account_id AS accountId, symbol, symbol_name AS name, market, quantity, avg_price_centiwon AS avgPriceCenti, updated_at AS updatedAt FROM positions WHERE account_id = ? ORDER BY symbol')
      .all(accountId) as Position[]
  }

  /** 체결 반영 — 계좌 현금·포지션·주문·원장을 한 트랜잭션으로. */
  applyExecution(accountId: string, order: OrderInput, exec: Execution): OrderRecord {
    const orderId = newId('od')
    const at = nowKstIso()

    const tx = this.db.transaction(() => this.persistExecution(orderId, at, accountId, order, exec))
    return tx()
  }

  /**
   * fit/ratio 주문 체결 (v2 §6) — 잔고·포지션 읽기와 수량 치환을 체결 트랜잭션 **안에서** 원자 수행.
   * 사전 계산의 TOCTOU(읽기와 체결 사이 잔고 변동)를 원천 제거한다.
   *   fit  (매수): qty = max q s.t. debit(q) ≤ min(amountKrw, cashKrw) — 수수료 포함, 1주 미만이면 unaffordable
   *   ratio(매도): qty = floor(보유수량 × ratio) — 체결가(priceKrw)는 caller 입력 그대로
   * 시세 조회는 일절 없다(quote ZERO) — 잔고는 자기 원장, 단가는 주문 입력.
   */
  applyResolvedExecution(
    accountId: string,
    request: {
      symbol: string
      side: 'buy' | 'sell'
      priceKrw: number
      name: string | null
      market: string | null
      mode: 'fit' | 'ratio'
      amountKrw?: number
      ratio?: number
    },
    rates: Rates,
  ): OrderRecord {
    const orderId = newId('od')
    const at = nowKstIso()

    const tx = this.db.transaction((): OrderRecord => {
      const account = this.db
        .prepare('SELECT cash_won AS cashKrw FROM accounts WHERE account_id = ?')
        .get(accountId) as { cashKrw: number } | null
      if (!account) {
        throw new EngineError('account_not_found', `존재하지 않는 계좌: ${accountId}`)
      }
      const position = this.getPosition(accountId, request.symbol)

      let quantity: number
      if (request.mode === 'fit') {
        const limitKrw = Math.min(request.amountKrw ?? 0, account.cashKrw)
        quantity = fitBuyQuantity(request.priceKrw, limitKrw, rates)
        if (quantity < 1) {
          throw new EngineError('unaffordable', '주문 금액/잔고로는 1주도 살 수 없습니다', {
            amountKrw: request.amountKrw,
            cashKrw: account.cashKrw,
            priceKrw: request.priceKrw,
          })
        }
      } else {
        quantity = resolveRatioQuantity(position?.quantity ?? 0, request.ratio ?? 0)
      }

      const order: OrderInput = {
        symbol: request.symbol,
        side: request.side,
        quantity,
        priceKrw: request.priceKrw,
        name: request.name,
        market: request.market,
      }
      const exec = executeMarketOrder({ cashKrw: account.cashKrw, position, order, rates })
      return this.persistExecution(orderId, at, accountId, order, exec)
    })
    return tx()
  }

  /** 영속화(트랜잭션 내부 전제) — 원장·포지션·주문·현금 반영 + OrderRecord 조립. */
  private persistExecution(
    orderId: string,
    at: string,
    accountId: string,
    order: OrderInput,
    exec: Execution,
  ): OrderRecord {
    const positionAfter = exec.positionAfter

    this.db
      .prepare('UPDATE accounts SET cash_won = ? WHERE account_id = ?')
      .run(exec.cashAfterKrw, accountId)

    if (positionAfter.quantity > 0) {
      this.db
        .prepare(
          `INSERT INTO positions (account_id, symbol, symbol_name, market, quantity, avg_price_centiwon, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, symbol) DO UPDATE SET
             symbol_name = excluded.symbol_name,
             market = excluded.market,
             quantity = excluded.quantity,
             avg_price_centiwon = excluded.avg_price_centiwon,
             updated_at = excluded.updated_at`,
        )
        .run(accountId, order.symbol, order.name, order.market, positionAfter.quantity, positionAfter.avgPriceCenti, at)
    } else {
      this.db.prepare('DELETE FROM positions WHERE account_id = ? AND symbol = ?').run(accountId, order.symbol)
    }

    this.db
      .prepare(
        `INSERT INTO orders (order_id, account_id, symbol, symbol_name, market, side, order_type, quantity,
           executed_price_won, gross_won, fee_won, tax_won, settlement_won, realized_pnl_won,
           quantity_after, avg_price_centiwon_after, cash_after_won, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'market', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orderId, accountId, order.symbol, order.name, order.market, exec.side, exec.quantity,
        exec.executedPriceKrw, exec.grossKrw, exec.feeKrw, exec.taxKrw, exec.settlementKrw,
        exec.realizedPnlKrw, positionAfter.quantity, positionAfter.avgPriceCenti, exec.cashAfterKrw, at,
      )

    this.db
      .prepare('INSERT INTO ledger (ledger_id, account_id, kind, amount_won, balance_after_won, ref_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        newId('lg'), accountId,
        exec.side === 'buy' ? 'buy_settlement' : 'sell_settlement',
        exec.settlementKrw, exec.cashAfterKrw, orderId, at,
      )

    return {
      orderId,
      accountId,
      symbol: order.symbol,
      name: order.name,
      market: order.market,
      side: exec.side,
      type: 'market',
      quantity: exec.quantity,
      executedPriceKrw: exec.executedPriceKrw,
      grossKrw: exec.grossKrw,
      feeKrw: exec.feeKrw,
      taxKrw: exec.taxKrw,
      settlementKrw: exec.settlementKrw,
      realizedPnlKrw: exec.realizedPnlKrw,
      positionAfter: positionAfter,
      cashAfterKrw: exec.cashAfterKrw,
      at,
    }
  }

  listOrders(accountId: string): OrderRecord[] {
    const rows = this.db
      .prepare(
        `SELECT order_id, account_id, symbol, symbol_name, market, side, order_type, quantity,
           executed_price_won, gross_won, fee_won, tax_won, settlement_won, realized_pnl_won,
           quantity_after, avg_price_centiwon_after, cash_after_won, created_at
         FROM orders WHERE account_id = ? ORDER BY created_at`,
      )
      .all(accountId) as Array<Record<string, unknown>>
    return rows.map(mapOrderRow)
  }

  listLedger(accountId: string): LedgerEntry[] {
    return this.db
      .prepare(
        `SELECT ledger_id AS ledgerId, account_id AS accountId, kind, amount_won AS amountKrw,
           balance_after_won AS balanceAfterKrw, ref_order_id AS refOrderId, created_at AS at
         FROM ledger WHERE account_id = ? ORDER BY created_at`,
      )
      .all(accountId) as LedgerEntry[]
  }
}

type OrderRow = {
  order_id: string
  account_id: string
  symbol: string
  symbol_name: string | null
  market: string | null
  side: 'buy' | 'sell'
  order_type: string
  quantity: number
  executed_price_won: number
  gross_won: number
  fee_won: number
  tax_won: number
  settlement_won: number
  realized_pnl_won: number | null
  quantity_after: number
  avg_price_centiwon_after: number
  cash_after_won: number
  created_at: string
}

function mapOrderRow(row: Record<string, unknown>): OrderRecord {
  const r = row as unknown as OrderRow
  return {
    orderId: r.order_id,
    accountId: r.account_id,
    symbol: r.symbol,
    name: r.symbol_name,
    market: r.market,
    side: r.side,
    type: r.order_type as 'market',
    quantity: r.quantity,
    executedPriceKrw: r.executed_price_won,
    grossKrw: r.gross_won,
    feeKrw: r.fee_won,
    taxKrw: r.tax_won,
    settlementKrw: r.settlement_won,
    realizedPnlKrw: r.realized_pnl_won,
    positionAfter: { quantity: r.quantity_after, avgPriceCenti: r.avg_price_centiwon_after },
    cashAfterKrw: r.cash_after_won,
    at: r.created_at,
  }
}
