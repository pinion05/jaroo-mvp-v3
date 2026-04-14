import { parseOcrNumber } from '@/lib/screenshot-ocr'
import type { HomeHolding } from '@/lib/jaroo-home-data'

export type CurrentQuoteItem = {
  market?: string | null
  code?: string | null
  ticker?: string | null
  price?: number | null
  currency?: string | null
  asOf?: string | null
  source?: string | null
  status?: string | null
}

function appendMetric(item: HomeHolding, label: string, value: string): HomeHolding {
  const otherMetrics = item.metrics.filter((metric) => metric.label !== label)
  return {
    ...item,
    metrics: [...otherMetrics, { label, value, tone: 'neutral' }],
  }
}

function formatLivePrice(price: number, currency?: string | null) {
  if (currency === 'USD') {
    return `$${price.toFixed(2)}`
  }

  return `${Math.round(price).toLocaleString('ko-KR')}원`
}

function buildQuoteLookupKey(item: Pick<HomeHolding, 'marketTone' | 'identifierCode' | 'identifierTicker' | 'code'>) {
  if (item.marketTone === 'nasdaq' || item.identifierTicker) {
    return item.identifierTicker?.trim().toUpperCase() || undefined
  }

  return item.identifierCode?.trim() || item.code?.trim() || undefined
}

export function buildHomeCurrentQuoteQuery(holdings: HomeHolding[]) {
  const codes = new Set<string>()
  const tickers = new Set<string>()

  for (const holding of holdings) {
    const key = buildQuoteLookupKey(holding)
    if (!key) continue

    if (holding.marketTone === 'nasdaq' || holding.identifierTicker) {
      tickers.add(key)
      continue
    }

    codes.add(key)
  }

  const searchParams = new URLSearchParams()
  if (codes.size > 0) {
    searchParams.set('codes', [...codes].join(','))
  }
  if (tickers.size > 0) {
    searchParams.set('tickers', [...tickers].join(','))
  }

  return searchParams.toString()
}

export function applyCurrentQuotesToHomeHoldings(holdings: HomeHolding[], quoteItems: CurrentQuoteItem[]) {
  const quoteMap = new Map<string, CurrentQuoteItem>()

  for (const quoteItem of quoteItems) {
    const key = quoteItem.market === 'US'
      ? quoteItem.ticker?.trim().toUpperCase()
      : quoteItem.code?.trim()

    if (!key || quoteItem.status !== 'ok' || typeof quoteItem.price !== 'number') {
      continue
    }

    quoteMap.set(key, quoteItem)
  }

  return holdings.map((holding) => {
    const key = buildQuoteLookupKey(holding)
    if (!key) {
      return holding
    }

    const quoteItem = quoteMap.get(key)
    if (!quoteItem || typeof quoteItem.price !== 'number') {
      return holding
    }

    const livePriceText = formatLivePrice(quoteItem.price, quoteItem.currency)
    const averagePriceValue = parseOcrNumber(holding.averagePrice)
    const metaLine = holding.metaLine.includes('현재가')
      ? holding.metaLine.replace(/ · 현재가 .*$/, ` · 현재가 ${livePriceText}`)
      : `${holding.metaLine} · 현재가 ${livePriceText}`

    const maybeLiveReturn = averagePriceValue && quoteItem.currency === 'KRW'
      ? (((quoteItem.price - averagePriceValue) / averagePriceValue) * 100).toFixed(1)
      : null

    const nextHolding = appendMetric({
      ...holding,
      metaLine,
      change: maybeLiveReturn ? `${Number(maybeLiveReturn) >= 0 ? '+' : ''}${maybeLiveReturn}%` : holding.change,
    }, '현재가', livePriceText)

    return nextHolding
  })
}
