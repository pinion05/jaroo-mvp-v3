-- Harden review-identified cache/control gaps for PR #86.
-- - Return upstream_error through read RPC.
-- - Add selective invalidation RPC.
-- - Lock down previously imported public core tables with RLS and no client policies.

drop function if exists public.get_crawler_cache_payload(text);

create function public.get_crawler_cache_payload(p_cache_key text)
returns table (
  id uuid,
  cache_key text,
  payload jsonb,
  payload_hash text,
  payload_size_bytes bigint,
  metadata jsonb,
  source_refs jsonb,
  status text,
  fetched_at timestamptz,
  cached_at timestamptz,
  stale_after timestamptz,
  expires_at timestamptz,
  upstream_error jsonb
)
language sql
stable
security definer
set search_path = public, crawler_cache, pg_temp
as $$
  select
    payloads.id,
    payloads.cache_key,
    payloads.payload,
    payloads.payload_hash,
    payloads.payload_size_bytes,
    payloads.metadata,
    payloads.source_refs,
    payloads.status,
    payloads.fetched_at,
    payloads.cached_at,
    payloads.stale_after,
    payloads.expires_at,
    payloads.upstream_error
  from crawler_cache.payloads
  where payloads.cache_key = p_cache_key
    and payloads.status in ('fresh', 'stale', 'error_fallback')
    and (payloads.expires_at is null or payloads.expires_at > now())
  limit 1;
$$;

create or replace function public.invalidate_crawler_cache_payload(
  p_cache_key text default null,
  p_source text default null,
  p_market text default null,
  p_target_identifier text default null,
  p_route text default null
)
returns table (invalidated_count integer)
language plpgsql
security definer
set search_path = public, crawler_cache, pg_temp
as $$
declare
  changed_count integer := 0;
begin
  if p_cache_key is null
    and p_source is null
    and p_market is null
    and p_target_identifier is null
    and p_route is null then
    raise exception 'at least one cache invalidation selector is required';
  end if;

  with updated as (
    update crawler_cache.payloads
    set status = 'invalidated',
        upstream_error = null
    where (p_cache_key is null or cache_key = p_cache_key)
      and (p_source is null or source = p_source)
      and (p_market is null or market = p_market)
      and (p_target_identifier is null or target_identifier = p_target_identifier)
      and (p_route is null or route = p_route)
      and status <> 'invalidated'
    returning id, cache_key, source, market, target_identifier, route, route_version
  ), inserted_events as (
    insert into crawler_cache.events (
      payload_id,
      cache_key,
      event_type,
      source,
      market,
      target_identifier,
      route,
      route_version,
      metadata
    )
    select
      updated.id,
      updated.cache_key,
      'invalidate',
      updated.source,
      updated.market,
      updated.target_identifier,
      updated.route,
      updated.route_version,
      jsonb_build_object('reason', 'manual-invalidation')
    from updated
    returning 1
  )
  select count(*)::integer into changed_count from inserted_events;

  return query select changed_count;
end;
$$;

revoke all on function public.get_crawler_cache_payload(text) from public, anon, authenticated;
revoke all on function public.invalidate_crawler_cache_payload(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_crawler_cache_payload(text) to service_role;
grant execute on function public.invalidate_crawler_cache_payload(text, text, text, text, text) to service_role;

comment on function public.get_crawler_cache_payload(text) is 'Service-role RPC for reading one non-expired crawler cache payload by cache key, including upstream error fallback metadata.';
comment on function public.invalidate_crawler_cache_payload(text, text, text, text, text) is 'Service-role RPC for selectively invalidating crawler cache payloads by cache key or source/target/route selectors.';

alter table if exists public.users enable row level security;
alter table if exists public.holdings enable row level security;
alter table if exists public.analysis_results enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.holdings from anon, authenticated;
revoke all on table public.analysis_results from anon, authenticated;

grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.holdings to service_role;
grant select, insert, update, delete on table public.analysis_results to service_role;

comment on table public.users is 'Jaroo core user records. RLS enabled; no anon/authenticated client policies until auth ownership mapping is defined.';
comment on table public.holdings is 'Jaroo core holdings. RLS enabled; no anon/authenticated client policies until auth ownership mapping is defined.';
comment on table public.analysis_results is 'Jaroo core analysis snapshots. RLS enabled; no anon/authenticated client policies until auth ownership mapping is defined.';
