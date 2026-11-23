// 마이그레이션 회귀 — 0002(placed→filled)의 실제 업그레이드 경로 검증.
// 재현 시나리오: #373 이전에 만들어진 dev DB(구 CHECK)에서 filled INSERT가
// SQLITE_CONSTRAINT_CHECK로 죽던 버그(차트콕 실턴 실측)의 방어.

import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/journal.ts'
import { loadMigrationsSql } from '../src/migrations.ts'

// #373 이전의 구 스키마 — judgment_logs가 placed CHECK를 갖는 시점의 0001
const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  persona_card TEXT NOT NULL,
  initial_cash_won INTEGER NOT NULL,
  cash_goal_won INTEGER,
  paper_trade_account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS judgment_logs (
  log_id TEXT PRIMARY KEY,
  character_slug TEXT NOT NULL,
  loop_at TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('buy','sell','hold')),
  symbol TEXT,
  quantity INTEGER,
  price_krw INTEGER,
  reason_code TEXT NOT NULL,
  fact TEXT NOT NULL,
  rationale TEXT NOT NULL,
  order_id TEXT,
  order_status TEXT NOT NULL CHECK (order_status IN ('placed','skipped','failed')),
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_judgment_character ON judgment_logs(character_slug, loop_at DESC);
`

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('0002 마이그레이션 — placed→filled 어휘 전환', () => {
  test('구 CHECK DB: placed 행은 filled로 변환, skipped 보존, 이후 filled INSERT 성공', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-trader-mig-'))
    tmpDirs.push(dir)
    const dbPath = join(dir, 'legacy.db')

    // ① 구 스키마 DB + placed/skipped 행 (이전 dev DB 상태 재현)
    const legacy = new Database(dbPath, { create: true })
    legacy.exec(LEGACY_SCHEMA)
    legacy
      .prepare(
        `INSERT INTO judgment_logs (log_id, character_slug, loop_at, decision, symbol, quantity, price_krw, reason_code, fact, rationale, order_id, order_status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('jdg_legacy1', 'sosimi', '2026-11-19T18:00:00+09:00', 'buy', '005930', 1, 70_000, 'dip_buy', '{}', '소심이 기록', 'od_1', 'placed', null, '2026-11-19T18:00:01+09:00')
    legacy
      .prepare(
        `INSERT INTO judgment_logs (log_id, character_slug, loop_at, decision, symbol, quantity, price_krw, reason_code, fact, rationale, order_id, order_status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('jdg_legacy2', 'sosimi', '2026-11-19T18:00:00+09:00', 'hold', null, null, null, 'no_signal', '{}', '관망', null, 'skipped', null, '2026-11-19T18:00:02+09:00')
    legacy
      .prepare(
        `INSERT INTO judgment_logs (log_id, character_slug, loop_at, decision, symbol, quantity, price_krw, reason_code, fact, rationale, order_id, order_status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('jdg_legacy3', 'sosimi', '2026-11-19T19:00:00+09:00', 'sell', '005930', 1, 72_000, 'thesis_invalidated', '{}', '체결 시도 실패 기록', null, 'failed', 'paper_trade_unavailable', '2026-11-19T19:00:01+09:00')
    legacy.close()

    // ② 마이그레이션 적용 — Store 생성 시 0001+0002 실행
    const store = new Store(dbPath, loadMigrationsSql())
    const judgments = store.listJudgments('sosimi', 10)
    const byId = new Map(judgments.map((j) => [j.logId, j]))
    expect(byId.get('jdg_legacy1')?.orderStatus).toBe('filled') // placed → filled 변환
    expect(byId.get('jdg_legacy2')?.orderStatus).toBe('skipped') // skipped 보존
    expect(byId.get('jdg_legacy3')?.orderStatus).toBe('failed') // failed 보존
    expect(byId.get('jdg_legacy3')?.errorMessage).toBe('paper_trade_unavailable') // error_message 열 fidelity
    expect(byId.get('jdg_legacy1')?.rationale).toBe('소심이 기록') // 서사 보존

    // ③ 새 CHECK에서 filled INSERT 성공 (구 DB였다면 SQLITE_CONSTRAINT_CHECK)
    const entry = store.appendJudgment('sosimi', '2026-11-20T14:00:00+09:00', {
      decision: 'buy',
      symbol: '093320',
      quantity: 5,
      priceKrw: 22_466,
      reasonCode: 'wedge_breakout',
      fact: { amountKrw: 300_000 },
      rationale: '손절 22466 대 목표 33142로 손익비 남아 소액 진입',
      order: { orderId: 'od_new', orderStatus: 'filled' },
    })
    expect(entry.orderStatus).toBe('filled')
    store.close()
  })

  test('fresh DB + 재기동 멱등 — 두 번째 Store 기동에도 행 보존·어휘 불변', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-trader-mig2-'))
    tmpDirs.push(dir)
    const dbPath = join(dir, 'fresh.db')

    const first = new Store(dbPath, loadMigrationsSql())
    first.appendJudgment('sosimi', '2026-11-20T14:00:00+09:00', {
      decision: 'hold',
      symbol: null,
      quantity: null,
      priceKrw: null,
      reasonCode: 'no_signal',
      fact: {},
      rationale: '관망',
      order: { orderId: null, orderStatus: 'skipped' },
    })
    first.close()

    // 두 번째 기동 — 0002가 다시 실행돼도 행이 그대로 (재구축 멱등)
    const second = new Store(dbPath, loadMigrationsSql())
    const judgments = second.listJudgments('sosimi', 10)
    expect(judgments).toHaveLength(1)
    expect(judgments[0]?.orderStatus).toBe('skipped')
    second.close()
  })
})
