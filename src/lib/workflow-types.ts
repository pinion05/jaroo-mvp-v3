import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'
import { isAveragePriceComputedFromEvaluation, parseOcrNumber, parseOcrProfitRate } from './screenshot-ocr'

export type WorkflowMarketTone = 'kospi' | 'kosdaq' | 'nasdaq' | 'etf'
export type WorkflowInstrumentKind = 'stock' | 'etf'
export type WorkflowMoneyCurrency = 'KRW' | 'USD'
export type WorkflowAsyncStatus = 'idle' | 'loading' | 'success' | 'error'
export type OcrReviewResolutionState = 'unresolved' | 'resolved' | 'manual-required' | 'error'
export type MergeRowStatus = 'ready' | 'error'

export type ScreenshotUploadInput = {
  broker: string
  uploads: Array<{
    id: string
    fileName: string
    imageDataUrl: string
  }>
}

export type OcrExtractedRow = {
  name: string
  quantity: string
  profitRate: string
  evaluationAmount: string
  averagePrice: string
  code?: string
  ticker?: string
}

export type ResolvedReviewRow = OcrExtractedRow & {
  resolvedName?: string
  resolvedCode?: string
  resolvedTicker?: string
  resolvedMarket?: string
  resolvedMarketTone?: WorkflowMarketTone
  resolvedKind?: WorkflowInstrumentKind
}

export type ResolveCandidate = {
  id: string
  resolvedName: string
  resolvedCode?: string
  resolvedTicker?: string
  resolvedMarket?: string
  resolvedMarketTone?: WorkflowMarketTone
  resolvedKind?: WorkflowInstrumentKind
  source: 'ticker-map' | 'local'
  score?: number
  via?: string
}

export type OcrReviewRow = ResolvedReviewRow & {
  id: string
  raw?: OcrExtractedRow
  sourceFileName?: string
  sourceUploadId?: string
  rowIndex?: number
  resolutionState: OcrReviewResolutionState
  selectedCandidateId?: string | null
}

export type ConfirmedHolding = {
  displayName: string
  ticker?: string
  code?: string
  market?: string
  marketTone?: WorkflowMarketTone
  kind?: WorkflowInstrumentKind
  quantityText: string
  quantityValue?: number
  profitRateText: string
  profitRateValue?: number
  evaluationAmountText: string
  evaluationAmountValue?: number
  averagePriceText: string
  averagePriceValue?: number
  sourceFileName?: string
  averagePriceCurrency?: WorkflowMoneyCurrency
}

export type MergeRow = ConfirmedHolding & {
  id: string
  sourceRowId?: string
  status: MergeRowStatus
  errorCode?: string
  errorMessage?: string
}

export type PortfolioNormalizedItem = {
  code?: string
  ticker?: string
  market?: string
  marketTone?: WorkflowMarketTone
  kind?: WorkflowInstrumentKind
  name: string
  quantity: number
  averagePrice: number
  currentPrice?: number
  currentProfitRate?: number
  currentPriceCurrency?: WorkflowMoneyCurrency
  evaluationAmount?: number
  averagePriceCurrency?: WorkflowMoneyCurrency
  usdKrwRate?: number
  identifierLabel?: string
}

export type DeepScanTargetInput = {
  code?: string
  ticker?: string
  market?: string
  marketTone?: WorkflowMarketTone
  kind?: WorkflowInstrumentKind
  name: string
  quantity: number
  averagePrice: number
  currentPrice?: number
  currentProfitRate?: number
  currentPriceCurrency?: WorkflowMoneyCurrency
  evaluationAmount?: number
  averagePriceCurrency?: WorkflowMoneyCurrency
  usdKrwRate?: number
  identifierLabel?: string
}

export type DeepScanResultCacheEntry = {
  targetKey: string
  payload: JarooDeepScanPayload
  completedAt: string
}

export function createOcrReviewRowId(seed: {
  uploadId?: string
  fileName?: string
  rowIndex?: number
  name?: string
}) {
  return [
    seed.uploadId?.trim() || 'upload',
    seed.fileName?.trim() || 'file',
    typeof seed.rowIndex === 'number' ? String(seed.rowIndex) : 'row',
    seed.name?.trim() || 'holding',
  ].join(':')
}

export function createMergeRowId(sourceRowId: string, displayName: string) {
  return `${sourceRowId}:${displayName.trim() || 'holding'}`
}

export function buildIdentifierLabel(ticker?: string, code?: string) {
  const identifiers = [ticker?.trim(), code?.trim()].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  )

  return identifiers.length > 0 ? identifiers.join(' · ') : undefined
}

function isUsResolvedMarket(row: Pick<OcrReviewRow, 'resolvedMarketTone' | 'resolvedMarket'>) {
  return row.resolvedMarketTone === 'nasdaq' || /(nasdaq|nyse|amex|us)/i.test(row.resolvedMarket ?? '')
}

function inferMoneyCurrencyFromText(value: string | undefined) {
  const normalizedValue = value?.trim().toUpperCase() ?? ''

  if (!normalizedValue) {
    return undefined
  }

  if (normalizedValue.includes('$') || normalizedValue.includes('USD')) {
    return 'USD' as const
  }

  if (normalizedValue.includes('₩') || normalizedValue.includes('KRW') || normalizedValue.includes('원')) {
    return 'KRW' as const
  }

  return undefined
}

function inferAveragePriceCurrency(row: OcrReviewRow) {
  const explicitAveragePriceCurrency = inferMoneyCurrencyFromText(row.averagePrice)

  if (explicitAveragePriceCurrency) {
    return explicitAveragePriceCurrency
  }

  const evaluationAmountCurrency = inferMoneyCurrencyFromText(row.evaluationAmount)

  if (isUsResolvedMarket(row)) {
    return evaluationAmountCurrency && isAveragePriceComputedFromEvaluation(
      row.quantity,
      row.profitRate,
      row.evaluationAmount,
      row.averagePrice,
    )
      ? evaluationAmountCurrency
      : undefined
  }

  return evaluationAmountCurrency ?? 'KRW'
}

export function toConfirmedHolding(row: OcrReviewRow): ConfirmedHolding {
  const averagePriceCurrency = inferAveragePriceCurrency(row)

  return {
    displayName: row.resolvedName?.trim() || row.name.trim(),
    ticker: row.resolvedTicker?.trim() || row.ticker?.trim() || undefined,
    code: row.resolvedCode?.trim() || row.code?.trim() || undefined,
    market: row.resolvedMarket?.trim() || undefined,
    marketTone: row.resolvedMarketTone,
    kind: row.resolvedKind,
    quantityText: row.quantity,
    quantityValue: parseOcrNumber(row.quantity) ?? undefined,
    profitRateText: row.profitRate,
    profitRateValue: parseOcrProfitRate(row.profitRate) ?? undefined,
    evaluationAmountText: row.evaluationAmount,
    evaluationAmountValue: parseOcrNumber(row.evaluationAmount) ?? undefined,
    averagePriceText: row.averagePrice,
    averagePriceValue: parseOcrNumber(row.averagePrice) ?? undefined,
    averagePriceCurrency,
    sourceFileName: row.sourceFileName,
  }
}

export function isMergeRowApplicable(row: MergeRow) {
  return row.status !== 'error'
}

export function getApplicableConfirmedHoldings(rows: MergeRow[]): ConfirmedHolding[] {
  return rows.filter(isMergeRowApplicable).map((row) => ({
    displayName: row.displayName,
    ticker: row.ticker,
    code: row.code,
    market: row.market,
    marketTone: row.marketTone,
    kind: row.kind,
    quantityText: row.quantityText,
    quantityValue: row.quantityValue,
    profitRateText: row.profitRateText,
    profitRateValue: row.profitRateValue,
    evaluationAmountText: row.evaluationAmountText,
    evaluationAmountValue: row.evaluationAmountValue,
    averagePriceText: row.averagePriceText,
    averagePriceValue: row.averagePriceValue,
    averagePriceCurrency: row.averagePriceCurrency,
    sourceFileName: row.sourceFileName,
  }))
}

export function toPortfolioNormalizedItem(holding: ConfirmedHolding): PortfolioNormalizedItem | null {
  if (
    !holding.displayName.trim()
    || typeof holding.quantityValue !== 'number'
    || typeof holding.averagePriceValue !== 'number'
  ) {
    return null
  }

  return {
    code: holding.code?.trim() || undefined,
    ticker: holding.ticker?.trim() || undefined,
    market: holding.market?.trim() || undefined,
    marketTone: holding.marketTone,
    kind: holding.kind,
    name: holding.displayName.trim(),
    quantity: holding.quantityValue,
    averagePrice: holding.averagePriceValue,
    evaluationAmount: holding.evaluationAmountValue,
    averagePriceCurrency: holding.averagePriceCurrency,
    identifierLabel: buildIdentifierLabel(holding.ticker, holding.code),
  }
}

export function getPortfolioItemKey(item: Pick<PortfolioNormalizedItem, 'code' | 'ticker' | 'name' | 'market'>) {
  return [item.code?.trim(), item.ticker?.trim(), item.name.trim(), item.market?.trim()].filter(Boolean).join('|')
}

export function toDeepScanTargetInput(item: PortfolioNormalizedItem): DeepScanTargetInput {
  return {
    code: item.code,
    ticker: item.ticker,
    market: item.market,
    marketTone: item.marketTone,
    kind: item.kind,
    name: item.name,
    quantity: item.quantity,
    averagePrice: item.averagePrice,
    currentPrice: item.currentPrice,
    currentProfitRate: item.currentProfitRate,
    currentPriceCurrency: item.currentPriceCurrency,
    evaluationAmount: item.evaluationAmount,
    averagePriceCurrency: item.averagePriceCurrency,
    usdKrwRate: item.usdKrwRate,
    identifierLabel: item.identifierLabel ?? buildIdentifierLabel(item.ticker, item.code),
  }
}

type DeepScanTargetKeyInput = Pick<
  DeepScanTargetInput,
  | 'code'
  | 'ticker'
  | 'name'
  | 'market'
  | 'quantity'
  | 'averagePrice'
  | 'evaluationAmount'
  | 'averagePriceCurrency'
  | 'currentPrice'
  | 'currentPriceCurrency'
  | 'usdKrwRate'
>

function normalizeDeepScanTargetKeyText(value: string | undefined) {
  return value?.trim() ?? ''
}

function normalizeDeepScanTargetKeyNumber(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }

  return Object.is(value, -0) ? '0' : String(value)
}

export function getDeepScanTargetKey(target: DeepScanTargetKeyInput) {
  return [
    ['code', normalizeDeepScanTargetKeyText(target.code)],
    ['ticker', normalizeDeepScanTargetKeyText(target.ticker)],
    ['name', normalizeDeepScanTargetKeyText(target.name)],
    ['market', normalizeDeepScanTargetKeyText(target.market)],
    ['quantity', normalizeDeepScanTargetKeyNumber(target.quantity)],
    ['averagePrice', normalizeDeepScanTargetKeyNumber(target.averagePrice)],
    ['evaluationAmount', normalizeDeepScanTargetKeyNumber(target.evaluationAmount)],
    ['averagePriceCurrency', normalizeDeepScanTargetKeyText(target.averagePriceCurrency)],
    ['currentPrice', normalizeDeepScanTargetKeyNumber(target.currentPrice)],
    ['currentPriceCurrency', normalizeDeepScanTargetKeyText(target.currentPriceCurrency)],
    ['usdKrwRate', normalizeDeepScanTargetKeyNumber(target.usdKrwRate)],
  ].map(([label, value]) => `${label}:${value}`).join('|')
}
