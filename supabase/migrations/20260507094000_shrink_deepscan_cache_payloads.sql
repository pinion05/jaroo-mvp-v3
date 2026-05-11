-- DeepScan now caches WiseReport KR slim payloads, not raw aggregates.
-- Remove oversized raw-aggregate smoke rows and avoid expensive whole-payload GIN maintenance.

delete from crawler_cache.events
where route = 'wisereport-kr-v12-aggregate'
   or route = 'crawler-cache-rpc-smoke'
   or target_identifier like 'cache-smoke-%'
   or target_identifier = '000000';

delete from crawler_cache.payloads
where route = 'wisereport-kr-v12-aggregate'
   or route = 'crawler-cache-rpc-smoke'
   or target_identifier like 'cache-smoke-%'
   or target_identifier = '000000';

drop index if exists crawler_cache.payloads_payload_gin_idx;

comment on table crawler_cache.payloads is 'Read-through long-term cache entries for crawler payloads. DeepScan WiseReport entries store slim payloads; raw crawler aggregates should be stored outside this table if ever needed.';
