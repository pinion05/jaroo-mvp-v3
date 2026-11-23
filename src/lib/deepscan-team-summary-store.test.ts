// 화이트박스 TC — 팀 요약 영속화 저장 로직(캐시 로드 LLM 비용 제로화, 2026-11-13)
// 대상: src/lib/deepscan-team-summary-store.ts — sanitize·merge·pick 순수 함수
//
// 검증 계약:
//   TS-STORE-1  sanitize — 스테이지 키 화이트리스트·inputKey 형식·길이 제한·팀당 1개
//   TS-STORE-2  merge — 팀 요약이 payload.teamSummaries에 병합되고 멱등(같은 입력·같은 문장은 재저장 0)
//   TS-STORE-3  pick — 요청(팀+inputKey)이 정확히 일치하는 저장 문장만 씨드한다(본문 변경=미스→재생성 폴백)
//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md §수정 이력

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeTeamSummariesIntoPayload,
  pickSeededTeamSummaries,
  sanitizeTeamSummaryEntries,
} from './deepscan-team-summary-store'
import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

function createStubPayload(): JarooDeepScanPayload {
  return {
    input: {
      instrument: { name: '삼성전자', code: '005930', market: 'KR', kind: 'stock' },
      holding: { shares: '10주', averagePrice: '70,000원' },
      selectedAt: '2026-11-13T00:00:00.000Z',
      sourceContext: { from: 'holding', sessionKey: 'session-1', appliedAt: '2026-11-13T00:00:00.000Z' },
    },
    hero: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, headline: 'h', body: 'b', statusText: 's', score: 7, scoreLabel: '7점', scoreDelta: '+1' },
    committee: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, axes: [] },
    insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: 'i', items: [], summaryTags: [] },
    strategy: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      weekSignal: 's', weekSignalTone: 'positive', weekBadgeText: 'b', scenarioLabel: 'l',
      scenarioProbability: '60%', scenarioPeriod: '약 3개월', scenarioCondition: 'c',
      currentPriceText: '80,000원', targetPriceText: '90,000원', scenarioDetails: [], otherScenarios: [], otherScenarioTags: [],
    },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, realizedText: 'r', rows: [] },
    portfolioSimulation: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, beforeScore: 42, afterScore: 45, deltaLabel: '+3p', caption: 'c' },
    metadata: {
      generatedAt: '2026-11-13T00:00:00.000Z', version: 'v', degraded: false, debugId: 'd',
      inputValidity: { valid: true }, sourceRefs: [],
      blockStatus: { hero: 'ok', committee: 'ok', insights: 'ok', strategy: 'ok', sellNow: 'ok', portfolioSimulation: 'ok' },
    },
  } as unknown as JarooDeepScanPayload
}

const SUMMARY = '지금 구간은 평단 대비 손실 구간이라 회복 속도를 먼저 확인해야 해요.'

test('TS-STORE-1: sanitize — 화이트리스트·형식·길이·팀당 1개 검증', () => {
  // 정상 3팀은 모두 통과
  const valid = sanitizeTeamSummaryEntries([
    { teamKey: 'marketTeam', inputKey: '120:1234', summary: SUMMARY },
    { teamKey: 'contextTeam', inputKey: '130:5678', summary: SUMMARY },
    { teamKey: 'fundamentalTeam', inputKey: '140:9012', summary: SUMMARY, model: 'm', provider: 'p' },
  ])
  assert.equal(valid.length, 3)
  assert.equal(valid[2].model, 'm')

  // 화이트리스트 밖 팀·잘못된 inputKey·너무 짧은 문장은 탈락
  assert.equal(sanitizeTeamSummaryEntries([{ teamKey: 'evilTeam', inputKey: '1:1', summary: SUMMARY }]).length, 0)
  assert.equal(sanitizeTeamSummaryEntries([{ teamKey: 'marketTeam', inputKey: 'abc', summary: SUMMARY }]).length, 0)
  assert.equal(sanitizeTeamSummaryEntries([{ teamKey: 'marketTeam', inputKey: '1:1', summary: '짧아요' }]).length, 0)
  assert.equal(sanitizeTeamSummaryEntries('not-array').length, 0)

  // 같은 팀이 여러 번 오면 첫 번째만
  const deduped = sanitizeTeamSummaryEntries([
    { teamKey: 'marketTeam', inputKey: '1:1', summary: SUMMARY },
    { teamKey: 'marketTeam', inputKey: '2:2', summary: SUMMARY },
  ])
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].inputKey, '1:1')
})

test('TS-STORE-2: merge — teamSummaries 병합 + 멱등(같은 입력·같은 문장 재저장 0)', () => {
  const payload = createStubPayload()

  const merged = mergeTeamSummariesIntoPayload(payload, [
    { teamKey: 'marketTeam', inputKey: '120:1234', summary: SUMMARY },
  ])
  assert.ok(merged)
  assert.equal(merged?.teamSummaries?.marketTeam?.inputKey, '120:1234')
  assert.equal(merged?.teamSummaries?.marketTeam?.summary, SUMMARY)
  assert.ok(typeof merged?.teamSummaries?.marketTeam?.generatedAt === 'string')
  // 원본 payload는 오염되지 않는다(불변 병합)
  assert.equal(payload.teamSummaries, undefined)

  // 멱등 — 같은 입력·같은 문장이 이미 저장돼 있으면 null(저장 스킵)
  const again = mergeTeamSummariesIntoPayload(merged as JarooDeepScanPayload, [
    { teamKey: 'marketTeam', inputKey: '120:1234', summary: SUMMARY },
  ])
  assert.equal(again, null)

  // 다른 inputKey(본문 변경)는 덮어쓴다 — 새로운 분석 결과가 우선
  const overwritten = mergeTeamSummariesIntoPayload(merged as JarooDeepScanPayload, [
    { teamKey: 'marketTeam', inputKey: '999:9999', summary: SUMMARY },
  ])
  assert.equal(overwritten?.teamSummaries?.marketTeam?.inputKey, '999:9999')

  // 빈 엔트리 → null
  assert.equal(mergeTeamSummariesIntoPayload(payload, []), null)
})

test('TS-STORE-3: pick — 요청(팀+inputKey) 일치 문장만 씨드, 불일치·쓰레기는 미스', () => {
  const stored = {
    marketTeam: { inputKey: '120:1234', summary: SUMMARY, model: 'm' },
    contextTeam: { inputKey: '130:5678', summary: SUMMARY },
    fundamentalTeam: { inputKey: '140:9012', summary: '너무 짧음' },
  }
  const requests = [
    { teamKey: 'marketTeam', inputKey: '120:1234' }, // 일치 → 씨드
    { teamKey: 'contextTeam', inputKey: '000:0000' }, // 본문 변경 → 미스
    { teamKey: 'fundamentalTeam', inputKey: '140:9012' }, // 저장값 불량 → 미스
    { teamKey: 'unknownTeam', inputKey: '1:1' }, // 저장 없음 → 미스
  ]

  const seeded = pickSeededTeamSummaries(stored, requests)
  assert.deepEqual(Object.keys(seeded), ['marketTeam'])
  assert.equal(seeded.marketTeam?.summary, SUMMARY)
  assert.equal(seeded.marketTeam?.model, 'm')

  assert.deepEqual(pickSeededTeamSummaries(null, requests), {})
  assert.deepEqual(pickSeededTeamSummaries('garbage', requests), {})
})
