create or replace function public.get_crawler_cache_payload(p_cache_key text)
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
  expires_at timestamptz
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
    payloads.expires_at
  from crawler_cache.payloads
  where payloads.cache_key = p_cache_key
    and payloads.status in ('fresh', 'stale', 'error_fallback')
    and (payloads.expires_at is null or payloads.expires_at > now())
  limit 1;
$$;

create or replace function public.upsert_crawler_cache_payload(
  p_cache_key text,
  p_source text,
  p_market text,
  p_target_identifier text,
  p_target_display_name text,
  p_target_kind text,
  p_route text,
  p_route_version text,
  p_schema_version text,
  p_request_hash text,
  p_payload_hash text,
  p_payload_size_bytes bigint,
  p_payload jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_source_refs jsonb default '[]'::jsonb,
  p_status text default 'fresh',
  p_auth_scope text default 'public',
  p_fetched_at timestamptz default now(),
  p_stale_after timestamptz default null,
  p_expires_at timestamptz default null,
  p_upstream_error jsonb default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public, crawler_cache, pg_temp
as $$
begin
  return query
  insert into crawler_cache.payloads (
    cache_key,
    source,
    market,
    target_identifier,
    target_display_name,
    target_kind,
    route,
    route_version,
    schema_version,
    request_hash,
    payload_hash,
    payload_size_bytes,
    payload,
    metadata,
    source_refs,
    status,
    auth_scope,
    fetched_at,
    cached_at,
    stale_after,
    expires_at,
    upstream_error
  ) values (
    p_cache_key,
    p_source,
    p_market,
    p_target_identifier,
    p_target_display_name,
    p_target_kind,
    p_route,
    p_route_version,
    p_schema_version,
    p_request_hash,
    p_payload_hash,
    p_payload_size_bytes,
    p_payload,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_source_refs, '[]'::jsonb),
    p_status,
    p_auth_scope,
    coalesce(p_fetched_at, now()),
    now(),
    p_stale_after,
    p_expires_at,
    p_upstream_error
  )
  on conflict (cache_key) do update set
    source = excluded.source,
    market = excluded.market,
    target_identifier = excluded.target_identifier,
    target_display_name = excluded.target_display_name,
    target_kind = excluded.target_kind,
    route = excluded.route,
    route_version = excluded.route_version,
    schema_version = excluded.schema_version,
    request_hash = excluded.request_hash,
    payload_hash = excluded.payload_hash,
    payload_size_bytes = excluded.payload_size_bytes,
    payload = excluded.payload,
    metadata = excluded.metadata,
    source_refs = excluded.source_refs,
    status = excluded.status,
    auth_scope = excluded.auth_scope,
    fetched_at = excluded.fetched_at,
    cached_at = now(),
    stale_after = excluded.stale_after,
    expires_at = excluded.expires_at,
    upstream_error = excluded.upstream_error
  returning payloads.id;
end;
$$;

create or replace function public.record_crawler_cache_event(
  p_event_type text,
  p_cache_key text default null,
  p_payload_id uuid default null,
  p_source text default null,
  p_market text default null,
  p_target_identifier text default null,
  p_route text default null,
  p_route_version text default null,
  p_latency_ms integer default null,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (id bigint)
language plpgsql
security definer
set search_path = public, crawler_cache, pg_temp
as $$
begin
  return query
  insert into crawler_cache.events (
    payload_id,
    cache_key,
    event_type,
    source,
    market,
    target_identifier,
    route,
    route_version,
    latency_ms,
    error_message,
    metadata
  ) values (
    p_payload_id,
    p_cache_key,
    p_event_type,
    p_source,
    p_market,
    p_target_identifier,
    p_route,
    p_route_version,
    p_latency_ms,
    p_error_message,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning events.id;
end;
$$;

revoke all on function public.get_crawler_cache_payload(text) from public, anon, authenticated;
revoke all on function public.upsert_crawler_cache_payload(text, text, text, text, text, text, text, text, text, text, text, bigint, jsonb, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.record_crawler_cache_event(text, text, uuid, text, text, text, text, text, integer, text, jsonb) from public, anon, authenticated;

grant execute on function public.get_crawler_cache_payload(text) to service_role;
grant execute on function public.upsert_crawler_cache_payload(text, text, text, text, text, text, text, text, text, text, text, bigint, jsonb, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, jsonb) to service_role;
grant execute on function public.record_crawler_cache_event(text, text, uuid, text, text, text, text, text, integer, text, jsonb) to service_role;

comment on function public.get_crawler_cache_payload(text) is 'Service-role RPC for reading one non-expired crawler cache payload by cache key.';
comment on function public.upsert_crawler_cache_payload(text, text, text, text, text, text, text, text, text, text, text, bigint, jsonb, jsonb, jsonb, text, text, timestamptz, timestamptz, timestamptz, jsonb) is 'Service-role RPC for writing crawler cache payloads without exposing crawler_cache schema to public API schemas.';
comment on function public.record_crawler_cache_event(text, text, uuid, text, text, text, text, text, integer, text, jsonb) is 'Service-role RPC for recording crawler cache hit/miss/write/error events.';
