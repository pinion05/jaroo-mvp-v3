import { NextResponse, type NextRequest } from 'next/server'

import { HISTORY_RETENTION_PER_USER, listScanHistory } from '@/lib/deepscan-history-store'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DEFAULT_HISTORY_LIMIT = 20
export const MAX_HISTORY_LIMIT = 50

/** 목록 요청 limit 정규화 — 기본 20, 상한 50(보존 한도 30 이상은 여유). */
export function normalizeHistoryLimit(raw: string | null): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HISTORY_LIMIT
  return Math.min(parsed, MAX_HISTORY_LIMIT)
}

export async function GET(request: NextRequest) {
  const auth = await resolveApiUserId('deepscan-history')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const limit = normalizeHistoryLimit(request.nextUrl.searchParams.get('limit'))
  const rows = await listScanHistory(auth.userId, limit)
  if (rows == null) {
    return NextResponse.json({ error: 'history-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }

  return NextResponse.json(
    { rows, limit, retention: HISTORY_RETENTION_PER_USER },
    { headers: NO_STORE_PRIVATE_HEADERS },
  )
}
