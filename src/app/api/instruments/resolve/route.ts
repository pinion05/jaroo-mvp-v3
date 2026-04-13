import { NextResponse } from 'next/server'

import { resolveHoldingInstrument, searchHoldingInstrumentCandidates, type ResolvedInstrument } from '@/lib/holding-instrument-lookup'
import {
  sanitizeOcrRows,
  type OcrInstrumentCandidate,
  type OcrRow,
} from '@/lib/screenshot-ocr'
import { enrichOcrRowsViaTickerMap, searchTickerMapCandidates } from '@/lib/ticker-map-resolver'

type ResolveInstrumentsRequest = {
  rows?: unknown
}

export const MAX_RESOLVE_ROWS = 100
export const MAX_RESOLVE_NAME_LENGTH = 200
export const MIN_VISIBLE_CANDIDATE_SCORE = 0.65
const MAX_CANDIDATES_PER_ROW = 5

function trimOrUndefined(value: string | null | undefined) {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : undefined
}

function buildCandidateId({ resolvedName, resolvedCode, resolvedTicker }: Pick<OcrInstrumentCandidate, 'resolvedName' | 'resolvedCode' | 'resolvedTicker'>) {
  return [resolvedCode, resolvedTicker, resolvedName.trim().toLowerCase()].filter(Boolean).join('::')
}

function toInstrumentCandidate(
  resolved: Pick<ResolvedInstrument, 'name' | 'code' | 'ticker' | 'market' | 'marketTone' | 'kind' | 'confidence'>,
  source: OcrInstrumentCandidate['source'],
  score = resolved.confidence,
  via?: string,
): OcrInstrumentCandidate {
  return {
    id: buildCandidateId({
      resolvedName: resolved.name,
      resolvedCode: resolved.code,
      resolvedTicker: resolved.ticker,
    }),
    resolvedName: resolved.name,
    resolvedCode: resolved.code,
    resolvedTicker: resolved.ticker,
    resolvedMarket: resolved.market,
    resolvedMarketTone: resolved.marketTone,
    resolvedKind: resolved.kind,
    source,
    score,
    via,
  }
}

export function filterVisibleInstrumentCandidates(candidates: OcrInstrumentCandidate[]) {
  return candidates.filter((candidate) => typeof candidate.score !== 'number' || candidate.score >= MIN_VISIBLE_CANDIDATE_SCORE)
}

function toResolvedOcrRow(row: OcrRow, resolved: ResolvedInstrument): OcrRow {
  return {
    ...row,
    resolvedName: resolved.name,
    resolvedCode: resolved.code,
    resolvedTicker: resolved.ticker,
    resolvedMarket: resolved.market,
    resolvedMarketTone: resolved.marketTone,
    resolvedKind: resolved.kind,
  }
}

function resolveVisibleInstrumentByName(name: string) {
  return searchHoldingInstrumentCandidates(name, 1, MIN_VISIBLE_CANDIDATE_SCORE)[0] ?? null
}

export function enrichResolveRowsWithVisibleInstrumentInfo(rows: OcrRow[]): OcrRow[] {
  return sanitizeOcrRows(rows).map((row) => {
    const resolved =
      resolveHoldingInstrument(row.resolvedCode ?? '') ??
      resolveHoldingInstrument(row.resolvedTicker ?? '') ??
      resolveVisibleInstrumentByName(row.name)

    if (!resolved) {
      return row
    }

    return toResolvedOcrRow(row, resolved)
  })
}

function dedupeCandidates(candidates: OcrInstrumentCandidate[]) {
  const uniqueCandidates = new Map<string, OcrInstrumentCandidate>()

  for (const candidate of candidates) {
    if (!candidate.id || uniqueCandidates.has(candidate.id)) {
      continue
    }

    uniqueCandidates.set(candidate.id, candidate)
  }

  return [...uniqueCandidates.values()]
}

function getCurrentResolvedInstrument(row: OcrRow) {
  return (
    resolveHoldingInstrument(row.resolvedCode ?? '') ??
    resolveHoldingInstrument(row.resolvedTicker ?? '') ??
    resolveHoldingInstrument(row.name)
  )
}

function buildLocalCandidates(row: OcrRow) {
  const nameMatches = searchHoldingInstrumentCandidates(row.name, MAX_CANDIDATES_PER_ROW).map((candidate) =>
    toInstrumentCandidate(candidate, 'local'),
  )
  const currentResolvedInstrument = getCurrentResolvedInstrument(row)

  return dedupeCandidates(
    filterVisibleInstrumentCandidates([
      ...(currentResolvedInstrument ? [toInstrumentCandidate(currentResolvedInstrument, 'local')] : []),
      ...nameMatches,
    ]),
  ).slice(0, MAX_CANDIDATES_PER_ROW)
}

async function buildTickerMapCandidates(row: OcrRow) {
  const currentResolvedInstrument = getCurrentResolvedInstrument(row)

  if (currentResolvedInstrument?.locale === 'KR') {
    return []
  }

  const matches = await searchTickerMapCandidates(row.name, MAX_CANDIDATES_PER_ROW)

  return dedupeCandidates(
    filterVisibleInstrumentCandidates(
      matches
        .map((match) => {
          const resolvedTicker = trimOrUndefined(match.ticker)?.toUpperCase()
          const resolvedViaTicker = resolvedTicker ? resolveHoldingInstrument(resolvedTicker) : null

          if (resolvedViaTicker) {
            return toInstrumentCandidate(
              {
                ...resolvedViaTicker,
                confidence: typeof match.score === 'number' ? match.score : resolvedViaTicker.confidence,
              },
              'ticker-map',
              typeof match.score === 'number' ? match.score : resolvedViaTicker.confidence,
              trimOrUndefined(match.via),
            )
          }

          const resolvedName = trimOrUndefined(match.canonicalEn) ?? trimOrUndefined(match.canonicalKo)

          if (!resolvedName && !resolvedTicker) {
            return null
          }

          const fallbackName = resolvedName ?? resolvedTicker ?? row.name.trim()

          return {
            id: buildCandidateId({
              resolvedName: fallbackName,
              resolvedCode: undefined,
              resolvedTicker,
            }),
            resolvedName: fallbackName,
            resolvedTicker,
            source: 'ticker-map' as const,
            score: typeof match.score === 'number' ? match.score : undefined,
            via: trimOrUndefined(match.via),
          }
        })
        .filter((candidate): candidate is OcrInstrumentCandidate => candidate !== null),
    ),
  ).slice(0, MAX_CANDIDATES_PER_ROW)
}

async function buildResolveCandidates(rows: OcrRow[]) {
  return Promise.all(
    rows.map(async (row) => {
      const [tickerMapCandidates, localCandidates] = await Promise.all([buildTickerMapCandidates(row), Promise.resolve(buildLocalCandidates(row))])

      return dedupeCandidates([...tickerMapCandidates, ...localCandidates]).slice(0, MAX_CANDIDATES_PER_ROW)
    }),
  )
}

export function getResolveRowsValidationError(rows: OcrRow[]) {
  if (rows.length === 0) {
    return 'At least one OCR row is required.'
  }

  if (rows.length > MAX_RESOLVE_ROWS) {
    return `Too many OCR rows. Up to ${MAX_RESOLVE_ROWS} rows are supported per request.`
  }

  const hasTooLongName = rows.some((row) => row.name.length > MAX_RESOLVE_NAME_LENGTH)
  if (hasTooLongName) {
    return `OCR row names must be ${MAX_RESOLVE_NAME_LENGTH} characters or fewer.`
  }

  return ''
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as ResolveInstrumentsRequest | null
  const rows = sanitizeOcrRows(payload?.rows)
  const validationError = getResolveRowsValidationError(rows)

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const [tickerMapResolvedRows, candidates] = await Promise.all([enrichOcrRowsViaTickerMap(rows), buildResolveCandidates(rows)])
  const enrichedRows = enrichResolveRowsWithVisibleInstrumentInfo(tickerMapResolvedRows)

  return NextResponse.json({ rows: enrichedRows, candidates })
}
