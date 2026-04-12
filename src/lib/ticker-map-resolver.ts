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

const DEFAULT_TICKER_MAP_REPO_ROOT = '/home/pinion/worktrees/kr-us-stock-name-ticker-maps-unified-stock-lookup'

let cachedResolversPromise: Promise<TickerMapResolvers | null> | null = null

function resolveTickerMapRepoRoot() {
  const configuredPath = process.env.TICKER_MAP_REPO_ROOT?.trim()
  return configuredPath || DEFAULT_TICKER_MAP_REPO_ROOT
}

async function importExternalModule(modulePath: string) {
  const moduleUrl = pathToFileURL(modulePath).href

  return Function('modulePath', 'return import(modulePath)')(moduleUrl) as Promise<Record<string, unknown>>
}

async function loadTickerMapResolvers(): Promise<TickerMapResolvers | null> {
  if (!cachedResolversPromise) {
    cachedResolversPromise = (async () => {
      try {
        const repoRoot = resolveTickerMapRepoRoot()
        const [{ createKrStockResolver }, { createKoFuzzyResolver }] = await Promise.all([
          importExternalModule(path.join(repoRoot, 'src/kr-stock-resolver.js')),
          importExternalModule(path.join(repoRoot, 'src/ko-fuzzy-resolver.js')),
        ])

        if (typeof createKrStockResolver !== 'function' || typeof createKoFuzzyResolver !== 'function') {
          return null
        }

        return {
          krResolver: createKrStockResolver() as TickerMapKrResolver,
          usResolver: createKoFuzzyResolver() as TickerMapUsResolver,
        }
      } catch {
        return null
      }
    })()
  }

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
