export const SCREENSHOT_OCR_STORAGE_KEY = 'jaroo:screenshot-ocr-upload'
export const OCR_MERGE_RESULT_STORAGE_KEY = 'jaroo:screenshot-ocr-merge-result'
export const MAX_SCREENSHOT_UPLOADS = 5

export type OcrRow = {
  name: string
  quantity: string
  profitAmount?: string
  profitRate: string
  evaluationAmount: string
  averagePrice: string
  resolvedName?: string
  resolvedCode?: string
  resolvedTicker?: string
  resolvedMarket?: string
  resolvedMarketTone?: 'kospi' | 'kosdaq' | 'nasdaq' | 'etf'
  resolvedKind?: 'stock' | 'etf'
  code?: string
  ticker?: string
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

function sanitizeScreenshotUploadSession(value: unknown): ScreenshotUploadSession | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<ScreenshotUploadSession>

  if (typeof candidate.broker !== 'string' || !Array.isArray(candidate.uploads)) {
    return null
  }

  const uploads = candidate.uploads.flatMap((upload) => {
    if (!upload || typeof upload !== 'object') {
      return []
    }

    const candidateUpload = upload as Partial<ScreenshotUploadImage>

    if (
      typeof candidateUpload.id !== 'string'
      || typeof candidateUpload.fileName !== 'string'
      || typeof candidateUpload.imageDataUrl !== 'string'
      || !candidateUpload.imageDataUrl.startsWith('data:image/')
    ) {
      return []
    }

    return [{
      id: candidateUpload.id,
      fileName: candidateUpload.fileName,
      imageDataUrl: candidateUpload.imageDataUrl,
    }]
  })

  if (uploads.length === 0 || uploads.length !== candidate.uploads.length || uploads.length > MAX_SCREENSHOT_UPLOADS) {
    return null
  }

  return {
    broker: candidate.broker,
    uploads,
  }
}

export function persistScreenshotUploadSession(session: ScreenshotUploadSession) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(SCREENSHOT_OCR_STORAGE_KEY, JSON.stringify(session))
}

export function readPersistedScreenshotUploadSession() {
  if (typeof window === 'undefined') {
    return null
  }

  const rawSession = window.sessionStorage.getItem(SCREENSHOT_OCR_STORAGE_KEY)

  if (!rawSession) {
    return null
  }

  try {
    return sanitizeScreenshotUploadSession(JSON.parse(rawSession))
  } catch {
    return null
  }
}

export function clearPersistedScreenshotUploadSession() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(SCREENSHOT_OCR_STORAGE_KEY)
}

export type OcrSourceRow = OcrRow & {
  id: string
  uploadId: string
  fileName: string
  uploadIndex: number
  rowIndex: number
  normalizedName: string
}

export type OcrInstrumentCandidate = {
  id: string
  resolvedName: string
  resolvedCode?: string
  resolvedTicker?: string
  resolvedMarket?: string
  resolvedMarketTone?: OcrRow['resolvedMarketTone']
  resolvedKind?: OcrRow['resolvedKind']
  source: 'ticker-map' | 'local'
  score?: number
  via?: string
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

const OCR_PERCENT_TEXT_PATTERN = /([+-]?)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*%/g
const OCR_SIGNED_AMOUNT_PATTERN = /([+-])\s*[₩$€¥£]?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)/g

export function normalizeOcrProfitAmount(value: string, combinedProfitText = '') {
  const candidates = [value, combinedProfitText]
    .map((candidate) => candidate.trim().replace(/[−–—]/g, '-'))
    .filter(Boolean)

  for (const candidate of candidates) {
    for (const match of candidate.matchAll(OCR_SIGNED_AMOUNT_PATTERN)) {
      const matchEnd = (match.index ?? 0) + match[0].length
      if (/^\s*%/.test(candidate.slice(matchEnd))) {
        continue
      }

      const numericText = match[2]?.replaceAll(',', '')
      const numericValue = Number(numericText)
      if (numericText && Number.isFinite(numericValue)) {
        return `${match[1]}${numericText}`
      }
    }

    const zeroAmountMatch = candidate.match(/^[₩$€¥£]?\s*0(?:\.0+)?\s*(?:원|krw|usd)?$/i)
    if (zeroAmountMatch) {
      return '0'
    }
  }

  return ''
}

export function normalizeOcrProfitRate(value: string, profitAmount = '') {
  const normalizedValue = value.trim().replace(/[−–—]/g, '-')

  if (!normalizedValue) {
    return ''
  }

  const percentMatches = [...normalizedValue.matchAll(OCR_PERCENT_TEXT_PATTERN)]
  const selectedMatch = percentMatches.at(-1)
  if (!selectedMatch) {
    return normalizedValue
  }

  const explicitSign = selectedMatch[1] ?? ''
  const rateNumber = (selectedMatch[2] ?? '').replaceAll(',', '')
  const normalizedProfitAmount = normalizeOcrProfitAmount(profitAmount)
    || normalizeOcrProfitAmount('', normalizedValue)
  const parsedProfitAmount = parseOcrNumber(normalizedProfitAmount)
  const isWrappedAccountingNegative = /^\(\s*[+-]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%\s*\)$/.test(normalizedValue)
  let sign = explicitSign

  if (parsedProfitAmount !== null && parsedProfitAmount !== 0) {
    sign = parsedProfitAmount < 0 ? '-' : '+'
  } else if (!sign && isWrappedAccountingNegative) {
    sign = '-'
  }

  return `${sign}${rateNumber}%`
}

export function parseOcrProfitRate(value: string) {
  const normalizedValue = normalizeOcrProfitRate(value)

  if (!normalizedValue) {
    return null
  }

  const percentMatch = normalizedValue.match(/([+-]?(?:\d+(?:[,.]\d+)*\.?\d*|\.\d+))\s*%/)
  if (percentMatch?.[1]) {
    const parsedPercent = Number(percentMatch[1].replaceAll(',', ''))
    return Number.isFinite(parsedPercent) ? parsedPercent : null
  }

  return parseOcrNumber(value)
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

export function computeAveragePrice(
  quantity: string,
  profitRate: string,
  evaluationAmount: string,
  profitAmount = '',
) {
  const parsedQuantity = parseOcrNumber(quantity)
  const parsedEvaluationAmount = parseOcrNumber(evaluationAmount)

  if (parsedQuantity === null || parsedEvaluationAmount === null || parsedQuantity === 0) {
    return ''
  }

  const parsedProfitAmount = parseOcrNumber(profitAmount)
  if (parsedProfitAmount !== null) {
    const principalFromAmount = parsedEvaluationAmount - parsedProfitAmount
    if (Number.isFinite(principalFromAmount) && principalFromAmount > 0) {
      return formatComputedNumber(principalFromAmount / parsedQuantity)
    }
  }

  const parsedProfitRate = parseOcrProfitRate(profitRate)
  if (parsedProfitRate === null) {
    return ''
  }

  const principalDivisor = 1 + (parsedProfitRate / 100)
  if (!Number.isFinite(principalDivisor) || principalDivisor <= 0) {
    return ''
  }

  const averagePrice = (parsedEvaluationAmount / principalDivisor) / parsedQuantity
  return Number.isFinite(averagePrice) && averagePrice > 0 ? formatComputedNumber(averagePrice) : ''
}

export function isAveragePriceComputedFromEvaluation(
  quantity: string,
  profitRate: string,
  evaluationAmount: string,
  averagePrice: string,
  profitAmount = '',
) {
  const parsedAveragePrice = parseOcrNumber(averagePrice)
  const expectedAveragePrice = parseOcrNumber(
    computeAveragePrice(quantity, profitRate, evaluationAmount, profitAmount),
  )

  if (parsedAveragePrice === null || expectedAveragePrice === null || expectedAveragePrice <= 0) {
    return false
  }

  const absoluteDistance = Math.abs(parsedAveragePrice - expectedAveragePrice)
  const relativeDistance = absoluteDistance / Math.max(Math.abs(expectedAveragePrice), 1)

  return absoluteDistance <= 1 || relativeDistance <= 0.02
}

function normalizeInstrumentCode(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().replace(/\s+/g, '').toUpperCase()
  return normalized.length > 0 ? normalized : undefined
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
      const rawProfitRate = typeof item.profitRate === 'string' ? item.profitRate.trim() : ''
      const rawProfitAmount = typeof item.profitAmount === 'string' ? item.profitAmount.trim() : ''
      const profitAmount = normalizeOcrProfitAmount(rawProfitAmount, rawProfitRate)
      const profitRate = normalizeOcrProfitRate(rawProfitRate, profitAmount)
      const evaluationAmount = typeof item.evaluationAmount === 'string' ? item.evaluationAmount.trim() : ''
      const averagePrice = typeof item.averagePrice === 'string' ? item.averagePrice.trim() : ''
      const code = normalizeInstrumentCode(item.code)
      const ticker = normalizeInstrumentCode(item.ticker)
      const resolvedName = typeof item.resolvedName === 'string' ? item.resolvedName.trim() : undefined
      const resolvedCode = normalizeInstrumentCode(item.resolvedCode)
      const resolvedTicker = normalizeInstrumentCode(item.resolvedTicker)
      const resolvedMarket = typeof item.resolvedMarket === 'string' ? item.resolvedMarket.trim() : undefined
      const resolvedMarketTone: OcrRow['resolvedMarketTone'] =
        item.resolvedMarketTone === 'kospi' || item.resolvedMarketTone === 'kosdaq' || item.resolvedMarketTone === 'nasdaq' || item.resolvedMarketTone === 'etf'
          ? item.resolvedMarketTone
          : undefined
      const resolvedKind: OcrRow['resolvedKind'] = item.resolvedKind === 'stock' || item.resolvedKind === 'etf' ? item.resolvedKind : undefined

      return {
        name,
        quantity,
        profitAmount,
        profitRate,
        evaluationAmount,
        averagePrice: averagePrice || computeAveragePrice(quantity, profitRate, evaluationAmount, profitAmount),
        code,
        ticker,
        resolvedName,
        resolvedCode,
        resolvedTicker,
        resolvedMarket,
        resolvedMarketTone,
        resolvedKind,
      }
    })
    .filter((item) => item.name.length > 0 || item.quantity.length > 0 || Boolean(item.profitAmount) || item.profitRate.length > 0 || item.evaluationAmount.length > 0)
}

export function sanitizeOcrInstrumentCandidates(input: unknown): OcrInstrumentCandidate[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .reduce<OcrInstrumentCandidate[]>((candidates, item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const resolvedName = typeof item.resolvedName === 'string' ? item.resolvedName.trim() : ''
      const source = item.source === 'local' ? 'local' : item.source === 'ticker-map' ? 'ticker-map' : null

      if (!id || !resolvedName || !source) {
        return candidates
      }

      const resolvedCode = normalizeInstrumentCode(item.resolvedCode)
      const resolvedTicker = normalizeInstrumentCode(item.resolvedTicker)
      const resolvedMarket = typeof item.resolvedMarket === 'string' ? item.resolvedMarket.trim() : undefined
      const resolvedMarketTone: OcrRow['resolvedMarketTone'] =
        item.resolvedMarketTone === 'kospi' || item.resolvedMarketTone === 'kosdaq' || item.resolvedMarketTone === 'nasdaq' || item.resolvedMarketTone === 'etf'
          ? item.resolvedMarketTone
          : undefined
      const resolvedKind: OcrRow['resolvedKind'] = item.resolvedKind === 'stock' || item.resolvedKind === 'etf' ? item.resolvedKind : undefined
      const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : undefined
      const via = typeof item.via === 'string' ? item.via.trim() : undefined

      candidates.push({
        id,
        resolvedName,
        resolvedCode,
        resolvedTicker,
        resolvedMarket,
        resolvedMarketTone,
        resolvedKind,
        source,
        score,
        via,
      })

      return candidates
    }, [])
}

export function sanitizeOcrInstrumentCandidateLists(input: unknown): OcrInstrumentCandidate[][] {
  if (!Array.isArray(input)) {
    return []
  }

  return input.map((item) => sanitizeOcrInstrumentCandidates(item))
}

export function normalizeStockName(name: string) {
  return name
    .trim()
    .replace(/^[\s#★☆▶▷◀◁▸•·*_\-=+[\\\](){}<>~!|"'“”‘’.,;:]+|[\s#★☆▶▷◀◁▸•·*_\-=+[\\\](){}<>~!|"'“”‘’.,;:]+$/g, '')
    .replace(/#/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
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
