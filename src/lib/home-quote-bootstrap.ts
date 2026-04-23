import { parseOcrNumber } from '@/lib/screenshot-ocr'
import type { PortfolioNormalizedItem } from '@/lib/workflow-types'
import { buildHomeHoldingsFromPortfolioItems } from './jaroo-home-data'
import {
  applyCurrentQuotesToHomeHoldings,
  buildHomeCurrentQuoteQuery,
  buildQuoteLookupKey,
  requiresFxConversion,
  resolveAveragePriceCurrency,
  shouldTreatQuoteFailureAsErrorCard,
  type CurrentQuoteItem,
} from './home-current-quotes'

type QuoteBootstrapResult = {
  items: PortfolioNormalizedItem[]
  quoteQuery: string
  quoteStatus: 'idle' | 'success' | 'error'
  quoteErrorMessage: string | null
}

export async function hydratePortfolioItemsWithCurrentQuotes(
  portfolioItems: PortfolioNormalizedItem[],
  fetcher: typeof fetch = fetch,
): Promise<QuoteBootstrapResult> {
  const rawHomeHoldings = buildHomeHoldingsFromPortfolioItems(portfolioItems)
  const quoteQuery = buildHomeCurrentQuoteQuery(rawHomeHoldings)

  if (!quoteQuery) {
    return {
      items: portfolioItems,
      quoteQuery: '',
      quoteStatus: 'idle',
      quoteErrorMessage: null,
    }
  }

  const hasUsHomeHoldings = rawHomeHoldings.some((holding) => holding.marketTone === 'nasdaq' || Boolean(holding.identifierTicker))
  const [fxResult, quoteResult] = await Promise.all([
    hasUsHomeHoldings
      ? (async () => {
          try {
            const response = await fetcher('/api/market/fx/usd-krw', { cache: 'no-store' })
            const payload = await response.json()
            const parsedRate = Number(payload?.data?.rate)
            return response.ok && Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null
          } catch {
            return null
          }
        })()
      : Promise.resolve(null),
    (async () => {
      const response = await fetcher(`/api/quotes/current?${quoteQuery}`, { cache: 'no-store' })
      const payload = await response.json()
      return { response, payload }
    })(),
  ])

  if (!quoteResult.response.ok) {
    return {
      items: portfolioItems.map((item) => ({
        ...item,
        currentPrice: undefined,
        currentProfitRate: undefined,
        currentPriceCurrency: undefined,
      })),
      quoteQuery,
      quoteStatus: 'error',
      quoteErrorMessage: '현재 시세를 불러오지 못했어요. 다시 시도해주세요.',
    }
  }

  const nextItems: CurrentQuoteItem[] = Array.isArray(quoteResult.payload?.data?.items) ? quoteResult.payload.data.items : []
  const okItems = nextItems.filter((item) => item.status === 'ok' && typeof item.price === 'number')
  const nextHoldings = applyCurrentQuotesToHomeHoldings(rawHomeHoldings, okItems, { usdKrwRate: hasUsHomeHoldings ? fxResult : null })
  const nextHoldingsById = new Map(nextHoldings.map((holding) => [holding.id, holding]))
  const responseByLookupKey = new Map<string, CurrentQuoteItem>()

  for (const item of nextItems) {
    const lookupKey = item.market === 'US'
      ? item.ticker?.trim().toUpperCase()
      : item.code?.trim()

    if (lookupKey) {
      responseByLookupKey.set(lookupKey, item)
    }
  }

  let failureCount = 0

  const hydratedItems = portfolioItems.map((item, index) => {
    const homeHolding = rawHomeHoldings[index]
    const lookupKey = homeHolding ? buildQuoteLookupKey(homeHolding) : undefined
    const quoteItem = lookupKey ? responseByLookupKey.get(lookupKey) : undefined

    if (!homeHolding || !homeHolding.name.trim()) {
      failureCount += 1
      return {
        ...item,
        currentPrice: undefined,
        currentProfitRate: undefined,
        currentPriceCurrency: undefined,
      }
    }

    if (!quoteItem || quoteItem.status !== 'ok' || typeof quoteItem.price !== 'number') {
      if (shouldTreatQuoteFailureAsErrorCard(homeHolding, 'quote-unavailable')) {
        failureCount += 1
      }
      return {
        ...item,
        currentPrice: undefined,
        currentProfitRate: undefined,
        currentPriceCurrency: undefined,
      }
    }

    const quoteCurrency: 'KRW' | 'USD' = quoteItem.currency === 'USD' || homeHolding.marketTone === 'nasdaq' ? 'USD' : 'KRW'
    const averagePriceCurrency = resolveAveragePriceCurrency(homeHolding, quoteCurrency, quoteItem, { usdKrwRate: fxResult })
    const requiresFx = requiresFxConversion(quoteCurrency, averagePriceCurrency)

    if (requiresFx && fxResult === null) {
      failureCount += 1
      return {
        ...item,
        currentPrice: undefined,
        currentProfitRate: undefined,
        currentPriceCurrency: undefined,
      }
    }

    const enrichedHolding = nextHoldingsById.get(homeHolding.id)

    return {
      ...item,
      currentPrice: quoteItem.price,
      currentPriceCurrency: quoteCurrency,
      currentProfitRate: parseOcrNumber(enrichedHolding?.change ?? '') ?? undefined,
    }
  })

  return {
    items: hydratedItems,
    quoteQuery,
    quoteStatus: failureCount === rawHomeHoldings.length ? 'error' : 'success',
    quoteErrorMessage: failureCount === rawHomeHoldings.length
      ? '현재 시세를 불러오지 못했어요. 다시 시도해주세요.'
      : null,
  }
}

export type { QuoteBootstrapResult }
