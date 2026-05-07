import { createHash } from 'node:crypto';

const DEFAULT_RPC_TIMEOUT_MS = 2_500;
const DEFAULT_FRESH_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_STALE_TTL_MS = 7 * 24 * 60 * 60_000;
const CACHE_KEY_PREFIX = 'crawler-cache-v1';
const DISABLE_TOKENS = new Set(['0', 'false', 'off', 'no', 'disabled']);
const ENABLE_TOKENS = new Set(['1', 'true', 'on', 'yes', 'enabled']);

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeToggle(value) {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (ENABLE_TOKENS.has(normalized)) return true;
  if (DISABLE_TOKENS.has(normalized)) return false;
  return undefined;
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveIntegerEnv(names, fallback, env = process.env) {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) {
      return readPositiveInteger(value, fallback);
    }
  }

  return fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value === undefined) {
    return null;
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableJsonValue(value));
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizeSupabaseUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function normalizeTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const normalized = normalizeText(value);
  if (!normalized) return null;

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function addMs(baseDate, ms) {
  const base = baseDate instanceof Date ? baseDate : new Date(baseDate);
  return new Date(base.getTime() + ms).toISOString();
}

function getRowPayload(row) {
  if (!row || typeof row !== 'object') return undefined;
  return row.payload;
}

function isCacheRowFresh(row, now = new Date()) {
  if (!row || row.status !== 'fresh') {
    return false;
  }

  const expiresAt = normalizeTimestamp(row.expires_at ?? row.expiresAt);
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
    return false;
  }

  const staleAfter = normalizeTimestamp(row.stale_after ?? row.staleAfter);
  return !staleAfter || Date.parse(staleAfter) > now.getTime();
}

function isCacheRowUsableAsStale(row, now = new Date()) {
  if (!row || !['fresh', 'stale', 'error_fallback'].includes(row.status)) {
    return false;
  }

  const expiresAt = normalizeTimestamp(row.expires_at ?? row.expiresAt);
  return !expiresAt || Date.parse(expiresAt) > now.getTime();
}

function asMetadataObject(value) {
  return isPlainObject(value) ? value : {};
}

function asSourceRefs(value) {
  return Array.isArray(value) ? value : [];
}

function requireDescriptorText(descriptor, key) {
  const value = normalizeText(descriptor?.[key]);
  if (!value) {
    throw new Error(`crawler cache descriptor ${key} is required`);
  }

  return value;
}

export function buildCrawlerCacheIdentity(descriptor = {}) {
  const source = requireDescriptorText(descriptor, 'source');
  const market = requireDescriptorText(descriptor, 'market');
  const targetIdentifier = requireDescriptorText(descriptor, 'targetIdentifier');
  const route = requireDescriptorText(descriptor, 'route');
  const routeVersion = requireDescriptorText(descriptor, 'routeVersion');
  const schemaVersion = requireDescriptorText(descriptor, 'schemaVersion');
  const requestHash = normalizeText(descriptor.requestHash) ?? sha256Hex(stableStringify(descriptor.request ?? {}));
  const cacheKey = normalizeText(descriptor.cacheKey)
    ?? `${CACHE_KEY_PREFIX}:${sha256Hex(stableStringify({
      source,
      market,
      targetIdentifier,
      route,
      routeVersion,
      schemaVersion,
      requestHash,
    }))}`;

  return {
    cacheKey,
    source,
    market,
    targetIdentifier,
    targetDisplayName: normalizeText(descriptor.targetDisplayName) ?? null,
    targetKind: normalizeText(descriptor.targetKind) ?? null,
    route,
    routeVersion,
    schemaVersion,
    requestHash,
    authScope: normalizeText(descriptor.authScope) ?? 'public',
    metadata: asMetadataObject(descriptor.metadata),
    sourceRefs: asSourceRefs(descriptor.sourceRefs),
  };
}

export function buildCrawlerCachePayloadEntry(descriptor = {}, payload, options = {}) {
  const identity = buildCrawlerCacheIdentity(descriptor);
  const payloadJson = stableStringify(payload);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const freshTtlMs = readPositiveInteger(options.freshTtlMs, DEFAULT_FRESH_TTL_MS);
  const staleTtlMs = readPositiveInteger(options.staleTtlMs, DEFAULT_STALE_TTL_MS);

  return {
    ...identity,
    payload,
    payloadHash: sha256Hex(payloadJson),
    payloadSizeBytes: Buffer.byteLength(payloadJson, 'utf8'),
    status: normalizeText(options.status) ?? 'fresh',
    fetchedAt: normalizeTimestamp(options.fetchedAt) ?? now.toISOString(),
    staleAfter: normalizeTimestamp(options.staleAfter) ?? addMs(now, freshTtlMs),
    expiresAt: normalizeTimestamp(options.expiresAt) ?? addMs(now, staleTtlMs),
    upstreamError: isPlainObject(options.upstreamError) ? options.upstreamError : null,
  };
}

async function fetchJsonWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = data?.message ?? data?.hint ?? response.statusText ?? 'Supabase RPC request failed';
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function createSupabaseCrawlerCacheClient(options = {}) {
  const supabaseUrl = normalizeSupabaseUrl(options.supabaseUrl);
  const serviceRoleKey = normalizeText(options.serviceRoleKey);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = readPositiveInteger(options.timeoutMs, DEFAULT_RPC_TIMEOUT_MS);

  if (!supabaseUrl || !serviceRoleKey || typeof fetchImpl !== 'function') {
    return null;
  }

  const rpc = async (name, body) => fetchJsonWithTimeout(fetchImpl, `${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  }, timeoutMs);

  return {
    enabled: true,
    async readPayload(cacheKey) {
      const rows = await rpc('get_crawler_cache_payload', { p_cache_key: cacheKey });
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },
    async upsertPayload(entry) {
      return rpc('upsert_crawler_cache_payload', {
        p_cache_key: entry.cacheKey,
        p_source: entry.source,
        p_market: entry.market,
        p_target_identifier: entry.targetIdentifier,
        p_target_display_name: entry.targetDisplayName,
        p_target_kind: entry.targetKind,
        p_route: entry.route,
        p_route_version: entry.routeVersion,
        p_schema_version: entry.schemaVersion,
        p_request_hash: entry.requestHash,
        p_payload_hash: entry.payloadHash,
        p_payload_size_bytes: entry.payloadSizeBytes,
        p_payload: entry.payload,
        p_metadata: entry.metadata,
        p_source_refs: entry.sourceRefs,
        p_status: entry.status,
        p_auth_scope: entry.authScope,
        p_fetched_at: entry.fetchedAt,
        p_stale_after: entry.staleAfter,
        p_expires_at: entry.expiresAt,
        p_upstream_error: entry.upstreamError,
      });
    },
    async recordEvent(event) {
      return rpc('record_crawler_cache_event', {
        p_cache_key: event.cacheKey ?? null,
        p_event_type: event.eventType,
        p_payload_id: event.payloadId ?? null,
        p_source: event.source ?? null,
        p_market: event.market ?? null,
        p_target_identifier: event.targetIdentifier ?? null,
        p_route: event.route ?? null,
        p_route_version: event.routeVersion ?? null,
        p_latency_ms: event.latencyMs ?? null,
        p_error_message: event.errorMessage ?? null,
        p_metadata: asMetadataObject(event.metadata),
      });
    },
  };
}

export function getDefaultSupabaseCrawlerCacheClient(options = {}) {
  const env = options.env ?? process.env;
  const toggle = normalizeToggle(env.CRAWLER_SUPABASE_CACHE_ENABLE ?? env.SUPABASE_CRAWLER_CACHE_ENABLE);

  if (toggle === false) {
    return null;
  }

  const serviceRoleKey = normalizeText(options.serviceRoleKey)
    ?? normalizeText(env.SUPABASE_SERVICE_ROLE_KEY)
    ?? normalizeText(env.SUPABASE_SERVICE_KEY);
  const supabaseUrl = normalizeText(options.supabaseUrl) ?? normalizeText(env.SUPABASE_URL);

  if (toggle !== true && (!supabaseUrl || !serviceRoleKey)) {
    return null;
  }

  return createSupabaseCrawlerCacheClient({
    supabaseUrl,
    serviceRoleKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? readPositiveIntegerEnv([
      'CRAWLER_SUPABASE_CACHE_TIMEOUT_MS',
      'SUPABASE_CRAWLER_CACHE_TIMEOUT_MS',
    ], DEFAULT_RPC_TIMEOUT_MS, env),
  });
}

async function recordEventBestEffort(cacheClient, event) {
  if (!cacheClient || typeof cacheClient.recordEvent !== 'function') {
    return;
  }

  try {
    await cacheClient.recordEvent(event);
  } catch {
    // cache event logging must never block crawler progress
  }
}

function buildEventBase(identity) {
  return {
    cacheKey: identity.cacheKey,
    source: identity.source,
    market: identity.market,
    targetIdentifier: identity.targetIdentifier,
    route: identity.route,
    routeVersion: identity.routeVersion,
  };
}

function errorMessage(error) {
  return normalizeText(error?.message) ?? String(error ?? 'unknown error');
}

export async function readThroughCrawlerCache({
  cacheClient,
  descriptor,
  load,
  freshTtlMs = DEFAULT_FRESH_TTL_MS,
  staleTtlMs = DEFAULT_STALE_TTL_MS,
  allowStaleOnError = true,
  now = new Date(),
} = {}) {
  if (typeof load !== 'function') {
    throw new Error('readThroughCrawlerCache requires a load function');
  }

  const identity = buildCrawlerCacheIdentity(descriptor);
  const eventBase = buildEventBase(identity);
  const startedAt = Date.now();

  if (!cacheClient) {
    return {
      value: await load(),
      cache: {
        enabled: false,
        hit: false,
        cacheKey: identity.cacheKey,
      },
    };
  }

  let cachedRow = null;
  let staleCandidate = null;
  let readError = null;

  try {
    cachedRow = await cacheClient.readPayload(identity.cacheKey);
    if (cachedRow && isCacheRowFresh(cachedRow, now)) {
      await recordEventBestEffort(cacheClient, {
        ...eventBase,
        payloadId: cachedRow.id,
        eventType: 'hit',
        latencyMs: Date.now() - startedAt,
        metadata: { freshness: 'fresh' },
      });

      return {
        value: getRowPayload(cachedRow),
        cache: {
          enabled: true,
          hit: true,
          freshness: 'fresh',
          cacheKey: identity.cacheKey,
          payloadId: cachedRow.id ?? null,
        },
      };
    }

    if (cachedRow && isCacheRowUsableAsStale(cachedRow, now)) {
      staleCandidate = cachedRow;
    }
  } catch (error) {
    readError = error;
  }

  await recordEventBestEffort(cacheClient, {
    ...eventBase,
    payloadId: cachedRow?.id ?? null,
    eventType: 'miss',
    latencyMs: Date.now() - startedAt,
    metadata: {
      reason: readError ? 'read-error' : staleCandidate ? 'stale' : 'empty',
      ...(readError ? { readError: errorMessage(readError) } : {}),
    },
  });

  try {
    const loadedValue = await load();
    const entry = buildCrawlerCachePayloadEntry(identity, loadedValue, {
      freshTtlMs,
      staleTtlMs,
      now,
    });
    let payloadId = null;
    let writeError = null;

    try {
      const upsertResult = await cacheClient.upsertPayload(entry);
      payloadId = Array.isArray(upsertResult) ? upsertResult[0]?.id ?? null : upsertResult?.id ?? null;
    } catch (error) {
      writeError = error;
    }

    await recordEventBestEffort(cacheClient, {
      ...eventBase,
      payloadId,
      eventType: 'write',
      latencyMs: Date.now() - startedAt,
      errorMessage: writeError ? errorMessage(writeError) : null,
      metadata: {
        ok: !writeError,
        payloadHash: entry.payloadHash,
        payloadSizeBytes: entry.payloadSizeBytes,
      },
    });

    return {
      value: loadedValue,
      cache: {
        enabled: true,
        hit: false,
        freshness: 'loaded',
        cacheKey: identity.cacheKey,
        payloadId,
        ...(readError ? { readError: errorMessage(readError) } : {}),
        ...(writeError ? { writeError: errorMessage(writeError) } : {}),
      },
    };
  } catch (error) {
    await recordEventBestEffort(cacheClient, {
      ...eventBase,
      payloadId: staleCandidate?.id ?? null,
      eventType: 'error',
      latencyMs: Date.now() - startedAt,
      errorMessage: errorMessage(error),
      metadata: {
        staleFallbackAvailable: Boolean(staleCandidate && allowStaleOnError),
      },
    });

    if (allowStaleOnError && staleCandidate) {
      await recordEventBestEffort(cacheClient, {
        ...eventBase,
        payloadId: staleCandidate.id ?? null,
        eventType: 'stale_hit',
        latencyMs: Date.now() - startedAt,
        errorMessage: errorMessage(error),
        metadata: { reason: 'upstream-error' },
      });

      return {
        value: getRowPayload(staleCandidate),
        cache: {
          enabled: true,
          hit: true,
          freshness: 'stale',
          cacheKey: identity.cacheKey,
          payloadId: staleCandidate.id ?? null,
          upstreamError: errorMessage(error),
        },
      };
    }

    throw error;
  }
}

export function getDefaultCrawlerCacheFreshTtlMs(env = process.env) {
  return readPositiveIntegerEnv([
    'CRAWLER_SUPABASE_CACHE_FRESH_TTL_MS',
    'SUPABASE_CRAWLER_CACHE_FRESH_TTL_MS',
  ], DEFAULT_FRESH_TTL_MS, env);
}

export function getDefaultCrawlerCacheStaleTtlMs(env = process.env) {
  return readPositiveIntegerEnv([
    'CRAWLER_SUPABASE_CACHE_STALE_TTL_MS',
    'SUPABASE_CRAWLER_CACHE_STALE_TTL_MS',
  ], DEFAULT_STALE_TTL_MS, env);
}
