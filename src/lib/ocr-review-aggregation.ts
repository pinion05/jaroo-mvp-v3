import {
  formatComputedNumber,
  normalizeStockName,
  parseOcrNumber,
  parseOcrProfitRate,
} from '@/lib/screenshot-ocr'
import type { OcrReviewRow } from '@/lib/workflow-types'

export type OcrReviewAccountDetail = {
  rowId: string
  sourceFileName?: string
  quantity: string
  profitAmount?: string
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

function sumParsedProfitAmounts(rows: OcrReviewRow[]) {
  const values = rows.map((row) => parseOcrNumber(row.profitAmount ?? ''))
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

function formatSignedComputedNumber(value: number) {
  const normalizedValue = Number(value.toFixed(4))

  if (!Number.isFinite(normalizedValue)) {
    return ''
  }

  return `${normalizedValue > 0 ? '+' : ''}${normalizedValue}`
}

function formatMergedRate(rate: number) {
  return `${rate > 0 ? '+' : ''}${rate.toFixed(1).replace('-', '−')}%`
}

// OCR 스키마 축소(2026-09-29) 이후 평가금액·손익금액은 더 이상 모델이 뽑지 않는다.
// 평단·수량이 있으면 원금(qty×avg) 기반으로 평가금액·손익·병합 수익률을 유도하고,
// 수동 입력·레거시 행의 명시값(explicit)이 있으면 그것을 우선한다.
function computeRowPrincipal(row: OcrReviewRow) {
  const quantity = parseOcrNumber(row.quantity)
  const averagePrice = parseOcrNumber(row.averagePrice)

  if (quantity === null || quantity <= 0 || averagePrice === null || averagePrice <= 0) {
    return null
  }

  const principal = quantity * averagePrice

  return Number.isFinite(principal) && principal > 0 ? principal : null
}

function deriveEvaluationAmountFromPrincipals(rows: OcrReviewRow[]) {
  const values = rows.map((row) => {
    const principal = computeRowPrincipal(row)

    if (principal === null) {
      return null
    }

    const rate = parseOcrProfitRate(row.profitRate)
    return principal * (1 + ((rate ?? 0) / 100))
  })

  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

function deriveProfitAmountFromPrincipals(rows: OcrReviewRow[]) {
  const values = rows.map((row) => {
    const principal = computeRowPrincipal(row)

    if (principal === null) {
      return null
    }

    const rate = parseOcrProfitRate(row.profitRate)
    return principal * ((rate ?? 0) / 100)
  })

  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

function computeMergedProfitRate(rows: OcrReviewRow[], evaluationAmount: number | null, profitAmount: number | null) {
  if (evaluationAmount !== null && profitAmount !== null) {
    const principal = evaluationAmount - profitAmount

    if (Number.isFinite(principal) && principal > 0) {
      return formatMergedRate((profitAmount / principal) * 100)
    }
  }

  if (evaluationAmount !== null) {
    const principalValues = rows.map((row) => {
      const rowEvaluationAmount = parseOcrNumber(row.evaluationAmount)
      const rowProfitRate = parseOcrProfitRate(row.profitRate)

      if (rowEvaluationAmount === null || rowProfitRate === null) {
        return null
      }

      const divisor = 1 + (rowProfitRate / 100)

      if (!Number.isFinite(divisor) || divisor === 0) {
        return null
      }

      return rowEvaluationAmount / divisor
    })

    if (principalValues.every((value): value is number => value !== null)) {
      const principal = principalValues.reduce((sum, value) => sum + value, 0)

      if (Number.isFinite(principal) && principal !== 0) {
        return formatMergedRate(((evaluationAmount / principal) - 1) * 100)
      }
    }
  }

  const principalRateValues = rows.map((row) => {
    const principal = computeRowPrincipal(row)
    const rate = parseOcrProfitRate(row.profitRate)

    return principal === null || rate === null ? null : (principal * rate) / 100
  })

  if (principalRateValues.every((value): value is number => value !== null)) {
    const totalWeightedRate = principalRateValues.reduce((sum, value) => sum + value, 0)
    const totalPrincipal = rows
      .map((row) => computeRowPrincipal(row))
      .reduce((sum: number, value) => (value === null ? sum : sum + value), 0)

    if (Number.isFinite(totalPrincipal) && totalPrincipal > 0) {
      return formatMergedRate((totalWeightedRate / totalPrincipal) * 100)
    }
  }

  return ''
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
    profitAmount: row.profitAmount,
    profitRate: row.profitRate,
    evaluationAmount: row.evaluationAmount,
    averagePrice: row.averagePrice,
  }
}

// 단일 행도 평가금액·손익금액이 비어 있으면 평단 기반으로 유도해 검수 UI·스냅샷이 비어 보이지 않게 한다.
function deriveSnapshotFields(row: OcrReviewRow): Partial<OcrReviewRow> {
  const patch: Partial<OcrReviewRow> = {}

  if (!row.evaluationAmount.trim()) {
    const derivedEvaluationAmount = deriveEvaluationAmountFromPrincipals([row])

    if (derivedEvaluationAmount !== null) {
      patch.evaluationAmount = formatComputedNumber(derivedEvaluationAmount)
    }
  }

  if (!row.profitAmount?.trim()) {
    const derivedProfitAmount = deriveProfitAmountFromPrincipals([row])

    if (derivedProfitAmount !== null) {
      patch.profitAmount = formatSignedComputedNumber(derivedProfitAmount)
    }
  }

  return patch
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
      ...deriveSnapshotFields(single),
      sourceRowIds: single ? [single.id] : [],
      accountDetails: single ? [toAccountDetail(single)] : [],
      isAccountMerged: false,
    }
  }

  const quantity = sumParsed(orderedRows, 'quantity')
  const explicitEvaluationAmount = sumParsed(orderedRows, 'evaluationAmount')
  const explicitProfitAmount = sumParsedProfitAmounts(orderedRows)
  const derivedEvaluationAmount = explicitEvaluationAmount !== null ? null : deriveEvaluationAmountFromPrincipals(orderedRows)
  const derivedProfitAmount = explicitProfitAmount !== null ? null : deriveProfitAmountFromPrincipals(orderedRows)
  const quantityText = quantity === null ? primary.quantity : formatComputedNumber(quantity)
  const evaluationAmountText =
    explicitEvaluationAmount !== null
      ? formatComputedNumber(explicitEvaluationAmount)
      : derivedEvaluationAmount !== null
        ? formatComputedNumber(derivedEvaluationAmount)
        : primary.evaluationAmount
  const profitAmountText =
    explicitProfitAmount !== null
      ? formatSignedComputedNumber(explicitProfitAmount)
      : derivedProfitAmount !== null
        ? formatSignedComputedNumber(derivedProfitAmount)
        : primary.profitAmount
  const profitRateText =
    computeMergedProfitRate(orderedRows, explicitEvaluationAmount, explicitProfitAmount)
    || (derivedEvaluationAmount !== null
      ? computeMergedProfitRate(orderedRows, derivedEvaluationAmount, derivedProfitAmount)
      : '')
    || primary.profitRate
  const averagePriceText =
    computeWeightedAveragePrice(orderedRows)
    || primary.averagePrice

  return {
    ...primary,
    id: `agg:${getAggregationKey(primary)}`,
    quantity: quantityText,
    evaluationAmount: evaluationAmountText,
    profitAmount: profitAmountText,
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
