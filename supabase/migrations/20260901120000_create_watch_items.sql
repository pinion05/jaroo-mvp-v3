-- 워치(종목 감시 등록): 딥스캔 '지켜보기 시작' 등록·해지 저장.
-- 감시 배치(조건 감지 → 텔레그램 발송)는 후속 단계로, 이 테이블이 그 원천이 된다.
-- 1인 1종목 1행(재등록은 upsert), 종목 키는 KR 코드/US 티커를 code 로 통일.

create table if not exists public.watch_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,
  name text not null,
  market text,
  created_at timestamptz not null default now(),
  constraint watch_items_user_code_unique unique (user_id, code)
);

create index if not exists watch_items_user_idx on public.watch_items (user_id);

alter table public.watch_items enable row level security;

create policy "watch_items_select_own"
  on public.watch_items for select
  to authenticated
  using (auth.uid() = user_id);

create policy "watch_items_insert_own"
  on public.watch_items for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "watch_items_delete_own"
  on public.watch_items for delete
  to authenticated
  using (auth.uid() = user_id);
