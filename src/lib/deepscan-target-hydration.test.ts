import test from 'node:test'
import assert from 'node:assert/strict'

import { getDeepScanTargetKey, type DeepScanTargetInput } from './workflow-types'
import {
  resolveDeepScanHydratedTarget,
  shouldStartDeepScanRequestAfterHydration,
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

  assert.equal(shouldStartDeepScanRequestAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: null,
  }), false)
  assert.equal(shouldStartDeepScanRequestAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: 'different-target',
  }), false)
  assert.equal(shouldStartDeepScanRequestAfterHydration({
    shouldStartRequest: true,
    targetKey,
    hydratedTargetKey: targetKey,
  }), true)
})
