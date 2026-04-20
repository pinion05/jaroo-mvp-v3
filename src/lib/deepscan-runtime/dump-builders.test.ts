import test from 'node:test'
import assert from 'node:assert/strict'
import { createDebugFact, createDebugManifest, createDebugSource, createDumpIssue, mapCellRecordToSeries, toRuntimeDump } from './dump-builders'

test('mapCellRecordToSeries converts period maps into typed arrays', () => {
  const series = mapCellRecordToSeries({ 'period:202512': 10, 'period:202601:2': '20' }, (rawKey) => {
    const match = rawKey.match(/^period:(\d{4})(\d{2})(?::(\d+))?$/)
    if (!match) return { periodEnd: rawKey }
    return {
      periodEnd: `${match[1]}-${match[2]}`,
      ...(match[3] ? { sequence: Number(match[3]) } : {}),
    }
  })
  assert.deepEqual(series, [
    { sourcePeriodKey: 'period:202512', periodEnd: '2025-12', value: 10 },
    { sourcePeriodKey: 'period:202601:2', periodEnd: '2026-01', sequence: 2, value: 20 },
  ])
})

test('createDebugSource/createDumpIssue clone structured metadata', () => {
  const source = createDebugSource({ sourceAlias: 'slim', rawFile: 'raw/slim.json', requestPath: '/api/slim', selector: { kind: 'field', path: '$.x' } })
  const issue = createDumpIssue({ fieldRef: 'facts.directOwnershipFlow', availability: 'unavailable', reasonCode: ['no_direct_flow'] })
  assert.equal(source.sourceAlias, 'slim')
  assert.deepEqual(issue, { fieldRef: 'facts.directOwnershipFlow', availability: 'unavailable', reasonCode: ['no_direct_flow'] })
})

test('createDebugFact builds provenance-rich debug fact', () => {
  const fact = createDebugFact(101.49, {
    sourceAlias: 'slim',
    rawFile: 'raw/slim.json',
    requestPath: '/api/slim',
    selector: { kind: 'field', path: '$.x' },
  }, {
    quality: { availability: 'present', derivationKind: 'decoded_alias', reasonCode: ['decoded_val_alias'] },
    notes: ['decoded by current val1..val9 adapter'],
  })

  assert.equal(fact.value, 101.49)
  assert.equal(fact.source.sourceAlias, 'slim')
  assert.equal(fact.quality?.derivationKind, 'decoded_alias')
})

test('toRuntimeDump strips provenance but preserves semantic quality', () => {
  const runtime = toRuntimeDump({
    score: createDebugFact(78, {
      sourceAlias: 'consensus',
      rawFile: 'raw/consensus.json',
      requestPath: '/api/consensus',
      selector: { kind: 'field', path: '$.data.consensus.targetConsensus' },
    }, {
      quality: { availability: 'present', derivationKind: 'proxy', reasonCode: ['stale_consensus'] },
      notes: ['keep this weak signal'],
    }),
  }) as Record<string, unknown>

  assert.deepEqual(runtime, {
    score: {
      value: 78,
      quality: { availability: 'present', derivationKind: 'proxy', reasonCode: ['stale_consensus'] },
      notes: ['keep this weak signal'],
    },
  })
})

test('createDebugManifest defaults errors to empty array', () => {
  const manifest = createDebugManifest({
    requestId: 'req-1',
    generatedAt: '2026-04-20T00:00:00Z',
    contractVersion: 'v1',
    instrument: { ticker: 'NVDA' },
    sourceAliases: {},
    processedFiles: [],
    stripProfileVersion: 'v1',
    callUnits: [],
  })

  assert.deepEqual(manifest.errors, [])
})
