-- jaroo-paper-trade 스키마 v1
-- 원칙: cache ZERO / DB fetch only — 모든 상태는 이 테이블들에만 존재하고
-- 파생값(평가손익 등)은 저장하지 않는다(요청 시 계산).

CREATE TABLE IF NOT EXISTS accounts (
  account_id       TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  initial_cash_won INTEGER NOT NULL,
  cash_won         INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  account_id          TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  symbol_name         TEXT,
  market              TEXT,
  quantity            INTEGER NOT NULL,
  avg_price_centiwon  INTEGER NOT NULL,  -- 평단가(원×100, 정수)
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (account_id, symbol)
);

-- 체결 내역 = 매매 입증 데이터의 소스 오브 트루스.
CREATE TABLE IF NOT EXISTS orders (
  order_id                 TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL,
  symbol                   TEXT NOT NULL,
  symbol_name              TEXT,
  market                   TEXT,
  side                     TEXT NOT NULL CHECK (side IN ('buy','sell')),
  order_type               TEXT NOT NULL DEFAULT 'market',
  quantity                 INTEGER NOT NULL,
  executed_price_won       INTEGER NOT NULL,
  gross_won                INTEGER NOT NULL,
  fee_won                  INTEGER NOT NULL,
  tax_won                  INTEGER NOT NULL,
  settlement_won           INTEGER NOT NULL,   -- 현금 변동(매수: 음수)
  realized_pnl_won         INTEGER,            -- 매도에만 존재
  quantity_after           INTEGER NOT NULL,
  avg_price_centiwon_after INTEGER NOT NULL,
  cash_after_won           INTEGER NOT NULL,
  created_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, created_at);

CREATE TABLE IF NOT EXISTS ledger (
  ledger_id         TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL,
  kind              TEXT NOT NULL,           -- deposit | buy_settlement | sell_settlement
  amount_won        INTEGER NOT NULL,
  balance_after_won INTEGER NOT NULL,
  ref_order_id      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, created_at);
