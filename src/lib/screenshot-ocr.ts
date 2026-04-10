export const SCREENSHOT_OCR_STORAGE_KEY = 'jaroo:screenshot-ocr-upload'
export const OCR_MERGE_RESULT_STORAGE_KEY = 'jaroo:screenshot-ocr-merge-result'
export const MAX_SCREENSHOT_UPLOADS = 5

export type OcrRow = {
  name: string
  quantity: string
  profitRate: string
  evaluationAmount: string
  averagePrice: string
  resolvedName?: string
  resolvedCode?: string
  resolvedTicker?: string
  resolvedMarket?: string
  resolvedMarketTone?: 'kospi' | 'kosdaq' | 'nasdaq' | 'etf'
  resolvedKind?: 'stock' | 'etf'
}

export type ScreenshotUploadImage = {
  id: string
  fileName: string
  imageDataUrl: string
}

export type ScreenshotUploadSession = {
  broker: string
  uploads: ScreenshotUploadImage[]
}

export type OcrSourceRow = OcrRow & {
  id: string
  uploadId: string
  fileName: string
  uploadIndex: number
  rowIndex: number
  normalizedName: string
}

export type OcrConflict = {
  key: string
  displayName: string
  candidates: OcrSourceRow[]
}

export type OcrMergeResult = {
  mergedRows: OcrSourceRow[]
  conflicts: OcrConflict[]
}

const OCR_NUMBER_TEXT_PATTERN = /(shares?|share|stocks?|stock|주|원|krw|usd|eur|jpy|cny|aud|cad|hkd)/gi

export function parseOcrNumber(value: string) {
  const normalizedValue = value.trim().replace(/[−–—]/g, '-')

  if (!normalizedValue) {
    return null
  }

  const wrappedNegativeMatch = normalizedValue.match(/^\((.*)\)$/)
  const isWrappedNegative = Boolean(wrappedNegativeMatch)
  const unwrappedValue = wrappedNegativeMatch?.[1] ?? normalizedValue
  const cleanedValue = unwrappedValue
    .replaceAll(',', '')
    .replace(/\s+/g, '')
    .replace(/[₩$€¥£%]/g, '')
    .replace(OCR_NUMBER_TEXT_PATTERN, '')

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleanedValue)) {
    return null
  }

  const parsedValue = Number(cleanedValue)

  if (!Number.isFinite(parsedValue)) {
    return null
  }

  return isWrappedNegative ? -Math.abs(parsedValue) : parsedValue
}

export function formatComputedNumber(value: number) {
  const roundedValue = Number(value.toFixed(4))

  if (!Number.isFinite(roundedValue)) {
    return ''
  }

  return roundedValue.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })
}

export function computeAveragePrice(quantity: string, profitRate: string, evaluationAmount: string) {
  const parsedQuantity = parseOcrNumber(quantity)
  const parsedProfitRate = parseOcrNumber(profitRate)
  const parsedEvaluationAmount = parseOcrNumber(evaluationAmount)

  if (parsedQuantity === null || parsedProfitRate === null || parsedEvaluationAmount === null || parsedQuantity === 0) {
    return ''
  }

  const profitRateDecimal = parsedProfitRate / 100
  const principalDivisor = 1 + profitRateDecimal

  if (!Number.isFinite(principalDivisor) || principalDivisor === 0) {
    return ''
  }

  const principal = parsedEvaluationAmount / principalDivisor
  const averagePrice = principal / parsedQuantity

  if (!Number.isFinite(averagePrice)) {
    return ''
  }

  return formatComputedNumber(averagePrice)
}

export function sanitizeOcrRows(input: unknown): OcrRow[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const quantity = typeof item.quantity === 'string' ? item.quantity.trim() : ''
      const profitRate = typeof item.profitRate === 'string' ? item.profitRate.trim() : ''
      const evaluationAmount = typeof item.evaluationAmount === 'string' ? item.evaluationAmount.trim() : ''
      const averagePrice = typeof item.averagePrice === 'string' ? item.averagePrice.trim() : ''
      const resolvedName = typeof item.resolvedName === 'string' ? item.resolvedName.trim() : undefined
      const resolvedCode = typeof item.resolvedCode === 'string' ? item.resolvedCode.trim() : undefined
      const resolvedTicker = typeof item.resolvedTicker === 'string' ? item.resolvedTicker.trim().toUpperCase() : undefined
      const resolvedMarket = typeof item.resolvedMarket === 'string' ? item.resolvedMarket.trim() : undefined
      const resolvedMarketTone: OcrRow['resolvedMarketTone'] =
        item.resolvedMarketTone === 'kospi' || item.resolvedMarketTone === 'kosdaq' || item.resolvedMarketTone === 'nasdaq' || item.resolvedMarketTone === 'etf'
          ? item.resolvedMarketTone
          : undefined
      const resolvedKind: OcrRow['resolvedKind'] = item.resolvedKind === 'stock' || item.resolvedKind === 'etf' ? item.resolvedKind : undefined

      return {
        name,
        quantity,
        profitRate,
        evaluationAmount,
        averagePrice: averagePrice || computeAveragePrice(quantity, profitRate, evaluationAmount),
        resolvedName,
        resolvedCode,
        resolvedTicker,
        resolvedMarket,
        resolvedMarketTone,
        resolvedKind,
      }
    })
    .filter((item) => item.name.length > 0 || item.quantity.length > 0 || item.profitRate.length > 0 || item.evaluationAmount.length > 0)
}

export function normalizeStockName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function normalizeComparableValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/^\+/, '')
    .replace(/[₩$€¥£%]/g, '')
    .replace(OCR_NUMBER_TEXT_PATTERN, '')
}

export function buildOcrSourceRows(uploads: ScreenshotUploadImage[], rowsByUpload: Record<string, OcrRow[]>) {
  return uploads.flatMap((upload, uploadIndex) => {
    const rows = rowsByUpload[upload.id] ?? []

    return rows.map((row, rowIndex) => ({
      ...row,
      id: `${upload.id}:${rowIndex}`,
      uploadId: upload.id,
      fileName: upload.fileName,
      uploadIndex,
      rowIndex,
      normalizedName: normalizeStockName(row.name),
    }))
  })
}

export function buildMergedOcrResult(rows: OcrSourceRow[]): OcrMergeResult {
  const groupedRows = new Map<string, OcrSourceRow[]>()

  rows.forEach((row) => {
    const key = row.normalizedName || `${row.uploadId}:${row.rowIndex}`
    const group = groupedRows.get(key)

    if (group) {
      group.push(row)
      return
    }

    groupedRows.set(key, [row])
  })

  const mergedRows: OcrSourceRow[] = []
  const conflicts: OcrConflict[] = []

  groupedRows.forEach((groupRows, key) => {
    const uniqueCandidates = new Map<string, OcrSourceRow>()

    groupRows.forEach((row) => {
      const variantKey = `${normalizeComparableValue(row.quantity)}::${normalizeComparableValue(row.profitRate)}::${normalizeComparableValue(row.evaluationAmount)}`

      if (!uniqueCandidates.has(variantKey)) {
        uniqueCandidates.set(variantKey, row)
      }
    })

    const candidates = [...uniqueCandidates.values()].sort((left, right) => left.uploadIndex - right.uploadIndex || left.rowIndex - right.rowIndex)

    if (candidates.length <= 1) {
      if (candidates[0]) {
        mergedRows.push(candidates[0])
      }

      return
    }

    conflicts.push({
      key,
      displayName: groupRows.find((row) => row.name.trim())?.name || key,
      candidates,
    })
  })

  mergedRows.sort((left, right) => left.uploadIndex - right.uploadIndex || left.rowIndex - right.rowIndex)
  conflicts.sort((left, right) => {
    const leftFirst = left.candidates[0]
    const rightFirst = right.candidates[0]
    return (leftFirst?.uploadIndex ?? 0) - (rightFirst?.uploadIndex ?? 0) || (leftFirst?.rowIndex ?? 0) - (rightFirst?.rowIndex ?? 0)
  })

  return { mergedRows, conflicts }
}

export function resolveMergedOcrRows(baseRows: OcrSourceRow[], conflicts: OcrConflict[], selections: Record<string, string>) {
  const chosenRows = conflicts
    .map((conflict) => conflict.candidates.find((candidate) => candidate.id === selections[conflict.key]) ?? null)
    .filter((row): row is OcrSourceRow => row !== null)

  return [...baseRows, ...chosenRows].sort((left, right) => left.uploadIndex - right.uploadIndex || left.rowIndex - right.rowIndex)
}
