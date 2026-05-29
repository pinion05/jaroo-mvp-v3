import { NextRequest, NextResponse } from 'next/server'

const NAVER_STOCK_API_BASE = 'https://m.stock.naver.com/api'
const BRIEFING_SNAPSHOT_TIMEOUT_MS = 4_500
const DAILY_PRICE_PAGE_SIZE = 60

type NaverCompareDirection = {
  code?: string
  text?: string
  name?: string
}

type NaverPriceRow = {
  localTradedAt?: string
  closePrice?: string | number
  compareToPreviousClosePrice?: string | number
  compareToPreviousPrice?: NaverCompareDirection
  fluctuationsRatio?: string | number
  openPrice?: string | number
  highPrice?: string | number
  lowPrice?: string | number
  accumulatedTradingVolume?: string | number
}

type NaverBasicPayload = {
  closePrice?: string | number
  localTradedAt?: string
  marketStatus?: string
  stockExchangeName?: string
  stockExchangeType?: {
    name?: string
    nameKor?: string
  }
}

type BriefingDailyRow = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  changePct: number | null
}

type BriefingIndexSnapshot = {
  value: number | null
  changePct: number | null
  asOf: string | null
}

function parseNaverNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeKrCode(value: string | null) {
  const normalized = value?.trim() ?? ''
  const match = normalized.match(/^\d{6}$/u)
  return match ? match[0] : null
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

async function fetchJsonWithTimeout<T>(url: string, requestSignal?: AbortSignal, timeoutMs = BRIEFING_SNAPSHOT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const abortFromRequest = () => controller.abort()
  requestSignal?.addEventListener('abort', abortFromRequest, { once: true })

  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`naver-finance returned HTTP ${response.status}: ${url}`)
    }

    return (await response.json()) as T
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    requestSignal?.removeEventListener('abort', abortFromRequest)
  }
}

function normalizePriceRow(row: NaverPriceRow): BriefingDailyRow | null {
  const date = typeof row.localTradedAt === 'string' ? row.localTradedAt.slice(0, 10) : ''
  const close = parseNaverNumber(row.closePrice)
  if (!date || close === null) {
    return null
  }

  return {
    date,
    open: parseNaverNumber(row.openPrice),
    high: parseNaverNumber(row.highPrice),
    low: parseNaverNumber(row.lowPrice),
    close,
    volume: parseNaverNumber(row.accumulatedTradingVolume),
    changePct: parseNaverNumber(row.fluctuationsRatio),
  }
}

async function fetchDailyRows(code: string, requestSignal?: AbortSignal) {
  const rows = await fetchJsonWithTimeout<NaverPriceRow[]>(
    `${NAVER_STOCK_API_BASE}/stock/${encodeURIComponent(code)}/price?page=1&pageSize=${DAILY_PRICE_PAGE_SIZE}`,
    requestSignal,
  )

  return Array.isArray(rows)
    ? rows.map(normalizePriceRow).filter((row): row is BriefingDailyRow => Boolean(row)).reverse()
    : []
}

async function fetchStockBasic(code: string, requestSignal?: AbortSignal) {
  return fetchJsonWithTimeout<NaverBasicPayload>(
    `${NAVER_STOCK_API_BASE}/stock/${encodeURIComponent(code)}/basic`,
    requestSignal,
  )
}

async function fetchIndexSnapshot(indexCode: 'KOSPI' | 'KOSDAQ', requestSignal?: AbortSignal): Promise<BriefingIndexSnapshot> {
  const payload = await fetchJsonWithTimeout<NaverPriceRow & NaverBasicPayload>(
    `${NAVER_STOCK_API_BASE}/index/${indexCode}/basic`,
    requestSignal,
  )

  return {
    value: parseNaverNumber(payload.closePrice),
    changePct: parseNaverNumber(payload.fluctuationsRatio),
    asOf: typeof payload.localTradedAt === 'string' ? payload.localTradedAt : null,
  }
}

function getLatestRow(daily: BriefingDailyRow[]) {
  return daily.length > 0 ? daily[daily.length - 1] : null
}

function getPreviousRow(daily: BriefingDailyRow[]) {
  return daily.length > 1 ? daily[daily.length - 2] : null
}

export async function GET(request: NextRequest) {
  const code = normalizeKrCode(request.nextUrl.searchParams.get('code'))
  if (!code) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'invalid-code',
          message: 'code must be a 6 digit KR stock code',
        },
      },
      { status: 400 },
    )
  }

  try {
    const [daily, stockBasic, kospi, kosdaq] = await Promise.all([
      fetchDailyRows(code, request.signal),
      fetchStockBasic(code, request.signal).catch(() => null),
      fetchIndexSnapshot('KOSPI', request.signal).catch(() => null),
      fetchIndexSnapshot('KOSDAQ', request.signal).catch(() => null),
    ])

    const latest = getLatestRow(daily)
    const previous = getPreviousRow(daily)
    const basicPrice = stockBasic ? parseNaverNumber(stockBasic.closePrice) : null
    const currentPrice = latest?.close ?? basicPrice

    return NextResponse.json({
      ok: true,
      data: {
        code,
        asOf: stockBasic?.localTradedAt ?? latest?.date ?? null,
        quote: {
          currentPrice,
          openPrice: latest?.open ?? null,
          highPrice: latest?.high ?? null,
          lowPrice: latest?.low ?? null,
          volume: latest?.volume ?? null,
          previousClose: previous?.close ?? null,
          previousVolume: previous?.volume ?? null,
          changePct: latest?.changePct ?? (currentPrice !== null && previous?.close ? ((currentPrice / previous.close) - 1) * 100 : null),
          currency: 'KRW',
          asOf: stockBasic?.localTradedAt ?? latest?.date ?? null,
          marketStatus: stockBasic?.marketStatus ?? null,
          exchange: stockBasic?.stockExchangeName ?? stockBasic?.stockExchangeType?.name ?? null,
          source: 'naver-finance',
        },
        daily,
        market: {
          kospi,
          kosdaq,
        },
        sources: ['naver-finance'],
      },
    })
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'client-abort',
            message: 'request aborted',
          },
        },
        { status: 499 },
      )
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'upstream-error',
          message: error instanceof Error ? error.message : 'briefing snapshot failed',
        },
      },
      { status: 502 },
    )
  }
}
