import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolveHoldingInstrument } from '@/lib/holding-instrument-lookup'
import type { OcrRow } from '@/lib/screenshot-ocr'

export type TickerMapSearchCandidate = {
  ticker?: string | null
  canonicalKo?: string | null
  canonicalEn?: string | null
  via?: string | null
  score?: number | null
  recallRank?: number | null
  names?: string[] | null
}

type TickerMapUsResolver = {
  resolve(query: string, options?: { topN?: number }): TickerMapSearchCandidate[]
}

type TickerMapResolvers = {
  usResolver: TickerMapUsResolver
}

const TICKER_MAP_REPO_ROOT_ENV = 'TICKER_MAP_REPO_ROOT'
const DEFAULT_TICKER_MAP_REPO_NAME = 'kr-us-stock-name-ticker-maps'
const WORKSPACE_INSTRUMENT_CORE_RELATIVE_PATH = path.join('packages', 'instrument-core')

let cachedResolversPromise: Promise<TickerMapResolvers | null> | null = null
const warnedTickerMapMessages = new Set<string>()

function warnTickerMapOnce(key: string, message: string, error?: unknown) {
  if (warnedTickerMapMessages.has(key)) {
    return
  }

  warnedTickerMapMessages.add(key)

  const errorDetails =
    error instanceof Error ? ` (${error.name}: ${error.message})` : error ? ` (${String(error)})` : ''

  console.warn(`[ticker-map-resolver] ${message}${errorDetails}`)
}

function trimOrUndefined(value: string | null | undefined) {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : undefined
}

function hasKoFuzzyResolverModule(repoRoot: string) {
  return fs.existsSync(path.join(repoRoot, 'src/ko-fuzzy-resolver.js'))
}

function getDefaultTickerMapRepoCandidates() {
  const homeDir = os.homedir()
  const cwd = process.cwd()

  return [
    path.resolve(cwd, WORKSPACE_INSTRUMENT_CORE_RELATIVE_PATH),
    path.resolve(cwd, '..', WORKSPACE_INSTRUMENT_CORE_RELATIVE_PATH),
    path.resolve(cwd, '..', '..', WORKSPACE_INSTRUMENT_CORE_RELATIVE_PATH),
    homeDir ? path.join(homeDir, DEFAULT_TICKER_MAP_REPO_NAME) : '',
    path.resolve(cwd, '..', DEFAULT_TICKER_MAP_REPO_NAME),
    path.resolve(cwd, '..', '..', DEFAULT_TICKER_MAP_REPO_NAME),
    path.resolve(cwd, '..', '..', '..', DEFAULT_TICKER_MAP_REPO_NAME),
  ].filter(Boolean)
}

function canUseDefaultTickerMapRepoDiscovery() {
  return process.env.NODE_ENV !== 'production'
}

function resolveTickerMapRepoRoot() {
  const configuredPath = process.env[TICKER_MAP_REPO_ROOT_ENV]?.trim()

  if (configuredPath) {
    if (hasKoFuzzyResolverModule(configuredPath)) {
      return configuredPath
    }

    warnTickerMapOnce(
      `missing-configured-repo-root:${configuredPath}`,
      `${TICKER_MAP_REPO_ROOT_ENV} is set but src/ko-fuzzy-resolver.js was not found under ${configuredPath}.`,
    )
  }

  if (!canUseDefaultTickerMapRepoDiscovery()) {
    warnTickerMapOnce(
      'missing-repo-root',
      `${TICKER_MAP_REPO_ROOT_ENV} is not configured. Ticker-map resolution is disabled in production until an explicit repo path is provided.`,
    )

    return null
  }

  const defaultRepoRoot = getDefaultTickerMapRepoCandidates().find((candidatePath) => hasKoFuzzyResolverModule(candidatePath))

  if (defaultRepoRoot) {
    warnTickerMapOnce(
      `using-default-repo-root:${defaultRepoRoot}`,
      `${TICKER_MAP_REPO_ROOT_ENV} is not configured. Falling back to ${defaultRepoRoot}.`,
    )

    return defaultRepoRoot
  }

  warnTickerMapOnce(
    'missing-repo-root',
    `${TICKER_MAP_REPO_ROOT_ENV} is not configured and no colocated ${DEFAULT_TICKER_MAP_REPO_NAME} repo was found. Ticker-map resolution is disabled.`,
  )

  return null
}

async function importExternalModule(modulePath: string) {
  const moduleUrl = pathToFileURL(modulePath).href

  return import(/* webpackIgnore: true */ moduleUrl) as Promise<Record<string, unknown>>
}

function getCreateKoFuzzyResolver(moduleExports: Record<string, unknown>) {
  if (typeof moduleExports.createKoFuzzyResolver === 'function') {
    return moduleExports.createKoFuzzyResolver as () => TickerMapUsResolver
  }

  const defaultExport = moduleExports.default

  if (
    typeof defaultExport === 'object' &&
    defaultExport !== null &&
    typeof (defaultExport as Record<string, unknown>).createKoFuzzyResolver === 'function'
  ) {
    return (defaultExport as Record<string, unknown>).createKoFuzzyResolver as () => TickerMapUsResolver
  }

  return null
}

async function loadTickerMapResolvers(): Promise<TickerMapResolvers | null> {
  if (cachedResolversPromise) {
    return cachedResolversPromise
  }

  const repoRoot = resolveTickerMapRepoRoot()
  if (!repoRoot) {
    return null
  }

  const modulePath = path.join(repoRoot, 'src/ko-fuzzy-resolver.js')

  cachedResolversPromise = (async () => {
    try {
      const moduleExports = await importExternalModule(modulePath)
      const createKoFuzzyResolver = getCreateKoFuzzyResolver(moduleExports)

      if (!createKoFuzzyResolver) {
        warnTickerMapOnce(
          `invalid-exports:${repoRoot}`,
          `Ticker-map module did not expose createKoFuzzyResolver: ${modulePath}`,
        )
        cachedResolversPromise = null
        return null
      }

      return {
        usResolver: createKoFuzzyResolver(),
      }
    } catch (error) {
      warnTickerMapOnce(`load-failure:${repoRoot}`, `Failed to load ticker-map resolver module from ${modulePath}`, error)
      cachedResolversPromise = null
      return null
    }
  })()

  return cachedResolversPromise
}

function normalizeTickerMapCandidate(candidate: TickerMapSearchCandidate): TickerMapSearchCandidate | null {
  const ticker = trimOrUndefined(candidate.ticker)?.toUpperCase()
  const canonicalKo = trimOrUndefined(candidate.canonicalKo)
  const canonicalEn = trimOrUndefined(candidate.canonicalEn)
  const via = trimOrUndefined(candidate.via)
  const score = typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? candidate.score : undefined
  const recallRank = typeof candidate.recallRank === 'number' && Number.isFinite(candidate.recallRank) ? candidate.recallRank : undefined
  const names = Array.isArray(candidate.names)
    ? candidate.names
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
    : undefined

  if (!ticker && !canonicalKo && !canonicalEn) {
    return null
  }

  return {
    ticker,
    canonicalKo,
    canonicalEn,
    via,
    score,
    recallRank,
    names,
  }
}

export async function searchTickerMapCandidates(query: string, topN = 5): Promise<TickerMapSearchCandidate[]> {
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return []
  }

  const resolvers = await loadTickerMapResolvers()

  if (!resolvers) {
    return []
  }

  return resolvers.usResolver
    .resolve(normalizedQuery, { topN })
    .map((candidate) => normalizeTickerMapCandidate(candidate))
    .filter((candidate): candidate is TickerMapSearchCandidate => candidate !== null)
}

export function resetTickerMapResolverCacheForTests() {
  cachedResolversPromise = null
  warnedTickerMapMessages.clear()
}

export async function resolveTickerMapRow(row: OcrRow): Promise<Partial<OcrRow> | null> {
  const locallyResolvedInstrument =
    resolveHoldingInstrument(row.resolvedCode ?? '') ??
    resolveHoldingInstrument(row.resolvedTicker ?? '') ??
    resolveHoldingInstrument(row.name)

  if (locallyResolvedInstrument?.locale === 'KR') {
    return null
  }

  const bestCandidate = (await searchTickerMapCandidates(row.name, 1))[0]

  if (!bestCandidate) {
    return null
  }

  const isExactMatch = bestCandidate.via === 'exact' || (bestCandidate.score ?? 0) >= 0.99

  if (!isExactMatch) {
    return null
  }

  return {
    resolvedName: trimOrUndefined(bestCandidate.canonicalEn) ?? trimOrUndefined(bestCandidate.canonicalKo) ?? row.name.trim(),
    resolvedTicker: trimOrUndefined(bestCandidate.ticker)?.toUpperCase(),
  }
}

export async function enrichOcrRowsViaTickerMap(rows: OcrRow[]): Promise<OcrRow[]> {
  const enrichedRows = await Promise.all(
    rows.map(async (row) => {
      const resolved = await resolveTickerMapRow(row)

      if (!resolved) {
        return row
      }

      return {
        ...row,
        resolvedName: resolved.resolvedName ?? row.resolvedName,
        resolvedCode: resolved.resolvedCode ?? row.resolvedCode,
        resolvedTicker: resolved.resolvedTicker ?? row.resolvedTicker,
      }
    }),
  )

  return enrichedRows
}
