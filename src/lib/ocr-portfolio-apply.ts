import { buildHomeHoldingsFromPortfolioItems, persistAppliedHomePortfolio, type AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import { fetchHomeQuoteResponseWithTimeout } from '@/lib/home-quote-bootstrap'
import { formatComputedNumber, parseOcrProfitRate } from '@/lib/screenshot-ocr'
import {
  createMergeRowId,
  getApplicableConfirmedHoldings,
  toConfirmedHolding,
  toPortfolioNormalizedItem,
  type ConfirmedHolding,
  type MergeRow,
  type OcrReviewRow,
  type PortfolioNormalizedItem,
} from '@/lib/workflow-types'

export function isMissingAveragePrice(value: string) {
  const normalizedValue = value.replace(/[−–—]/g, '-').trim()

  if (!normalizedValue) {
    return true
  }

  if (/^-+$/.test(normalizedValue)) {
    return true
  }

  return normalizedValue.toLowerCase().replace(/[./\s]/g, '') === 'na'
}

// 평단이 화면에 없는 행의 적용 시점 보강(2026-09-29): OCR 스키마에서 평가금액·손익금액을
// 제거하면서 평단 역산 재료가 사라졌다. 적용 게이트가 종목 resolve를 강제하므로 현재 시세는
// 항상 조회 가능하고, avg = 현재가 ÷ (1 + 수익률/100)로 역산한다. 스크린샷 이후 시세 변동과
// 수익률 반올림 오차가 묻는 근사값이다.
export function deriveAveragePriceFromCurrentPrice(currentPrice: number, profitRate?: number) {
  const divisor = 1 + ((profitRate ?? 0) / 100)

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(divisor) || divisor <= 0) {
    return null
  }

  const averagePrice = currentPrice / divisor

  return Number.isFinite(averagePrice) && averagePrice > 0 ? averagePrice : null
}

export function buildQuoteLookupKeyFromReviewRow(
  row: Pick<OcrReviewRow, 'resolvedMarketTone' | 'resolvedCode' | 'resolvedTicker' | 'code' | 'ticker'>,
) {
  if (row.resolvedMarketTone === 'nasdaq') {
    return (row.resolvedTicker ?? row.ticker)?.trim().toUpperCase() || undefined
  }

  return (row.resolvedCode ?? row.code)?.trim() || undefined
}

const AVERAGE_PRICE_FILL_TIMEOUT_MS = 30_000

export async function fillMissingAveragePricesFromQuotes<T extends OcrReviewRow>(
  rows: T[],
  fetcher: typeof fetch = fetch,
  options: { quoteTimeoutMs?: number } = {},
): Promise<T[]> {
  if (rows.every((row) => !isMissingAveragePrice(row.averagePrice))) {
    return rows
  }

  const codes = new Set<string>()
  const tickers = new Set<string>()

  for (const row of rows) {
    if (!isMissingAveragePrice(row.averagePrice)) {
      continue
    }

    const lookupKey = buildQuoteLookupKeyFromReviewRow(row)
    if (!lookupKey) {
      continue
    }

    if (row.resolvedMarketTone === 'nasdaq') {
      tickers.add(lookupKey)
    } else {
      codes.add(lookupKey)
    }
  }

  const searchParams = new URLSearchParams()
  if (codes.size > 0) {
    searchParams.set('codes', [...codes].join(','))
  }
  if (tickers.size > 0) {
    searchParams.set('tickers', [...tickers].join(','))
  }
  const quoteQuery = searchParams.toString()

  if (!quoteQuery) {
    return rows
  }

  type QuoteItem = {
    market?: string | null
    code?: string | null
    ticker?: string | null
    price?: number | null
    status?: string | null
  }

  let quoteItems: QuoteItem[]

  try {
    const response = await fetchHomeQuoteResponseWithTimeout(
      fetcher,
      `/api/quotes/current?${quoteQuery}`,
      { cache: 'no-store' },
      options.quoteTimeoutMs ?? AVERAGE_PRICE_FILL_TIMEOUT_MS,
    )

    if (!response.ok) {
      return rows
    }

    const payload = await response.json()
    quoteItems = Array.isArray(payload?.data?.items) ? payload.data.items : []
  } catch {
    return rows
  }

  const pricesByLookupKey = new Map<string, number>()

  for (const item of quoteItems) {
    const lookupKey = item.market === 'US' ? item.ticker?.trim().toUpperCase() : item.code?.trim()

    if (lookupKey && item.status === 'ok' && typeof item.price === 'number') {
      pricesByLookupKey.set(lookupKey, item.price)
    }
  }

  return rows.map((row) => {
    if (!isMissingAveragePrice(row.averagePrice)) {
      return row
    }

    const lookupKey = buildQuoteLookupKeyFromReviewRow(row)
    const currentPrice = lookupKey ? pricesByLookupKey.get(lookupKey) : undefined

    if (typeof currentPrice !== 'number') {
      return row
    }

    const averagePrice = deriveAveragePriceFromCurrentPrice(currentPrice, parseOcrProfitRate(row.profitRate) ?? undefined)

    return averagePrice === null ? row : { ...row, averagePrice: formatComputedNumber(averagePrice) }
  })
}

// 보강 이후에도 평단이 없는 행(시세 조회 실패 등)은 적용에서 제외한다.
export function markMissingAveragePriceErrors(rows: MergeRow[]): MergeRow[] {
  return rows.map((row) => {
    if (row.status === 'error' || !isMissingAveragePrice(row.averagePriceText)) {
      return row
    }

    return {
      ...row,
      status: 'error',
      errorCode: 'merge-average-price-missing',
      errorMessage: '현재 시세로 평단을 계산하지 못했어요. 평단을 직접 입력한 뒤 다시 시도해주세요.',
    }
  })
}

export function buildMergeRowsFromReviewRows(rows: OcrReviewRow[]): MergeRow[] {
  return rows.map((row) => {
    const confirmedHolding = toConfirmedHolding(row)
    const mergeRow: MergeRow = {
      id: createMergeRowId(row.id, confirmedHolding.displayName),
      sourceRowId: row.id,
      status: 'ready',
      ...confirmedHolding,
    }

    if (row.resolutionState !== 'resolved') {
      return {
        ...mergeRow,
        status: 'error',
        errorCode: 'merge-upstream-review-incomplete',
        errorMessage: '이 행은 종목 확인에서 아직 확정되지 않았어요. 다시 확인해주세요.',
      }
    }

    // 평단이 비어 있어도 여기서 error로 만들지 않는다. 적용 시점 보강
    // (fillMissingAveragePricesFromQuotes)이 채울 수 있고, 채워지지 않으면
    // markMissingAveragePriceErrors가 그때 제외 표시한다.
    if (!confirmedHolding.displayName.trim() || typeof confirmedHolding.quantityValue !== 'number') {
      return {
        ...mergeRow,
        status: 'error',
        errorCode: 'merge-normalization-failed',
        errorMessage: '이 행은 홈 포트폴리오 형식으로 변환할 수 없어요. 값을 다시 확인해주세요.',
      }
    }

    return mergeRow
  })
}

export function buildAppliedHomePortfolioRowsFromConfirmedHoldings(holdings: ConfirmedHolding[]): AppliedHomePortfolioRow[] {
  return holdings.map((holding) => ({
    name: holding.displayName,
    quantity: holding.quantityText,
    profitAmount: holding.profitAmountText,
    profitRate: holding.profitRateText,
    evaluationAmount: holding.evaluationAmountText,
    averagePrice: holding.averagePriceText,
    averagePriceCurrency: holding.averagePriceCurrency ?? (holding.marketTone === 'nasdaq' ? undefined : 'KRW'),
    code: holding.code,
    ticker: holding.ticker,
    resolvedName: holding.displayName,
    resolvedCode: holding.code,
    resolvedTicker: holding.ticker,
    resolvedMarket: holding.market,
    resolvedMarketTone: holding.marketTone,
    resolvedKind: holding.kind,
  }))
}

export type AppliedPortfolioBuildResult = {
  applicableHoldings: ConfirmedHolding[]
  normalizedItems: PortfolioNormalizedItem[]
  persistedRows: AppliedHomePortfolioRow[]
  nextQuoteHoldings: ReturnType<typeof buildHomeHoldingsFromPortfolioItems>
}

export function buildAppliedPortfolioFromMergeRows(rows: MergeRow[]): AppliedPortfolioBuildResult {
  const applicableHoldings = getApplicableConfirmedHoldings(rows)
  const normalizedItems = applicableHoldings
    .map((holding) => toPortfolioNormalizedItem(holding))
    .filter((item): item is PortfolioNormalizedItem => item !== null)

  return {
    applicableHoldings,
    normalizedItems,
    persistedRows: buildAppliedHomePortfolioRowsFromConfirmedHoldings(applicableHoldings),
    nextQuoteHoldings: buildHomeHoldingsFromPortfolioItems(normalizedItems),
  }
}

export function persistAppliedPortfolioFromMergeRows(rows: MergeRow[], appliedAt: string) {
  const result = buildAppliedPortfolioFromMergeRows(rows)
  const persisted = persistAppliedHomePortfolio({
    broker: 'OCR 적용 포트폴리오',
    rows: result.persistedRows,
    appliedAt,
  })

  return {
    ...result,
    persisted,
  }
}
