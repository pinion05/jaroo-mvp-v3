import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeepScanRecoveryForecastBlock,
  describeMomentumProvenance,
  extractGeneratedOhlcSeries,
  summarizeGeneratedDumpSignals,
} from './build-payload'

test('summarizeGeneratedDumpSignals surfaces Polygon OHLC and direct ownership flow summaries', () => {
  const summary = summarizeGeneratedDumpSignals({
    members: {
      momentum: {
        facts: {
          ohlcSeries: {
            value: [
              { date: '2026-04-20', close: 273.05 },
              { date: '2026-04-17', close: 270.23 },
            ],
            quality: { availability: 'present', derivationKind: 'direct', reasonCode: ['polygon_primary_ohlc'] },
          },
        },
      },
      'ownership-flow': {
        facts: {
          directOwnershipFlow: {
            value: {
              source: 'sec-submissions',
              signal: {
                summary: '최근 180일 ownership/flow 공시 3건',
                direction: 'mixed-direct-flow',
              },
              counts: {
                totalDirectEvents: 3,
              },
              latestDates: {
                latestEvent: '2026-04-20',
              },
            },
            quality: { availability: 'present', derivationKind: 'direct' },
          },
        },
      },
    },
  })

  assert.deepEqual(summary, {
    momentum: {
      availability: 'present',
      pointCount: 2,
      latestDate: '2026-04-20',
      latestClose: 273.05,
      primarySource: 'polygon',
    },
    ownershipFlow: {
      availability: 'present',
      summary: '최근 180일 ownership/flow 공시 3건',
      direction: 'mixed-direct-flow',
      eventCount: 3,
      latestEventDate: '2026-04-20',
      primarySource: 'sec-submissions',
    },
  })
})

test('summarizeGeneratedDumpSignals preserves missing availability when direct facts are absent', () => {
  const summary = summarizeGeneratedDumpSignals({
    members: {
      momentum: {
        facts: {
          ohlcSeries: {
            value: null,
            quality: { availability: 'missing' },
          },
        },
      },
      'ownership-flow': {
        facts: {
          directOwnershipFlow: {
            value: null,
            quality: { availability: 'missing' },
          },
        },
      },
    },
  })

  assert.equal(summary.momentum?.availability, 'missing')
  assert.equal(summary.momentum?.pointCount, 0)
  assert.equal(summary.ownershipFlow?.availability, 'missing')
  assert.equal(summary.ownershipFlow?.eventCount, 0)
})

test('extractGeneratedOhlcSeries normalizes runtime OHLC facts for recovery forecasting', () => {
  const series = extractGeneratedOhlcSeries({
    members: {
      momentum: {
        facts: {
          ohlcSeries: {
            value: [
              { date: '2026-04-20', close: 273.05 },
              { tradeDate: '2026-04-17', closePrice: 270.23 },
              { date: 'bad-row', close: null },
            ],
            quality: { availability: 'present' },
          },
        },
      },
    },
  })

  assert.deepEqual(series, [
    { date: '2026-04-20', close: 273.05 },
    { date: '2026-04-17', close: 270.23 },
  ])
})

test('buildDeepScanRecoveryForecastBlock returns a deepscan-ready 원금회수 block from holding and OHLC context', () => {
  const block = buildDeepScanRecoveryForecastBlock({
    rawInput: {
      instrument: { name: 'Tesla', ticker: 'TSLA', market: 'US', kind: 'stock' },
      holding: { shares: '3', averagePrice: '121' },
      sourceContext: { from: 'holding' },
    },
    currentPrice: 100,
    currency: 'USD',
    primarySeries: [
      { date: '2026-01-01', close: 121 },
      { date: '2026-01-02', close: 100 },
      { date: '2026-01-03', close: 121 },
      { date: '2026-01-04', close: 130 },
      { date: '2026-01-05', close: 121 },
      { date: '2026-01-06', close: 100 },
      { date: '2026-01-07', close: 121 },
      { date: '2026-01-08', close: 130 },
      { date: '2026-01-09', close: 100 },
      { date: '2026-01-10', close: 121 },
    ],
    sourceRefs: [],
    sourceId: 'test-ohlc:TSLA',
    sourceLabel: 'test OHLC',
  })

  assert.ok(block)
  assert.equal(block.blockState, 'ok')
  assert.match(block.summaryText, /평단 \$121\.00 회복/)
  assert.match(block.expectedRecoveryDaysText, /거래일|이미 도달/)
  assert.notEqual(block.recoveryProbabilityText, 'N/A')
  assert.equal(block.currentPriceText, '$100.00')
  assert.equal(block.targetPriceText, '$121.00')
  assert.equal(block.modelRows.length, 3)
  assert.match(block.disclaimer, /투자 권유/)
})

test('describeMomentumProvenance는 provider별 OHLC 문구를 맞춘다', () => {
  assert.deepEqual(describeMomentumProvenance('polygon', 252), {
    insightTitle: 'Polygon OHLC 252개 봉을 반영했어요.',
    sourceRefLabel: 'Polygon OHLC 252 bars',
    heroBodyText: 'Polygon OHLC 252개 반영',
  })

  assert.deepEqual(describeMomentumProvenance('fmp', 120), {
    insightTitle: 'FMP OHLC 120개 봉을 반영했어요.',
    sourceRefLabel: 'FMP OHLC 120 bars',
    heroBodyText: 'FMP OHLC 120개 반영',
  })

  assert.deepEqual(describeMomentumProvenance('unknown', 80), {
    insightTitle: 'OHLC 80개 봉을 반영했어요.',
    sourceRefLabel: 'OHLC 80 bars',
    heroBodyText: 'OHLC 80개 반영',
  })
})
