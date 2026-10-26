import { fetchHomeQuoteResponseWithTimeout } from '@/lib/home-quote-bootstrap'
import { formatComputedNumber, parseOcrNumber } from '@/lib/screenshot-ocr'
import { buildQuoteLookupKeyFromReviewRow } from '@/lib/ocr-portfolio-apply'
import type { OcrReviewRow } from '@/lib/workflow-types'

const EVALUATION_PREVIEW_QUOTE_TIMEOUT_MS = 30_000

type QuotePriceItem = {
  market?: string | null
  code?: string | null
  ticker?: string | null
  price?: number | null
  status?: string | null
}

type EvaluationPreviewRow = Pick<
  OcrReviewRow,
  | 'quantity'
  | 'evaluationAmount'
  | 'resolvedMarketTone'
  | 'resolvedCode'
  | 'resolvedTicker'
  | 'code'
  | 'ticker'
>

export type EvaluationPreviewOptions = {
  quoteTimeoutMs?: number
  signal?: AbortSignal
}

function isMissingEvaluationAmount(value: string) {
  const normalizedValue = value.replace(/[−–—]/g, '-').trim()

  if (!normalizedValue) {
    return true
  }

  if (/^-+$/.test(normalizedValue)) {
    return true
  }

  return normalizedValue.toLowerCase().replace(/[./\s]/g, '') === 'na'
}

// 검수 카드의 평가금 프리뷰(2026-10-06): OCR 스키마 축소(2026-09-29)로 평가금액이 비어 있는 행은
// 현재 시세로 평가금(현재가×수량)을 계산해 보여준다. 표시 전용 근사값이며, 적용 데이터는
// 기존처럼 적용 시점의 fillMissingAveragePricesFromQuotes로만 확정한다.
export async function fetchCurrentPricesForEvaluationPreview<T extends EvaluationPreviewRow>(
  rows: T[],
  fetcher: typeof fetch = fetch,
  options: EvaluationPreviewOptions = {},
): Promise<Map<string, number>> {
  const codes = new Set<string>()
  const tickers = new Set<string>()

  for (const row of rows) {
    if (!isMissingEvaluationAmount(row.evaluationAmount)) {
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
    return new Map()
  }

  let quoteItems: QuotePriceItem[]

  try {
    const response = await fetchHomeQuoteResponseWithTimeout(
      fetcher,
      `/api/quotes/current?${quoteQuery}`,
      { cache: 'no-store', signal: options.signal },
      options.quoteTimeoutMs ?? EVALUATION_PREVIEW_QUOTE_TIMEOUT_MS,
    )

    if (!response.ok) {
      return new Map()
    }

    const payload = await response.json()
    quoteItems = Array.isArray(payload?.data?.items) ? payload.data.items : []
  } catch {
    return new Map()
  }

  const pricesByLookupKey = new Map<string, number>()

  for (const item of quoteItems) {
    const lookupKey = item.market === 'US' ? item.ticker?.trim().toUpperCase() : item.code?.trim()

    if (lookupKey && item.status === 'ok' && typeof item.price === 'number') {
      pricesByLookupKey.set(lookupKey, item.price)
    }
  }

  return pricesByLookupKey
}

export function computeEvaluationPreviewAmount(row: EvaluationPreviewRow, prices: Map<string, number> | null) {
  if (!isMissingEvaluationAmount(row.evaluationAmount)) {
    return null
  }

  const lookupKey = buildQuoteLookupKeyFromReviewRow(row)
  const currentPrice = lookupKey ? prices?.get(lookupKey) : undefined

  if (typeof currentPrice !== 'number' || currentPrice <= 0) {
    return null
  }

  const quantity = parseOcrNumber(row.quantity)

  if (quantity === null || quantity <= 0) {
    return null
  }

  const amount = currentPrice * quantity

  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export function formatEvaluationPreviewAmount(amount: number, marketTone?: string) {
  const formattedAmount = formatComputedNumber(amount)

  if (!formattedAmount) {
    return ''
  }

  return marketTone === 'nasdaq' ? `≈ $${formattedAmount}` : `≈ ${formattedAmount}원`
}

// 조회 대상 룩업 키 서명. 페이지 useEffect가 이 값이 바뀔 때만 시세를 다시 조회하도록 쓴다.
export function buildEvaluationPreviewKey(rows: EvaluationPreviewRow[]) {
  const lookupKeys = new Set<string>()

  for (const row of rows) {
    if (!isMissingEvaluationAmount(row.evaluationAmount)) {
      continue
    }

    const lookupKey = buildQuoteLookupKeyFromReviewRow(row)
    if (lookupKey) {
      lookupKeys.add(lookupKey)
    }
  }

  return [...lookupKeys].sort().join(',')
}
