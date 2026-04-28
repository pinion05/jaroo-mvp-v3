const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveCacheTtlMs(options = {}, env = process.env) {
  if (options.cache && typeof options.cache === 'object' && options.cache.ttlMs != null) {
    return parsePositiveNumber(options.cache.ttlMs, DEFAULT_TTL_MS);
  }
  if (options.cacheTtlMs != null) {
    return parsePositiveNumber(options.cacheTtlMs, DEFAULT_TTL_MS);
  }
  if (options.cacheTTL != null) {
    return parsePositiveNumber(options.cacheTTL, DEFAULT_TTL_MS);
  }
  return parsePositiveNumber(env.WISEREPORT_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

function isCacheBypassed(options = {}, env = process.env) {
  const envBypass = /^(1|true|yes|on)$/i.test(String(env.WISEREPORT_CACHE_BYPASS || ''));
  return envBypass
    || options.cache === false
    || options.bypassCache === true
    || options.noCache === true
    || (options.cache && typeof options.cache === 'object' && options.cache.bypass === true);
}

function isForceRefresh(options = {}) {
  return options.forceRefresh === true
    || options.refresh === true
    || (options.cache && typeof options.cache === 'object' && options.cache.forceRefresh === true);
}

function defaultIsCacheable(value) {
  if (value == null) return false;
  if (typeof value === 'object' && value.ok === false) return false;
  return true;
}

function cloneResultWithCacheMeta(value, meta) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return {
    ...value,
    cache: {
      ...(value.cache && typeof value.cache === 'object' ? value.cache : {}),
      ...meta,
    },
  };
}

function createReadThroughCache({ name, now = () => Date.now(), maxEntries = MAX_ENTRIES, logger = null } = {}) {
  const entries = new Map();
  const stats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    sets: 0,
    bypasses: 0,
    refreshes: 0,
    errors: 0,
  };

  function trim() {
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  function clear(key) {
    if (key == null) {
      entries.clear();
      for (const statKey of Object.keys(stats)) stats[statKey] = 0;
      return;
    }
    entries.delete(key);
  }

  function getStats() {
    return { ...stats, size: entries.size, name };
  }

  async function readThrough(key, loader, options = {}) {
    const current = now();
    const ttlMs = resolveCacheTtlMs(options);
    const forceRefresh = isForceRefresh(options);
    const bypass = isCacheBypassed(options);
    const allowStaleOnError = options.allowStaleOnError !== false;
    const isCacheable = options.isCacheable || defaultIsCacheable;
    const entry = entries.get(key);
    const fresh = entry && current - entry.cachedAt < ttlMs;

    if (!bypass && !forceRefresh && fresh) {
      stats.hits += 1;
      logger?.info?.('CrawlerCache', `${name || 'wisereport'} hit | ${key}`);
      return cloneResultWithCacheMeta(entry.value, {
        status: 'hit',
        key,
        cachedAt: new Date(entry.cachedAt).toISOString(),
        expiresAt: new Date(entry.cachedAt + ttlMs).toISOString(),
        ageMs: current - entry.cachedAt,
        ttlMs,
      });
    }

    if (bypass) stats.bypasses += 1;
    else if (forceRefresh) stats.refreshes += 1;
    else stats.misses += 1;

    try {
      const loaded = await loader();
      if (!bypass && isCacheable(loaded)) {
        entries.set(key, { value: loaded, cachedAt: now() });
        trim();
        stats.sets += 1;
      }
      const storedAt = entries.get(key)?.cachedAt ?? now();
      return cloneResultWithCacheMeta(loaded, {
        status: bypass ? 'bypass' : forceRefresh ? 'refresh' : 'miss',
        key,
        cachedAt: !bypass && isCacheable(loaded) ? new Date(storedAt).toISOString() : null,
        expiresAt: !bypass && isCacheable(loaded) ? new Date(storedAt + ttlMs).toISOString() : null,
        ageMs: 0,
        ttlMs,
      });
    } catch (error) {
      stats.errors += 1;
      if (!bypass && allowStaleOnError && entry) {
        stats.staleHits += 1;
        logger?.warn?.('CrawlerCache', `${name || 'wisereport'} stale fallback | ${key} | ${error?.message ?? error}`);
        return cloneResultWithCacheMeta(entry.value, {
          status: 'stale',
          key,
          cachedAt: new Date(entry.cachedAt).toISOString(),
          expiresAt: new Date(entry.cachedAt + ttlMs).toISOString(),
          ageMs: current - entry.cachedAt,
          ttlMs,
          staleReason: error?.message ?? String(error),
        });
      }
      throw error;
    }
  }

  return { readThrough, clear, getStats };
}

module.exports = {
  createReadThroughCache,
  resolveCacheTtlMs,
  isCacheBypassed,
  isForceRefresh,
  defaultIsCacheable,
};
