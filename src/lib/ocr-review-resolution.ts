import type { OcrSourceRow } from '@/lib/screenshot-ocr'
import type { OcrReviewRow, ResolveCandidate } from '@/lib/workflow-types'

export type ResolvedInstrumentRowsResult = {
  rows: OcrSourceRow[]
  candidatesByRowId: Record<string, ResolveCandidate[]>
}

export function hasResolvedIdentifier(row: Pick<OcrReviewRow, 'resolvedName' | 'resolvedTicker' | 'resolvedCode'>) {
  return Boolean(row.resolvedName?.trim() || row.resolvedTicker?.trim() || row.resolvedCode?.trim())
}

export function toReviewRow(row: OcrSourceRow): OcrReviewRow {
  return {
    ...row,
    raw: {
      name: row.name,
      quantity: row.quantity,
      profitRate: row.profitRate,
      evaluationAmount: row.evaluationAmount,
      averagePrice: row.averagePrice,
      code: row.code,
      ticker: row.ticker,
    },
    sourceFileName: row.fileName,
    sourceUploadId: row.uploadId,
    resolutionState: hasResolvedIdentifier(row) ? 'resolved' : 'unresolved',
    selectedCandidateId: null,
  }
}

export function applyReviewCandidate(row: OcrReviewRow, candidate?: ResolveCandidate) {
  if (!candidate) {
    return row
  }

  return {
    ...row,
    resolvedName: candidate.resolvedName,
    resolvedCode: candidate.resolvedCode ?? row.resolvedCode,
    resolvedTicker: candidate.resolvedTicker ?? row.resolvedTicker,
    resolvedMarket: candidate.resolvedMarket ?? row.resolvedMarket,
    resolvedMarketTone: candidate.resolvedMarketTone ?? row.resolvedMarketTone,
    resolvedKind: candidate.resolvedKind ?? row.resolvedKind,
  }
}

export function mergeResolvedRowsWithExistingReviewRows(
  resolvedRows: OcrSourceRow[],
  existingRows: OcrReviewRow[],
  existingCandidatesByRowId: Record<string, ResolveCandidate[]>,
) {
  const existingRowsById = new Map(existingRows.map((row) => [row.id, row]))
  const nextRows = resolvedRows.map((row) => existingRowsById.get(row.id) ?? toReviewRow(row))
  const nextRowIds = new Set(nextRows.map((row) => row.id))
  const nextCandidatesByRowId = Object.fromEntries(
    Object.entries(existingCandidatesByRowId).filter(([rowId]) => nextRowIds.has(rowId)),
  )

  return {
    rows: nextRows,
    candidatesByRowId: nextCandidatesByRowId,
  }
}

export function getRowsNeedingInstrumentResolution(
  resolvedRows: OcrSourceRow[],
  mergedRows: OcrReviewRow[],
  candidatesByRowId: Record<string, ResolveCandidate[]>,
) {
  const mergedRowsById = new Map(mergedRows.map((row) => [row.id, row]))

  return resolvedRows.filter((row) => {
    if (candidatesByRowId[row.id]) {
      return false
    }

    return mergedRowsById.get(row.id)?.resolutionState === 'unresolved'
  })
}

export function applyInstrumentResolutionResult(
  mergedRows: OcrReviewRow[],
  result: ResolvedInstrumentRowsResult,
  existingCandidatesByRowId: Record<string, ResolveCandidate[]>,
) {
  const resolvedRowsById = new Map(result.rows.map((row) => [row.id, row]))

  return mergedRows.map((row) => {
    const resolvedRow = resolvedRowsById.get(row.id)
    const candidates = result.candidatesByRowId[row.id] ?? existingCandidatesByRowId[row.id] ?? []
    const firstCandidate = candidates[0]
    const baseRow = resolvedRow ? toReviewRow(resolvedRow) : row
    const autoAppliedRow = hasResolvedIdentifier(baseRow) ? baseRow : applyReviewCandidate(baseRow, firstCandidate)
    const selectedCandidateId = !hasResolvedIdentifier(baseRow) && firstCandidate ? firstCandidate.id : row.selectedCandidateId ?? null
    const needsManualResolution = !hasResolvedIdentifier(autoAppliedRow)

    return {
      ...autoAppliedRow,
      selectedCandidateId,
      resolutionState: needsManualResolution ? 'manual-required' : 'resolved',
    } satisfies OcrReviewRow
  })
}

export function applyInstrumentResolutionFailure(mergedRows: OcrReviewRow[]) {
  return mergedRows.map((row) => ({
    ...row,
    resolutionState: hasResolvedIdentifier(row) ? 'resolved' : 'manual-required',
  }) satisfies OcrReviewRow)
}
