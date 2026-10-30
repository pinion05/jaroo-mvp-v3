const NAVER_STOCK_API_BASE = 'https://m.stock.naver.com/api'
// 13페이지 × pageSize 60 = 780봉 ≈ 3년치 영업일(실측: 2023-08-14 → 2026-10-30).
// 상장 3년 미만 종목은 네이버가 보유한 만큼만 짧게 내려주는데, 그대로 수용한다 —
// 엔진의 minReturnCount(252)가 회복 모델 가용 여부를 필터한다.
const DEFAULT_PAGE_COUNT = 13
const DEFAULT_PAGE_SIZE = 60
const DEFAULT_TIMEOUT_MS = 15_000
// 13요청 동시 발사는 네이버 모바일 API에서 429로 거절될 수 있어 페이지를 청크로 나눠
// 순차 fetch한다(5+5+3, 청크 사이 짧은 지연).
const PAGE_FETCH_CHUNK_SIZE = 5
const PAGE_FETCH_CHUNK_DELAY_MS = 150
// 같은 종목의 13페이지 fetch를 매 스캔마다 치지 않도록 모듈 레벨 TTL 캐시를 건다
// (briefing-snapshot 라우트의 in-memory 결과 캐시와 같은 패턴). 일봉은 하루 한 번
// 갱신되므로 6시간 TTL이면 충분히 신선하다. 외부 의존 없이 Map만 사용.
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000

type NaverDailyPriceRow = {
  localTradedAt?: unknown
  closePrice?: unknown
}

export type KrDailyPricePoint = {
  date: string
  close: number
}

type FetchKrDailyPriceHistoryOptions = {
  fetcher?: typeof fetch
  pageCount?: number
  pageSize?: number
  timeoutMs?: number
  /** 0 이하이면 캐시를 우회한다(테스트·디버그용). 기본 6시간. */
  cacheTtlMs?: number
}

type HistoryCacheEntry = {
  series: KrDailyPricePoint[]
  expiresAt: number
}

const dailyHistoryCache = new Map<string, HistoryCacheEntry>()
const dailyHistoryInflight = new Map<string, Promise<KrDailyPricePoint[]>>()

/** 모듈 캐시를 비운다(유닛 테스트 격리용). */
export function clearKrDailyPriceHistoryCache() {
  dailyHistoryCache.clear()
  dailyHistoryInflight.clear()
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function parseClose(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.replace(/,/g, '').trim())
      : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeRow(row: NaverDailyPriceRow): KrDailyPricePoint | null {
  const date = typeof row.localTradedAt === 'string' ? row.localTradedAt.slice(0, 10) : ''
  const close = parseClose(row.closePrice)
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) && close !== null ? { date, close } : null
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchNaverDailyPricePage(args: {
  fetcher: typeof fetch
  code: string
  page: number
  pageSize: number
  signal: AbortSignal
}) {
  const response = await args.fetcher(
    `${NAVER_STOCK_API_BASE}/stock/${encodeURIComponent(args.code)}/price?page=${args.page}&pageSize=${args.pageSize}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: args.signal,
    },
  )
  if (!response.ok) {
    throw new Error(`Naver daily price page ${args.page} returned HTTP ${response.status}`)
  }
  const payload = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error(`Naver daily price page ${args.page} returned invalid JSON`)
  }
  return payload as NaverDailyPriceRow[]
}

async function fetchFreshDailyPriceHistory(args: {
  fetcher: typeof fetch
  code: string
  pageCount: number
  pageSize: number
  timeoutMs: number
}): Promise<KrDailyPricePoint[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs)

  try {
    const pages: NaverDailyPriceRow[][] = []
    for (let offset = 0; offset < args.pageCount; offset += PAGE_FETCH_CHUNK_SIZE) {
      if (offset > 0) {
        await wait(PAGE_FETCH_CHUNK_DELAY_MS)
      }
      const chunkEnd = Math.min(offset + PAGE_FETCH_CHUNK_SIZE, args.pageCount)
      const chunk = await Promise.all(
        Array.from({ length: chunkEnd - offset }, (_, index) =>
          fetchNaverDailyPricePage({
            fetcher: args.fetcher,
            code: args.code,
            page: offset + index + 1,
            pageSize: args.pageSize,
            signal: controller.signal,
          }),
        ),
      )
      pages.push(...chunk)
    }

    const byDate = new Map<string, KrDailyPricePoint>()
    for (const row of pages.flat()) {
      const point = normalizeRow(row)
      if (point && !byDate.has(point.date)) {
        byDate.set(point.date, point)
      }
    }

    const series = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
    if (series.length === 0) {
      throw new Error('Naver daily price history is empty')
    }
    return series
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Naver daily price history timed out after ${args.timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchKrDailyPriceHistory(
  code: string,
  options: FetchKrDailyPriceHistoryOptions = {},
): Promise<KrDailyPricePoint[]> {
  if (!/^\d{6}$/u.test(code)) {
    throw new Error('KR 종목코드는 6자리 숫자여야 합니다.')
  }

  const fetcher = options.fetcher ?? fetch
  const pageCount = positiveInteger(options.pageCount, DEFAULT_PAGE_COUNT)
  const pageSize = positiveInteger(options.pageSize, DEFAULT_PAGE_SIZE)
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const cacheTtlMs = options.cacheTtlMs === undefined ? DEFAULT_CACHE_TTL_MS : Math.max(0, options.cacheTtlMs)
  const cacheKey = `${code}:${pageCount}:${pageSize}`

  if (cacheTtlMs > 0) {
    const cached = dailyHistoryCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.series
    }
    const inflight = dailyHistoryInflight.get(cacheKey)
    if (inflight) {
      return inflight
    }
  }

  const fresh = fetchFreshDailyPriceHistory({ fetcher, code, pageCount, pageSize, timeoutMs })
  if (cacheTtlMs <= 0) {
    return fresh
  }

  dailyHistoryInflight.set(cacheKey, fresh)
  try {
    const series = await fresh
    dailyHistoryCache.set(cacheKey, { series, expiresAt: Date.now() + cacheTtlMs })
    return series
  } finally {
    dailyHistoryInflight.delete(cacheKey)
  }
}
