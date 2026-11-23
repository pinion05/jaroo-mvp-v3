import test from 'node:test'
import assert from 'node:assert/strict'

import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

import { resolveDeepScanStartAfterHydration } from './deepscan-target-hydration'
import { resolveDeepScanPageCacheState } from './deepscan-page-projection'
import { getDeepScanTargetKey, type DeepScanTargetInput } from './workflow-types'
import { useDeepScanStore } from './stores/use-deepscan-store'

// 유료 실행 계약의 상태 시뮬레이션 회귀 (실측 §5-A/B, PR #351).
// 스토어·투영 상태만으로 "페이지가 유료 파이프라인을 발사할 조건"을 검증한다 —
// fetch는 일어나지 않으므로 과금 경로 검증이 결정론적이다.

function createSavedPayload(name: string): JarooDeepScanPayload {
  return {
    input: {
      instrument: { name, code: '100840', market: 'KOSPI', kind: 'stock' },
      holding: { shares: '51주', averagePrice: '38,634원' },
      sourceContext: { from: 'holding' },
    },
    hero: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      headline: 'headline', body: 'body', statusText: 'status', score: 55, scoreLabel: '55점', scoreDelta: '+1',
    },
    committee: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, axes: [] },
    insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: '인사이트', items: [], summaryTags: [] },
    strategy: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      weekSignal: '보류', weekSignalTone: 'neutral', weekBadgeText: '관망',
      scenarioLabel: 'scenario', scenarioProbability: '55%', scenarioPeriod: '약 3개월',
      scenarioCondition: 'condition', currentPriceText: '24,000원', targetPriceText: '53,000원',
      scenarioDetails: [], otherScenarios: [], otherScenarioTags: [],
    },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, rows: [], realizedText: '-' },
    portfolioSimulation: {
      blockState: 'ok', sourceRefs: [], fallback: null, error: null,
      beforeScore: 42, afterScore: 45, deltaLabel: '+3p', caption: 'caption',
    },
    metadata: {
      generatedAt: '2026-11-02T07:31:00.000Z',
      version: 'test-v1',
      degraded: false,
      debugId: 'debug-1',
      inputValidity: { valid: true },
      sourceRefs: [],
      blockStatus: { hero: 'ok', committee: 'ok', insights: 'ok', strategy: 'ok', sellNow: 'ok', portfolioSimulation: 'ok' },
    },
  }
}

const sntTarget: DeepScanTargetInput = {
  code: '100840',
  name: 'SNT에너지',
  market: 'KOSPI',
  marketTone: 'kospi',
  kind: 'stock',
  quantity: 51,
  averagePrice: 38634,
}

function projectPageCacheState() {
  const state = useDeepScanStore.getState()
  return resolveDeepScanPageCacheState({
    hasTarget: Boolean(state.target),
    targetKey: state.target ? getDeepScanTargetKey(state.target) : null,
    requestStatus: state.requestStatus,
    activePayload: state.activePayload,
    activeTargetKey: state.activeTargetKey,
    lastSuccessful: state.lastSuccessful,
  })
}

// §5-A 재현: 기록 항목 탭(SNT 11.02) → 저장된 리포트 시딩 → /deepscan.
// startRequest(유료 실행 개시)가 없어도 payload가 존재하면 요청이 시작되지 않는다.
test('기록 열람 시딩(§5-A): 저장 payload가 있으면 페이지는 재요청을 시작하지 않는다', () => {
  useDeepScanStore.getState().clear()
  const savedPayload = createSavedPayload('SNT에너지')
  const scannedAt = '2026-11-02T07:31:00.000Z'

  // 기록 페이지 openRow가 하는 일 — setTarget + finishSuccess(저장 리포트)
  useDeepScanStore.getState().setTarget(sntTarget)
  useDeepScanStore.getState().finishSuccess(savedPayload, scannedAt)

  const projection = projectPageCacheState()
  assert.equal(projection.fetchState, 'success')
  assert.deepEqual(projection.payload, savedPayload)
  // 핵심 계약: 보여줄 payload가 있으므로 새 요청(유료 실행 가능)이 시작되지 않는다
  assert.equal(projection.shouldStartRequest, false)

  useDeepScanStore.getState().clear()
})

// §5-A 실패 주입: 기록 단건 조회 실패 → payload 없이 타깃만 복원된 도착.
// 이 상태에서도 명시적 의도가 없으면 시작 결정은 run-readonly(과금 없는 조회)여야 한다.
test('기록 단건 실패(§5-A 주입): payload 없이 도착해도 의도 없으면 읽기 전용 조회만 허용된다', () => {
  useDeepScanStore.getState().clear()
  useDeepScanStore.getState().setTarget(sntTarget)

  const projection = projectPageCacheState()
  assert.equal(projection.payload, null)
  assert.equal(projection.shouldStartRequest, true)

  const targetKey = getDeepScanTargetKey(sntTarget)
  assert.equal(
    resolveDeepScanStartAfterHydration({
      shouldStartRequest: projection.shouldStartRequest,
      targetKey,
      hydratedTargetKey: targetKey,
      explicitRunIntent: false,
    }),
    'run-readonly',
  )

  useDeepScanStore.getState().clear()
})

// §5-B 재현: 페이지 재방문(직전 종목 잔존) — 스토어는 비고(새 페이지 로드),
// 하이드레이션이 타깃을 복원한다. 의도 없는 방문은 유료 실행(run-explicit)이 될 수 없다.
test('재방문(§5-B): 하이드레이션 복원만으로는 유료 자동 실행이 금지된다', () => {
  useDeepScanStore.getState().clear()
  useDeepScanStore.getState().setTarget(sntTarget) // 하이드레이션이 복원한 직전 종목

  const projection = projectPageCacheState()
  assert.equal(projection.shouldStartRequest, true)

  const targetKey = getDeepScanTargetKey(sntTarget)

  // 표식 없는 방문 — 오직 읽기 전용
  assert.equal(
    resolveDeepScanStartAfterHydration({
      shouldStartRequest: true,
      targetKey,
      hydratedTargetKey: targetKey,
      explicitRunIntent: false,
    }),
    'run-readonly',
  )

  // 홈 종목카드 클릭(표식 있음)에서 온 방문만 자동 실행 — 정상 진입로 보호
  assert.equal(
    resolveDeepScanStartAfterHydration({
      shouldStartRequest: true,
      targetKey,
      hydratedTargetKey: targetKey,
      explicitRunIntent: true,
    }),
    'run-explicit',
  )

  useDeepScanStore.getState().clear()
})

// §5-B 후속: 읽기 전용 조회가 스냅샷 미스로 끝나면(finishError 'snapshot-miss')
// 다시 방문해도 오류 상태이므로 자동 재시도(유료 가능)가 발사되지 않는다.
test('snapshot-miss 후 재방문: 오류 상태는 자동 시작도 유발하지 않는다', () => {
  useDeepScanStore.getState().clear()
  useDeepScanStore.getState().setTarget(sntTarget)
  useDeepScanStore.getState().startRequest()
  useDeepScanStore.getState().finishError(
    '저장된 최신 딥스캔 결과가 없어요. 다시 분석하면 딥스캔 크레딧이 사용돼요.',
    'snapshot-miss',
  )

  const projection = projectPageCacheState()
  assert.equal(projection.fetchState, 'error')
  assert.equal(projection.shouldStartRequest, false)

  const targetKey = getDeepScanTargetKey(sntTarget)
  assert.equal(
    resolveDeepScanStartAfterHydration({
      shouldStartRequest: projection.shouldStartRequest,
      targetKey,
      hydratedTargetKey: targetKey,
      explicitRunIntent: false,
    }),
    'idle',
  )

  useDeepScanStore.getState().clear()
})
