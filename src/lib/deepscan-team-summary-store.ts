// 팀 요약 영속화 저장 로직(2026-11-13, 캐시 로드 LLM 비용 제로화) — 순수 함수만 담는다.
// - 런 시점: 로딩 화면이 /api/deepscan/team-summary에서 받은 3개 팀 최종 문장을
//   /api/deepscan/team-summaries-persist로 돌려보내면 이 모듈의 병합 로직을 거쳐
//   스냅샷/기록 payload의 teamSummaries에 저장된다.
// - 재방문(캐시 로드): 저장된 문장을 inputKey(요약 입력 본문 해시)가 같은 요청에만
//   씨드한다 — 씨드된 팀은 fetch를 발사하지 않는다(LLM 호출 0).
// - 구형 스냅샷(필드 없음): 씨드가 없어 기존대로 1회 생성 → 그 결과가 다시 저장되어
//   이후 재방문은 0회로 수렴한다.
// 서버·클라이언트 양쪽에서 쓰므로 React·Next 전용 import 금지.

import type { JarooDeepScanPayload, JarooDeepScanTeamSummaryEntry } from '../../packages/contracts/src/deepscan'

export const TEAM_SUMMARY_STAGE_KEYS = ['marketTeam', 'contextTeam', 'fundamentalTeam'] as const
export type TeamSummaryStageKey = (typeof TEAM_SUMMARY_STAGE_KEYS)[number]

const INPUT_KEY_PATTERN = /^\d+:\d+$/
const SUMMARY_MIN_CHARS = 20
const SUMMARY_MAX_CHARS = 1200
const MAX_ENTRIES_PER_MERGE = 3

export type SanitizedTeamSummaryEntry = {
  teamKey: TeamSummaryStageKey
  inputKey: string
  summary: string
  model?: string
  provider?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxChars) return null
  return trimmed
}

/** 저장 가능한 팀 요약 엔트리만 남긴다 — 라우트 persist 입구에서 1차 방어. */
export function sanitizeTeamSummaryEntries(raw: unknown): SanitizedTeamSummaryEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: SanitizedTeamSummaryEntry[] = []

  for (const item of raw.slice(0, MAX_ENTRIES_PER_MERGE)) {
    const record = asRecord(item)
    if (!record) continue

    const teamKey = typeof record.teamKey === 'string' && (TEAM_SUMMARY_STAGE_KEYS as readonly string[]).includes(record.teamKey)
      ? (record.teamKey as TeamSummaryStageKey)
      : null
    const inputKey = typeof record.inputKey === 'string' && INPUT_KEY_PATTERN.test(record.inputKey) ? record.inputKey : null
    const summary = normalizeText(record.summary, SUMMARY_MAX_CHARS)
    if (!teamKey || !inputKey || !summary || summary.length < SUMMARY_MIN_CHARS) continue

    const model = normalizeText(record.model, 120)
    const provider = normalizeText(record.provider, 120)
    entries.push({ teamKey, inputKey, summary, ...(model ? { model } : {}), ...(provider ? { provider } : {}) })
  }

  // 팀당 1개 — 같은 teamKey가 여러 번 오면 첫 번째만 인정한다.
  const seen = new Set<TeamSummaryStageKey>()
  return entries.filter((entry) => {
    if (seen.has(entry.teamKey)) return false
    seen.add(entry.teamKey)
    return true
  })
}

/** 페이로드에 팀 요약을 병합해 새 페이로드를 반환 — 유효 엔트리가 없으면 null(저장 스킵). */
export function mergeTeamSummariesIntoPayload(
  payload: JarooDeepScanPayload,
  entries: SanitizedTeamSummaryEntry[],
): JarooDeepScanPayload | null {
  if (!entries.length) return null

  const next: Record<string, JarooDeepScanTeamSummaryEntry> = { ...(payload.teamSummaries ?? {}) }
  let merged = 0
  for (const entry of entries) {
    const existing = next[entry.teamKey]
    // 이미 같은 입력의 문장이 저장돼 있으면 덮어쓰지 않는다(첫 저장 우선 — 멱등).
    if (existing?.inputKey === entry.inputKey && existing.summary === entry.summary) continue
    next[entry.teamKey] = {
      inputKey: entry.inputKey,
      summary: entry.summary,
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.provider ? { provider: entry.provider } : {}),
      generatedAt: new Date().toISOString(),
    }
    merged += 1
  }

  if (!merged) return null
  return { ...payload, teamSummaries: next }
}

/**
 * 재방문 씨드 추출 — 저장된 요약 중 요청(팀+inputKey)이 정확히 일치하는 것만 돌려준다.
 * 본문이 바뀌어 inputKey가 다르면 미스 → 기존대로 1회 재생성(안전 폴백).
 */
export function pickSeededTeamSummaries(
  stored: unknown,
  requests: ReadonlyArray<{ teamKey: string; inputKey: string }>,
): Record<string, JarooDeepScanTeamSummaryEntry> {
  const record = asRecord(stored)
  if (!record) return {}

  const seeded: Record<string, JarooDeepScanTeamSummaryEntry> = {}
  for (const request of requests) {
    const entry = asRecord(record[request.teamKey])
    const inputKey = typeof entry?.inputKey === 'string' ? entry.inputKey : null
    const summary = normalizeText(entry?.summary, SUMMARY_MAX_CHARS)
    if (!entry || inputKey !== request.inputKey || !summary || summary.length < SUMMARY_MIN_CHARS) continue
    seeded[request.teamKey] = { ...entry, inputKey, summary } as JarooDeepScanTeamSummaryEntry
  }
  return seeded
}
