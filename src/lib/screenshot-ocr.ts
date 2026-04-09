export const SCREENSHOT_OCR_STORAGE_KEY = 'jaroo:screenshot-ocr-upload'
export const OCR_MERGE_RESULT_STORAGE_KEY = 'jaroo:screenshot-ocr-merge-result'
export const MAX_SCREENSHOT_UPLOADS = 5

export type OcrRow = {
  name: string
  quantity: string
  profitRate: string
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

export function sanitizeOcrRows(input: unknown): OcrRow[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      quantity: typeof item.quantity === 'string' ? item.quantity.trim() : '',
      profitRate: typeof item.profitRate === 'string' ? item.profitRate.trim() : '',
    }))
    .filter((item) => item.name.length > 0 || item.quantity.length > 0 || item.profitRate.length > 0)
}

export function normalizeStockName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function normalizeComparableValue(value: string) {
  return value.trim().replace(/[−–—]/g, '-').replace(/\s+/g, '').replace(/,/g, '').replace(/^\+/, '')
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
      const variantKey = `${normalizeComparableValue(row.quantity)}::${normalizeComparableValue(row.profitRate)}`

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
