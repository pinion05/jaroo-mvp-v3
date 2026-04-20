import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeDebugArtifactRoot, writeDebugArtifactSet } from './debug-artifact-sink'
import { stripProvenance } from './strip-provenance'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

test('debug artifact sink initializes root and writes manifest/shared/member/runtime files', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'jaroo-dump-sink-'))
  try {
    const root = await initializeDebugArtifactRoot(tmp, 'request-1')
    const sharedDebug = {
      instrument: { ticker: 'NVDA' },
      price: {
        value: 10,
        source: {
          sourceAlias: 'slim',
          rawFile: 'raw/slim.json',
          requestPath: '/api/slim',
          selector: { kind: 'field', path: '$.price' },
        },
      },
    }
    const memberDebug = {
      valuation: {
        member: 'valuation',
        facts: {
          pe: {
            value: 30,
            source: {
              sourceAlias: 'slim',
              rawFile: 'raw/slim.json',
              requestPath: '/api/slim',
              selector: { kind: 'field', path: '$.pe' },
            },
          },
        },
      },
    }
    const axisDebug = {
      'market-timing': { axis: 'market-timing', members: ['valuation'] },
    }

    const result = await writeDebugArtifactSet(root, {
      manifest: {
        requestId: 'request-1',
        generatedAt: '2026-04-20T00:00:00Z',
        contractVersion: 'v1',
        instrument: { ticker: 'NVDA' },
        sourceAliases: { slim: { rawFile: 'raw/slim.json', requestPath: '/api/slim' } },
        processedFiles: [],
        stripProfileVersion: 'v1',
        callUnits: [{ member: 'valuation', sharedFile: 'processed/shared-context-runtime.json', memberFile: 'processed/member-valuation-runtime.json' }],
        errors: [],
      },
      sharedDebug,
      memberDebug,
      axisDebug,
    })

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'))
    const runtimeShape = {
      shared: stripProvenance(sharedDebug),
      members: { valuation: stripProvenance(memberDebug.valuation) },
      axes: { 'market-timing': stripProvenance(axisDebug['market-timing']) },
    }
    const expectedHash = createHash('sha256')
      .update(JSON.stringify(canonicalize(runtimeShape)))
      .digest('hex')

    assert.equal(manifest.requestId, 'request-1')
    assert.equal(manifest.runtimeShapeHash, expectedHash)
    assert.equal(manifest.sharedDebugPath, 'processed/shared-context-debug.json')
    assert.deepEqual(manifest.memberDebugPaths, { valuation: 'processed/member-valuation-debug.json' })
    assert.deepEqual(manifest.axisDebugPaths, { 'market-timing': 'processed/axis-market-timing-debug.json' })
    assert.deepEqual(manifest.callUnits, [{ member: 'valuation', sharedFile: 'processed/shared-context-runtime.json', memberFile: 'processed/member-valuation-runtime.json' }])
    assert.equal(manifest.runtimeSnapshotPath, 'processed/runtime-shape.json')
    assert.deepEqual(result.errors, [])
    assert.match(manifest.processedFiles.join('\n'), /shared-context-runtime\.json/)
    assert.match(manifest.processedFiles.join('\n'), /member-valuation-runtime\.json/)
    assert.match(manifest.processedFiles.join('\n'), /axis-market-timing-runtime\.json/)

    const runtimeSnapshot = JSON.parse(await readFile(result.runtimeSnapshotPath, 'utf8'))
    assert.deepEqual(runtimeSnapshot, runtimeShape)
    await access(join(root, 'processed', 'shared-context-runtime.json'))
    await access(join(root, 'processed', 'member-valuation-runtime.json'))
    await access(join(root, 'processed', 'axis-market-timing-runtime.json'))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('initializeDebugArtifactRoot rejects path traversal request ids', async () => {
  await assert.rejects(
    () => initializeDebugArtifactRoot(tmpdir(), '../escape'),
    /single safe path segment/,
  )
})


test('writeDebugArtifactSet rejects runtimeSnapshotPath traversal', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'jaroo-dump-sink-'))
  try {
    const root = await initializeDebugArtifactRoot(tmp, 'request-2')
    await assert.rejects(
      () => writeDebugArtifactSet(root, {
        manifest: {
          requestId: 'request-2',
          generatedAt: '2026-04-20T00:00:00Z',
          contractVersion: 'v1',
          instrument: { ticker: 'NVDA' },
          sourceAliases: {},
          processedFiles: [],
          stripProfileVersion: 'v1',
          callUnits: [],
          errors: [],
          runtimeSnapshotPath: 'processed/nested/runtime-shape.json',
        },
        sharedDebug: {},
        memberDebug: {},
      }),
      /runtimeSnapshotPath must be processed\/runtime-shape\.json/,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})


test('writeDebugArtifactSet rejects member and axis key traversal', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'jaroo-dump-sink-'))
  try {
    const root = await initializeDebugArtifactRoot(tmp, 'request-3')
    await assert.rejects(
      () => writeDebugArtifactSet(root, {
        manifest: {
          requestId: 'request-3',
          generatedAt: '2026-04-20T00:00:00Z',
          contractVersion: 'v1',
          instrument: { ticker: 'NVDA' },
          sourceAliases: {},
          processedFiles: [],
          stripProfileVersion: 'v1',
          callUnits: [],
          errors: [],
        },
        sharedDebug: {},
        memberDebug: { '../escape': { ok: true } },
        axisDebug: { '../axis-escape': { ok: true } },
      }),
      /memberKey must be a single safe path segment/,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
