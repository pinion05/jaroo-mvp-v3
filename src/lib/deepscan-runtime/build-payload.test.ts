import test from 'node:test'
import assert from 'node:assert/strict'

import { summarizeGeneratedDumpSignals } from './build-payload'

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
