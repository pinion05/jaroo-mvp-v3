create extension if not exists pgcrypto;
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now()
);
create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stock_code text not null,
  stock_name text not null,
  qty numeric not null,
  avg_price numeric not null,
  target_price numeric,
  stop_loss_price numeric,
  memo text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_holdings_user_id on public.holdings(user_id);
create index if not exists idx_holdings_stock_code on public.holdings(stock_code);
create table if not exists public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  holding_id uuid references public.holdings(id) on delete cascade,
  analysis_type text not null default 'portfolio_deep_analysis',
  summary text,
  verdict text,
  market_snapshot_json jsonb,
  news_snapshot_json jsonb,
  filing_snapshot_json jsonb,
  price_snapshot_json jsonb,
  full_result_json jsonb,
  model_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_analysis_results_user_id on public.analysis_results(user_id);
create index if not exists idx_analysis_results_holding_id on public.analysis_results(holding_id);
