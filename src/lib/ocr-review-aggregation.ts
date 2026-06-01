import {
  computeAveragePrice,
  formatComputedNumber,
  normalizeStockName,
  parseOcrNumber,
} from '@/lib/screenshot-ocr'
import type { OcrReviewRow } from '@/lib/workflow-types'

export type OcrReviewAccountDetail = {
  rowId: string
  sourceFileName?: string
  quantity: string
  profitRate: string
  evaluationAmount: string
  averagePrice: string
}

export type AggregatedOcrReviewRow = OcrReviewRow & {
  sourceRowIds: string[]
  accountDetails: OcrReviewAccountDetail[]
  isAccountMerged: boolean
}

function getAggregationKey(row: OcrReviewRow) {
  const resolvedCode = row.resolvedCode?.trim().toUpperCase()
  if (resolvedCode) {
    return `code:${resolvedCode}`
  }

  const resolvedTicker = row.resolvedTicker?.trim().toUpperCase()
  if (resolvedTicker) {
    return `ticker:${resolvedTicker}`
  }

  const normalizedName = normalizeStockName(row.resolvedName || row.name)
  return `name:${normalizedName || row.id}`
}

function sumParsed(rows: OcrReviewRow[], field: 'quantity' | 'evaluationAmount') {
  const values = rows.map((row) => parseOcrNumber(row[field]))
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

function computeMergedProfitRate(rows: OcrReviewRow[], evaluationAmount: number) {
  const principalValues = rows.map((row) => {
    const rowEvaluationAmount = parseOcrNumber(row.evaluationAmount)
    const rowProfitRate = parseOcrNumber(row.profitRate)

    if (rowEvaluationAmount === null || rowProfitRate === null) {
      return null
    }

    const divisor = 1 + (rowProfitRate / 100)
    if (!Number.isFinite(divisor) || divisor === 0) {
      return null
    }

    return rowEvaluationAmount / divisor
  })

  if (!principalValues.every((value): value is number => value !== null)) {
    return ''
  }

  const principal = principalValues.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(principal) || principal === 0) {
    return ''
  }

  return `${formatComputedNumber(((evaluationAmount / principal) - 1) * 100)}%`
}

function computeWeightedAveragePrice(rows: OcrReviewRow[]) {
  const components = rows.map((row) => {
    const quantity = parseOcrNumber(row.quantity)
    const averagePrice = parseOcrNumber(row.averagePrice)

    if (quantity === null || averagePrice === null) {
      return null
    }

    return { quantity, averagePrice }
  })

  if (!components.every((value): value is { quantity: number; averagePrice: number } => value !== null)) {
    return ''
  }

  const totalQuantity = components.reduce((sum, value) => sum + value.quantity, 0)
  if (!Number.isFinite(totalQuantity) || totalQuantity === 0) {
    return ''
  }

  const totalCost = components.reduce((sum, value) => sum + (value.quantity * value.averagePrice), 0)
  const weightedAveragePrice = totalCost / totalQuantity

  return Number.isFinite(weightedAveragePrice) ? formatComputedNumber(weightedAveragePrice) : ''
}

function toAccountDetail(row: OcrReviewRow): OcrReviewAccountDetail {
  return {
    rowId: row.id,
    sourceFileName: row.sourceFileName,
    quantity: row.quantity,
    profitRate: row.profitRate,
    evaluationAmount: row.evaluationAmount,
    averagePrice: row.averagePrice,
  }
}

function aggregateGroup(rows: OcrReviewRow[]): AggregatedOcrReviewRow {
  const orderedRows = [...rows].sort((left, right) => {
    const leftIndex = left.rowIndex ?? Number.MAX_SAFE_INTEGER
    const rightIndex = right.rowIndex ?? Number.MAX_SAFE_INTEGER
    return leftIndex - rightIndex || left.id.localeCompare(right.id)
  })
  const primary = orderedRows[0]

  if (!primary || orderedRows.length === 1) {
    const single = primary ?? rows[0]
    return {
      ...(single as OcrReviewRow),
      sourceRowIds: single ? [single.id] : [],
      accountDetails: single ? [toAccountDetail(single)] : [],
      isAccountMerged: false,
    }
  }

  const quantity = sumParsed(orderedRows, 'quantity')
  const evaluationAmount = sumParsed(orderedRows, 'evaluationAmount')
  const quantityText = quantity === null ? primary.quantity : formatComputedNumber(quantity)
  const evaluationAmountText = evaluationAmount === null ? primary.evaluationAmount : formatComputedNumber(evaluationAmount)
  const profitRateText = evaluationAmount === null ? primary.profitRate : computeMergedProfitRate(orderedRows, evaluationAmount) || primary.profitRate
  const averagePriceText =
    computeWeightedAveragePrice(orderedRows)
    || computeAveragePrice(quantityText, profitRateText, evaluationAmountText)
    || primary.averagePrice

  return {
    ...primary,
    id: `agg:${getAggregationKey(primary)}`,
    quantity: quantityText,
    evaluationAmount: evaluationAmountText,
    profitRate: profitRateText,
    averagePrice: averagePriceText,
    sourceRowIds: orderedRows.map((row) => row.id),
    accountDetails: orderedRows.map(toAccountDetail),
    isAccountMerged: true,
  }
}

export function aggregateResolvedOcrReviewRows(rows: OcrReviewRow[]): AggregatedOcrReviewRow[] {
  const groupedRows = new Map<string, OcrReviewRow[]>()

  rows.forEach((row) => {
    const key = getAggregationKey(row)
    const group = groupedRows.get(key)

    if (group) {
      group.push(row)
      return
    }

    groupedRows.set(key, [row])
  })

  return [...groupedRows.values()].map(aggregateGroup)
}
