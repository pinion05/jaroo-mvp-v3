-- 0002: judgment_logs order_status 어휘 placed → filled (#373 후속)
--
-- 배경: #373이 0001의 CHECK를 in-place 수정(placed→filled)했지만 SQLite는
-- CREATE TABLE IF NOT EXISTS로 기존 테이블을 건드리지 않는다 — 기존 dev DB는
-- 구 CHECK(placed) 그대로라 'filled' INSERT가 SQLITE_CONSTRAINT_CHECK로 실패
-- (차트콕 실턴 실측: 체결 5건 + 판단 로그 500 × 5).
--
-- 재구축 패턴: 새 CHECK 테이블 생성 → 어휘 변환 복사 → 교체.
-- placed 행은 filled로 변환되고 skipped/failed는 그대로 (소심이 등 기존 기록 보존).
-- fresh DB(0001이 이미 filled CHECK로 생성)에서도 멱등 — 변환 대상 없이 재구축만
-- 수행되며 행 내용 불변. 인덱스는 DROP TABLE와 함께 소멸하므로 재생성.

-- 전체를 한 트랜잭션으로 — SQLite DDL은 트랜잭셔널하다. db.exec()는 문장별
-- 자동커밋이라 래핑이 없으면 INSERT 커밋 직후~DROP 직전 크래시 시 재기동
-- 마이그레이션이 UNIQUE(judgment_logs_v2.log_id) 실패로 기동 루프에 빠진다
-- (평가 세션 실증). BEGIN~COMMIT 안에서는 크래시 시 전체 롤백 → 재기동이 깨끗이 재실행.

BEGIN;

CREATE TABLE IF NOT EXISTS judgment_logs_v2 (
  log_id        TEXT PRIMARY KEY,
  character_slug TEXT NOT NULL,
  loop_at       TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('buy','sell','hold')),
  symbol        TEXT,
  quantity      INTEGER,
  price_krw     INTEGER,
  reason_code   TEXT NOT NULL,
  fact          TEXT NOT NULL,
  rationale     TEXT NOT NULL,
  order_id      TEXT,
  order_status  TEXT NOT NULL CHECK (order_status IN ('filled','skipped','failed')),
  error_message TEXT,
  created_at    TEXT NOT NULL
);

INSERT INTO judgment_logs_v2
  (log_id, character_slug, loop_at, decision, symbol, quantity, price_krw,
   reason_code, fact, rationale, order_id, order_status, error_message, created_at)
SELECT
  log_id, character_slug, loop_at, decision, symbol, quantity, price_krw,
  reason_code, fact, rationale, order_id,
  CASE order_status WHEN 'placed' THEN 'filled' ELSE order_status END,
  error_message, created_at
FROM judgment_logs;

DROP TABLE judgment_logs;
ALTER TABLE judgment_logs_v2 RENAME TO judgment_logs;

CREATE INDEX IF NOT EXISTS idx_judgment_character ON judgment_logs(character_slug, loop_at DESC);

COMMIT;
