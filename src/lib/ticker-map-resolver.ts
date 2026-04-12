import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OcrRow } from '@/lib/screenshot-ocr'

type TickerMapKrResult = {
  matched?: boolean
  name?: string | null
  code?: string | null
}

type TickerMapKrResolver = {
  resolve(query: string): TickerMapKrResult | null
}

type TickerMapUsResult = {
  ticker?: string | null
  canonicalKo?: string | null
  canonicalEn?: string | null
  via?: string | null
}

type TickerMapUsResolver = {
  resolve(query: string, options?: { topN?: number }): TickerMapUsResult[]
}

type TickerMapResolvers = {
  krResolver: TickerMapKrResolver
  usResolver: TickerMapUsResolver
}

const TICKER_MAP_REPO_ROOT_ENV = 'TICKER_MAP_REPO_ROOT'

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

function resolveTickerMapRepoRoot() {
  const configuredPath = process.env[TICKER_MAP_REPO_ROOT_ENV]?.trim()

  if (configuredPath) {
    return configuredPath
  }

  warnTickerMapOnce(
    'missing-repo-root',
    `${TICKER_MAP_REPO_ROOT_ENV} is not configured. Ticker-map resolution is disabled until an explicit repo path is provided.`,
  )

  return null
}

async function importExternalModule(modulePath: string) {
  const moduleUrl = pathToFileURL(modulePath).href

  return import(/* webpackIgnore: true */ moduleUrl) as Promise<Record<string, unknown>>
}

async function loadTickerMapResolvers(): Promise<TickerMapResolvers | null> {
  if (cachedResolversPromise) {
    return cachedResolversPromise
  }

  const repoRoot = resolveTickerMapRepoRoot()
  if (!repoRoot) {
    return null
  }

  const modulePaths = [
    path.join(repoRoot, 'src/kr-stock-resolver.js'),
    path.join(repoRoot, 'src/ko-fuzzy-resolver.js'),
  ]

  cachedResolversPromise = (async () => {
    try {
      const [{ createKrStockResolver }, { createKoFuzzyResolver }] = await Promise.all(modulePaths.map(importExternalModule))

      if (typeof createKrStockResolver !== 'function' || typeof createKoFuzzyResolver !== 'function') {
        warnTickerMapOnce(
          `invalid-exports:${repoRoot}`,
          `Ticker-map modules did not expose the expected resolver factories: ${modulePaths.join(', ')}`,
        )
        cachedResolversPromise = null
        return null
      }

      return {
        krResolver: createKrStockResolver() as TickerMapKrResolver,
        usResolver: createKoFuzzyResolver() as TickerMapUsResolver,
      }
    } catch (error) {
      warnTickerMapOnce(
        `load-failure:${repoRoot}`,
        `Failed to load ticker-map resolver modules from ${repoRoot}: ${modulePaths.join(', ')}`,
        error,
      )
      cachedResolversPromise = null
      return null
    }
  })()

  return cachedResolversPromise
}

function trimOrUndefined(value: string | null | undefined) {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : undefined
}

export async function resolveTickerMapRow(row: OcrRow): Promise<Partial<OcrRow> | null> {
  const query = row.name.trim()

  if (!query) {
    return null
  }

  const resolvers = await loadTickerMapResolvers()

  if (!resolvers) {
    return null
  }

  const krMatch = resolvers.krResolver.resolve(query)

  if (krMatch?.matched) {
    return {
      resolvedName: trimOrUndefined(krMatch.name) ?? query,
      resolvedCode: trimOrUndefined(krMatch.code),
    }
  }

  const usMatch = resolvers.usResolver.resolve(query, { topN: 1 })[0]
  const resolvedTicker = trimOrUndefined(usMatch?.ticker)?.toUpperCase()

  if (!resolvedTicker) {
    return null
  }

  return {
    resolvedName: trimOrUndefined(usMatch?.canonicalEn) ?? trimOrUndefined(usMatch?.canonicalKo) ?? query,
    resolvedTicker,
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
