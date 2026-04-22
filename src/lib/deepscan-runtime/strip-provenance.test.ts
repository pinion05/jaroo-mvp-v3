import test from 'node:test'
import assert from 'node:assert/strict'
import { stripProvenance } from './strip-provenance'

test('stripProvenance removes nested debug source metadata and preserves quality', () => {
  const result = stripProvenance({
    instrument: {
      name: {
        value: 'NVDA',
        source: {
          sourceAlias: 'slim',
          rawFile: 'raw/slim.json',
          requestPath: '/api/slim',
          selector: { kind: 'field', path: '$.x' },
        },
        quality: {
          availability: 'present',
          reasonCode: ['source-live'],
        },
      },
    },
    sourceRefs: [{ id: 'should-remove' }],
  }) as Record<string, unknown>

  assert.deepEqual(result, {
    instrument: {
      name: {
        value: 'NVDA',
        quality: {
          availability: 'present',
          reasonCode: ['source-live'],
        },
      },
    },
  })
})

test('stripProvenance preserves semantic source fields inside values', () => {
  const result = stripProvenance({
    quote: {
      value: {
        source: 'polygon',
        price: 201.68,
      },
      source: {
        sourceAlias: 'quotes',
        rawFile: 'raw/quotes.json',
        requestPath: '/api/source/quotes',
        selector: { kind: 'field', path: '$.data.items[0]' },
      },
    },
  }) as Record<string, unknown>

  assert.deepEqual(result, {
    quote: {
      value: {
        source: 'polygon',
        price: 201.68,
      },
    },
  })
})

test('stripProvenance sanitizes provenance-like notes', () => {
  const result = stripProvenance({
    notes: [
      'endpoint=/api/source/quotes',
      'this member remains low-confidence',
      '$.pages.snap.financialSummary',
    ],
  }) as Record<string, unknown>

  assert.deepEqual(result, {
    notes: ['this member remains low-confidence'],
  })
})

test('stripProvenance preserves benign shared notes but removes adapter notes', () => {
  const result = stripProvenance({
    notes: ['Live-fetched upstream values included.', 'decoded by current val1..val9 adapter'],
  }) as Record<string, unknown>

  assert.deepEqual(result, {
    notes: ['Live-fetched upstream values included.'],
  })
})

test('stripProvenance removes debug-only fields', () => {
  const result = stripProvenance({
    decodeMeta: { decodeVersion: 'x' },
    selectorDebugOnly: { path: '$.foo' },
    value: 1,
  }) as Record<string, unknown>

  assert.deepEqual(result, { value: 1 })
})
