import { buildHomeHoldingsFromPortfolioItems, persistAppliedHomePortfolio, type AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import { computeAveragePrice } from '@/lib/screenshot-ocr'
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

export function prepareMergeRowsForApply<T extends { averagePrice: string; quantity: string; profitAmount?: string; profitRate: string; evaluationAmount: string }>(rows: T[]) {
  return rows.map((row) => {
    if (!isMissingAveragePrice(row.averagePrice)) {
      return { ...row }
    }

    return {
      ...row,
      averagePrice: computeAveragePrice(row.quantity, row.profitRate, row.evaluationAmount, row.profitAmount ?? ''),
    }
  })
}

export function buildMergeRowsFromReviewRows(rows: OcrReviewRow[]): MergeRow[] {
  return rows.map((row) => {
    const preparedReviewRow = {
      ...row,
      averagePrice: isMissingAveragePrice(row.averagePrice)
        ? computeAveragePrice(row.quantity, row.profitRate, row.evaluationAmount, row.profitAmount ?? '')
        : row.averagePrice,
    }
    const confirmedHolding = toConfirmedHolding(preparedReviewRow)
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

    if (!toPortfolioNormalizedItem(confirmedHolding)) {
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
