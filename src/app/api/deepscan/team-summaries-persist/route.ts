import { NextResponse } from 'next/server'

import { isCanonicalPayload } from '@/lib/deepscan-canonical'
import { updateLatestScanHistoryPayload } from '@/lib/deepscan-history-store'
import { resolveDeepScanSnapshotKey } from '@/lib/deepscan-snapshot-policy'
import { lookupDeepScanSnapshot, updateSnapshotCommitteePayload } from '@/lib/deepscan-snapshot-store'
import { mergeTeamSummariesIntoPayload, sanitizeTeamSummaryEntries } from '@/lib/deepscan-team-summary-store'
import type { JarooDeepScanPayload } from '../../../../../packages/contracts/src/deepscan'

export const runtime = 'nodejs'

/**
 * 팀 요약 영속화(2026-11-13, 캐시 로드 LLM 비용 제로화) — 런 중 로딩 화면이 이미 받은
 * 3개 팀 최종 문장을 스냅샷/기록 payload의 teamSummaries에 병합 저장한다.
 * 이후 재방문(캐시 로드)은 저장 문장을 그대로 씨드해 /api/deepscan/team-summary 발사 0회.
 * 멱등: 같은 입력·같은 문장이 이미 저장돼 있으면 저장하지 않는다.
 */
export type TeamSummariesPersistDeps = {
  resolveUserId: () => Promise<string | null>
  lookupSnapshot: (userId: string, targetKey: string) => Promise<{ payload: JarooDeepScanPayload } | null>
  updateSnapshot: (userId: string, targetKey: string, payload: JarooDeepScanPayload) => Promise<boolean>
  updateHistory: (userId: string, targetKey: string, payload: JarooDeepScanPayload) => Promise<boolean>
}

type PersistRequestBody = {
  code?: unknown
  ticker?: unknown
  summaries?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function createTeamSummariesPersistResponse(body: PersistRequestBody, deps: TeamSummariesPersistDeps) {
  const record = asRecord(body)
  const targetKey = resolveDeepScanSnapshotKey({
    code: normalizeText(record?.code),
    ticker: normalizeText(record?.ticker),
  })
  const entries = sanitizeTeamSummaryEntries(record?.summaries)

  if (!targetKey) {
    return NextResponse.json({ ok: false, error: { message: 'code or ticker is required.' } }, { status: 400 })
  }
  if (!entries.length) {
    return NextResponse.json({ ok: false, error: { message: 'no valid summaries.' } }, { status: 400 })
  }

  const userId = await deps.resolveUserId()
  if (!userId) {
    return NextResponse.json({ ok: false, error: { message: 'unauthorized' } }, { status: 401 })
  }

  const snapshot = await deps.lookupSnapshot(userId, targetKey)
  if (!snapshot?.payload || !isCanonicalPayload(snapshot.payload)) {
    // 런 직후 스냅샷이 아직 없는 시점 등 — 저장할 곳이 없으면 조용히 포기(다음 방문 재시도).
    return NextResponse.json({ ok: false, error: { message: 'snapshot not found.' } }, { status: 404 })
  }

  const merged = mergeTeamSummariesIntoPayload(snapshot.payload, entries)
  if (!merged) {
    return NextResponse.json({ ok: true, persisted: 0, saved: false, reason: 'already-stored' })
  }
  if (!isCanonicalPayload(merged)) {
    return NextResponse.json({ ok: false, error: { message: 'merged payload is not canonical.' } }, { status: 500 })
  }

  const saved = await deps.updateSnapshot(userId, targetKey, merged)
  const historySaved = await deps.updateHistory(userId, targetKey, merged)

  if (!saved) {
    return NextResponse.json({ ok: false, error: { message: 'snapshot update failed.' } }, { status: 500 })
  }
  console.log(`[team-summaries-persist] ok { targetKey: '${targetKey}', entries: ${entries.length}, history: ${historySaved} }`)
  return NextResponse.json({ ok: true, persisted: entries.length, saved, historySaved })
}

export async function POST(request: Request) {
  // 서버 LLM 키 비용 보호 — team-summary 라우트와 동일한 로그인 게이트.
  const { resolveApiUserId } = await import('@/lib/supabase/api-auth')
  const auth = await resolveApiUserId('deepscan-team-summaries-persist')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ ok: false, error: { message: 'auth-unavailable' } }, { status: 503 })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ ok: false, error: { message: 'unauthorized' } }, { status: 401 })
  }
  const userId = auth.status === 'authenticated' ? auth.userId : null

  const body = await request.json().catch(() => null) as PersistRequestBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: { message: 'invalid JSON body' } }, { status: 400 })
  }

  return createTeamSummariesPersistResponse(body, {
    resolveUserId: async () => userId,
    lookupSnapshot: (resolvedUserId, targetKey) => lookupDeepScanSnapshot(resolvedUserId, targetKey),
    updateSnapshot: (resolvedUserId, targetKey, payload) => updateSnapshotCommitteePayload(resolvedUserId, targetKey, payload),
    updateHistory: (resolvedUserId, targetKey, payload) => updateLatestScanHistoryPayload(resolvedUserId, targetKey, payload),
  })
}
