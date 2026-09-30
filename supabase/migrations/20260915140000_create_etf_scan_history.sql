-- ETF 조회 기록 원장 — /api/etf/profile 조회 성공 시마다 1행 append.
-- deepscan_scan_history와 같은 원장 패턴이지만 payload 계약이 다르다:
--   deepscan → JarooDeepScanPayload (isCanonicalPayload로 검증)
--   etf      → EtfProfileJson (jaroo-etf-profile-v1, 읽기 경로에서 schemaVersion 검증)
-- 스키마가 달라 단일 테이블 재사용은 불가하므로(getScanHistoryById의 canonical
-- 가드가 ETF payload를 거부) 별도 테이블로 분리했다. 읽기/쓰기는 API 라우트의
-- 서비스 롤만 하므로 정책 없는 RLS(deny-all)로 클라이언트 직접 접근을 차단한다.

create table if not exists public.etf_scan_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_key text not null,
  market text,
  stock_name text,
  target_input jsonb not null,
  payload jsonb not null,
  price_basis numeric,
  charged_credits integer not null default 0,
  scanned_at timestamptz not null default now()
);

create index if not exists etf_scan_history_user_scanned_idx
  on public.etf_scan_history (user_id, scanned_at desc);

alter table public.etf_scan_history enable row level security;
