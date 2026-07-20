import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { type AppliedHomePortfolioRow, type AveragePriceCurrency } from '@/lib/jaroo-home-data'
import { buildIdentifierLabel } from '@/lib/workflow-types'

export type PortfolioSaveRow = {
  name: string
  code?: string
  ticker?: string
  market?: string
  market_tone?: AppliedHomePortfolioRow['resolvedMarketTone']
  kind?: AppliedHomePortfolioRow['resolvedKind']
  quantity: number
  average_price: number
  average_price_currency?: AveragePriceCurrency
  evaluation_amount?: number | null
  identifier_label?: string
  sort_order: number
  source: string
}

export type PortfolioDbRow = PortfolioSaveRow

export function mapAppliedRowsToSaveRows(rows: AppliedHomePortfolioRow[]): PortfolioSaveRow[] {
  return rows.map((row, index) => {
    const name = (row.resolvedName?.trim() || row.name.trim())
    const ticker = row.resolvedTicker?.trim() || row.ticker?.trim() || undefined
    const code = row.resolvedCode?.trim() || row.code?.trim() || undefined

    return {
      name,
      code,
      ticker,
      market: row.resolvedMarket?.trim() || undefined,
      market_tone: row.resolvedMarketTone,
      kind: row.resolvedKind,
      quantity: parseOcrNumber(row.quantity) ?? 0,
      average_price: parseOcrNumber(row.averagePrice) ?? 0,
      average_price_currency: row.averagePriceCurrency,
      evaluation_amount: parseOcrNumber(row.evaluationAmount) ?? null,
      identifier_label: buildIdentifierLabel(ticker, code),
      sort_order: index,
      source: 'ocr',
    }
  })
}

export function mapDbRowsToAppliedRows(rows: PortfolioDbRow[]): AppliedHomePortfolioRow[] {
  return rows.map((row) => {
    const name = (row.name ?? '').trim()
    return {
      name,
      resolvedName: name,
      quantity: row.quantity != null ? String(row.quantity) : '',
      averagePrice: row.average_price != null ? String(row.average_price) : '',
      profitRate: '',
      evaluationAmount: row.evaluation_amount != null ? String(row.evaluation_amount) : '',
      resolvedCode: row.code,
      code: row.code,
      resolvedTicker: row.ticker,
      ticker: row.ticker,
      resolvedMarket: row.market,
      resolvedMarketTone: row.market_tone,
      resolvedKind: row.kind,
      averagePriceCurrency: row.average_price_currency,
    }
  })
}

export type PortfolioFetchResult =
  | { status: 'rows'; rows: AppliedHomePortfolioRow[] }
  | { status: 'empty' }
  | { status: 'logged-out' }
  | { status: 'error' }

export type PortfolioSyncResult =
  | { ok: true; saved?: number }
  | { ok: false; reason: 'logged-out' | 'error' }

export async function parsePortfolioFetchResponse(response: Response): Promise<PortfolioFetchResult> {
  if (response.status === 401) {
    return { status: 'logged-out' }
  }
  if (!response.ok) {
    return { status: 'error' }
  }

  const payload = (await response.json()) as { rows?: PortfolioDbRow[] }
  const rows = Array.isArray(payload?.rows) ? payload.rows : []

  if (rows.length === 0) {
    return { status: 'empty' }
  }

  return { status: 'rows', rows: mapDbRowsToAppliedRows(rows) }
}

export function shouldUsePortfolioSessionFallback(result: PortfolioFetchResult) {
  return result.status === 'logged-out' || result.status === 'error'
}

export async function parsePortfolioSyncResponse(response: Response): Promise<PortfolioSyncResult> {
  if (response.status === 401) {
    return { ok: false, reason: 'logged-out' }
  }
  if (!response.ok) {
    return { ok: false, reason: 'error' }
  }

  const payload = (await response.json()) as { saved?: number }
  return { ok: true, saved: payload.saved }
}

export async function fetchPortfolio(): Promise<PortfolioFetchResult> {
  try {
    const response = await fetch('/api/portfolio', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    })
    return await parsePortfolioFetchResponse(response)
  } catch {
    return { status: 'error' }
  }
}

export async function syncPortfolioToServer(rows: AppliedHomePortfolioRow[]): Promise<PortfolioSyncResult> {
  try {
    const response = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: mapAppliedRowsToSaveRows(rows) }),
    })

    return await parsePortfolioSyncResponse(response)
  } catch {
    return { ok: false, reason: 'error' }
  }
}
