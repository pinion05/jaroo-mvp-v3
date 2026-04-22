import instrumentUniverse from './data/instrument-universe.json'
import { sanitizeOcrRows, type OcrRow } from './screenshot-ocr'

type InstrumentKind = 'stock' | 'etf'
type InstrumentMarketTone = 'kospi' | 'kosdaq' | 'nasdaq' | 'etf'
type InstrumentLocale = 'KR' | 'US'

type InstrumentUniverseEntry = {
  name: string
  code?: string
  ticker?: string
  market: string
  marketTone: InstrumentMarketTone
  kind: InstrumentKind
  locale: InstrumentLocale
  aliases?: string[]
}

type SearchTermSource = 'name' | 'alias' | 'code' | 'ticker'

type IndexedSearchTerm = {
  normalized: string
  tokens: string[]
  grams: Map<string, number>
  source: SearchTermSource
}

type IndexedInstrument = InstrumentUniverseEntry & {
  searchTerms: IndexedSearchTerm[]
}

type RankedInstrumentMatch = {
  entry: IndexedInstrument
  score: number
}

export type ResolvedInstrument = {
  name: string
  code?: string
  ticker?: string
  market: string
  marketTone: InstrumentMarketTone
  kind: InstrumentKind
  locale: InstrumentLocale
  confidence: number
}

const CODE_PATTERN = /\b\d{6}\b/
const STRUCTURED_TICKER_PATTERN = /^[A-Z]{1,5}$/
const PURE_TICKER_QUERY_PATTERN = /^[A-Z]{3,5}$/
const MIN_CONFIDENCE = 0.62
const MIN_CANDIDATE_CONFIDENCE = 0.45

function normalizeLookupValue(value: string) {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^0-9a-z가-힣]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function collapseNormalizedValue(value: string) {
  return normalizeLookupValue(value).replace(/\s+/g, '')
}

function tokenizeNormalizedValue(value: string) {
  return normalizeLookupValue(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

function buildGramMap(value: string, gramSize = 3) {
  const collapsed = collapseNormalizedValue(value)
  const grams = new Map<string, number>()

  if (!collapsed) {
    return grams
  }

  if (collapsed.length <= gramSize) {
    grams.set(collapsed, 1)
    return grams
  }

  for (let index = 0; index <= collapsed.length - gramSize; index += 1) {
    const gram = collapsed.slice(index, index + gramSize)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }

  return grams
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>) {
  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (const value of left.values()) {
    leftMagnitude += value * value
  }

  for (const value of right.values()) {
    rightMagnitude += value * value
  }

  for (const [key, value] of left.entries()) {
    dotProduct += value * (right.get(key) ?? 0)
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude)
}

function jaccardSimilarity(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size
  return union === 0 ? 0 : intersection / union
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0
  }

  if (!left.length) {
    return right.length
  }

  if (!right.length) {
    return left.length
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = new Array(right.length + 1).fill(0)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      )
    }

    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previous[rightIndex] = current[rightIndex]
    }
  }

  return previous[right.length]
}

function levenshteinSimilarity(left: string, right: string) {
  if (!left || !right) {
    return 0
  }

  const distance = levenshteinDistance(left, right)
  return 1 - distance / Math.max(left.length, right.length)
}

function normalizeIdentifier(value?: string) {
  if (!value) {
    return ''
  }

  return value.trim().toUpperCase()
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function toIndexedSearchTerm(candidate: string, source: SearchTermSource): IndexedSearchTerm {
  return {
    normalized: collapseNormalizedValue(candidate),
    tokens: tokenizeNormalizedValue(candidate),
    grams: buildGramMap(candidate),
    source,
  }
}

const rawUniverse = instrumentUniverse as InstrumentUniverseEntry[]

const indexedUniverse: IndexedInstrument[] = rawUniverse.map((entry) => {
  const searchTerms = [
    ...uniqueStrings([entry.name]).map((candidate) => toIndexedSearchTerm(candidate, 'name')),
    ...uniqueStrings([entry.code]).map((candidate) => toIndexedSearchTerm(candidate, 'code')),
    ...uniqueStrings([entry.ticker]).map((candidate) => toIndexedSearchTerm(candidate, 'ticker')),
    ...uniqueStrings(entry.aliases ?? []).map((candidate) => toIndexedSearchTerm(candidate, 'alias')),
  ]

  return {
    ...entry,
    searchTerms,
  }
})

const codeIndex = new Map<string, IndexedInstrument>()
const tickerIndex = new Map<string, IndexedInstrument>()
const exactSearchTermIndex = new Map<string, IndexedInstrument[]>()

for (const entry of indexedUniverse) {
  if (entry.code) {
    codeIndex.set(normalizeIdentifier(entry.code), entry)
  }

  if (entry.ticker) {
    tickerIndex.set(normalizeIdentifier(entry.ticker), entry)
  }

  for (const term of entry.searchTerms) {
    if (!term.normalized) {
      continue
    }

    const existingEntries = exactSearchTermIndex.get(term.normalized) ?? []
    if (!existingEntries.includes(entry)) {
      existingEntries.push(entry)
      exactSearchTermIndex.set(term.normalized, existingEntries)
    }
  }
}

function toResolvedInstrument(entry: IndexedInstrument, confidence: number): ResolvedInstrument {
  return {
    name: entry.name,
    code: entry.code,
    ticker: entry.ticker,
    market: entry.market,
    marketTone: entry.marketTone,
    kind: entry.kind,
    locale: entry.locale,
    confidence,
  }
}

function getResolvedInstrumentKey(candidate: Pick<ResolvedInstrument, 'code' | 'ticker' | 'name'>) {
  return normalizeIdentifier(candidate.code) || normalizeIdentifier(candidate.ticker) || collapseNormalizedValue(candidate.name)
}

function dedupeResolvedInstruments(candidates: ResolvedInstrument[]) {
  const uniqueCandidates = new Map<string, ResolvedInstrument>()

  for (const candidate of candidates) {
    const candidateKey = getResolvedInstrumentKey(candidate)

    if (!candidateKey || uniqueCandidates.has(candidateKey)) {
      continue
    }

    uniqueCandidates.set(candidateKey, candidate)
  }

  return [...uniqueCandidates.values()]
}

function extractStructuredIdentifiers(query: string) {
  const normalizedTokens = tokenizeNormalizedValue(query)
  const ignoreSingleCharacterEmbeddedTickers = normalizedTokens.length > 1
  const code = query.match(CODE_PATTERN)?.[0] ?? ''
  const tickerTokens = Array.from(
    new Set(
      query
        .toUpperCase()
        .split(/[^0-9A-Z가-힣]+/)
        .map((token) => token.trim())
        .filter((token) => STRUCTURED_TICKER_PATTERN.test(token))
        .filter((token) => !ignoreSingleCharacterEmbeddedTickers || token.length > 1),
    ),
  )

  return {
    code,
    tickerTokens,
  }
}

function isPureTickerLikeQuery(query: string) {
  return PURE_TICKER_QUERY_PATTERN.test(normalizeIdentifier(query))
}

function compareRankedInstrumentMatches(left: RankedInstrumentMatch, right: RankedInstrumentMatch) {
  return right.score - left.score || left.entry.name.localeCompare(right.entry.name, 'ko-KR')
}

function getSearchTermSourcePriority(source: SearchTermSource) {
  switch (source) {
    case 'name':
      return 0
    case 'alias':
      return 1
    case 'code':
      return 2
    case 'ticker':
      return 3
    default:
      return 4
  }
}

function insertRankedInstrumentMatch(matches: RankedInstrumentMatch[], nextMatch: RankedInstrumentMatch, limit: number) {
  if (matches.length >= limit && compareRankedInstrumentMatches(nextMatch, matches[matches.length - 1]) >= 0) {
    return
  }

  matches.push(nextMatch)

  for (let index = matches.length - 1; index > 0; index -= 1) {
    if (compareRankedInstrumentMatches(matches[index], matches[index - 1]) >= 0) {
      break
    }

    const previousMatch = matches[index - 1]
    matches[index - 1] = matches[index]
    matches[index] = previousMatch
  }

  if (matches.length > limit) {
    matches.pop()
  }
}

function scoreSearchTerm(
  queryCollapsed: string,
  queryTokens: string[],
  queryGrams: Map<string, number>,
  term: IndexedSearchTerm,
  isPureTickerQuery: boolean,
) {
  if (!queryCollapsed || !term.normalized) {
    return 0
  }

  if (queryCollapsed === term.normalized) {
    return 1
  }

  const queryContainsTerm = queryCollapsed.includes(term.normalized)
  const termContainsQuery = term.normalized.includes(queryCollapsed)

  if (isPureTickerQuery && term.source === 'ticker' && queryCollapsed.length > term.normalized.length) {
    return 0
  }

  const containsScore =
    queryContainsTerm || termContainsQuery
      ? Math.min(queryCollapsed.length, term.normalized.length) / Math.max(queryCollapsed.length, term.normalized.length)
      : 0
  const prefixScore = queryCollapsed.startsWith(term.normalized) || term.normalized.startsWith(queryCollapsed) ? 1 : 0
  const levenshteinScore = levenshteinSimilarity(queryCollapsed, term.normalized)
  const semanticScore = cosineSimilarity(queryGrams, term.grams)
  const tokenScore = jaccardSimilarity(queryTokens, term.tokens)

  return semanticScore * 0.4 + levenshteinScore * 0.3 + containsScore * 0.2 + tokenScore * 0.1 + prefixScore * 0.08
}

function resolveByExactIdentifier(query: string) {
  const normalizedIdentifier = normalizeIdentifier(query)

  if (!normalizedIdentifier) {
    return null
  }

  return codeIndex.get(normalizedIdentifier) ?? tickerIndex.get(normalizedIdentifier) ?? null
}

function resolveByExactSearchTerm(query: string, limit: number) {
  const normalizedQuery = collapseNormalizedValue(query)

  if (!normalizedQuery) {
    return []
  }

  const exactMatches = exactSearchTermIndex.get(normalizedQuery) ?? []

  return exactMatches
    .map((entry) => ({
      entry,
      priority: Math.min(
        ...entry.searchTerms
          .filter((term) => term.normalized === normalizedQuery)
          .map((term) => getSearchTermSourcePriority(term.source)),
      ),
    }))
    .sort((left, right) => left.priority - right.priority || left.entry.name.localeCompare(right.entry.name, 'ko-KR'))
    .slice(0, limit)
    .map(({ entry }) => toResolvedInstrument(entry, 1))
}

export function getInstrumentUniverseStats() {
  const krCount = indexedUniverse.filter((entry) => entry.locale === 'KR').length
  const usCount = indexedUniverse.filter((entry) => entry.locale === 'US').length

  return {
    totalCount: indexedUniverse.length,
    krCount,
    usCount,
  }
}

export function searchHoldingInstrumentCandidates(identifier: string, limit = 5, minConfidence = MIN_CANDIDATE_CONFIDENCE): ResolvedInstrument[] {
  if (limit <= 0) {
    return []
  }

  const directMatch = resolveByExactIdentifier(identifier)

  if (directMatch) {
    return [toResolvedInstrument(directMatch, 1)]
  }

  const exactTermMatches = resolveByExactSearchTerm(identifier, limit)
  if (exactTermMatches.length > 0) {
    return exactTermMatches
  }

  const { code, tickerTokens } = extractStructuredIdentifiers(identifier)
  const embeddedCodeMatch = resolveByExactIdentifier(code)
  const structuredMatches = dedupeResolvedInstruments([
    ...(embeddedCodeMatch ? [toResolvedInstrument(embeddedCodeMatch, 0.99)] : []),
    ...tickerTokens.flatMap((ticker) => {
      const embeddedTickerMatch = resolveByExactIdentifier(ticker)
      return embeddedTickerMatch ? [toResolvedInstrument(embeddedTickerMatch, 0.98)] : []
    }),
  ])

  if (structuredMatches.length > 0) {
    return structuredMatches.slice(0, limit)
  }

  const queryCollapsed = collapseNormalizedValue(identifier)
  const queryTokens = tokenizeNormalizedValue(identifier)
  const queryGrams = buildGramMap(identifier)
  const pureTickerLikeQuery = isPureTickerLikeQuery(identifier)

  if (!queryCollapsed) {
    return []
  }

  const rankedMatches: RankedInstrumentMatch[] = []

  for (const entry of indexedUniverse) {
    let entryBestScore = 0

    for (const term of entry.searchTerms) {
      entryBestScore = Math.max(entryBestScore, scoreSearchTerm(queryCollapsed, queryTokens, queryGrams, term, pureTickerLikeQuery))
    }

    if (entryBestScore < minConfidence) {
      continue
    }

    insertRankedInstrumentMatch(
      rankedMatches,
      {
        entry,
        score: entryBestScore,
      },
      limit,
    )
  }

  return rankedMatches.map(({ entry, score }) => toResolvedInstrument(entry, score))
}

export function resolveHoldingInstrument(identifier: string): ResolvedInstrument | null {
  return searchHoldingInstrumentCandidates(identifier, 1, MIN_CONFIDENCE)[0] ?? null
}

export function enrichOcrRowsWithInstrumentInfo(rows: OcrRow[]): OcrRow[] {
  return sanitizeOcrRows(rows).map((row) => {
    const resolved =
      resolveHoldingInstrument(row.resolvedCode ?? '') ??
      resolveHoldingInstrument(row.resolvedTicker ?? '') ??
      resolveHoldingInstrument(row.name)

    if (!resolved) {
      return row
    }

    return {
      ...row,
      resolvedName: resolved.name,
      resolvedCode: resolved.code,
      resolvedTicker: resolved.ticker,
      resolvedMarket: resolved.market,
      resolvedMarketTone: resolved.marketTone,
      resolvedKind: resolved.kind,
    }
  })
}
