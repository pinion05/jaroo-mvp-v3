// SQLite 저장소 (node:sqlite DatabaseSync) — 캐릭터 레지스트리 + 판단 로그(저널).
// cache ZERO / DB fetch only (paper-trade 계승): 모든 읽기는 SELECT.
// 사실(체결)은 paper-trade 원장이 소유 — 이 DB는 매핑과 판단 서사만 소유한다.
//
// #378 Node 전환(2026-11-23): bun:sqlite → node:sqlite (paper-trade #368 패턴 계승).
// #376 read 방어: persona_card·fact JSON 파싱은 행별 강등 — 손상 1행이 조회 전체를 브릭하지 않는다.
// #378 P2: 기동 실패 컨텍스트(dbPath·SQLite 코드)를 에러에 실어 던진다.

import { DatabaseSync } from 'node:sqlite'
import type { StatementSync } from 'node:sqlite'
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

/** #376 — 손상 persona_card 대체 카드. 목록·라우트가 죽지 않게 최소 형태만 보장한다. */
const FALLBACK_CARD: PersonaCard = {
  temperament: '(손상)',
  narrativeGoal: '(persona_card 파싱 실패 — 원본 행 확인 필요)',
  obsessions: [],
  principles: [],
  voice: { buy: '(손상)', sell: '(손상)', hold: '(손상)' },
}

/** #376 — JSON 파싱 행별 강등: 실패 시 fallback, 나머지 행은 정상 조회된다. */
function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
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
    personaCard: parseJsonSafe<PersonaCard>(row.persona_card, {
      ...FALLBACK_CARD,
      temperament: `${FALLBACK_CARD.temperament}: ${row.slug}`,
    }),
    initialCashKrw: row.initial_cash_won,
    cashGoalKrw: row.cash_goal_won,
    paperTradeAccountId: row.paper_trade_account_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type JudgmentRow = {
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
}

export class Store {
  readonly db: DatabaseSync

  // 사전 준비된 statement — 요청 경로에서 prepare 호출 없음 (paper-trade 패턴).
  private readonly seedCharacterStmt: StatementSync
  private readonly listCharactersStmt: StatementSync
  private readonly getCharacterStmt: StatementSync
  private readonly attachAccountStmt: StatementSync
  private readonly insertJudgmentStmt: StatementSync
  private readonly listJudgmentsStmt: StatementSync

  private closed = false

  constructor(dbPath: string, schemaSql: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    try {
      // timeout(=busy timeout, ms): node:sqlite는 기본 0이라 동시 기동·watch 재시작
      // 레이스에서 즉시 'database is locked'로 죽는다(리뷰팀 실측).
      this.db = new DatabaseSync(dbPath, { timeout: 5000 })
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = NORMAL')
      this.db.exec('PRAGMA busy_timeout = 5000')
      this.db.exec(schemaSql)
    } catch (error) {
      // #378 P2 — raw 스택 대신 어디서(dbPath)·무엇이(SQLite 코드) 실패했는지 싣는다.
      const code = (error as { code?: string }).code ?? 'unknown'
      throw new Error(
        `Store 생성 실패: db=${dbPath} code=${code} — ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    this.seedCharacterStmt = this.db.prepare(
      `INSERT OR IGNORE INTO characters
       (slug, display_name, persona_card, initial_cash_won, cash_goal_won, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    this.listCharactersStmt = this.db.prepare(
      'SELECT * FROM characters WHERE is_active = 1 ORDER BY slug',
    )
    this.getCharacterStmt = this.db.prepare('SELECT * FROM characters WHERE slug = ?')
    this.attachAccountStmt = this.db.prepare(
      'UPDATE characters SET paper_trade_account_id = ?, updated_at = ? WHERE slug = ?',
    )
    this.insertJudgmentStmt = this.db.prepare(
      `INSERT INTO judgment_logs
       (log_id, character_slug, loop_at, decision, symbol, quantity, price_krw, reason_code, fact, rationale, order_id, order_status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.listJudgmentsStmt = this.db.prepare(
      'SELECT * FROM judgment_logs WHERE character_slug = ? ORDER BY created_at DESC, log_id DESC LIMIT ?',
    )
  }

  close(): void {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }

  /** 기본 캐릭터 시드 — INSERT OR IGNORE 로 멱등. */
  seedCharacters(seeds: CharacterSeed[]): void {
    const at = nowKstIso()
    for (const seed of seeds) {
      this.seedCharacterStmt.run(
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
    // #376 — rowToCharacter가 파싱 실패행도 강등 변환하므로 map 자체는 throw하지 않는다.
    const rows = this.listCharactersStmt.all() as CharacterRow[]
    return rows.map(rowToCharacter)
  }

  getCharacter(slug: string): Character | null {
    const row = this.getCharacterStmt.get(slug) as CharacterRow | null
    return row ? rowToCharacter(row) : null
  }

  attachAccount(slug: string, accountId: string): void {
    this.attachAccountStmt.run(accountId, nowKstIso(), slug)
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
    this.insertJudgmentStmt.run(
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
    const rows = this.listJudgmentsStmt.all(characterSlug, limit) as JudgmentRow[]
    return rows.map((row) => ({
      logId: row.log_id,
      characterSlug: row.character_slug,
      loopAt: row.loop_at,
      decision: row.decision as JudgmentEntry['decision'],
      symbol: row.symbol,
      quantity: row.quantity,
      priceKrw: row.price_krw,
      reasonCode: row.reason_code,
      // #376 — 손상 fact는 unparsable 마커로 강등, 나머지 행은 정상 반환
      fact: parseJsonSafe<JudgmentEntry['fact']>(row.fact, { unparsable: true }),
      rationale: row.rationale,
      orderId: row.order_id,
      orderStatus: row.order_status as JudgmentEntry['orderStatus'],
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }))
  }
}
