const NAVER_STOCK_API_BASE = 'https://m.stock.naver.com/api'
const DEFAULT_PAGE_COUNT = 6
const DEFAULT_PAGE_SIZE = 60
const DEFAULT_TIMEOUT_MS = 5_000

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
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const pages = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
      const page = index + 1
      const response = await fetcher(
        `${NAVER_STOCK_API_BASE}/stock/${encodeURIComponent(code)}/price?page=${page}&pageSize=${pageSize}`,
        {
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          signal: controller.signal,
        },
      )
      if (!response.ok) {
        throw new Error(`Naver daily price page ${page} returned HTTP ${response.status}`)
      }
      const payload = await response.json()
      if (!Array.isArray(payload)) {
        throw new Error(`Naver daily price page ${page} returned invalid JSON`)
      }
      return payload as NaverDailyPriceRow[]
    }))

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
      throw new Error(`Naver daily price history timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
