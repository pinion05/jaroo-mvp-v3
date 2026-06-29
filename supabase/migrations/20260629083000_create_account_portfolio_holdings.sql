-- Account-bound current portfolio snapshot for Jaroo home restore.
-- Authentication boundary: Supabase auth.users.id via auth.uid().

create extension if not exists pgcrypto;

create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  code text,
  ticker text,
  market text,
  market_tone text check (market_tone is null or market_tone in ('kospi', 'kosdaq', 'nasdaq', 'etf')),
  kind text check (kind is null or kind in ('stock', 'etf')),
  quantity numeric not null check (quantity > 0),
  average_price numeric not null check (average_price >= 0),
  average_price_currency text check (average_price_currency is null or average_price_currency in ('KRW', 'USD')),
  evaluation_amount numeric check (evaluation_amount is null or evaluation_amount >= 0),
  identifier_label text,
  sort_order integer not null default 0,
  source text not null default 'ocr-merge',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_holdings_user_order_idx
  on public.portfolio_holdings (user_id, sort_order, created_at);

create index if not exists portfolio_holdings_user_identity_idx
  on public.portfolio_holdings (user_id, code, ticker, name);

alter table public.portfolio_holdings enable row level security;

drop trigger if exists portfolio_holdings_set_updated_at on public.portfolio_holdings;
create trigger portfolio_holdings_set_updated_at
before update on public.portfolio_holdings
for each row execute function public.set_updated_at();

drop policy if exists "portfolio_holdings_select_own" on public.portfolio_holdings;
create policy "portfolio_holdings_select_own"
on public.portfolio_holdings
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "portfolio_holdings_insert_own" on public.portfolio_holdings;
create policy "portfolio_holdings_insert_own"
on public.portfolio_holdings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "portfolio_holdings_update_own" on public.portfolio_holdings;
create policy "portfolio_holdings_update_own"
on public.portfolio_holdings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "portfolio_holdings_delete_own" on public.portfolio_holdings;
create policy "portfolio_holdings_delete_own"
on public.portfolio_holdings
for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.replace_portfolio_holdings(p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  inserted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'portfolio items must be a JSON array';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 100 then
    raise exception 'too many portfolio items';
  end if;

  delete from public.portfolio_holdings
  where user_id = current_user_id;

  insert into public.portfolio_holdings (
    user_id,
    name,
    code,
    ticker,
    market,
    market_tone,
    kind,
    quantity,
    average_price,
    average_price_currency,
    evaluation_amount,
    identifier_label,
    sort_order,
    source
  )
  select
    current_user_id,
    btrim(item ->> 'name'),
    nullif(btrim(item ->> 'code'), ''),
    nullif(btrim(item ->> 'ticker'), ''),
    nullif(btrim(item ->> 'market'), ''),
    nullif(btrim(item ->> 'market_tone'), ''),
    nullif(btrim(item ->> 'kind'), ''),
    (item ->> 'quantity')::numeric,
    (item ->> 'average_price')::numeric,
    nullif(btrim(item ->> 'average_price_currency'), ''),
    nullif(item ->> 'evaluation_amount', '')::numeric,
    nullif(btrim(item ->> 'identifier_label'), ''),
    coalesce((item ->> 'sort_order')::integer, ordinal::integer - 1),
    coalesce(nullif(btrim(item ->> 'source'), ''), 'ocr-merge')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as entries(item, ordinal)
  where length(btrim(item ->> 'name')) > 0;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on table public.portfolio_holdings from public, anon;
grant select, insert, update, delete on table public.portfolio_holdings to authenticated;
grant select, insert, update, delete on table public.portfolio_holdings to service_role;
grant execute on function public.replace_portfolio_holdings(jsonb) to authenticated;
grant execute on function public.replace_portfolio_holdings(jsonb) to service_role;

comment on table public.portfolio_holdings is 'Current account portfolio holdings restored on /home, keyed by Supabase auth.users.id.';
comment on function public.replace_portfolio_holdings(jsonb) is 'Atomically replaces the authenticated user current portfolio holdings from sanitized JSON input.';
