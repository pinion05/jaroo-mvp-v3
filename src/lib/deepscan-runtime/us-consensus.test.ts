import test from 'node:test'
import assert from 'node:assert/strict'

import { decodeUsConsensusObservation } from './us-consensus'

test('decodeUsConsensusObservation는 sample-backed val aliases를 고정한다', () => {
  const decoded = decodeUsConsensusObservation({
    asOfDate: '2025-04-17',
    targetPeriodId: 'period:202701',
    targetPeriodLabel: '202701',
    metrics: {
      val1: 198.87,
      val2: 366703.88,
      val3: 0.13,
      val4: 8.27,
      val5: 0.13,
      val6: 24.05,
      val7: 12.99,
      val8: 0,
      val9: 15.31,
    },
  })

  assert.deepEqual(decoded, {
    asOfDate: '2025-04-17',
    targetPeriodId: 'period:202701',
    targetPeriodLabel: '202701',
    spotPrice: 198.87,
    forecastRevenue: 366703.88,
    forecastRevenueRevisionPct: 0.13,
    forecastEps: 8.27,
    forecastEpsRevisionPct: 0.13,
    forwardPer: 24.05,
    forecastBps: 12.99,
    forecastBpsRevisionPct: 0,
    forwardPbr: 15.31,
    sourceOpaqueMetrics: {
      val1: 198.87,
      val2: 366703.88,
      val3: 0.13,
      val4: 8.27,
      val5: 0.13,
      val6: 24.05,
      val7: 12.99,
      val8: 0,
      val9: 15.31,
    },
    decodingConfidence: 'sample-backed',
  })
})
