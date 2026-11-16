// SQLite 저장소 (node:sqlite DatabaseSync) — cache ZERO / DB fetch only.
// 클래스는 커넥션을 들고 있을 뿐 상태를 캐시하지 않는다: 모든 읽기는 SELECT,
// 체결 반영은 하나의 트랜잭션으로 원자적 수행한다.
//
// 메모리 설계: prepared statement는 고정된 유한 집합이므로 생성자에서 1회 준비해
// 필드로 보관한다(요청마다 prepare 금지). 행 객체는 [Object: null prototype]으로
// 반환되지만 기존 매핑 로직(mapOrderRow)은 프로토타입 없이도 동작한다.

import { DatabaseSync } from 'node:sqlite'
import type { StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Account, LedgerEntry, OrderInput, OrderRecord, Position } from './domain.ts'
import type { Execution } from './engine.ts'

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
  readonly db: DatabaseSync

  // 사전 준비된 statement들 — 요청 경로에서 prepare 호출 없음.
  private readonly beginTx: StatementSync
  private readonly commitTx: StatementSync
  private readonly rollbackTx: StatementSync
  private readonly insertAccountStmt: StatementSync
  private readonly insertLedgerStmt: StatementSync
  private readonly getAccountStmt: StatementSync
  private readonly listAccountsStmt: StatementSync
  private readonly getPositionStmt: StatementSync
  private readonly listPositionsStmt: StatementSync
  private readonly updateAccountCashStmt: StatementSync
  private readonly upsertPositionStmt: StatementSync
  private readonly deletePositionStmt: StatementSync
  private readonly insertOrderStmt: StatementSync
  private readonly listOrdersStmt: StatementSync
  private readonly listLedgerStmt: StatementSync

  private closed = false

  constructor(dbPath: string, schemaSql: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    // timeout(=busy timeout, ms): node:sqlite는 기본 0이라 명시 필수.
    this.db = new DatabaseSync(dbPath, { timeout: 5000 })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA cache_size = -2000') // 페이지 캐시 상한 ≈ 2MB(메모리 최적화)
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec(schemaSql)

    this.beginTx = this.db.prepare('BEGIN')
    this.commitTx = this.db.prepare('COMMIT')
    this.rollbackTx = this.db.prepare('ROLLBACK')
    this.insertAccountStmt = this.db.prepare(
      'INSERT INTO accounts (account_id, name, initial_cash_won, cash_won, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    this.insertLedgerStmt = this.db.prepare(
      'INSERT INTO ledger (ledger_id, account_id, kind, amount_won, balance_after_won, ref_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    this.getAccountStmt = this.db.prepare(
      'SELECT account_id AS accountId, name, initial_cash_won AS initialCashKrw, cash_won AS cashKrw, created_at AS createdAt FROM accounts WHERE account_id = ?',
    )
    this.listAccountsStmt = this.db.prepare(
      'SELECT account_id AS accountId, name, initial_cash_won AS initialCashKrw, cash_won AS cashKrw, created_at AS createdAt FROM accounts ORDER BY created_at',
    )
    this.getPositionStmt = this.db.prepare(
      'SELECT account_id AS accountId, symbol, symbol_name AS name, market, quantity, avg_price_centiwon AS avgPriceCenti, updated_at AS updatedAt FROM positions WHERE account_id = ? AND symbol = ?',
    )
    this.listPositionsStmt = this.db.prepare(
      'SELECT account_id AS accountId, symbol, symbol_name AS name, market, quantity, avg_price_centiwon AS avgPriceCenti, updated_at AS updatedAt FROM positions WHERE account_id = ? ORDER BY symbol',
    )
    this.updateAccountCashStmt = this.db.prepare('UPDATE accounts SET cash_won = ? WHERE account_id = ?')
    this.upsertPositionStmt = this.db.prepare(
      `INSERT INTO positions (account_id, symbol, symbol_name, market, quantity, avg_price_centiwon, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, symbol) DO UPDATE SET
         symbol_name = excluded.symbol_name,
         market = excluded.market,
         quantity = excluded.quantity,
         avg_price_centiwon = excluded.avg_price_centiwon,
         updated_at = excluded.updated_at`,
    )
    this.deletePositionStmt = this.db.prepare('DELETE FROM positions WHERE account_id = ? AND symbol = ?')
    this.insertOrderStmt = this.db.prepare(
      `INSERT INTO orders (order_id, account_id, symbol, symbol_name, market, side, order_type, quantity,
         executed_price_won, gross_won, fee_won, tax_won, settlement_won, realized_pnl_won,
         quantity_after, avg_price_centiwon_after, cash_after_won, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'market', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.listOrdersStmt = this.db.prepare(
      `SELECT order_id, account_id, symbol, symbol_name, market, side, order_type, quantity,
         executed_price_won, gross_won, fee_won, tax_won, settlement_won, realized_pnl_won,
         quantity_after, avg_price_centiwon_after, cash_after_won, created_at
       FROM orders WHERE account_id = ? ORDER BY created_at`,
    )
    this.listLedgerStmt = this.db.prepare(
      `SELECT ledger_id AS ledgerId, account_id AS accountId, kind, amount_won AS amountKrw,
         balance_after_won AS balanceAfterKrw, ref_order_id AS refOrderId, created_at AS at
       FROM ledger WHERE account_id = ? ORDER BY created_at`,
    )
  }

  /**
   * 동기 트랜잭션 래퍼 — node:sqlite에는 bun:sqlite의 .transaction()이 없다.
   * BEGIN → fn() → COMMIT, throw 시 ROLLBACK.
   * 콜백은 동기 함수만 허용한다(async 금지: COMMIT 전에 제어가 풀리면 원자성이 깨진다).
   */
  private runInTransaction<T>(fn: () => T): T {
    this.beginTx.run()
    try {
      const result = fn()
      this.commitTx.run()
      return result
    } catch (error) {
      this.rollbackTx.run()
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    // 종료 시 WAL 체크포인트 — 마지막 커넥션 close가 WAL을 자동 병합하지만
    // 명시적으로 truncate해 두면 -wal/-shm 잔여 파일이 남지 않는다.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.close()
  }

  createAccount(name: string, initialCashKrw: number): Account {
    const accountId = newId('ac')
    const at = nowKstIso()
    this.runInTransaction(() => {
      this.insertAccountStmt.run(accountId, name, initialCashKrw, initialCashKrw, at)
      this.insertLedgerStmt.run(newId('lg'), accountId, 'deposit', initialCashKrw, initialCashKrw, null, at)
    })
    return { accountId, name, initialCashKrw, cashKrw: initialCashKrw, createdAt: at }
  }

  getAccount(accountId: string): Account | null {
    return (
      this.getAccountStmt.get(accountId) as Account | null ?? null
    )
  }

  listAccounts(): Account[] {
    return this.listAccountsStmt.all() as Account[]
  }

  getPosition(accountId: string, symbol: string): Position | null {
    return (
      this.getPositionStmt.get(accountId, symbol) as Position | null ?? null
    )
  }

  listPositions(accountId: string): Position[] {
    return this.listPositionsStmt.all(accountId) as Position[]
  }

  /** 체결 반영 — 계좌 현금·포지션·주문·원장을 한 트랜잭션으로. */
  applyExecution(accountId: string, order: OrderInput, exec: Execution): OrderRecord {
    const orderId = newId('od')
    const at = nowKstIso()
    const positionAfter = exec.positionAfter

    this.runInTransaction(() => {
      this.updateAccountCashStmt.run(exec.cashAfterKrw, accountId)

      if (positionAfter.quantity > 0) {
        this.upsertPositionStmt.run(
          accountId, order.symbol, order.name, order.market, positionAfter.quantity, positionAfter.avgPriceCenti, at,
        )
      } else {
        this.deletePositionStmt.run(accountId, order.symbol)
      }

      this.insertOrderStmt.run(
        orderId, accountId, order.symbol, order.name, order.market, exec.side, exec.quantity,
        exec.executedPriceKrw, exec.grossKrw, exec.feeKrw, exec.taxKrw, exec.settlementKrw,
        exec.realizedPnlKrw, positionAfter.quantity, positionAfter.avgPriceCenti, exec.cashAfterKrw, at,
      )

      this.insertLedgerStmt.run(
        newId('lg'), accountId,
        exec.side === 'buy' ? 'buy_settlement' : 'sell_settlement',
        exec.settlementKrw, exec.cashAfterKrw, orderId, at,
      )
    })

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
    const rows = this.listOrdersStmt.all(accountId) as Array<Record<string, unknown>>
    return rows.map(mapOrderRow)
  }

  listLedger(accountId: string): LedgerEntry[] {
    return this.listLedgerStmt.all(accountId) as LedgerEntry[]
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
