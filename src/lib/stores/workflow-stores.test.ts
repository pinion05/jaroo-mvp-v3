import test from 'node:test'
import assert from 'node:assert/strict'

import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import {
  createMergeRowId,
  createOcrReviewRowId,
  getDeepScanTargetKey,
  toConfirmedHolding,
  toPortfolioNormalizedItem,
  type DeepScanTargetInput,
  type MergeRow,
  type OcrReviewRow,
} from '@/lib/workflow-types'
import { useDeepScanStore, shouldReuseDeepScanLastSuccess } from './use-deepscan-store'
import { useMergeStore, selectMergeApplicableRows } from './use-merge-store'
import { useOcrReviewStore } from './use-ocr-review-store'
import { useOcrUploadStore } from './use-ocr-upload-store'
import { usePortfolioStore } from './use-portfolio-store'

function resetStores() {
  useOcrUploadStore.getState().clear()
  useOcrReviewStore.getState().resetForRestart()
  useMergeStore.getState().resetForBackNav()
  usePortfolioStore.getState().clear()
  useDeepScanStore.getState().clear()
}

function createReviewRow(overrides: Partial<OcrReviewRow> = {}): OcrReviewRow {
  const id = overrides.id ?? createOcrReviewRowId({ uploadId: 'upload-1', fileName: 'foo.png', rowIndex: 0, name: '마이크로소프트' })
  return {
    id,
    name: '마이크로소프트',
    quantity: '3주',
    profitRate: '+18.4%',
    evaluationAmount: '$3,450.00',
    averagePrice: '$972.11',
    resolvedName: 'Microsoft Corporation',
    resolvedTicker: 'MSFT',
    resolvedCode: 'US5949181045',
    resolvedMarket: 'NASDAQ',
    resolvedMarketTone: 'nasdaq',
    resolvedKind: 'stock',
    resolutionState: 'resolved',
    selectedCandidateId: 'candidate-1',
    ...overrides,
  }
}

function createMergeRow(overrides: Partial<MergeRow> = {}): MergeRow {
  const sourceRow = createReviewRow({ id: 'review-1' })
  const confirmed = toConfirmedHolding(sourceRow)

  return {
    id: createMergeRowId(sourceRow.id, confirmed.displayName),
    sourceRowId: sourceRow.id,
    status: 'ready',
    ...confirmed,
    ...overrides,
  }
}

function createDeepScanPayload(): JarooDeepScanPayload {
  return {
    input: {
      instrument: {
        name: 'Microsoft Corporation',
        ticker: 'MSFT',
        market: 'NASDAQ',
      },
      holding: {
        shares: '3주',
        averagePrice: '$972.11',
      },
      sourceContext: {
        from: 'holding',
      },
    },
    hero: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      headline: 'headline',
      body: 'body',
      statusText: 'status',
      score: 67,
      scoreLabel: '67점',
      scoreDelta: '+1',
    },
    committee: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      axes: [],
    },
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
    sellNow: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      rows: [],
      realizedText: '-',
    },
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

test.afterEach(() => {
  resetStores()
})

test('OCR review store restart clears rows, candidates, and request state', () => {
  const row = createReviewRow()
  useOcrReviewStore.getState().setRows([row])
  useOcrReviewStore.getState().setCandidates(row.id, [{ id: 'candidate-1', resolvedName: 'Microsoft Corporation', resolvedTicker: 'MSFT', source: 'local' }])
  useOcrReviewStore.getState().setRequestStatus('error', 'resolve failed')
  useOcrReviewStore.getState().setResolveStatus('error', 'candidate failed')

  useOcrReviewStore.getState().resetForRestart()

  const state = useOcrReviewStore.getState()
  assert.deepEqual(state.rows, [])
  assert.deepEqual(state.candidatesByRowId, {})
  assert.equal(state.requestStatus, 'idle')
  assert.equal(state.resolveStatus, 'idle')
  assert.equal(state.errorMessage, null)
  assert.equal(state.resolveErrorMessage, null)
})

test('OCR review store supports candidate replacement and manual row patching', () => {
  const row = createReviewRow({
    id: 'manual-row',
    resolvedName: undefined,
    resolvedTicker: undefined,
    resolvedCode: undefined,
    resolvedMarket: undefined,
    resolvedMarketTone: undefined,
    resolvedKind: undefined,
    resolutionState: 'manual-required',
    selectedCandidateId: null,
  })

  useOcrReviewStore.getState().setRows([row])
  useOcrReviewStore.getState().replaceCandidates({
    [row.id]: [{ id: 'candidate-2', resolvedName: 'Microsoft Corporation', resolvedTicker: 'MSFT', source: 'ticker-map' }],
  })
  useOcrReviewStore.getState().patchRow(row.id, {
    resolvedTicker: 'MSFT',
    resolvedMarket: 'NASDAQ',
    resolvedMarketTone: 'nasdaq',
    resolvedKind: 'stock',
    resolutionState: 'resolved',
  })
  useOcrReviewStore.getState().setResolveStatus('success')

  const state = useOcrReviewStore.getState()
  assert.equal(state.candidatesByRowId[row.id]?.[0]?.id, 'candidate-2')
  assert.equal(state.rows[0]?.resolvedTicker, 'MSFT')
  assert.equal(state.rows[0]?.resolutionState, 'resolved')
  assert.equal(state.resolveStatus, 'success')
})

test('merge selector excludes error rows from applicable payload', () => {
  useMergeStore.getState().setRows([
    createMergeRow(),
    createMergeRow({
      id: 'error-row',
      status: 'error',
      errorMessage: 'needs upstream fix',
    }),
  ])

  const applicable = selectMergeApplicableRows()

  assert.equal(applicable.length, 1)
  assert.equal(applicable[0]?.displayName, 'Microsoft Corporation')
})

test('portfolio store can normalize confirmed holdings and clear failed quote fields for one item', () => {
  const first = toPortfolioNormalizedItem(toConfirmedHolding(createReviewRow({ id: 'review-1' })))
  const second = toPortfolioNormalizedItem(
    toConfirmedHolding(
      createReviewRow({
        id: 'review-2',
        name: '엔비디아',
        resolvedName: 'NVIDIA CORP',
        resolvedTicker: 'NVDA',
        resolvedCode: undefined,
        evaluationAmount: '$4,000.00',
        averagePrice: '$1,000.00',
      }),
    ),
  )

  assert.ok(first)
  assert.ok(second)

  usePortfolioStore.getState().replaceItems([
    { ...first!, currentPrice: 1000, currentProfitRate: 10 },
    { ...second!, currentPrice: 1200, currentProfitRate: 20 },
  ])

  usePortfolioStore.getState().clearItemQuote({ code: second!.code, ticker: second!.ticker, name: second!.name, market: second!.market })

  const items = usePortfolioStore.getState().items
  assert.equal(items[0]?.currentPrice, 1000)
  assert.equal(items[0]?.currentProfitRate, 10)
  assert.equal(items[1]?.currentPrice, undefined)
  assert.equal(items[1]?.currentProfitRate, undefined)
})

test('deep scan store reuses the last successful result only for the same target key', () => {
  const target: DeepScanTargetInput = {
    code: '005930',
    ticker: '005930.KS',
    name: '삼성전자',
    market: 'KOSPI',
    marketTone: 'kospi',
    kind: 'stock',
    quantity: 10,
    averagePrice: 70000,
  }

  useDeepScanStore.getState().setTarget(target)
  useDeepScanStore.getState().startRequest()
  useDeepScanStore.getState().finishSuccess(createDeepScanPayload(), '2026-04-17T01:00:00.000Z')

  assert.equal(shouldReuseDeepScanLastSuccess(target), true)
  assert.equal(
    shouldReuseDeepScanLastSuccess({
      ...target,
      code: '000660',
      ticker: '000660.KS',
      name: 'SK하이닉스',
    }),
    false,
  )
  assert.equal(useDeepScanStore.getState().lastSuccessful?.targetKey, getDeepScanTargetKey(target))
  assert.equal(useDeepScanStore.getState().activeTargetKey, getDeepScanTargetKey(target))
})

test('deep scan store resets active request state when the target key changes', () => {
  const firstTarget: DeepScanTargetInput = {
    code: '005930',
    market: 'KOSPI',
    marketTone: 'kospi',
    kind: 'stock',
    name: '삼성전자',
    quantity: 10,
    averagePrice: 70000,
  }
  const secondTarget: DeepScanTargetInput = {
    ticker: 'AAPL',
    market: 'NASDAQ',
    marketTone: 'nasdaq',
    kind: 'stock',
    name: 'Apple',
    quantity: 2,
    averagePrice: 210,
  }

  useDeepScanStore.getState().setTarget(firstTarget)
  useDeepScanStore.getState().startRequest()
  useDeepScanStore.getState().finishSuccess(createDeepScanPayload(), '2026-04-17T01:10:00.000Z')
  useDeepScanStore.getState().setTarget(secondTarget)

  assert.equal(useDeepScanStore.getState().requestStatus, 'idle')
  assert.equal(useDeepScanStore.getState().errorMessage, null)
  assert.equal(useDeepScanStore.getState().activePayload, null)
  assert.equal(useDeepScanStore.getState().activeTargetKey, null)
  assert.equal(useDeepScanStore.getState().lastSuccessful?.targetKey, getDeepScanTargetKey(firstTarget))
})

test('upload store keeps the current screenshot handoff payload', () => {
  useOcrUploadStore.getState().setInput({
    broker: '키움',
    uploads: [{ id: 'upload-1', fileName: 'capture.png', imageDataUrl: 'data:image/png;base64,abc' }],
  })

  assert.equal(useOcrUploadStore.getState().input?.broker, '키움')
  assert.equal(useOcrUploadStore.getState().input?.uploads.length, 1)
})
