create extension if not exists pgcrypto;

create schema if not exists crawler_cache;

create table if not exists crawler_cache.payloads (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  source text not null,
  market text not null,
  target_identifier text not null,
  target_display_name text,
  target_kind text,
  route text not null,
  route_version text not null default 'v1',
  schema_version text not null,
  request_hash text not null,
  payload_hash text not null,
  payload_size_bytes bigint not null check (payload_size_bytes >= 0),
  payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  status text not null default 'fresh' check (status in ('fresh', 'stale', 'error_fallback', 'invalidated')),
  auth_scope text not null default 'public' check (auth_scope in ('public', 'system', 'user', 'account')),
  fetched_at timestamptz not null default now(),
  cached_at timestamptz not null default now(),
  stale_after timestamptz,
  expires_at timestamptz,
  upstream_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payloads_cache_key_not_blank check (length(btrim(cache_key)) > 0),
  constraint payloads_payload_hash_not_blank check (length(btrim(payload_hash)) > 0),
  constraint payloads_request_hash_not_blank check (length(btrim(request_hash)) > 0),
  constraint payloads_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint payloads_source_refs_array check (jsonb_typeof(source_refs) = 'array'),
  constraint payloads_upstream_error_object check (upstream_error is null or jsonb_typeof(upstream_error) = 'object')
);

create index if not exists payloads_lookup_idx
  on crawler_cache.payloads (source, market, target_identifier, route, route_version, schema_version, request_hash);
create index if not exists payloads_expiration_idx
  on crawler_cache.payloads (expires_at) where expires_at is not null;
create index if not exists payloads_stale_after_idx
  on crawler_cache.payloads (stale_after) where stale_after is not null;
create index if not exists payloads_status_idx
  on crawler_cache.payloads (status);
create index if not exists payloads_fetched_at_idx
  on crawler_cache.payloads (fetched_at desc);
create index if not exists payloads_metadata_gin_idx
  on crawler_cache.payloads using gin (metadata jsonb_path_ops);

create table if not exists crawler_cache.events (
  id bigserial primary key,
  payload_id uuid references crawler_cache.payloads(id) on delete set null,
  cache_key text,
  event_type text not null check (event_type in ('hit', 'miss', 'write', 'refresh', 'stale_hit', 'error', 'invalidate')),
  source text,
  market text,
  target_identifier text,
  route text,
  route_version text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists events_created_at_idx on crawler_cache.events (created_at desc);
create index if not exists events_cache_key_created_at_idx on crawler_cache.events (cache_key, created_at desc);
create index if not exists events_type_created_at_idx on crawler_cache.events (event_type, created_at desc);
create index if not exists events_target_idx on crawler_cache.events (source, market, target_identifier, route);

create or replace function crawler_cache.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_payloads_updated_at on crawler_cache.payloads;
create trigger set_payloads_updated_at
before update on crawler_cache.payloads
for each row execute function crawler_cache.set_updated_at();

alter table crawler_cache.payloads enable row level security;
alter table crawler_cache.events enable row level security;

grant usage on schema crawler_cache to service_role;
grant select, insert, update, delete on all tables in schema crawler_cache to service_role;
grant usage, select on all sequences in schema crawler_cache to service_role;
alter default privileges in schema crawler_cache grant select, insert, update, delete on tables to service_role;
alter default privileges in schema crawler_cache grant usage, select on sequences to service_role;

comment on schema crawler_cache is 'Durable cache for large external crawler payloads used by Jaroo DeepScan and market-data flows.';
comment on table crawler_cache.payloads is 'Read-through long-term cache entries for large crawler payloads, keyed by source, target, route, schema, and request fingerprint.';
comment on table crawler_cache.events is 'Operational cache hit/miss/write/error events for crawler cache observability.';
