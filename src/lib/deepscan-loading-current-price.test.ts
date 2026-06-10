import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveDeepScanBriefingCardCurrentPrice,
  resolveDeepScanLoadingCurrentPrice,
} from './deepscan-loading-current-price'

test('DeepScan loading current price prefers payload/quick quote over stale briefing snapshot', () => {
  assert.equal(
    resolveDeepScanLoadingCurrentPrice({
      payloadCurrentPrice: 236.13,
      quickQuoteCurrentPrice: 236.13,
      targetCurrentPrice: 118.065,
      briefingCurrentPrice: 247.79,
    }),
    236.13,
  )
})

test('DeepScan loading current price uses quick quote before target or briefing snapshot', () => {
  assert.equal(
    resolveDeepScanLoadingCurrentPrice({
      quickQuoteCurrentPrice: 236.13,
      targetCurrentPrice: 118.065,
      briefingCurrentPrice: 247.79,
    }),
    236.13,
  )
})

test('DeepScan briefing card current price follows the display price before stale snapshot rows', () => {
  assert.equal(
    resolveDeepScanBriefingCardCurrentPrice({
      displayCurrentPrice: 236.13,
      briefingQuotePrice: 247.79,
      latestClose: 247.79,
    }),
    236.13,
  )
})
