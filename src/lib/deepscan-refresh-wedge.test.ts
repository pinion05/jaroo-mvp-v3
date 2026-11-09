import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveDeepScanHydrationApplication,
  resolveDeepScanStartAfterHydration,
} from './deepscan-target-hydration'
import type { DeepScanTargetInput } from './workflow-types'
import { getDeepScanTargetKey } from './workflow-types'

// TC-BBSC-007 회귀(딥스캔 런 중 새로고침 웨지) — 근원 계약의 유닛 테스트.
//
// 웨지 메커니즘(2026-11-09 실측·로컬 순수 CDP 재현): 런 활성 상태에서 전체 문서
// 로드(F5)를 하면 스토어가 비어 있어 하이드레이션이 세션 타깃을 시드한다. 이후
// 하이드레이션 이펙트가 같은 종목을 "새 객체"로 계속 덮어썼고(target 참조가 매
// 주기마다 교체), [target]을 deps로 가진 이펙트(퀵시세·브리핑 스냅샷·정규 요청)가
// 무한 재실행되며 렌더러가 웨지됐다(30초 만에 RSS 1.8→3.7GB, 평가 전면 불응,
// 로컬 재현에서도 quotes/current 16,677회·briefing-snapshot 4,117회 스톰).
//
// 이 계약이 지켜지면 하이드레이션 반영은 원샷(스토어가 비어 있을 때만)이 되고
// 이펙트 루프가 수렴한다.

function createTarget(overrides: Partial<DeepScanTargetInput> = {}): DeepScanTargetInput {
  return {
    code: '005930',
    ticker: undefined,
    market: 'KOSPI',
    marketTone: 'kospi',
    kind: 'stock',
    name: '삼성전자',
    quantity: 12,
    averagePrice: 71500,
    currentPrice: 187100,
    currentPriceCurrency: 'KRW',
    ...overrides,
  }
}

test('하이드레이션 반영은 스토어가 비어 있을 때만 시드한다(원샷)', () => {
  const hydrated = createTarget()

  const seeded = resolveDeepScanHydrationApplication({ currentTarget: null, nextTarget: hydrated })
  assert.equal(seeded.apply, true)
  assert.equal(seeded.hydratedTargetKey, getDeepScanTargetKey(hydrated))
  assert.equal(seeded.sessionHaltHintEligible, true)
})

test('이미 같은 종목의 메모리 타깃이 있으면 다시 반영하지 않는다 — 이것이 웨지 루프의 차단점', () => {
  const current = createTarget()
  const hydratedAgain = createTarget({ currentPrice: 188200 })

  // 같은 종목(식별자 동일)이라도 값이 조금 달라도 새 객체로 덮어쓰지 않는다.
  // 덮어쓰면 target 참조가 바뀌어 [target] deps 이펙트가 재실행된다.
  const decision = resolveDeepScanHydrationApplication({ currentTarget: current, nextTarget: hydratedAgain })
  assert.equal(decision.apply, false)
  // 시작 결정 잠금 해제는 현재 메모리 타깃 키로 한다(시드하지 않아도 진행 가능).
  assert.equal(decision.hydratedTargetKey, getDeepScanTargetKey(current))
})

test('다른 종목의 메모리 타깃이 있어도 덮어쓰지 않는다(하이드레이션은 보조 경로)', () => {
  const current = createTarget({ code: '069500', name: 'KODEX 200' })
  const hydrated = createTarget()

  const decision = resolveDeepScanHydrationApplication({ currentTarget: current, nextTarget: hydrated })
  assert.equal(decision.apply, false)
  assert.equal(decision.hydratedTargetKey, getDeepScanTargetKey(current))
  // 다른 종목이면 세션 거래정지 힌트도 현재 타깃에 적용하지 않는다
  assert.equal(decision.sessionHaltHintEligible, false)
})

test('같은 종목의 메모리 타깃이면 세션 거래정지 힌트 자격은 유지한다(1차 힌트 회귀 방지)', () => {
  const current = createTarget({ currentPrice: 187100 })
  const hydrated = createTarget({ currentPrice: 188200 })

  const decision = resolveDeepScanHydrationApplication({ currentTarget: current, nextTarget: hydrated })
  assert.equal(decision.apply, false)
  assert.equal(decision.sessionHaltHintEligible, true)
})

test('원샷 시드 후 반복 하이드레이션 판정은 수렴한다 — 재반영 없이 같은 키를 유지한다', () => {
  // F5 직후 상황 시뮬레이션: 시드 → 직후 이펙트 재실행(같은 세션 타깃 재판정)
  const sessionTarget = createTarget()

  const first = resolveDeepScanHydrationApplication({ currentTarget: null, nextTarget: sessionTarget })
  assert.equal(first.apply, true)
  const storeTarget = sessionTarget // 시드된 객체 그 자체

  // 이후 N번의 재판정 모두 apply=false → setState 없음 → 이펙트 루프 종결
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const rebuilt = createTarget() // 세션 재파싱은 매번 새 객체를 만든다
    const decision = resolveDeepScanHydrationApplication({ currentTarget: storeTarget, nextTarget: rebuilt })
    assert.equal(decision.apply, false)
    assert.equal(decision.hydratedTargetKey, getDeepScanTargetKey(storeTarget))
  }
})

test('시작 결정: 시드(또는 메모리 타깃) 키가 일치하고 의도가 있을 때만 실행 경로를 탄다', () => {
  const key = getDeepScanTargetKey(createTarget())

  assert.equal(
    resolveDeepScanStartAfterHydration({ shouldStartRequest: true, targetKey: key, hydratedTargetKey: key, explicitRunIntent: true }),
    'run-explicit',
  )
  assert.equal(
    resolveDeepScanStartAfterHydration({ shouldStartRequest: true, targetKey: key, hydratedTargetKey: key, explicitRunIntent: false }),
    'run-readonly',
  )
  // 하이드레이션 키 불일치(시작 조건 미완료)·요청 불필요 상태는 idle
  assert.equal(
    resolveDeepScanStartAfterHydration({ shouldStartRequest: true, targetKey: key, hydratedTargetKey: null, explicitRunIntent: true }),
    'idle',
  )
  assert.equal(
    resolveDeepScanStartAfterHydration({ shouldStartRequest: false, targetKey: key, hydratedTargetKey: key, explicitRunIntent: true }),
    'idle',
  )
})
