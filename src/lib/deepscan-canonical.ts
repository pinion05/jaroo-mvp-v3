import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

import type { HomeHolding, HomeMarketTone } from './jaroo-home-data'

type UnknownRecord = Record<string, unknown>

type DeepScanCanonicalHolding = Pick<
  HomeHolding,
  'name' | 'code' | 'identifierCode' | 'identifierTicker' | 'shares' | 'averagePrice' | 'evaluationAmount' | 'market' | 'marketTone'
> & {
  ticker?: string
}

export type DeepScanCanonicalTargetSession = {
  holding: DeepScanCanonicalHolding
  selectedAt?: string
}

const CANONICAL_QUERY_KEYS = [
  'market',
  'code',
  'ticker',
  'name',
  'shares',
  'averagePrice',
  'evaluationAmount',
  'selectedAt',
  'from',
] as const

const MAJOR_BLOCK_KEYS = [
  'hero',
  'committee',
  'insights',
  'strategy',
  'sellNow',
  'portfolioSimulation',
] as const

const BLOCK_STATES = new Set(['ok', 'error', 'blocked'])

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function isKnownMarketTone(value: unknown): value is HomeMarketTone {
  return value === 'kospi' || value === 'kosdaq' || value === 'etf' || value === 'nasdaq'
}

function resolveCanonicalMarket(holding: DeepScanCanonicalHolding) {
  const market = normalizeText(holding.market)?.toUpperCase()
  const marketTone = isKnownMarketTone(holding.marketTone) ? holding.marketTone : undefined
  const code = normalizeText(holding.code) ?? normalizeText(holding.identifierCode)
  const ticker = normalizeText(holding.ticker) ?? normalizeText(holding.identifierTicker)

  if (
    marketTone === 'nasdaq'
    || market === 'US'
    || market === 'NASDAQ'
    || market === 'NYSE'
    || market === 'AMEX'
  ) {
    return 'US'
  }

  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ' || marketTone === 'kospi' || marketTone === 'kosdaq') {
    return 'KR'
  }

  if (code) {
    return 'KR'
  }

  if (ticker) {
    return 'US'
  }

  return undefined
}

function setQueryValue(searchParams: URLSearchParams, key: (typeof CANONICAL_QUERY_KEYS)[number], value: unknown) {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue) {
    return
  }

  searchParams.set(key, normalizedValue)
}

function isBlockMeta(block: unknown) {
  const record = asRecord(block)
  if (!record) {
    return false
  }

  if (!BLOCK_STATES.has(String(record.blockState))) {
    return false
  }

  if (!Array.isArray(record.sourceRefs)) {
    return false
  }

  if (record.fallback !== null && asRecord(record.fallback) === null) {
    return false
  }

  if (record.error !== null && asRecord(record.error) === null) {
    return false
  }

  return true
}

function isCanonicalPayload(payload: unknown): payload is JarooDeepScanPayload {
  const record = asRecord(payload)
  if (!record) {
    return false
  }

  const input = asRecord(record.input)
  const instrument = asRecord(input?.instrument)
  const metadata = asRecord(record.metadata)
  const inputValidity = asRecord(metadata?.inputValidity)
  const blockStatus = asRecord(metadata?.blockStatus)

  if (!input || !instrument || typeof instrument.name !== 'string' || !instrument.name.trim()) {
    return false
  }

  if (
    !metadata
    || typeof metadata.generatedAt !== 'string'
    || typeof metadata.version !== 'string'
    || typeof metadata.degraded !== 'boolean'
    || typeof metadata.debugId !== 'string'
    || !Array.isArray(metadata.sourceRefs)
  ) {
    return false
  }

  if (!inputValidity || typeof inputValidity.valid !== 'boolean' || !blockStatus) {
    return false
  }

  for (const key of MAJOR_BLOCK_KEYS) {
    if (!isBlockMeta(record[key])) {
      return false
    }

    if (!BLOCK_STATES.has(String(blockStatus[key]))) {
      return false
    }

    if (blockStatus[key] !== asRecord(record[key])?.blockState) {
      return false
    }
  }

  return true
}

export function buildDeepScanCanonicalQuery(targetSession: DeepScanCanonicalTargetSession) {
  const searchParams = new URLSearchParams()
  const { holding } = targetSession

  setQueryValue(searchParams, 'market', resolveCanonicalMarket(holding))
  setQueryValue(searchParams, 'code', normalizeText(holding.code) ?? normalizeText(holding.identifierCode))
  setQueryValue(searchParams, 'ticker', normalizeText(holding.ticker) ?? normalizeText(holding.identifierTicker))
  setQueryValue(searchParams, 'name', holding.name)
  setQueryValue(searchParams, 'shares', holding.shares)
  setQueryValue(searchParams, 'averagePrice', holding.averagePrice)
  setQueryValue(searchParams, 'evaluationAmount', holding.evaluationAmount)
  setQueryValue(searchParams, 'selectedAt', targetSession.selectedAt)
  searchParams.set('from', 'home-handoff')

  return searchParams
}

export async function fetchDeepScanCanonicalPayload(
  targetSession: DeepScanCanonicalTargetSession,
  fetcher: typeof fetch = fetch,
) {
  const query = buildDeepScanCanonicalQuery(targetSession).toString()
  const response = await fetcher(`/api/deepscan?${query}`, { cache: 'no-store' })
  const payload = await response.json()

  return isCanonicalPayload(payload) ? payload : null
}

export function isDeepScanPayloadReady(payload: unknown): payload is JarooDeepScanPayload {
  return isCanonicalPayload(payload)
}

export function readBlockedReason(payload: unknown) {
  if (!isCanonicalPayload(payload)) {
    return null
  }

  for (const key of MAJOR_BLOCK_KEYS) {
    if (payload[key].blockState === 'ok') {
      continue
    }

    return payload[key].fallback?.reason ?? payload[key].error?.code ?? payload.metadata.errorCode ?? null
  }

  return null
}
