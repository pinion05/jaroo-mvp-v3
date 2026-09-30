-- 워치 일일 수집 스냅샷 — 감시 배치가 딥스캔 수집 파이프라인으로 모은 종목 단위 일일 데이터.
-- 사용자별이 아니라 종목별로 1일 1행(같은 종목을 여러 사용자가 감시해도 공유).
create table if not exists public.watch_daily_scans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  market text not null default 'KR',
  collected_date date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (code, collected_date)
);

create index if not exists watch_daily_scans_collected_date_idx
  on public.watch_daily_scans (collected_date desc);

-- 결제·크레딧 테이블과 동일한 deny-all 패턴: RLS 활성화 + 정책 없음.
-- 배치는 서비스 롤로만 접근하고, 사용자 클라이언트에서의 직접 읽기·쓰기를 차단한다.
alter table public.watch_daily_scans enable row level security;
