import type { JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'

import type { HomeHolding } from './jaroo-home-data'

type UnknownRecord = Record<string, unknown>

type DeepScanCanonicalHolding = Pick<
  HomeHolding,
  'name' | 'code' | 'identifierCode' | 'identifierTicker' | 'shares' | 'averagePrice' | 'evaluationAmount' | 'market' | 'marketTone'
> & {
  kind?: HomeHolding['kind']
  ticker?: string
  averagePriceCurrency?: string
  currentPrice?: string
  currentPriceCurrency?: string
  currentProfitRate?: string
  usdKrwRate?: string
}

export type DeepScanCanonicalTargetSession = {
  holding: DeepScanCanonicalHolding
  selectedAt?: string
}
type CanonicalQueryKey =
  | 'code'
  | 'ticker'
  | 'market'
  | 'kind'
  | 'name'
  | 'shares'
  | 'averagePrice'
  | 'averagePriceCurrency'
  | 'currentPrice'
  | 'currentPriceCurrency'
  | 'currentProfitRate'
  | 'evaluationAmount'
  | 'usdKrwRate'
  | 'selectedAt'
  | 'from'

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

function isPlaceholderSentinel(value: string) {
  const normalizedValue = value.replace(/[−–—]/g, '-').trim()

  if (/^-+$/.test(normalizedValue)) {
    return true
  }

  return normalizedValue.toLowerCase().replace(/[./\s]/g, '') === 'na'
}

function setQueryValue(searchParams: URLSearchParams, key: CanonicalQueryKey, value: unknown) {
  const normalizedValue = normalizeText(value)
  if (!normalizedValue) {
    return
  }

  searchParams.set(key, normalizedValue)
}

function setHoldingMetricQueryValue(searchParams: URLSearchParams, key: Extract<CanonicalQueryKey, 'averagePrice' | 'evaluationAmount'>, value: unknown) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue || isPlaceholderSentinel(normalizedValue)) {
    return
  }

  searchParams.set(key, normalizedValue)
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasOptionalStringFields(record: UnknownRecord, keys: readonly string[]) {
  return keys.every((key) => record[key] === undefined || typeof record[key] === 'string')
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

function hasRequiredStringFields(value: unknown, keys: readonly string[]) {
  const record = asRecord(value)
  return !!record && keys.every((key) => typeof record[key] === 'string')
}

function hasRequiredNumberFields(value: unknown, keys: readonly string[]) {
  const record = asRecord(value)
  return !!record && keys.every((key) => typeof record[key] === 'number')
}

function isCanonicalInput(input: unknown) {
  const record = asRecord(input)
  const instrument = asRecord(record?.instrument)
  const holding = record?.holding === undefined ? undefined : asRecord(record.holding)
  const sourceContext = asRecord(record?.sourceContext)

  if (!record || !instrument || typeof instrument.name !== 'string' || !instrument.name.trim()) {
    return false
  }

  if (!hasOptionalStringFields(instrument, ['code', 'ticker', 'market', 'kind'])) {
    return false
  }

  if (record.selectedAt !== undefined && typeof record.selectedAt !== 'string') {
    return false
  }

  if (!sourceContext || typeof sourceContext.from !== 'string' || !sourceContext.from.trim()) {
    return false
  }

  if (!hasOptionalStringFields(sourceContext, ['sessionKey', 'appliedAt'])) {
    return false
  }

  if (record.holding !== undefined && !holding) {
    return false
  }

  if (holding && !hasOptionalStringFields(holding, [
    'shares',
    'averagePrice',
    'averagePriceCurrency',
    'currentPrice',
    'currentPriceCurrency',
    'currentProfitRate',
    'evaluationAmount',
    'usdKrwRate',
  ])) {
    return false
  }

  return true
}

function isCanonicalHeroBlock(block: unknown) {
  return isBlockMeta(block)
    && hasRequiredStringFields(block, ['headline', 'body', 'statusText', 'scoreLabel', 'scoreDelta'])
    && hasRequiredNumberFields(block, ['score'])
}

function isCanonicalCommitteeBlock(block: unknown) {
  const record = asRecord(block)
  return isBlockMeta(block) && !!record && Array.isArray(record.axes)
}

function isCanonicalInsightsBlock(block: unknown) {
  const record = asRecord(block)
  return isBlockMeta(block)
    && !!record
    && typeof record.sectionLabel === 'string'
    && Array.isArray(record.items)
    && isStringArray(record.summaryTags)
}

function isCanonicalStrategyBlock(block: unknown) {
  const record = asRecord(block)
  return isBlockMeta(block)
    && hasRequiredStringFields(block, [
      'weekSignal',
      'weekSignalTone',
      'weekBadgeText',
      'scenarioLabel',
      'scenarioProbability',
      'scenarioPeriod',
      'scenarioCondition',
      'currentPriceText',
      'targetPriceText',
    ])
    && !!record
    && isStringArray(record.scenarioDetails)
    && Array.isArray(record.otherScenarios)
    && isStringArray(record.otherScenarioTags)
}

function isCanonicalSellNowBlock(block: unknown) {
  const record = asRecord(block)
  return isBlockMeta(block) && !!record && typeof record.realizedText === 'string' && Array.isArray(record.rows)
}

function isCanonicalPortfolioSimulationBlock(block: unknown) {
  return isBlockMeta(block)
    && hasRequiredStringFields(block, ['deltaLabel', 'caption'])
    && hasRequiredNumberFields(block, ['beforeScore', 'afterScore'])
}

function isCanonicalPayload(payload: unknown): payload is JarooDeepScanPayload {
  const record = asRecord(payload)
  const metadata = asRecord(record?.metadata)
  const inputValidity = asRecord(metadata?.inputValidity)
  const blockStatus = asRecord(metadata?.blockStatus)

  if (!record || !isCanonicalInput(record.input)) {
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

  if (
    !isCanonicalHeroBlock(record.hero)
    || !isCanonicalCommitteeBlock(record.committee)
    || !isCanonicalInsightsBlock(record.insights)
    || !isCanonicalStrategyBlock(record.strategy)
    || !isCanonicalSellNowBlock(record.sellNow)
    || !isCanonicalPortfolioSimulationBlock(record.portfolioSimulation)
  ) {
    return false
  }

  for (const key of MAJOR_BLOCK_KEYS) {
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

  setQueryValue(searchParams, 'code', normalizeText(holding.code) ?? normalizeText(holding.identifierCode))
  setQueryValue(searchParams, 'ticker', normalizeText(holding.ticker) ?? normalizeText(holding.identifierTicker))
  setQueryValue(searchParams, 'market', holding.marketTone === 'nasdaq' ? 'US' : holding.market)
  setQueryValue(searchParams, 'kind', holding.kind)
  setQueryValue(searchParams, 'name', holding.name)
  setQueryValue(searchParams, 'shares', holding.shares)
  setHoldingMetricQueryValue(searchParams, 'averagePrice', holding.averagePrice)
  setQueryValue(searchParams, 'averagePriceCurrency', holding.averagePriceCurrency)
  setQueryValue(searchParams, 'currentPrice', holding.currentPrice)
  setQueryValue(searchParams, 'currentPriceCurrency', holding.currentPriceCurrency)
  setQueryValue(searchParams, 'currentProfitRate', holding.currentProfitRate)
  setHoldingMetricQueryValue(searchParams, 'evaluationAmount', holding.evaluationAmount)
  setQueryValue(searchParams, 'usdKrwRate', holding.usdKrwRate)
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

  if (!response.ok && payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: { message?: string } }).error?.message
    if (message) {
      // 서버 안내(크레딧 부족·로그인·환불 안내 등)를 화면까지 전달한다 (§6-6).
      throw new Error(String(message))
    }
  }

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
