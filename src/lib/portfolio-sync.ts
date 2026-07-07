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
