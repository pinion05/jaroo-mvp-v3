import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveSnapshotProfitRate,
  getDeepScanTargetKey,
  toDeepScanTargetInput,
  toPortfolioNormalizedItem,
  type ConfirmedHolding,
  type DeepScanTargetInput,
  type PortfolioNormalizedItem,
} from './workflow-types'

const soopHolding: ConfirmedHolding = {
  displayName: 'SOOP',
  code: '067160',
  market: 'KOSDAQ',
  marketTone: 'kosdaq',
  kind: 'stock',
  quantityText: '3주',
  quantityValue: 3,
  profitAmountText: '-13,263원',
  profitAmountValue: -13263,
  profitRateText: '-6.8%',
  profitRateValue: -6.8,
  evaluationAmountText: '181,137원',
  evaluationAmountValue: 181137,
  averagePriceText: '64,800원',
  averagePriceValue: 64800,
  averagePriceCurrency: 'KRW',
}

const soopItem: PortfolioNormalizedItem = {
  code: '067160',
  market: 'KOSDAQ',
  marketTone: 'kosdaq',
  kind: 'stock',
  name: 'SOOP',
  quantity: 3,
  averagePrice: 64800,
  evaluationAmount: 181137,
  averagePriceCurrency: 'KRW',
}

const soopTarget: DeepScanTargetInput = {
  ...soopItem,
  currentPrice: 47100,
  currentProfitRate: -27.3,
  currentPriceCurrency: 'KRW',
}

test('deriveSnapshotProfitRate restores the broker snapshot return from valuation and cost basis', () => {
  assert.equal(
    deriveSnapshotProfitRate({ quantity: 3, averagePrice: 64800, evaluationAmount: 181137 }),
    -6.822530864197529,
  )
  assert.equal(deriveSnapshotProfitRate({ quantity: 0, averagePrice: 64800, evaluationAmount: 181137 }), undefined)
})

test('toPortfolioNormalizedItem preserves the explicit OCR snapshot return', () => {
  assert.equal(toPortfolioNormalizedItem(soopHolding)?.snapshotProfitRate, -6.8)
})

test('DeepScan target carries snapshot return separately from the live return', () => {
  const target = toDeepScanTargetInput({ ...soopItem, snapshotProfitRate: -6.8 })

  assert.equal(target.snapshotProfitRate, -6.8)
  assert.equal(target.currentProfitRate, undefined)
})

test('DeepScan target cache key changes when only the snapshot return changes', () => {
  assert.notEqual(
    getDeepScanTargetKey({ ...soopTarget, snapshotProfitRate: -6.8 }),
    getDeepScanTargetKey({ ...soopTarget, snapshotProfitRate: -27.3 }),
  )
})
