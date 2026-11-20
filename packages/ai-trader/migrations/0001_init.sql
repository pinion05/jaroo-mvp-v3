-- ai-trader 로컬 상태 (v2 정리) — 캐릭터 레지스트리 + 판단 로그(저널).
-- 사실의 진실 소스는 paper-trade 원장(orders/ledger)이다: 이 DB는 매핑과 판단 서사만 소유한다.
-- v2 개정(2026-11-19): strategy_params·watchlist 컬럼 폐기(정적 성향 필터·시드 관심목록 폐지 —
-- 종목은 ②흥미 선정 턴이 소스 덤프에서 뽑는다). thesis_id·turn_date·decision_dump_ref 등은
-- 마이그레이션 0002(구현 2.5a)에서 확장 — docs/superpowers/specs/2026-11-19-ai-trader-multiturn-loop-design.md §7.

CREATE TABLE IF NOT EXISTS characters (
  slug                   TEXT PRIMARY KEY,             -- 'sosimi'
  display_name           TEXT NOT NULL,                -- '소심이'
  persona_card           TEXT NOT NULL,                -- JSON (PersonaCard — principles 포함)
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
  reason_code   TEXT NOT NULL,                         -- 자유 태그 (정적 라벨 세트 폐지, v2)
  fact          TEXT NOT NULL,                         -- JSON — grounding 숫자·리포트 근거 (사실은 여기만)
  rationale     TEXT NOT NULL,                         -- ⑤ 페르소나 LLM 서사
  order_id      TEXT,                                  -- paper-trade 체결 시
  order_status  TEXT NOT NULL CHECK (order_status IN ('filled','skipped','failed')),
  error_message TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_judgment_character ON judgment_logs(character_slug, loop_at DESC);
