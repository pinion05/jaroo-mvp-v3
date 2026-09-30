-- 텔레그램 알림 채널: Jaroo 계정 ↔ 텔레그램 채팅 연결 (jaroo-watcher 봇).
-- 연결은 1회용 토큰으로만 확정한다. 유저가 t.me/jaroowatcher_bot?start=<token> 으로
-- 봇을 시작하면 웹훅(/api/telegram/webhook)이 토큰을 검증해 chat_id 를 저장한다.
-- 텔레그램 정책상 봇은 /start 한 적 없는 유저에게 먼저 메시지를 보낼 수 없으므로
-- 이 토큰 플로우가 사실상 "알림 수신 동의" 겸 온보딩이다.

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id text not null,
  username text,                                -- 텔레그램 @username (없을 수 있음)
  status text not null default 'active',        -- active | blocked (봇 차단 등 발송 실패 시 마킹)
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 한 텔레그램 계정은 하나의 Jaroo 계정에만 연결 가능 (모호한 발송 방지).
create unique index if not exists telegram_links_chat_id_key
  on public.telegram_links (chat_id);

-- 1회용 연동 토큰. 클라이언트가 직접 읽지 않는다(RLS 정책 없음 = authenticated 기본 차단).
create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_tokens_user_idx
  on public.telegram_link_tokens (user_id);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;

create policy telegram_links_select_own
  on public.telegram_links for select
  using (auth.uid() = user_id);

create policy telegram_links_delete_own
  on public.telegram_links for delete
  using (auth.uid() = user_id);
