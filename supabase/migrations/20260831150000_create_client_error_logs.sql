-- 클라이언트 렌더 크래시 관측 — global-error.tsx 가 /api/client-errors 로 적재.
-- 운영에서 "This page couldn't load" 가 재현 불가 상태로 반복되어, 다음 발생 시
-- 원인(스택/다이제스트/화면/UA)을 확보하기 위한 최소 로그 테이블.
-- 서버(service_role)에서만 INSERT 하므로 클라이언트 직접 쓰기 정책은 두지 않는다.

create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  digest text,
  page_url text,
  user_agent text,
  user_id uuid references auth.users (id) on delete cascade
);

-- 클라이언트 직접 접근 차단(정책 없음 = deny all). 서버(service_role)만 INSERT 한다.
alter table public.client_error_logs enable row level security;

create index if not exists client_error_logs_created_at_idx
  on public.client_error_logs (created_at desc);
