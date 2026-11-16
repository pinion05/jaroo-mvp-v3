-- ai-trader 로컬 상태 (Phase 1) — 캐릭터 레지스트리 + 판단 로그(저널).
-- 사실의 진실 소스는 paper-trade 원장(orders/ledger)이다: 이 DB는 매핑과 판단 서사만 소유한다.
-- Phase 2에서 ai_characters/character_events/character_memories 가 Supabase 로 이관된다
-- (docs/superpowers/specs/2026-11-16-ai-trader-character-pipeline-design.md §4).

CREATE TABLE IF NOT EXISTS characters (
  slug                   TEXT PRIMARY KEY,             -- 'sosimi'
  display_name           TEXT NOT NULL,                -- '소심이'
  persona_card           TEXT NOT NULL,                -- JSON (PersonaCard)
  strategy_params        TEXT NOT NULL,                -- JSON (StrategyParams)
  watchlist              TEXT NOT NULL,                -- JSON (WatchItem[])
  initial_cash_won       INTEGER NOT NULL,             -- 원 단위 정수
  cash_goal_won          INTEGER,                      -- 목표치 (현금 기준, 원 단위 정수)
  paper_trade_account_id TEXT,                         -- paper-trade 계좌 매핑 (bootstrap 전 NULL)
  is_active              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,                -- KST ISO8601
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judgment_logs (
  log_id        TEXT PRIMARY KEY,
  character_slug TEXT NOT NULL,
  loop_at       TEXT NOT NULL,                         -- KST ISO8601
  decision      TEXT NOT NULL CHECK (decision IN ('buy','sell','hold')),
  symbol        TEXT,                                  -- hold no_signal 은 NULL
  quantity      INTEGER,                               -- hold 는 NULL
  price_krw     INTEGER,                               -- hold 는 NULL
  reason_code   TEXT NOT NULL,                         -- stop_loss | take_profit | dip_buy | allocation_buy | frequency_gate | position_cap | insufficient_cash | no_signal | quote_missing
  fact          TEXT NOT NULL,                         -- JSON — grounding 숫자 (사실은 여기만)
  rationale     TEXT NOT NULL,                         -- 템플릿 서사 (Phase 2 LLM 대체 전 단계)
  order_id      TEXT,                                  -- paper-trade 체결 시
  order_status  TEXT NOT NULL CHECK (order_status IN ('placed','skipped','failed')),
  error_message TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_judgment_character ON judgment_logs(character_slug, loop_at DESC);
