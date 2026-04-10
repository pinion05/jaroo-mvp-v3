import { NextResponse } from 'next/server'

import { enrichOcrRowsWithInstrumentInfo } from '@/lib/holding-instrument-lookup'
import { sanitizeOcrRows } from '@/lib/screenshot-ocr'

type ResolveInstrumentsRequest = {
  rows?: unknown
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as ResolveInstrumentsRequest | null
  const rows = sanitizeOcrRows(payload?.rows)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'At least one OCR row is required.' }, { status: 400 })
  }

  return NextResponse.json({ rows: enrichOcrRowsWithInstrumentInfo(rows) })
}
