import type { OcrInstrumentCandidate, OcrSourceRow } from '@/lib/screenshot-ocr'

export type OcrIdentifierResolutionResult = {
  rows: OcrSourceRow[]
  candidatesByRowId: Record<string, OcrInstrumentCandidate[]>
}

type IdentifierLikeRow = Pick<OcrSourceRow, 'resolvedName' | 'resolvedTicker' | 'resolvedCode'>

type ResolveIdentifierRows = (rows: OcrSourceRow[]) => Promise<OcrIdentifierResolutionResult>

type RetryOptions = {
  maxAttempts?: number
  retryDelayMs?: number
  wait?: (delayMs: number) => Promise<void>
}

const DEFAULT_MAX_IDENTIFIER_RESOLUTION_ATTEMPTS = 2
const DEFAULT_IDENTIFIER_RESOLUTION_RETRY_DELAY_MS = 250

export function hasResolvedIdentifier(row: IdentifierLikeRow) {
  return Boolean(row.resolvedName?.trim() || row.resolvedTicker?.trim() || row.resolvedCode?.trim())
}

function waitForRetryDelay(delayMs: number) {
  if (delayMs <= 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

export function shouldRetryEmptyIdentifierResolution(
  requestedRows: OcrSourceRow[],
  result: OcrIdentifierResolutionResult,
) {
  if (requestedRows.length === 0) {
    return false
  }

  const resolvedRowsById = new Map(result.rows.map((row) => [row.id, row]))

  return requestedRows.every((row) => {
    const resolvedRow = resolvedRowsById.get(row.id) ?? row
    const candidates = result.candidatesByRowId[row.id] ?? []

    return !hasResolvedIdentifier(resolvedRow) && candidates.length === 0
  })
}

export async function resolveIdentifierRowsWithRetry(
  rows: OcrSourceRow[],
  resolveRows: ResolveIdentifierRows,
  options: RetryOptions = {},
) {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_IDENTIFIER_RESOLUTION_ATTEMPTS))
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? DEFAULT_IDENTIFIER_RESOLUTION_RETRY_DELAY_MS))
  const wait = options.wait ?? waitForRetryDelay
  let lastResult: OcrIdentifierResolutionResult | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await resolveRows(rows)

    if (!shouldRetryEmptyIdentifierResolution(rows, lastResult) || attempt === maxAttempts) {
      return lastResult
    }

    await wait(retryDelayMs)
  }

  return lastResult ?? { rows, candidatesByRowId: {} }
}
