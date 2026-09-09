-- 워치 알림 강도 설정 — 계정 단위 1행(#222 §3-6: 종목별 개별 설정은 두지 않는다).
-- 최소(minimal)=층1 핵심+안전 하한선만 / 보통(normal, 기본)=층1 전부+주 1회 요약 /
-- 상세(detail)=층1+급등락 5%. 안전 하한선(거래정지·상장폐지 등)은 어떤 레벨에서도 발송된다.
create table if not exists public.watch_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alert_level text not null default 'normal' check (alert_level in ('minimal', 'normal', 'detail')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.watch_settings enable row level security;

create policy "watch_settings_select_own"
  on public.watch_settings for select
  using (auth.uid() = user_id);

create policy "watch_settings_insert_own"
  on public.watch_settings for insert
  with check (auth.uid() = user_id);

create policy "watch_settings_update_own"
  on public.watch_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
