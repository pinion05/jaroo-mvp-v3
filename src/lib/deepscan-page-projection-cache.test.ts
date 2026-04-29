import test from 'node:test'
import assert from 'node:assert/strict'

import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'
import { resolveDeepScanPageCacheState } from './deepscan-page-projection'

function createPayload(headline: string): JarooDeepScanPayload {
  return {
    input: {
      instrument: { name: 'Samsung Electronics', ticker: '005930.KS', market: 'KOSPI' },
      holding: { shares: '10', averagePrice: '70000' },
      sourceContext: { from: 'holding' },
    },
    hero: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      headline,
      body: 'body',
      statusText: 'status',
      score: 67,
      scoreLabel: '67점',
      scoreDelta: '+1',
    },
    committee: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, axes: [] },
    insights: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      sectionLabel: '핵심 인사이트',
      items: [],
      summaryTags: [],
    },
    strategy: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      weekSignal: '보류',
      weekSignalTone: 'neutral',
      weekBadgeText: '관망',
      scenarioLabel: 'scenario',
      scenarioProbability: '60%',
      scenarioPeriod: '약 3개월',
      scenarioCondition: 'condition',
      currentPriceText: '$1,000',
      targetPriceText: '$1,100',
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, rows: [], realizedText: '-' },
    portfolioSimulation: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      beforeScore: 42,
      afterScore: 45,
      deltaLabel: '+3p',
      caption: 'caption',
    },
    metadata: {
      generatedAt: '2026-04-17T01:00:00.000Z',
      version: 'test-v1',
      degraded: false,
      debugId: 'debug-1',
      inputValidity: { valid: true },
      sourceRefs: [],
      blockStatus: {
        hero: 'ok',
        committee: 'ok',
        insights: 'ok',
        strategy: 'ok',
        sellNow: 'ok',
        portfolioSimulation: 'ok',
      },
    },
  }
}

test('deep scan page immediately reuses matching last successful payload on idle re-entry', () => {
  const payload = createPayload('cached result')

  const resolved = resolveDeepScanPageCacheState({
    hasTarget: true,
    targetKey: 'target:samsung',
    requestStatus: 'idle',
    activePayload: null,
    activeTargetKey: null,
    lastSuccessful: {
      targetKey: 'target:samsung',
      payload,
      completedAt: '2026-04-17T01:00:00.000Z',
    },
  })

  assert.equal(resolved.payload, payload)
  assert.equal(resolved.fetchState, 'success')
  assert.equal(resolved.shouldStartRequest, false)
})

test('deep scan page does not reuse last successful payload when the target key changes', () => {
  const payload = createPayload('stale result')

  const resolved = resolveDeepScanPageCacheState({
    hasTarget: true,
    targetKey: 'target:sk-hynix',
    requestStatus: 'idle',
    activePayload: null,
    activeTargetKey: null,
    lastSuccessful: {
      targetKey: 'target:samsung',
      payload,
      completedAt: '2026-04-17T01:00:00.000Z',
    },
  })

  assert.equal(resolved.payload, null)
  assert.equal(resolved.fetchState, 'idle')
  assert.equal(resolved.shouldStartRequest, true)
})
