-- 딥스캔 기록 원장 — 스캔 성공 시마다 1행 append.
-- deepscan_snapshots가 (user_id, 종목) 최신 1건 캐시라 과거가 덮어써지는 반면,
-- 이 테이블은 id 단위로 여러 건을 보존해 "기록" 탭·id 조회의 진실 소스가 된다.
-- 읽기/쓰기는 API 라우트의 서비스 롤만 하므로 스냅샷과 동일하게 정책 없는
-- RLS(deny-all)로 클라이언트 직접 접근을 차단한다.

create table if not exists public.deepscan_scan_history (
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

create index if not exists deepscan_scan_history_user_scanned_idx
  on public.deepscan_scan_history (user_id, scanned_at desc);

alter table public.deepscan_scan_history enable row level security;
