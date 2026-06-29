import { buildIdentifierLabel, type PortfolioNormalizedItem, type WorkflowInstrumentKind, type WorkflowMarketTone, type WorkflowMoneyCurrency } from './workflow-types'

export const ACCOUNT_PORTFOLIO_MAX_ITEMS = 100

export type AccountPortfolioHoldingInput = {
  name: string
  code?: string
  ticker?: string
  market?: string
  market_tone?: WorkflowMarketTone
  kind?: WorkflowInstrumentKind
  quantity: number
  average_price: number
  average_price_currency?: WorkflowMoneyCurrency
  evaluation_amount?: number
  identifier_label?: string
  sort_order: number
  source: 'ocr-merge'
}

export type AccountPortfolioHoldingRow = {
  id?: string
  name?: unknown
  code?: unknown
  ticker?: unknown
  market?: unknown
  market_tone?: unknown
  kind?: unknown
  quantity?: unknown
  average_price?: unknown
  average_price_currency?: unknown
  evaluation_amount?: unknown
  identifier_label?: unknown
  sort_order?: unknown
  updated_at?: unknown
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function workflowMarketTone(value: unknown): WorkflowMarketTone | undefined {
  return value === 'kospi' || value === 'kosdaq' || value === 'nasdaq' || value === 'etf' ? value : undefined
}

function workflowInstrumentKind(value: unknown): WorkflowInstrumentKind | undefined {
  return value === 'stock' || value === 'etf' ? value : undefined
}

function workflowMoneyCurrency(value: unknown): WorkflowMoneyCurrency | undefined {
  return value === 'KRW' || value === 'USD' ? value : undefined
}

export function sanitizeAccountPortfolioItems(value: unknown): PortfolioNormalizedItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  const items: PortfolioNormalizedItem[] = []

  for (const item of value.slice(0, ACCOUNT_PORTFOLIO_MAX_ITEMS)) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const name = trimOrUndefined(record.name)
    const quantity = finiteNumber(record.quantity)
    const averagePrice = finiteNumber(record.averagePrice)
    const evaluationAmount = finiteNumber(record.evaluationAmount)

    if (!name || typeof quantity !== 'number' || quantity <= 0 || typeof averagePrice !== 'number' || averagePrice < 0) {
      continue
    }

    items.push({
      code: trimOrUndefined(record.code),
      ticker: trimOrUndefined(record.ticker),
      market: trimOrUndefined(record.market),
      marketTone: workflowMarketTone(record.marketTone),
      kind: workflowInstrumentKind(record.kind),
      name,
      quantity,
      averagePrice,
      evaluationAmount,
      averagePriceCurrency: workflowMoneyCurrency(record.averagePriceCurrency),
      identifierLabel: trimOrUndefined(record.identifierLabel) ?? buildIdentifierLabel(trimOrUndefined(record.ticker), trimOrUndefined(record.code)),
    })
  }

  return items
}

export function portfolioItemToAccountHoldingInput(item: PortfolioNormalizedItem, index: number): AccountPortfolioHoldingInput {
  return {
    name: item.name.trim(),
    code: trimOrUndefined(item.code),
    ticker: trimOrUndefined(item.ticker),
    market: trimOrUndefined(item.market),
    market_tone: item.marketTone,
    kind: item.kind,
    quantity: item.quantity,
    average_price: item.averagePrice,
    average_price_currency: item.averagePriceCurrency,
    evaluation_amount: item.evaluationAmount,
    identifier_label: trimOrUndefined(item.identifierLabel) ?? buildIdentifierLabel(item.ticker, item.code),
    sort_order: index,
    source: 'ocr-merge',
  }
}

export function buildAccountPortfolioHoldingInputs(items: PortfolioNormalizedItem[]): AccountPortfolioHoldingInput[] {
  return sanitizeAccountPortfolioItems(items).map((item, index) => portfolioItemToAccountHoldingInput(item, index))
}

export function accountHoldingRowToPortfolioItem(row: AccountPortfolioHoldingRow): PortfolioNormalizedItem | null {
  const name = trimOrUndefined(row.name)
  const quantity = finiteNumber(row.quantity)
  const averagePrice = finiteNumber(row.average_price)
  const evaluationAmount = finiteNumber(row.evaluation_amount)
  const code = trimOrUndefined(row.code)
  const ticker = trimOrUndefined(row.ticker)

  if (!name || typeof quantity !== 'number' || quantity <= 0 || typeof averagePrice !== 'number' || averagePrice < 0) {
    return null
  }

  return {
    code,
    ticker,
    market: trimOrUndefined(row.market),
    marketTone: workflowMarketTone(row.market_tone),
    kind: workflowInstrumentKind(row.kind),
    name,
    quantity,
    averagePrice,
    evaluationAmount,
    averagePriceCurrency: workflowMoneyCurrency(row.average_price_currency),
    identifierLabel: trimOrUndefined(row.identifier_label) ?? buildIdentifierLabel(ticker, code),
  }
}

export function accountHoldingRowsToPortfolioItems(rows: AccountPortfolioHoldingRow[]): PortfolioNormalizedItem[] {
  return rows.map(accountHoldingRowToPortfolioItem).filter((item): item is PortfolioNormalizedItem => item !== null)
}
