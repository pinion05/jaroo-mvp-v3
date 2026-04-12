import { NextResponse } from 'next/server'

import { enrichOcrRowsWithInstrumentInfo } from '@/lib/holding-instrument-lookup'
import { sanitizeOcrRows, type OcrRow } from '@/lib/screenshot-ocr'
import { enrichOcrRowsViaTickerMap } from '@/lib/ticker-map-resolver'

type ResolveInstrumentsRequest = {
  rows?: unknown
}

export const MAX_RESOLVE_ROWS = 100
export const MAX_RESOLVE_NAME_LENGTH = 200

export function getResolveRowsValidationError(rows: OcrRow[]) {
  if (rows.length === 0) {
    return 'At least one OCR row is required.'
  }

  if (rows.length > MAX_RESOLVE_ROWS) {
    return `Too many OCR rows. Up to ${MAX_RESOLVE_ROWS} rows are supported per request.`
  }

  const hasTooLongName = rows.some((row) => row.name.length > MAX_RESOLVE_NAME_LENGTH)
  if (hasTooLongName) {
    return `OCR row names must be ${MAX_RESOLVE_NAME_LENGTH} characters or fewer.`
  }

  return ''
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as ResolveInstrumentsRequest | null
  const rows = sanitizeOcrRows(payload?.rows)
  const validationError = getResolveRowsValidationError(rows)

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const tickerMapResolvedRows = await enrichOcrRowsViaTickerMap(rows)

  return NextResponse.json({ rows: enrichOcrRowsWithInstrumentInfo(tickerMapResolvedRows) })
}
