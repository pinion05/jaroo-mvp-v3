import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, normalize } from 'node:path'
import type { DebugManifest } from './dump-contract'
import { stripProvenance } from './strip-provenance'

export type DebugArtifactSet = {
  manifest: DebugManifest
  sharedDebug: unknown
  memberDebug: Record<string, unknown>
  axisDebug?: Record<string, unknown>
}

type RuntimeShape = {
  shared: unknown
  members: Record<string, unknown>
  axes?: Record<string, unknown>
}

export async function initializeDebugArtifactRoot(baseDir: string, requestId: string) {
  if (
    requestId.length === 0
    || normalize(requestId) !== requestId
    || basename(requestId) !== requestId
    || requestId.includes('..')
  ) {
    throw new Error('requestId must be a single safe path segment')
  }

  const root = join(baseDir, requestId)
  await mkdir(join(root, 'processed'), { recursive: true })
  await mkdir(join(root, 'raw'), { recursive: true })
  return root
}

function stableStringify(value: unknown) {
  return JSON.stringify(value, null, 2)
}

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

function buildRuntimeShape(sharedDebug: unknown, memberDebug: Record<string, unknown>, axisDebug?: Record<string, unknown>): RuntimeShape {
  return {
    shared: stripProvenance(sharedDebug),
    members: Object.fromEntries(Object.entries(memberDebug).map(([key, value]) => [key, stripProvenance(value)])),
    ...(axisDebug ? { axes: Object.fromEntries(Object.entries(axisDebug).map(([key, value]) => [key, stripProvenance(value)])) } : {}),
  }
}

function buildRuntimeShapeHash(runtimeShape: RuntimeShape) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(runtimeShape)))
    .digest('hex')
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths)]
}

function getSafeRuntimeSnapshotPath(path?: string) {
  const fallback = 'processed/runtime-shape.json'
  if (!path || path === fallback) {
    return fallback
  }

  throw new Error(`runtimeSnapshotPath must be ${fallback}`)
}

function getSafeArtifactKey(key: string, label: 'memberKey' | 'axisKey') {
  if (key.length === 0 || normalize(key) !== key || basename(key) !== key || key.includes('..')) {
    throw new Error(`${label} must be a single safe path segment`)
  }

  return key
}

export async function writeDebugArtifactSet(root: string, artifactSet: DebugArtifactSet) {
  const processedDir = join(root, 'processed')
  const manifestPath = join(root, 'manifest.json')
  const runtimeShape = buildRuntimeShape(artifactSet.sharedDebug, artifactSet.memberDebug, artifactSet.axisDebug)
  const runtimeSnapshotPath = getSafeRuntimeSnapshotPath(artifactSet.manifest.runtimeSnapshotPath)
  const memberEntries = Object.entries(artifactSet.memberDebug).map(([memberKey, dump]) => ({
    memberKey,
    safeMemberKey: getSafeArtifactKey(memberKey, 'memberKey'),
    dump,
  }))
  const axisEntries = Object.entries(artifactSet.axisDebug ?? {}).map(([axisKey, dump]) => ({
    axisKey,
    safeAxisKey: getSafeArtifactKey(axisKey, 'axisKey'),
    dump,
  }))
  const debugPaths = [
    'processed/shared-context-debug.json',
    ...memberEntries.map(({ safeMemberKey }) => `processed/member-${safeMemberKey}-debug.json`),
    ...axisEntries.map(({ safeAxisKey }) => `processed/axis-${safeAxisKey}-debug.json`),
  ]
  const runtimePaths = [
    'processed/shared-context-runtime.json',
    runtimeSnapshotPath,
    ...memberEntries.map(({ safeMemberKey }) => `processed/member-${safeMemberKey}-runtime.json`),
    ...axisEntries.map(({ safeAxisKey }) => `processed/axis-${safeAxisKey}-runtime.json`),
  ]
  const memberDebugPaths = Object.fromEntries(
    memberEntries.map(({ memberKey, safeMemberKey }) => [memberKey, `processed/member-${safeMemberKey}-debug.json`]),
  )
  const axisDebugPaths = Object.fromEntries(
    axisEntries.map(({ axisKey, safeAxisKey }) => [axisKey, `processed/axis-${safeAxisKey}-debug.json`]),
  )
  const callUnits = artifactSet.manifest.callUnits.map((callUnit) => ({
    member: getSafeArtifactKey(callUnit.member, 'memberKey'),
    sharedFile: 'processed/shared-context-runtime.json',
    memberFile: `processed/member-${getSafeArtifactKey(callUnit.member, 'memberKey')}-runtime.json`,
  }))
  const manifest = {
    ...artifactSet.manifest,
    sharedDebugPath: 'processed/shared-context-debug.json',
    memberDebugPaths: Object.keys(memberDebugPaths).length > 0 ? memberDebugPaths : undefined,
    axisDebugPaths: Object.keys(axisDebugPaths).length > 0 ? axisDebugPaths : undefined,
    callUnits,
    processedFiles: uniquePaths([...artifactSet.manifest.processedFiles, ...debugPaths, ...runtimePaths]),
    runtimeSnapshotPath,
    runtimeShapeHash: buildRuntimeShapeHash(runtimeShape),
  }

  await writeFile(manifestPath, stableStringify(manifest))

  const errors = [...manifest.errors]
  const sharedPath = join(processedDir, 'shared-context-debug.json')
  const sharedRuntimePath = join(processedDir, 'shared-context-runtime.json')
  await writeFile(sharedPath, stableStringify(artifactSet.sharedDebug))
  await writeFile(sharedRuntimePath, stableStringify(runtimeShape.shared))

  for (const { memberKey, safeMemberKey, dump } of memberEntries) {
    const debugPath = join(processedDir, `member-${safeMemberKey}-debug.json`)
    const runtimePath = join(processedDir, `member-${safeMemberKey}-runtime.json`)
    try {
      await writeFile(debugPath, stableStringify(dump))
      await writeFile(runtimePath, stableStringify(runtimeShape.members[memberKey]))
    } catch (error) {
      errors.push({
        stage: 'write-member-debug',
        memberKey,
        message: error instanceof Error ? error.message : 'unknown write failure',
      })
    }
  }

  for (const { axisKey, safeAxisKey, dump } of axisEntries) {
    const debugPath = join(processedDir, `axis-${safeAxisKey}-debug.json`)
    const runtimePath = join(processedDir, `axis-${safeAxisKey}-runtime.json`)
    try {
      await writeFile(debugPath, stableStringify(dump))
      await writeFile(runtimePath, stableStringify(runtimeShape.axes?.[axisKey]))
    } catch (error) {
      errors.push({
        stage: 'write-axis-debug',
        memberKey: axisKey,
        message: error instanceof Error ? error.message : 'unknown write failure',
      })
    }
  }

  await writeFile(join(root, runtimeSnapshotPath), stableStringify(runtimeShape))

  if (errors.length !== manifest.errors.length) {
    await writeFile(manifestPath, stableStringify({ ...manifest, errors }))
  }

  return {
    root,
    manifestPath,
    sharedPath,
    sharedRuntimePath,
    runtimeSnapshotPath: join(root, runtimeSnapshotPath),
    errors,
  }
}
