/**
 * api-clients.js — 미국주식 API 공통 클라이언트
 *
 * Polygon, FMP, FinnHub, SEC EDGAR 공통 fetch 래퍼
 * - Rate limiting (API별 호출 간격 제어)
 * - 에러 핸들링 (graceful degradation)
 * - In-memory 캐싱 (TTL 기반)
 *
 * 환경변수:
 * - POLYGON_API_KEY
 * - FMP_API_KEY
 * - FINNHUB_API_KEY
 * - SEC_EDGAR_USER_AGENT
 */

// ── 환경변수 ──────────────────────────────────────────
const POLYGON_API_KEY = process.env.POLYGON_API_KEY || '';
const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
const SEC_EDGAR_USER_AGENT = process.env.SEC_EDGAR_USER_AGENT || 'JarooMVP/4.0 contact@jaroo.app';

// ── API 베이스 URL ────────────────────────────────────
const BASE_URLS = Object.freeze({
  polygon: 'https://api.polygon.io',
  fmp: 'https://financialmodelingprep.com',
  finnhub: 'https://finnhub.io/api/v1',
  secEdgar: 'https://data.sec.gov',
});
const PROVIDER_CONFIG = Object.freeze({
  polygon: {
    configured: Boolean(POLYGON_API_KEY),
  },
  fmp: {
    configured: Boolean(FMP_API_KEY),
  },
  finnhub: {
    configured: Boolean(FINNHUB_API_KEY),
  },
  secEdgar: {
    configured: true,
  },
  yahooChart: {
    configured: true,
  },
});

// ── Rate Limiter ──────────────────────────────────────
// 각 API별 다음 호출 가능 시간을 추적하여 최소 호출 간격 보장
const rateLimiters = new Map();
const providerLocks = new Map();
const providerCooldowns = new Map();
const SERIALIZED_APIS = new Set(['fmp']);
const PROVIDER_COOLDOWN_MS = Object.freeze({
  fmp: 10 * 60 * 1000,
});
const SENSITIVE_QUERY_PARAM_PATTERN = /^(?:api_?key|token|access_?token|authorization)$/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * API별 rate limiting 대기
 * @param {string} apiName - API 식별자
 * @param {number} minInterval - 최소 호출 간격 (ms)
 */
async function enforceRateLimit(apiName, minInterval = 200) {
  const now = Date.now();
  const nextAvailableAt = rateLimiters.get(apiName) || 0;
  const scheduledAt = Math.max(now, nextAvailableAt);
  const waitMs = scheduledAt - now;

  rateLimiters.set(apiName, scheduledAt + minInterval);

  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function withProviderLock(apiName, task) {
  if (!SERIALIZED_APIS.has(apiName)) return task();

  while (providerLocks.get(apiName)) {
    await providerLocks.get(apiName);
  }

  let release = null;
  const lock = new Promise((resolve) => {
    release = resolve;
  });
  providerLocks.set(apiName, lock);

  try {
    return await task();
  } finally {
    if (providerLocks.get(apiName) === lock) {
      providerLocks.delete(apiName);
    }
    release?.();
  }
}

// API별 기본 최소 호출 간격 (ms)
const RATE_LIMITS = Object.freeze({
  polygon: 150,
  fmp: 2000,
  finnhub: 200,
  secEdgar: 200,
});

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(dateMs - Date.now(), 0) : null;
}

export function getProviderCooldownRemaining(apiName) {
  const until = providerCooldowns.get(apiName);
  if (!until) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    providerCooldowns.delete(apiName);
    return 0;
  }
  return remaining;
}

export function getProviderStatus(apiName) {
  const configured = PROVIDER_CONFIG[apiName]?.configured ?? true;
  const cooldownRemainingMs = getProviderCooldownRemaining(apiName);
  return {
    apiName,
    configured,
    available: configured && cooldownRemainingMs === 0,
    cooldownRemainingMs,
    exhausted: cooldownRemainingMs > 0,
  };
}

// ── In-Memory 캐시 ────────────────────────────────────
const cacheStore = new Map();
const MAX_CACHE_SIZE = 500;

/**
 * 캐시에서 데이터 조회
 * @param {string} key - 캐시 키
 * @param {number} ttl - 캐시 유효시간 (ms), 기본 5분
 * @returns {null|*} 캐시된 데이터 또는 null
 */
function cacheGet(key, ttl = 5 * 60 * 1000) {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttl) {
    cacheStore.delete(key);
    return null;
  }
  return entry.data;
}

function trimCacheStore() {
  if (cacheStore.size <= MAX_CACHE_SIZE) return;
  const keys = [...cacheStore.keys()];
  for (let i = 0; i < keys.length - MAX_CACHE_SIZE; i += 1) {
    cacheStore.delete(keys[i]);
  }
}

/**
 * 캐시에 데이터 저장
 * @param {string} key - 캐시 키
 * @param {*} data - 저장할 데이터
 */
function cacheSet(key, data) {
  cacheStore.set(key, { data, ts: Date.now() });
  trimCacheStore();
}

function sanitizeUrlForCacheKey(url) {
  try {
    const parsed = new URL(url);
    let redacted = false;

    for (const name of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAM_PATTERN.test(name)) {
        parsed.searchParams.set(name, '[redacted]');
        redacted = true;
      }
    }

    return redacted ? parsed.toString() : url;
  } catch {
    return url.replace(/([?&](?:api_?key|token|access_?token|authorization)=)[^&]*/gi, '$1[redacted]');
  }
}

function buildCacheKey(url, explicitCacheKey) {
  if (explicitCacheKey) return explicitCacheKey;
  return `api:${sanitizeUrlForCacheKey(url)}`;
}

function sanitizeCacheKey(key) {
  if (typeof key !== 'string') return String(key);
  if (key.startsWith('api:')) {
    return `api:${sanitizeUrlForCacheKey(key.slice(4))}`;
  }
  return sanitizeUrlForCacheKey(key);
}

// ── 공통 fetch 래퍼 ────────────────────────────────────

/**
 * 공통 API fetch 함수
 * @param {Object} opts
 * @param {string} opts.apiName - API 식별자 (rate limiting 용)
 * @param {string} opts.baseUrl - 기본 URL
 * @param {string} opts.path - API 경로 (쿼리스트링 포함)
 * @param {Object} [opts.headers] - 추가 헤더
 * @param {number} [opts.timeout=10000] - 타임아웃 (ms)
 * @param {number} [opts.cacheTTL] - 캐시 TTL (ms), 지정 시 캐싱 활성화
 * @param {string} [opts.cacheKey] - 명시적 캐시 키 (미지정 시 URL 기반 자동 생성)
 * @returns {Promise<Object|null>} JSON 응답 또는 null (실패 시)
 */
export async function apiFetch({
  apiName,
  baseUrl,
  path,
  headers = {},
  timeout = 10000,
  cacheTTL,
  cacheKey,
}) {
  const url = `${baseUrl}${path}`;
  const sanitizedUrl = sanitizeUrlForCacheKey(url);
  const key = buildCacheKey(url, cacheKey);

  if (cacheTTL) {
    const cached = cacheGet(key, cacheTTL);
    if (cached !== null) return cached;
  }

  const cooldownRemaining = getProviderCooldownRemaining(apiName);
  if (cooldownRemaining > 0) {
    console.warn(`[US-Stock API] ${apiName} cooldown ${cooldownRemaining}ms: ${sanitizedUrl}`);
    return null;
  }

  return withProviderLock(apiName, async () => {
    const minInterval = RATE_LIMITS[apiName] || 200;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        await enforceRateLimit(apiName, minInterval);

        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            ...headers,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            const cooldownMs = PROVIDER_COOLDOWN_MS[apiName] ?? 0;
            if (cooldownMs > 0) {
              providerCooldowns.set(apiName, Date.now() + cooldownMs);
              console.warn(`[US-Stock API] ${apiName} 429 cooldown ${cooldownMs}ms: ${sanitizedUrl}`);
              return null;
            }
            if (attempt < 2) {
              const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? (1000 * (attempt + 1));
              console.warn(`[US-Stock API] ${apiName} 429 재시도 대기 ${retryAfterMs}ms: ${sanitizedUrl}`);
              await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
              continue;
            }
          }
          console.warn(`[US-Stock API] ${apiName} ${response.status}: ${sanitizedUrl}`);
          return null;
        }

        const data = await response.json();
        if (cacheTTL) {
          cacheSet(key, data);
        }
        return data;
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn(`[US-Stock API] ${apiName} 타임아웃 (${timeout}ms): ${sanitizedUrl}`);
        } else {
          console.warn(`[US-Stock API] ${apiName} 오류: ${err.message}`);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  });
}

// ── Polygon 전용 클라이언트 ───────────────────────────

/**
 * Polygon API 호출
 * @param {string} path - API 경로 (?ticker=, &apiKey= 제외)
 * @param {Object} [opts] - apiFetch 옵션
 * @returns {Promise<Object|null>}
 */
export function polygonFetch(path, opts = {}) {
  if (!POLYGON_API_KEY) {
    console.warn('[US-Stock] POLYGON_API_KEY 미설정');
    return Promise.resolve(null);
  }
  const separator = path.includes('?') ? '&' : '?';
  const fullpath = `${path}${separator}apiKey=${POLYGON_API_KEY}`;
  return apiFetch({
    apiName: 'polygon',
    baseUrl: BASE_URLS.polygon,
    path: fullpath,
    cacheTTL: 5 * 60 * 1000,
    ...opts,
  });
}

// ── FMP 전용 클라이언트 ────────────────────────────────

/**
 * FMP (Financial Modeling Prep) API 호출
 * @param {string} path - API 경로 (?apikey= 제외)
 * @param {Object} [opts] - apiFetch 옵션
 * @returns {Promise<Object|null>}
 */
export function fmpFetch(path, opts = {}) {
  if (!FMP_API_KEY) {
    console.warn('[US-Stock] FMP_API_KEY 미설정');
    return Promise.resolve(null);
  }
  const separator = path.includes('?') ? '&' : '?';
  const fullpath = `${path}${separator}apikey=${FMP_API_KEY}`;
  return apiFetch({
    apiName: 'fmp',
    baseUrl: BASE_URLS.fmp,
    path: fullpath,
    cacheTTL: 10 * 60 * 1000,
    ...opts,
  });
}

// ── FinnHub 전용 클라이언트 ────────────────────────────

/**
 * FinnHub API 호출
 * @param {string} path - API 경로 (?token= 제외)
 * @param {Object} [opts] - apiFetch 옵션
 * @returns {Promise<Object|null>}
 */
export function finnhubFetch(path, opts = {}) {
  if (!FINNHUB_API_KEY) {
    console.warn('[US-Stock] FINNHUB_API_KEY 미설정');
    return Promise.resolve(null);
  }
  const separator = path.includes('?') ? '&' : '?';
  const fullpath = `${path}${separator}token=${FINNHUB_API_KEY}`;
  return apiFetch({
    apiName: 'finnhub',
    baseUrl: BASE_URLS.finnhub,
    path: fullpath,
    cacheTTL: 10 * 60 * 1000,
    ...opts,
  });
}

// ── SEC EDGAR 전용 클라이언트 ──────────────────────────

/**
 * SEC EDGAR API 호출 (User-Agent 헤더 필수)
 * @param {string} path - API 경로
 * @param {Object} [opts] - apiFetch 옵션
 * @returns {Promise<Object|null>}
 */
export function secEdgarFetch(path, opts = {}) {
  return apiFetch({
    apiName: 'secEdgar',
    baseUrl: BASE_URLS.secEdgar,
    path,
    headers: {
      'User-Agent': SEC_EDGAR_USER_AGENT,
      'Accept-Encoding': 'gzip',
    },
    timeout: 15000,
    cacheTTL: 30 * 60 * 1000,
    ...opts,
  });
}

// ── 캐시 관리 유틸 ────────────────────────────────────

/** 전체 캐시 초기화 (테스트용) */
export function clearCache() {
  cacheStore.clear();
}

/** 캐시 통계 반환 */
export function getCacheStats() {
  return {
    size: cacheStore.size,
    keys: [...cacheStore.keys()].map((key) => sanitizeCacheKey(key)),
  };
}
