import { NextResponse } from 'next/server'

import { enrichOcrRowsWithInstrumentInfo } from '@/lib/holding-instrument-lookup'
import { sanitizeOcrRows } from '@/lib/screenshot-ocr'
import { enrichOcrRowsViaTickerMap } from '@/lib/ticker-map-resolver'

type ResolveInstrumentsRequest = {
  rows?: unknown
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as ResolveInstrumentsRequest | null
  const rows = sanitizeOcrRows(payload?.rows)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'At least one OCR row is required.' }, { status: 400 })
  }

  const tickerMapResolvedRows = await enrichOcrRowsViaTickerMap(rows)

  return NextResponse.json({ rows: enrichOcrRowsWithInstrumentInfo(tickerMapResolvedRows) })
}
