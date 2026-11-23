// 화이트박스 TC — 팀 요약 영속화 persist 라우트(캐시 로드 LLM 비용 제로화, 2026-11-13)
// 대상: src/app/api/deepscan/team-summaries-persist/route.ts — createTeamSummariesPersistResponse
//
// 의존성 주입: lookupSnapshot·updateSnapshot·updateHistory·resolveUserId를 전부 가짜로
// 갈음한다 — 실제 Supabase·네트워크 사용 없음. 페이로드 픽스처는 canonical 검증
// (isCanonicalPayload)을 통과하는 형태(deepscan-canonical.test.ts와 동일 구조)다.
//
// 검증 계약:
//   TS-PERSIST-1  식별자(code/ticker) 없음 400 · 유효 요약 없음 400 · 미인증 401
//   TS-PERSIST-2  스냅샷 부재 404(런 직후 저장 경합 등 — 조용한 포기)
//   TS-PERSIST-3  정상 — 스냅샷 payload에 teamSummaries 병합 저장 + 최신 기록 갱신
//   TS-PERSIST-4  멱등 — 이미 저장된 문장 재요청은 updateSnapshot 재호출 없이 persisted 0
//   TS-PERSIST-5  스냅샷 업데이트 실패 → 500
//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md §수정 이력

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTeamSummariesPersistResponse, type TeamSummariesPersistDeps } from './route'
import type { JarooDeepScanPayload } from '../../../../../packages/contracts/src/deepscan'

function createCanonicalPayload(): JarooDeepScanPayload {
  return {
    input: {
      instrument: { name: '삼성전자', code: '005930', ticker: '005930.KS', market: 'KR', kind: 'stock' },
      holding: { shares: '10주', averagePrice: '70,000원', evaluationAmount: '750,000원' },
      selectedAt: '2026-11-13T00:00:00.000Z',
      sourceContext: { from: 'holding', sessionKey: 'session-1', appliedAt: '2026-11-13T00:00:00.000Z' },
    },
    hero: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, headline: 'headline', body: 'body', statusText: 'status', score: 7, scoreLabel: '7점', scoreDelta: '+1' },
    committee: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, axes: [] },
    insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: 'insights', items: [], summaryTags: [] },
    strategy: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      weekSignal: 'signal', weekSignalTone: 'positive', weekBadgeText: 'badge', scenarioLabel: 'scenario',
      scenarioProbability: '60%', scenarioPeriod: '약 3개월', scenarioCondition: 'condition',
      currentPriceText: '80,000원', targetPriceText: '90,000원', scenarioDetails: [], otherScenarios: [], otherScenarioTags: [],
    },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, realizedText: 'realized', rows: [] },
    portfolioSimulation: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, beforeScore: 42, afterScore: 45, deltaLabel: '+3p', caption: 'caption' },
    metadata: {
      generatedAt: '2026-11-13T00:00:00.000Z', version: 'test-v1', degraded: false, debugId: 'debug-1',
      inputValidity: { valid: true }, sourceRefs: [],
      blockStatus: { hero: 'ok', committee: 'ok', insights: 'ok', strategy: 'ok', sellNow: 'ok', portfolioSimulation: 'ok' },
    },
  }
}

const SUMMARY = '지금 구간은 평단 대비 손실 구간이라 회복 속도를 먼저 확인해야 해요.'

function createDeps(options: {
  payload?: JarooDeepScanPayload | null
  userId?: string | null
  snapshotResult?: boolean
} = {}): TeamSummariesPersistDeps & {
  calls: { updateSnapshot: Array<{ targetKey: string; payload: JarooDeepScanPayload }>; updateHistory: Array<{ targetKey: string }> }
} {
  const calls = { updateSnapshot: [] as Array<{ targetKey: string; payload: JarooDeepScanPayload }>, updateHistory: [] as Array<{ targetKey: string }> }
  return {
    resolveUserId: async () => (options.userId === undefined ? 'user-1' : options.userId),
    lookupSnapshot: async () => (options.payload === undefined ? { payload: createCanonicalPayload() } : options.payload ? { payload: options.payload } : null),
    updateSnapshot: async (userId, targetKey, payload) => {
      calls.updateSnapshot.push({ targetKey, payload })
      return options.snapshotResult !== false
    },
    updateHistory: async (userId, targetKey) => {
      calls.updateHistory.push({ targetKey })
      return true
    },
    calls,
  }
}

function summaryBody(overrides: Record<string, unknown> = {}) {
  return { code: '005930', summaries: [{ teamKey: 'marketTeam', inputKey: '120:1234', summary: SUMMARY }], ...overrides }
}

test('TS-PERSIST-1: 식별자 없음 400 · 유효 요약 없음 400 · 미인증 401', async () => {
  const deps = createDeps()

  const noIdentity = await createTeamSummariesPersistResponse({ summaries: [{ teamKey: 'marketTeam', inputKey: '1:1', summary: SUMMARY }] }, deps)
  assert.equal(noIdentity.status, 400)

  const noSummaries = await createTeamSummariesPersistResponse(summaryBody({ summaries: [] }), deps)
  assert.equal(noSummaries.status, 400)

  const unauthorized = await createTeamSummariesPersistResponse(summaryBody(), createDeps({ userId: null }))
  assert.equal(unauthorized.status, 401)
  assert.equal(deps.calls.updateSnapshot.length, 0)
})

test('TS-PERSIST-2: 스냅샷 부재(런 직후 경합 등)는 404로 조용히 포기', async () => {
  const deps = createDeps({ payload: null })
  const response = await createTeamSummariesPersistResponse(summaryBody(), deps)
  assert.equal(response.status, 404)
  assert.equal(deps.calls.updateSnapshot.length, 0)
})

test('TS-PERSIST-3: 정상 — 스냅샷 teamSummaries 병합 저장 + 최신 기록 갱신', async () => {
  const deps = createDeps()
  const response = await createTeamSummariesPersistResponse(summaryBody(), deps)

  assert.equal(response.status, 200)
  const body = await response.json() as { ok: boolean; persisted: number; historySaved: boolean }
  assert.equal(body.ok, true)
  assert.equal(body.persisted, 1)
  assert.equal(body.historySaved, true)

  assert.equal(deps.calls.updateSnapshot.length, 1)
  assert.equal(deps.calls.updateSnapshot[0].targetKey, '005930')
  assert.equal(deps.calls.updateSnapshot[0].payload.teamSummaries?.marketTeam?.summary, SUMMARY)
  assert.equal(deps.calls.updateHistory.length, 1)
})

test('TS-PERSIST-4: 멱등 — 이미 저장된 문장 재요청은 updateSnapshot 재호출 없이 persisted 0', async () => {
  const stored = createCanonicalPayload()
  stored.teamSummaries = { marketTeam: { inputKey: '120:1234', summary: SUMMARY, generatedAt: '2026-11-13T00:00:00.000Z' } }
  const deps = createDeps({ payload: stored })

  const response = await createTeamSummariesPersistResponse(summaryBody(), deps)
  assert.equal(response.status, 200)
  const body = await response.json() as { ok: boolean; persisted: number; reason?: string }
  assert.equal(body.ok, true)
  assert.equal(body.persisted, 0)
  assert.equal(body.reason, 'already-stored')
  assert.equal(deps.calls.updateSnapshot.length, 0, '멱등 경로는 저장을 다시 호출하지 않는다')
})

test('TS-PERSIST-5: 스냅샷 업데이트 실패 → 500', async () => {
  const deps = createDeps({ snapshotResult: false })
  const response = await createTeamSummariesPersistResponse(summaryBody(), deps)
  assert.equal(response.status, 500)
})
