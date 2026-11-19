// SQLite 저장소 (bun:sqlite) — 캐릭터 레지스트리 + 판단 로그(저널).
// cache ZERO / DB fetch only (paper-trade 계승): 모든 읽기는 SELECT.
// 사실(체결)은 paper-trade 원장이 소유 — 이 DB는 매핑과 판단 서사만 소유한다.

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Character, JudgmentEntry, JudgmentInput, PersonaCard } from './domain.ts'
import type { CharacterSeed } from './characters.ts'

export function newId(prefix: string): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** 판단·기록용 타임스탬프 — 한국 표준시(KST, UTC+9) ISO8601 (paper-trade 계승). */
export function nowKstIso(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
}

type CharacterRow = {
  slug: string
  display_name: string
  persona_card: string
  initial_cash_won: number
  cash_goal_won: number | null
  paper_trade_account_id: string | null
  is_active: number
  created_at: string
  updated_at: string
}

function rowToCharacter(row: CharacterRow): Character {
  return {
    slug: row.slug,
    displayName: row.display_name,
    personaCard: JSON.parse(row.persona_card) as PersonaCard,
    initialCashKrw: row.initial_cash_won,
    cashGoalKrw: row.cash_goal_won,
    paperTradeAccountId: row.paper_trade_account_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class Store {
  readonly db: Database

  constructor(dbPath: string, schemaSql: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(schemaSql)
  }

  close(): void {
    this.db.close()
  }

  /** 기본 캐릭터 시드 — INSERT OR IGNORE 로 멱등. */
  seedCharacters(seeds: CharacterSeed[]): void {
    const at = nowKstIso()
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO characters
       (slug, display_name, persona_card, initial_cash_won, cash_goal_won, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    for (const seed of seeds) {
      stmt.run(
        seed.slug,
        seed.displayName,
        JSON.stringify(seed.personaCard),
        seed.initialCashKrw,
        seed.cashGoalKrw,
        at,
        at,
      )
    }
  }

  listCharacters(): Character[] {
    const rows = this.db
      .prepare('SELECT * FROM characters WHERE is_active = 1 ORDER BY slug')
      .all() as CharacterRow[]
    return rows.map(rowToCharacter)
  }

  getCharacter(slug: string): Character | null {
    const row = this.db
      .prepare('SELECT * FROM characters WHERE slug = ?')
      .get(slug) as CharacterRow | null
    return row ? rowToCharacter(row) : null
  }

  attachAccount(slug: string, accountId: string): void {
    this.db
      .prepare('UPDATE characters SET paper_trade_account_id = ?, updated_at = ? WHERE slug = ?')
      .run(accountId, nowKstIso(), slug)
  }

  /** 판단 로그 저장 — 결정(⑤ LLM)은 이미 내려진 상태로 전달받는다. 저장만. */
  appendJudgment(characterSlug: string, loopAt: string, input: JudgmentInput): JudgmentEntry {
    const entry: JudgmentEntry = {
      decision: input.decision,
      symbol: input.symbol,
      quantity: input.quantity,
      priceKrw: input.priceKrw,
      reasonCode: input.reasonCode,
      fact: input.fact,
      rationale: input.rationale,
      orderId: input.order.orderId,
      orderStatus: input.order.orderStatus,
      errorMessage: input.order.errorMessage ?? null,
      logId: newId('jdg'),
      characterSlug,
      loopAt,
      createdAt: nowKstIso(),
    }
    this.db
      .prepare(
        `INSERT INTO judgment_logs
         (log_id, character_slug, loop_at, decision, symbol, quantity, price_krw, reason_code, fact, rationale, order_id, order_status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.logId,
        entry.characterSlug,
        entry.loopAt,
        entry.decision,
        entry.symbol,
        entry.quantity,
        entry.priceKrw,
        entry.reasonCode,
        JSON.stringify(entry.fact),
        entry.rationale,
        entry.orderId,
        entry.orderStatus,
        entry.errorMessage,
        entry.createdAt,
      )
    return entry
  }

  listJudgments(characterSlug: string, limit = 50): JudgmentEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM judgment_logs WHERE character_slug = ? ORDER BY created_at DESC, log_id DESC LIMIT ?')
      .all(characterSlug, limit) as Array<{
      log_id: string
      character_slug: string
      loop_at: string
      decision: string
      symbol: string | null
      quantity: number | null
      price_krw: number | null
      reason_code: string
      fact: string
      rationale: string
      order_id: string | null
      order_status: string
      error_message: string | null
      created_at: string
    }>
    return rows.map((row) => ({
      logId: row.log_id,
      characterSlug: row.character_slug,
      loopAt: row.loop_at,
      decision: row.decision as JudgmentEntry['decision'],
      symbol: row.symbol,
      quantity: row.quantity,
      priceKrw: row.price_krw,
      reasonCode: row.reason_code,
      fact: JSON.parse(row.fact) as JudgmentEntry['fact'],
      rationale: row.rationale,
      orderId: row.order_id,
      orderStatus: row.order_status as JudgmentEntry['orderStatus'],
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }))
  }
}
