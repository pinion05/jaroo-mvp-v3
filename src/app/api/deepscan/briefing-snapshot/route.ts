import { NextRequest, NextResponse } from 'next/server'

import type { LoadingBriefingDailyRow, LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'

const NAVER_STOCK_API_BASE = 'https://m.stock.naver.com/api'
const BRIEFING_SNAPSHOT_TIMEOUT_MS = 4_500
const BRIEFING_SNAPSHOT_CACHE_TTL_MS = 15_000
const DAILY_PRICE_PAGE_SIZE = 60

type NaverPriceRow = {
  localTradedAt?: string
  closePrice?: string | number
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

type BriefingIndexSnapshot = {
  value: number | null
  changePct: number | null
  asOf: string | null
}

type BriefingSnapshotSuccessBody = {
  ok: true
  data: LoadingBriefingSnapshot
}

type BriefingSnapshotRequestOptions = {
  fetcher?: typeof fetch
  timeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
}

type FetchJsonOptions = {
  fetcher: typeof fetch
  requestSignal?: AbortSignal
  timeoutMs: number
}

type SettledSourceStatus = 'ok' | 'error'

const briefingSnapshotCache = new Map<string, { expiresAt: number; body: BriefingSnapshotSuccessBody }>()
const briefingSnapshotInflight = new Map<string, Promise<BriefingSnapshotSuccessBody>>()

export class BriefingSnapshotTimeoutError extends Error {
  constructor(message = 'briefing snapshot upstream timed out') {
    super(message)
    this.name = 'BriefingSnapshotTimeoutError'
  }
}

export function clearBriefingSnapshotCache() {
  briefingSnapshotCache.clear()
  briefingSnapshotInflight.clear()
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

function getBriefingSnapshotTimeoutMs(options: BriefingSnapshotRequestOptions) {
  const configured = options.timeoutMs ?? Number(process.env.BRIEFING_SNAPSHOT_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : BRIEFING_SNAPSHOT_TIMEOUT_MS
}

function getBriefingSnapshotCacheTtlMs(options: BriefingSnapshotRequestOptions) {
  const configured = options.cacheTtlMs ?? Number(process.env.BRIEFING_SNAPSHOT_CACHE_TTL_MS)
  return Number.isFinite(configured) && configured >= 0 ? configured : BRIEFING_SNAPSHOT_CACHE_TTL_MS
}

async function fetchJsonWithTimeout<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  if (options.requestSignal?.aborted) {
    controller.abort()
  }

  const abortFromRequest = () => controller.abort()
  options.requestSignal?.addEventListener('abort', abortFromRequest, { once: true })

  try {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs)
    const response = await options.fetcher(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`naver-finance returned HTTP ${response.status}`)
    }

    return (await response.json()) as T
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new BriefingSnapshotTimeoutError()
    }
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    options.requestSignal?.removeEventListener('abort', abortFromRequest)
  }
}

function normalizePriceRow(row: NaverPriceRow): LoadingBriefingDailyRow | null {
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

async function fetchDailyRows(code: string, options: FetchJsonOptions) {
  const rows = await fetchJsonWithTimeout<NaverPriceRow[]>(
    `${NAVER_STOCK_API_BASE}/stock/${encodeURIComponent(code)}/price?page=1&pageSize=${DAILY_PRICE_PAGE_SIZE}`,
    options,
  )

  return Array.isArray(rows)
    ? rows.map(normalizePriceRow).filter((row): row is LoadingBriefingDailyRow => Boolean(row)).reverse()
    : []
}

async function fetchStockBasic(code: string, options: FetchJsonOptions) {
  return fetchJsonWithTimeout<NaverBasicPayload>(
    `${NAVER_STOCK_API_BASE}/stock/${encodeURIComponent(code)}/basic`,
    options,
  )
}

async function fetchIndexSnapshot(indexCode: 'KOSPI' | 'KOSDAQ', options: FetchJsonOptions): Promise<BriefingIndexSnapshot> {
  const payload = await fetchJsonWithTimeout<NaverPriceRow & NaverBasicPayload>(
    `${NAVER_STOCK_API_BASE}/index/${indexCode}/basic`,
    options,
  )

  return {
    value: parseNaverNumber(payload.closePrice),
    changePct: parseNaverNumber(payload.fluctuationsRatio),
    asOf: typeof payload.localTradedAt === 'string' ? payload.localTradedAt : null,
  }
}

function getLatestRow(daily: LoadingBriefingDailyRow[]) {
  return daily.length > 0 ? daily[daily.length - 1] : null
}

function getPreviousRow(daily: LoadingBriefingDailyRow[]) {
  return daily.length > 1 ? daily[daily.length - 2] : null
}

function resultValue<T>(result: PromiseSettledResult<T>) {
  return result.status === 'fulfilled' ? result.value : null
}

function sourceStatus(result: PromiseSettledResult<unknown>): SettledSourceStatus {
  return result.status === 'fulfilled' ? 'ok' : 'error'
}

function hasTimeoutFailure(results: Array<PromiseSettledResult<unknown>>) {
  return results.some((result) => result.status === 'rejected' && result.reason instanceof BriefingSnapshotTimeoutError)
}

function resolveChangePct(currentPrice: number | null, latest: LoadingBriefingDailyRow | null, previous: LoadingBriefingDailyRow | null) {
  if (typeof latest?.changePct === 'number' && Number.isFinite(latest.changePct)) {
    return latest.changePct
  }

  return currentPrice !== null && previous?.close ? ((currentPrice / previous.close) - 1) * 100 : null
}

export async function buildBriefingSnapshotData(
  code: string,
  options: Required<Pick<BriefingSnapshotRequestOptions, 'fetcher' | 'timeoutMs'>> & Pick<BriefingSnapshotRequestOptions, 'cacheTtlMs' | 'now'>,
  requestSignal?: AbortSignal,
): Promise<LoadingBriefingSnapshot> {
  const fetchOptions: FetchJsonOptions = {
    fetcher: options.fetcher,
    requestSignal,
    timeoutMs: options.timeoutMs,
  }

  const results = await Promise.allSettled([
    fetchDailyRows(code, fetchOptions),
    fetchStockBasic(code, fetchOptions),
    fetchIndexSnapshot('KOSPI', fetchOptions),
    fetchIndexSnapshot('KOSDAQ', fetchOptions),
  ] as const)

  const [dailyResult, stockBasicResult, kospiResult, kosdaqResult] = results
  const daily = resultValue(dailyResult) ?? []
  const stockBasic = resultValue(stockBasicResult)
  const kospi = resultValue(kospiResult)
  const kosdaq = resultValue(kosdaqResult)
  const latest = getLatestRow(daily)
  const previous = getPreviousRow(daily)
  const basicPrice = stockBasic ? parseNaverNumber(stockBasic.closePrice) : null
  const currentPrice = latest?.close ?? basicPrice

  if (currentPrice === null && !latest && !stockBasic) {
    if (hasTimeoutFailure(results)) {
      throw new BriefingSnapshotTimeoutError()
    }
    throw new Error('stock briefing snapshot unavailable')
  }

  return {
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
      changePct: resolveChangePct(currentPrice, latest, previous),
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
    sourceStatus: {
      daily: sourceStatus(dailyResult),
      stockBasic: sourceStatus(stockBasicResult),
      kospi: sourceStatus(kospiResult),
      kosdaq: sourceStatus(kosdaqResult),
    },
    sources: ['naver-finance'],
  }
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message },
    },
    { status },
  )
}

function jsonSuccess(body: BriefingSnapshotSuccessBody, cacheTtlMs: number) {
  return NextResponse.json(body, {
    headers: cacheTtlMs > 0
      ? { 'Cache-Control': `public, s-maxage=${Math.ceil(cacheTtlMs / 1000)}, stale-while-revalidate=30` }
      : undefined,
  })
}

export async function handleBriefingSnapshotRequest(request: NextRequest, options: BriefingSnapshotRequestOptions = {}) {
  const code = normalizeKrCode(request.nextUrl.searchParams.get('code'))
  if (!code) {
    return jsonError(400, 'invalid-code', 'code must be a 6 digit KR stock code')
  }

  const fetcher = options.fetcher ?? fetch
  const timeoutMs = getBriefingSnapshotTimeoutMs(options)
  const cacheTtlMs = getBriefingSnapshotCacheTtlMs(options)
  const now = options.now?.() ?? Date.now()
  const cacheKey = code

  const cached = cacheTtlMs > 0 ? briefingSnapshotCache.get(cacheKey) : undefined
  if (cached && cached.expiresAt > now) {
    return jsonSuccess(cached.body, cacheTtlMs)
  }

  try {
    let inflight = briefingSnapshotInflight.get(cacheKey)
    if (!inflight) {
      inflight = buildBriefingSnapshotData(code, { fetcher, timeoutMs, cacheTtlMs, now: options.now })
        .then((data) => ({ ok: true as const, data }))
        .finally(() => {
          briefingSnapshotInflight.delete(cacheKey)
        })
      briefingSnapshotInflight.set(cacheKey, inflight)
    }

    const body = await inflight
    if (request.signal.aborted) {
      return jsonError(499, 'client-abort', 'request aborted')
    }

    if (cacheTtlMs > 0) {
      briefingSnapshotCache.set(cacheKey, { expiresAt: now + cacheTtlMs, body })
    }

    return jsonSuccess(body, cacheTtlMs)
  } catch (error) {
    if (request.signal.aborted) {
      return jsonError(499, 'client-abort', 'request aborted')
    }

    if (error instanceof BriefingSnapshotTimeoutError) {
      return jsonError(504, 'upstream-timeout', 'briefing snapshot upstream timed out')
    }

    return jsonError(502, 'upstream-error', 'briefing snapshot failed')
  }
}

export async function GET(request: NextRequest) {
  return handleBriefingSnapshotRequest(request)
}
