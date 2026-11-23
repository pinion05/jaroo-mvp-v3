import test from 'node:test'
import assert from 'node:assert/strict'

import { getDeepScanTargetKey, type DeepScanTargetInput } from './workflow-types'
import {
  resolveDeepScanHydratedTarget,
  resolveDeepScanStartAfterHydration,
} from './deepscan-target-hydration'

const storedUsTarget: DeepScanTargetInput = {
  ticker: 'TSLA',
  market: 'US',
  marketTone: 'nasdaq',
  kind: 'stock',
  name: 'Tesla, Inc.',
  quantity: 7.0957,
  averagePrice: 514619.2058,
  averagePriceCurrency: 'KRW',
  currentPriceCurrency: 'USD',
}

test('US target hydration converges after preserving an already loaded FX rate', async () => {
  let fxLoadCount = 0
  const currentTarget: DeepScanTargetInput = {
    ...storedUsTarget,
    quantity: 7.09569,
    currentPrice: 380.84,
    usdKrwRate: 1478.84,
  }

  const firstHydration = await resolveDeepScanHydratedTarget({
    currentTarget,
    hydratedTarget: storedUsTarget,
    loadUsdKrwRate: async () => {
      fxLoadCount += 1
      return 1500
    },
  })

  assert.equal(firstHydration.quantity, 7.0957)
  assert.equal(firstHydration.currentPrice, 380.84)
  assert.equal(firstHydration.usdKrwRate, 1478.84)
  assert.equal(fxLoadCount, 0)

  const secondHydration = await resolveDeepScanHydratedTarget({
    currentTarget: firstHydration,
    hydratedTarget: storedUsTarget,
    loadUsdKrwRate: async () => {
      fxLoadCount += 1
      return 1500
    },
  })

  assert.equal(getDeepScanTargetKey(secondHydration), getDeepScanTargetKey(firstHydration))
  assert.equal(fxLoadCount, 0)
})

test('US target hydration loads a missing FX rate once and then converges', async () => {
  let fxLoadCount = 0
  const loadUsdKrwRate = async () => {
    fxLoadCount += 1
    return 1478.84
  }

  const firstHydration = await resolveDeepScanHydratedTarget({
    currentTarget: storedUsTarget,
    hydratedTarget: storedUsTarget,
    loadUsdKrwRate,
  })
  const secondHydration = await resolveDeepScanHydratedTarget({
    currentTarget: firstHydration,
    hydratedTarget: storedUsTarget,
    loadUsdKrwRate,
  })

  assert.equal(firstHydration.usdKrwRate, 1478.84)
  assert.equal(getDeepScanTargetKey(secondHydration), getDeepScanTargetKey(firstHydration))
  assert.equal(fxLoadCount, 1)
})

test('DeepScan request waits until hydration resolved the exact target key', () => {
  const targetKey = getDeepScanTargetKey(storedUsTarget)

  assert.equal(resolveDeepScanStartAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: null,
    explicitRunIntent: true,
  }), 'idle')
  assert.equal(resolveDeepScanStartAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: 'different-target',
    explicitRunIntent: true,
  }), 'idle')
  assert.equal(resolveDeepScanStartAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: targetKey,
    explicitRunIntent: true,
  }), 'run-explicit')
})

// 유료 실행 계약(2026-11-09 운영 실측 §5-A/B): 페이지 방문(하이드레이션 타깃
// 복원)만으로 유료 파이프라인이 발사되지 않아야 한다. 명시적 실행 의도가 없는
// 방문은 읽기 전용(run-readonly) 조회로만 저장된 결과를 열 수 있다.
test('DeepScan 재방문(명시적 의도 없음)은 자동 유료 실행이 아니라 읽기 전용 조회가 된다', () => {
  const targetKey = getDeepScanTargetKey(storedUsTarget)

  // §5-B 재현 조건 — 타깃 복원은 완료됐지만 사용자 클릭 표식이 없는 방문
  assert.equal(resolveDeepScanStartAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: targetKey,
    explicitRunIntent: false,
  }), 'run-readonly')

  // 보여줄 payload가 이미 있으면 아무 요청도 시작하지 않는다
  assert.equal(resolveDeepScanStartAfterHydration({
    shouldStartRequest: false,
    targetKey,
    hydratedTargetKey: targetKey,
    explicitRunIntent: false,
  }), 'idle')
  assert.equal(resolveDeepScanStartAfterHydration({
    shouldStartRequest: false,
    targetKey,
    hydratedTargetKey: targetKey,
    explicitRunIntent: true,
  }), 'idle')
})
