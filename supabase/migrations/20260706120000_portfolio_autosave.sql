-- Portfolio auto-save/load: capture remote portfolio_holdings schema + atomic replace RPC + RLS.
-- Depends on public.set_updated_at() from 20260626084500_create_auth_profiles.sql.

-- 1. schema capture (no-op on the existing remote table)
create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  code text,
  ticker text,
  market text,
  market_tone text,
  kind text,
  quantity numeric not null,
  average_price numeric not null,
  average_price_currency text,
  evaluation_amount numeric,
  identifier_label text,
  sort_order integer not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_holdings_user_id_idx on public.portfolio_holdings(user_id);

drop trigger if exists portfolio_holdings_set_updated_at on public.portfolio_holdings;
create trigger portfolio_holdings_set_updated_at
  before update on public.portfolio_holdings
  for each row execute function public.set_updated_at();

-- 2. atomic per-user replace RPC (service_role only; serialized per user)
create or replace function public.sync_user_portfolio(p_user_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare inserted_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  delete from public.portfolio_holdings where user_id = p_user_id;

  insert into public.portfolio_holdings (
    user_id, name, code, ticker, market, market_tone, kind,
    quantity, average_price, average_price_currency, evaluation_amount,
    identifier_label, sort_order, source
  )
  select
    p_user_id,
    r->>'name',
    nullif(r->>'code',''),
    nullif(r->>'ticker',''),
    nullif(r->>'market',''),
    nullif(r->>'market_tone',''),
    nullif(r->>'kind',''),
    case when (r->>'quantity')      ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'quantity')::numeric      else 0 end,
    case when (r->>'average_price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'average_price')::numeric else 0 end,
    nullif(r->>'average_price_currency',''),
    case when (r->>'evaluation_amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'evaluation_amount')::numeric else null end,
    nullif(r->>'identifier_label',''),
    case when (r->>'sort_order') ~ '^-?[0-9]+$' then (r->>'sort_order')::integer else (idx - 1) end,
    coalesce(nullif(r->>'source',''), 'ocr')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, idx)
  where nullif(r->>'name','') is not null;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.sync_user_portfolio(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_user_portfolio(uuid, jsonb) to service_role;

-- 3. RLS (defense-in-depth; service_role bypasses regardless)
alter table public.portfolio_holdings enable row level security;

drop policy if exists "portfolio_holdings own rows" on public.portfolio_holdings;
create policy "portfolio_holdings own rows" on public.portfolio_holdings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
