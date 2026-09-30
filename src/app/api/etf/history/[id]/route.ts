import { NextResponse } from 'next/server'

import { getEtfHistoryById } from '@/lib/etf-history-store'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 기록 단건(id) 조회 — uuid가 아니거나 본인 소유가 아니면 404(존재 추론 방지). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUserId('etf-history-detail')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const { id } = await params
  const row = await getEtfHistoryById(auth.userId, String(id ?? ''))
  if (!row) {
    return NextResponse.json({ error: 'not-found' }, { status: 404, headers: NO_STORE_PRIVATE_HEADERS })
  }

  return NextResponse.json({ row }, { headers: NO_STORE_PRIVATE_HEADERS })
}
