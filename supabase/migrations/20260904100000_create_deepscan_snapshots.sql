-- 딥스캔 스냅샷 캐시 — (user_id, 종목) 단위 최신 1건.
-- 기본 경로는 스냅샷 히트(무료·즉시), 갱신은 명시적 '다시 분석'(refresh=1)만.
-- 결과 페이로드는 보유 수량·평단이 반영된 개인화 데이터라 종목 단위 공유 캐시가 아니다.
-- 읽기/쓰기는 API 라우트의 서비스 롤만 하므로 정책 없는 RLS(deny-all)로 클라이언트를 차단한다.

create table if not exists public.deepscan_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_key text not null,
  market text,
  payload jsonb not null,
  price_basis numeric,
  charged_credits integer not null default 0,
  scanned_at timestamptz not null default now(),
  constraint deepscan_snapshots_user_target_unique unique (user_id, target_key)
);

create index if not exists deepscan_snapshots_user_scanned_idx
  on public.deepscan_snapshots (user_id, scanned_at desc);

alter table public.deepscan_snapshots enable row level security;
