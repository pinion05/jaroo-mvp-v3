import { isFiniteNumber } from '@/lib/deepscan-briefing-snapshot'
import { resolveDeepScanTargetSession } from '@/lib/jaroo-home-data'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import type { DeepScanTargetInput, WorkflowMoneyCurrency } from '@/lib/workflow-types'

import type {
  HomeMarketTone,
  QuotesCurrentProxyResponse,
  TargetLoadingMarketSnapshot,
  UsMarketIndicatorItem,
  UsMarketIndicatorsProxyResponse,
} from './deepscan-page-types'

export function normalizeDeepScanCode(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) {
    return undefined
  }

  const exactCode = normalized.match(/^\d{6}$/u)
  if (exactCode) {
    return exactCode[0]
  }

  const embeddedCode = normalized.match(/(?:^|[^0-9])(\d{6})(?:[^0-9]|$)/u)
  return embeddedCode?.[1]
}

export function normalizeDeepScanTicker(value: string | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized || undefined
}

export function buildDeepScanTargetInputFromSession(session: ReturnType<typeof resolveDeepScanTargetSession>): DeepScanTargetInput | null {
  const holding = session?.holding
  if (!holding || holding.id === -1 || holding.name === '종목 미선택') {
    return null
  }

  const quantity = parseOcrNumber(holding.shares)
  const averagePrice = parseOcrNumber(holding.averagePrice)
  if (quantity === null || averagePrice === null) {
    return null
  }

  return {
    code: holding.identifierCode ?? holding.code,
    ticker: holding.identifierTicker,
    market: holding.market,
    marketTone: holding.marketTone,
    kind: holding.kind,
    name: holding.name,
    quantity,
    averagePrice,
    snapshotProfitRate: holding.snapshotProfitRate,
    currentPrice: parseOcrNumber(holding.metrics.find((metric) => metric.label === '현재가')?.value ?? '') ?? undefined,
    currentProfitRate: parseOcrNumber(holding.change) ?? undefined,
    currentPriceCurrency: holding.marketTone === 'nasdaq' ? 'USD' : 'KRW',
    evaluationAmount: parseOcrNumber(holding.evaluationAmount ?? '') ?? undefined,
    averagePriceCurrency: holding.averagePriceCurrency,
    identifierLabel: holding.identifierLabel,
  }
}

export async function fetchHydrationUsdKrwRate() {
  try {
    const response = await fetch('/api/market/fx/usd-krw', { cache: 'no-store' })
    if (!response.ok) {
      return undefined
    }

    const payload = await response.json()
    const rate = Number(payload?.data?.rate)
    return Number.isFinite(rate) && rate > 0 ? rate : undefined
  } catch {
    return undefined
  }
}

export function buildLoadingQuickQuoteUrl(target: { code?: string; ticker?: string } | null) {
  const code = normalizeDeepScanCode(target?.code)
  const ticker = normalizeDeepScanTicker(target?.ticker)
  if (!code && !ticker) {
    return undefined
  }

  const searchParams = new URLSearchParams()
  if (code) {
    searchParams.set('codes', code)
    searchParams.set('includeContext', '1')
  } else if (ticker) {
    searchParams.set('tickers', ticker)
  }

  return `/api/quotes/current?${searchParams.toString()}`
}

export function buildLoadingBriefingSnapshotUrl(target: { code?: string; ticker?: string; market?: string; marketTone?: HomeMarketTone } | null) {
  const code = normalizeDeepScanCode(target?.code)
  if (code) {
    const searchParams = new URLSearchParams({ code })
    return `/api/deepscan/briefing-snapshot?${searchParams.toString()}`
  }

  const ticker = target?.ticker?.trim().toUpperCase()
  if (!ticker || (target?.marketTone !== 'nasdaq' && target?.market?.toUpperCase() !== 'US')) {
    return undefined
  }

  const searchParams = new URLSearchParams({ ticker, market: 'US' })
  return `/api/deepscan/briefing-snapshot?${searchParams.toString()}`
}

export function isDeepScanUsTarget(target: { ticker?: string; market?: string; marketTone?: HomeMarketTone } | null) {
  return Boolean(target?.ticker?.trim())
    && (target?.marketTone === 'nasdaq' || target?.market?.toUpperCase() === 'US' || target?.market?.toUpperCase() === 'NASDAQ')
}

export function normalizeUsMarketIndicator(item: UsMarketIndicatorItem | null | undefined) {
  if (!item) {
    return null
  }

  const value = isFiniteNumber(item.close) ? item.close : isFiniteNumber(item.value) ? item.value : null
  const changePct = isFiniteNumber(item.changePct) ? item.changePct : null
  const timestamp = item.timestamp
  const asOf = typeof timestamp === 'number'
    ? new Date(timestamp).toISOString()
    : typeof timestamp === 'string' && timestamp.trim()
      ? timestamp
      : null

  return {
    value,
    changePct,
    asOf,
  }
}

export function buildUsLoadingMarketSnapshot(body: UsMarketIndicatorsProxyResponse, targetKey: string): TargetLoadingMarketSnapshot | null {
  if (!body.ok || !body.data) {
    return null
  }

  const sp500 = normalizeUsMarketIndicator(body.data.sp500)
  const nasdaq = normalizeUsMarketIndicator(body.data.nasdaq)
  const vix = normalizeUsMarketIndicator(body.data.vix)
  if (!sp500 && !nasdaq && !vix) {
    return null
  }

  return {
    targetKey,
    market: {
      ...(sp500 ? { sp500 } : {}),
      ...(nasdaq ? { nasdaq } : {}),
      ...(vix ? { vix } : {}),
    },
  }
}

export function normalizeQuoteCurrency(value: string | null | undefined): WorkflowMoneyCurrency | undefined {
  return value === 'KRW' || value === 'USD' ? value : undefined
}

export function selectLoadingQuickQuoteItem(
  body: QuotesCurrentProxyResponse,
  target: { code?: string; ticker?: string } | null,
) {
  const items = Array.isArray(body.data?.items) ? body.data.items : []
  const code = normalizeDeepScanCode(target?.code)
  const ticker = normalizeDeepScanTicker(target?.ticker)

  return items.find((item) => code && normalizeDeepScanCode(item.code ?? undefined) === code)
    ?? items.find((item) => ticker && normalizeDeepScanTicker(item.ticker ?? undefined) === ticker)
    ?? items[0]
}
