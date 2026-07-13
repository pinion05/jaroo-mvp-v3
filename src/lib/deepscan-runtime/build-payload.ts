import type {
  DeepScanBlockError,
  DeepScanBlockFallback,
  DeepScanBlockState,
  DeepScanSourceRef,
  JarooDeepScanCommitteeAxis,
  JarooDeepScanCommitteeMember,
  JarooDeepScanInsightItem,
  JarooDeepScanPayload,
  JarooDeepScanPortfolioSimulationBlock,
  JarooDeepScanRecoveryForecastBlock,
  JarooDeepScanSellNowBlock,
  JarooDeepScanStrategyBlock,
} from '../../../packages/contracts/src/deepscan'
import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'
import { scoreUsCommitteeFromGeneratedDump, type UsMemberKey } from './llm-committee'
import { decodeUsConsensusObservation } from './us-consensus'
import { buildJarooDeepScanPayload as buildCrawlerDeepScanPayload } from '../../../packages/crawler/src/services/deepscan-payload.js'
import { buildRecoveryForecastFromPriceSeries } from '../../../packages/deepscan-runtime-core/src/recovery-forecast.js'

type UnknownRecord = Record<string, unknown>

type CanonicalSourceFrom = JarooDeepScanPayload['input']['sourceContext']['from']
type DeepScanRawSourceFrom = CanonicalSourceFrom | 'home-handoff'

export type DeepScanRawInput = {
  instrument: {
    name?: string
    code?: string
    ticker?: string
    market?: string
    kind?: 'stock' | 'etf'
  }
  holding?: {
    shares?: string
    averagePrice?: string
    averagePriceCurrency?: string
    currentPrice?: string
    currentPriceCurrency?: string
    currentProfitRate?: string
    evaluationAmount?: string
    usdKrwRate?: string
  }
  selectedAt?: string
  sourceContext: {
    from?: DeepScanRawSourceFrom
  }
}

type DeepScanAgentResult = {
  key:
    | 'valuation'
    | 'growth'
    | 'profitability-quality'
    | 'financial-safety'
    | 'momentum'
    | 'estimate-revision'
    | 'ownership-flow'
    | 'event-risk'
    | 'portfolio-fit'
  label: string
  shortLabel: string
  score: number
  reason: string
  confidence: 'low' | 'medium' | 'high'
  verdict: 'positive' | 'neutral' | 'warning' | 'negative'
  iconTone: JarooDeepScanCommitteeMember['iconTone']
}

type SourceIssue = {
  id: string
  message: string
  retryable?: boolean
}

type UsDeepScanFacts = {
  companyName: string
  ticker?: string
  market?: string
  currency?: string
  currentPrice?: number
  marketCap?: number
  per?: number
  pbr?: number
  roe?: number
  eps?: number
  epsGrowth?: number
  revenue?: number
  operatingIncome?: number
  totalAssets?: number
  totalEquity?: number
  returns1w?: number
  returns3m?: number
  returns1y?: number
  news: Array<{ title: string; publishedAt?: string }>
  consensus?: ReturnType<typeof decodeUsConsensusObservation>
}

type MoneyCurrency = 'KRW' | 'USD'

export type CurrencyAwareAveragePriceInput = {
  averagePrice?: string | number | null
  averagePriceCurrency?: string | null
  currentPrice?: number | null
  currentPriceCurrency?: string | null
  usdKrwRate?: number | null
}

export type CurrencyAwareAveragePriceResult = {
  averagePrice: number | null
  averagePriceCurrency: MoneyCurrency | null
  currentPriceCurrency: MoneyCurrency
  averagePriceInCurrentCurrency: number | null
  requiresFx: boolean
  usdKrwRate: number | null
  converted: boolean
  blockedReason: string | null
}

type RuntimeDumpQuality = {
  availability?: string
  derivationKind?: string
  actionability?: string
  reasonCode?: string[]
}

type RuntimeDumpFact<T = unknown> = {
  value?: T
  quality?: RuntimeDumpQuality
  notes?: string[]
}

type RecoveryForecastContext = {
  rawInput: DeepScanRawInput
  primarySeries: Array<Record<string, unknown>>
  currentPrice?: number
  currency?: string
  sourceRefs: DeepScanSourceRef[]
  sourceLabel: string
  sourceId: string
}

type GeneratedDumpSignalSummary = {
  momentum: {
    availability: string
    pointCount: number
    latestDate?: string
    latestClose?: number
    primarySource: 'polygon' | 'fmp' | 'unknown'
  } | null
  ownershipFlow: {
    availability: string
    summary?: string
    direction?: string
    eventCount: number
    latestEventDate?: string
    primarySource: string
  } | null
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseNumberish(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().replace(/[−–—]/g, '-')
  if (!normalized) {
    return null
  }

  const cleaned = normalized.replaceAll(',', '').replace(/[₩$€¥£%원주]/g, '')
  if (!cleaned || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null
  }

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeMoneyCurrency(value: unknown): MoneyCurrency | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toUpperCase()
  if (normalized === 'KRW' || normalized.includes('원') || normalized.includes('₩')) {
    return 'KRW'
  }

  if (normalized === 'USD' || normalized.includes('$') || normalized.includes('달러')) {
    return 'USD'
  }

  return null
}

function normalizeUsdKrwRate(value: unknown) {
  const parsed = parseNumberish(value)
  return typeof parsed === 'number' && parsed > 0 ? parsed : null
}

function inferAveragePriceCurrency({
  averagePrice,
  averagePriceCurrency,
  currentPrice,
  currentPriceCurrency,
  usdKrwRate,
}: Required<Pick<CurrencyAwareAveragePriceResult, 'currentPriceCurrency'>> & {
  averagePrice: number | null
  averagePriceCurrency?: string | null
  currentPrice?: number | null
  usdKrwRate?: number | null
}) {
  const explicitCurrency = normalizeMoneyCurrency(averagePriceCurrency)
  if (explicitCurrency) {
    return explicitCurrency
  }

  if (averagePrice === null) {
    return null
  }

  if (currentPriceCurrency === 'KRW') {
    return 'KRW'
  }

  if (typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return averagePrice > 10_000 ? 'KRW' : 'USD'
  }

  if (typeof usdKrwRate === 'number' && Number.isFinite(usdKrwRate) && usdKrwRate > 0) {
    const krwComparablePrice = currentPrice * usdKrwRate
    const usdDistance = Math.abs(averagePrice - currentPrice) / Math.max(Math.abs(currentPrice), 1)
    const krwDistance = Math.abs(averagePrice - krwComparablePrice) / Math.max(Math.abs(krwComparablePrice), 1)
    return krwDistance < usdDistance ? 'KRW' : 'USD'
  }

  return averagePrice > currentPrice * 20 ? 'KRW' : 'USD'
}

export function resolveCurrencyAwareAveragePrice({
  averagePrice: rawAveragePrice,
  averagePriceCurrency: rawAveragePriceCurrency,
  currentPrice,
  currentPriceCurrency: rawCurrentPriceCurrency,
  usdKrwRate: rawUsdKrwRate,
}: CurrencyAwareAveragePriceInput): CurrencyAwareAveragePriceResult {
  const averagePrice = parseNumberish(rawAveragePrice)
  const currentCurrency = normalizeMoneyCurrency(rawCurrentPriceCurrency) ?? 'USD'
  const usdKrwRate = normalizeUsdKrwRate(rawUsdKrwRate)
  const averagePriceCurrency = inferAveragePriceCurrency({
    averagePrice,
    averagePriceCurrency: rawAveragePriceCurrency,
    currentPrice,
    currentPriceCurrency: currentCurrency,
    usdKrwRate,
  })

  if (averagePrice === null || averagePriceCurrency === null) {
    return {
      averagePrice,
      averagePriceCurrency,
      currentPriceCurrency: currentCurrency,
      averagePriceInCurrentCurrency: null,
      requiresFx: false,
      usdKrwRate,
      converted: false,
      blockedReason: 'average-price-missing',
    }
  }

  if (averagePriceCurrency === currentCurrency) {
    return {
      averagePrice,
      averagePriceCurrency,
      currentPriceCurrency: currentCurrency,
      averagePriceInCurrentCurrency: averagePrice,
      requiresFx: false,
      usdKrwRate,
      converted: false,
      blockedReason: null,
    }
  }

  if (usdKrwRate === null) {
    return {
      averagePrice,
      averagePriceCurrency,
      currentPriceCurrency: currentCurrency,
      averagePriceInCurrentCurrency: null,
      requiresFx: true,
      usdKrwRate,
      converted: false,
      blockedReason: 'usd-krw-rate-missing',
    }
  }

  const convertedAveragePrice = averagePriceCurrency === 'KRW' && currentCurrency === 'USD'
    ? averagePrice / usdKrwRate
    : averagePrice * usdKrwRate

  return {
    averagePrice,
    averagePriceCurrency,
    currentPriceCurrency: currentCurrency,
    averagePriceInCurrentCurrency: convertedAveragePrice,
    requiresFx: true,
    usdKrwRate,
    converted: true,
    blockedReason: null,
  }
}

function readRuntimeDumpFact<T>(memberDump: unknown, factKey: string): RuntimeDumpFact<T> | null {
  const facts = asRecord(asRecord(memberDump)?.facts)
  const fact = asRecord(facts?.[factKey])
  if (!fact) {
    return null
  }

  return {
    value: fact.value as T,
    quality: asRecord(fact.quality) as RuntimeDumpQuality | undefined,
    notes: Array.isArray(fact.notes) ? fact.notes.filter((note): note is string => typeof note === 'string') : undefined,
  }
}

type GeneratedMomentumPrimarySource = NonNullable<GeneratedDumpSignalSummary['momentum']>['primarySource']

export function summarizeGeneratedDumpSignals(runtimeShape: unknown): GeneratedDumpSignalSummary {
  const members = asRecord(asRecord(runtimeShape)?.members)
  const momentumDump = members?.momentum
  const ownershipDump = members?.['ownership-flow']

  const ohlcFact = readRuntimeDumpFact<Array<Record<string, unknown>>>(momentumDump, 'ohlcSeries')
  const ohlcSeries = Array.isArray(ohlcFact?.value) ? ohlcFact.value : []
  const latestOhlc = asRecord(ohlcSeries[0])
  const directOwnershipFact = readRuntimeDumpFact<Record<string, unknown>>(ownershipDump, 'directOwnershipFlow')
  const ownershipValue = asRecord(directOwnershipFact?.value)
  const ownershipSignal = asRecord(ownershipValue?.signal)
  const ownershipCounts = asRecord(ownershipValue?.counts)
  const ownershipLatestDates = asRecord(ownershipValue?.latestDates)
  const ohlcReasonCodes = Array.isArray(ohlcFact?.quality?.reasonCode)
    ? ohlcFact?.quality?.reasonCode
    : []

  return {
    momentum: ohlcFact
      ? {
          availability: normalizeText(ohlcFact.quality?.availability) ?? 'missing',
          pointCount: ohlcSeries.length,
          latestDate: normalizeText(latestOhlc?.date) ?? undefined,
          latestClose: asFiniteNumber(latestOhlc?.close) ?? undefined,
          primarySource: ohlcReasonCodes.includes('polygon_primary_ohlc')
            ? 'polygon'
            : ohlcReasonCodes.includes('fmp_primary_ohlc')
              ? 'fmp'
              : 'unknown',
        }
      : null,
    ownershipFlow: directOwnershipFact
      ? {
          availability: normalizeText(directOwnershipFact.quality?.availability) ?? 'missing',
          summary: normalizeText(ownershipSignal?.summary) ?? undefined,
          direction: normalizeText(ownershipSignal?.direction) ?? undefined,
          eventCount: asFiniteNumber(ownershipCounts?.totalDirectEvents) ?? 0,
          latestEventDate: normalizeText(ownershipLatestDates?.latestEvent) ?? undefined,
          primarySource: normalizeText(ownershipValue?.source) ?? 'unknown',
        }
      : null,
  }
}

export function extractGeneratedOhlcSeries(runtimeShape: unknown) {
  const members = asRecord(asRecord(runtimeShape)?.members)
  const momentumDump = members?.momentum
  const ohlcFact = readRuntimeDumpFact<Array<Record<string, unknown>>>(momentumDump, 'ohlcSeries')

  return asArray(ohlcFact?.value)
    .map((point) => asRecord(point))
    .filter((point): point is UnknownRecord => point !== null)
    .map((point) => ({
      date: normalizeText(point.date) ?? normalizeText(point.tradeDate) ?? normalizeText(point.at),
      close: asFiniteNumber(point.close) ?? asFiniteNumber(point.closePrice) ?? asFiniteNumber(point.price),
    }))
    .filter((point): point is { date: string | undefined; close: number } => typeof point.close === 'number')
}

function formatMomentumProviderLabel(primarySource: GeneratedMomentumPrimarySource) {
  switch (primarySource) {
    case 'polygon':
      return 'Polygon'
    case 'fmp':
      return 'FMP'
    default:
      return null
  }
}

export function describeMomentumProvenance(primarySource: GeneratedMomentumPrimarySource, pointCount: number) {
  const providerLabel = formatMomentumProviderLabel(primarySource)
  const ohlcLabel = providerLabel ? `${providerLabel} OHLC` : 'OHLC'

  return {
    insightTitle: `${ohlcLabel} ${pointCount}개 봉을 반영했어요.`,
    sourceRefLabel: `${ohlcLabel} ${pointCount} bars`,
    heroBodyText: `${ohlcLabel} ${pointCount}개 반영`,
  }
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function signedPercent(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatNumber(value?: number | null, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatCurrency(value?: number | null, currency = 'USD') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  if (currency === 'USD') {
    return `$${value.toFixed(2)}`
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatRecoveryDays(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return value === 0 ? '이미 도달' : `${Math.round(value).toLocaleString('ko-KR')}거래일`
}

export function formatProbability(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${value.toFixed(1).replace(/\.0$/, '')}%`
}

function formatDrawdownPct(currentPrice: number, targetPrice: number) {
  if (targetPrice <= 0) {
    return 'N/A'
  }

  return `${(((targetPrice - currentPrice) / targetPrice) * 100).toFixed(1)}%`
}

function recoveryConfidenceLabel(level?: string | null) {
  switch (level) {
    case 'high':
      return '높음'
    case 'medium':
      return '보통'
    case 'low':
      return '낮음'
    default:
      return 'N/A'
  }
}

function recoveryStatusText(status?: string | null) {
  switch (status) {
    case 'available':
      return '원금회수 예측'
    case 'low_confidence':
      return '낮은 신뢰도'
    default:
      return '예측 보류'
  }
}

function buildRecoveryModelRows(forecast: unknown): JarooDeepScanRecoveryForecastBlock['modelRows'] {
  const models = asRecord(asRecord(forecast)?.models)
  return [
    ['similarPattern', '유사 패턴'],
    ['gbm', 'GBM'],
    ['jumpDiffusion', 'Jump-Diffusion'],
  ].map(([key, fallbackLabel]) => {
    const model = asRecord(models?.[key])
    const sampleSize = asFiniteNumber(model?.sampleSize)

    return {
      label: normalizeText(model?.label) ?? fallbackLabel,
      recoveryDaysText: formatRecoveryDays(asFiniteNumber(model?.medianRecoveryDays)),
      probabilityText: formatProbability(asFiniteNumber(model?.recoveryProbabilityPct)),
      ...(sampleSize !== null ? { sampleText: `${sampleSize}건` } : {}),
    }
  })
}

export function runRecoveryForecast(context: RecoveryForecastContext): {
  forecast: unknown
  targetPrice: number
  currentPrice: number
  recoverySourceRefs: DeepScanSourceRef[]
} | null {
  const targetPrice = parseNumberish(context.rawInput.holding?.averagePrice)
  const currentPrice = context.currentPrice

  if (
    typeof targetPrice !== 'number'
    || targetPrice <= 0
    || typeof currentPrice !== 'number'
    || currentPrice <= 0
    || context.primarySeries.length < 3
  ) {
    return null
  }

  const recoverySourceRefs = [
    ...context.sourceRefs,
    createSourceRef('holding', 'recovery-target-average-price', 'average price recovery target'),
    createSourceRef(
      'market',
      context.sourceId,
      context.sourceLabel,
      normalizeText(context.primarySeries.at(-1)?.date),
    ),
  ]
  const forecast = buildRecoveryForecastFromPriceSeries(
    {
      primarySeries: context.primarySeries,
      currentPrice,
      targetPrice,
    },
    {
      similarPattern: {
        lookbackDays: 40,
        tolerancePct: 12,
        spacingDays: 20,
        minSampleSize: 3,
      },
      simulation: {
        horizonDays: 252,
        pathCount: 5000,
        seed: `deepscan-recovery:${context.rawInput.instrument.ticker ?? context.rawInput.instrument.code ?? context.rawInput.instrument.name}:${currentPrice}:${targetPrice}`,
      },
    },
  )

  return { forecast, targetPrice, currentPrice, recoverySourceRefs }
}

export function shapeRecoveryForecastBlock(args: {
  forecast: unknown
  targetPrice: number
  currentPrice: number
  currency: string | undefined
  recoverySourceRefs: DeepScanSourceRef[]
}): JarooDeepScanRecoveryForecastBlock {
  const { forecast, targetPrice, currentPrice, currency, recoverySourceRefs } = args
  const forecastRecord = asRecord(forecast)
  const consensus = asRecord(forecastRecord?.consensus)
  const confidence = asRecord(consensus?.confidence)
  const status = normalizeText(forecastRecord?.status)
  const expectedRecoveryDays = asFiniteNumber(consensus?.expectedRecoveryDays)
  const recoveryProbabilityPct = asFiniteNumber(consensus?.recoveryProbabilityPct)
  const confidenceLabel = recoveryConfidenceLabel(normalizeText(confidence?.level))
  const isUnavailable = status === 'unavailable' || !consensus
  const blockState: DeepScanBlockState = isUnavailable ? 'blocked' : 'ok'
  const fallback = status === 'low_confidence'
    ? createFallback('recovery-low-confidence', '모델간 회수기간 편차가 큽니다.')
    : null
  const error = isUnavailable
    ? createError('recovery-forecast-unavailable', normalizeText(forecastRecord?.reason) ?? '원금회수 예측에 필요한 모델 결과가 부족합니다.', true)
    : null

  return {
    ...createBlockMeta(blockState, recoverySourceRefs, { fallback, error }),
    statusText: recoveryStatusText(status),
    summaryText: isUnavailable
      ? (error?.message ?? '원금회수 예측을 계산하지 못했어요.')
      : expectedRecoveryDays === 0
        ? '현재가가 이미 평단 이상이라 원금회수 목표에 도달한 상태입니다.'
        : `평단 ${formatCurrency(targetPrice, currency)} 회복까지 약 ${formatRecoveryDays(expectedRecoveryDays)}로 추정돼요.`,
    expectedRecoveryDaysText: formatRecoveryDays(expectedRecoveryDays),
    recoveryProbabilityText: formatProbability(recoveryProbabilityPct),
    confidenceText: confidenceLabel,
    currentPriceText: formatCurrency(currentPrice, currency),
    targetPriceText: formatCurrency(targetPrice, currency),
    drawdownText: formatDrawdownPct(currentPrice, targetPrice),
    modelRows: buildRecoveryModelRows(forecast),
    disclaimer: normalizeText(consensus?.disclaimer) ?? '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
  }
}

export function buildDeepScanRecoveryForecastBlock(context: RecoveryForecastContext): JarooDeepScanRecoveryForecastBlock | null {
  const ran = runRecoveryForecast(context)
  if (!ran) {
    return null
  }
  return shapeRecoveryForecastBlock({
    forecast: ran.forecast,
    targetPrice: ran.targetPrice,
    currentPrice: ran.currentPrice,
    currency: context.currency,
    recoverySourceRefs: ran.recoverySourceRefs,
  })
}

function createSourceRef(type: DeepScanSourceRef['type'], id: string, label: string, note?: string): DeepScanSourceRef {
  return {
    type,
    id,
    label,
    note,
  }
}

function createFallback(reason: string, label?: string): DeepScanBlockFallback {
  return {
    used: true,
    reason,
    label,
  }
}

function createError(code: string, message: string, retryable = false): DeepScanBlockError {
  return {
    code,
    message,
    retryable,
  }
}

function createBlockMeta(blockState: DeepScanBlockState, sourceRefs: DeepScanSourceRef[], options: { fallback?: DeepScanBlockFallback | null; error?: DeepScanBlockError | null } = {}) {
  return {
    blockState,
    sourceRefs,
    fallback: options.fallback ?? null,
    error: options.error ?? null,
  }
}


const SOURCE_FROM_VALUES = new Set<DeepScanRawSourceFrom>(['home-handoff', 'ocr', 'holding', 'report', 'news', 'market', 'system'])
const KR_MARKETS = new Set(['KR', 'KOSPI', 'KOSDAQ'])
const KR_TICKER_PATTERN = /^(\d{6})(?:\.(?:KS|KQ))?$/

function parseSourceFrom(value?: string): DeepScanRawSourceFrom {
  if (value && SOURCE_FROM_VALUES.has(value as DeepScanRawSourceFrom)) {
    return value as DeepScanRawSourceFrom
  }

  return 'system'
}

function normalizeSourceFrom(value?: string): CanonicalSourceFrom {
  if (value === 'home-handoff') {
    return 'holding'
  }

  if (value && SOURCE_FROM_VALUES.has(value as DeepScanRawSourceFrom)) {
    return value as CanonicalSourceFrom
  }

  return 'system'
}

function buildRawInputFromSearchParams(searchParams: URLSearchParams): DeepScanRawInput {
  const code = normalizeText(searchParams.get('code'))
  const ticker = normalizeText(searchParams.get('ticker'))?.toUpperCase()
  const market = normalizeText(searchParams.get('market'))?.toUpperCase()
  const kind = normalizeText(searchParams.get('kind'))?.toLowerCase()
  const name = normalizeText(searchParams.get('name'))
  const shares = normalizeText(searchParams.get('shares'))
  const averagePrice = normalizeText(searchParams.get('averagePrice'))
  const averagePriceCurrency = normalizeText(searchParams.get('averagePriceCurrency'))
  const currentPrice = normalizeText(searchParams.get('currentPrice'))
  const currentPriceCurrency = normalizeText(searchParams.get('currentPriceCurrency'))
  const currentProfitRate = normalizeText(searchParams.get('currentProfitRate'))
  const evaluationAmount = normalizeText(searchParams.get('evaluationAmount'))
  const usdKrwRate = normalizeText(searchParams.get('usdKrwRate'))
  const selectedAt = normalizeText(searchParams.get('selectedAt'))
  const from = normalizeText(searchParams.get('from'))
  const holding = {
    ...(shares ? { shares } : {}),
    ...(averagePrice ? { averagePrice } : {}),
    ...(averagePriceCurrency ? { averagePriceCurrency } : {}),
    ...(currentPrice ? { currentPrice } : {}),
    ...(currentPriceCurrency ? { currentPriceCurrency } : {}),
    ...(currentProfitRate ? { currentProfitRate } : {}),
    ...(evaluationAmount ? { evaluationAmount } : {}),
    ...(usdKrwRate ? { usdKrwRate } : {}),
  }

  return {
    instrument: {
      name,
      code,
      ticker,
      market,
      ...(kind === 'etf' ? { kind: 'etf' as const } : kind === 'stock' ? { kind: 'stock' as const } : {}),
    },
    holding: Object.keys(holding).length > 0 ? holding : undefined,
    selectedAt: selectedAt ?? undefined,
    sourceContext: {
      from: parseSourceFrom(from),
    },
  }
}

function normalizeMarketForRoute(value?: string) {
  return normalizeText(value)?.toUpperCase()
}

export function extractKrCodeFromTicker(ticker?: string) {
  const normalizedTicker = normalizeText(ticker)?.toUpperCase()
  return normalizedTicker?.match(KR_TICKER_PATTERN)?.[1]
}

export type DeepScanPayloadBuilderRoute = 'kr' | 'us' | 'invalid'

export function resolveDeepScanPayloadBuilderRoute(rawInput: DeepScanRawInput): DeepScanPayloadBuilderRoute {
  const code = normalizeText(rawInput.instrument.code)
  const ticker = normalizeText(rawInput.instrument.ticker)
  const market = normalizeMarketForRoute(rawInput.instrument.market)

  if (!code && !ticker) {
    return 'invalid'
  }

  if (market && KR_MARKETS.has(market)) {
    return 'kr'
  }

  if (!code && extractKrCodeFromTicker(ticker)) {
    return 'kr'
  }

  if (market === 'US' || (!code && ticker)) {
    return 'us'
  }

  return 'kr'
}

export function prepareDeepScanRawInputForBuilder(rawInput: DeepScanRawInput): DeepScanRawInput {
  const inferredKrCode = extractKrCodeFromTicker(rawInput.instrument.ticker)

  if (rawInput.instrument.code || !inferredKrCode) {
    return rawInput
  }

  return {
    ...rawInput,
    instrument: {
      ...rawInput.instrument,
      code: inferredKrCode,
    },
  }
}

function setCrawlerDeepScanQueryValue(searchParams: URLSearchParams, key: string, value: string | undefined) {
  const normalized = normalizeText(value)
  if (normalized) {
    searchParams.set(key, normalized)
  }
}

function resolveCrawlerDeepScanKind(input: DeepScanRawInput) {
  const market = normalizeMarketForRoute(input.instrument.market)
  if (market === 'ETN') {
    return 'etn'
  }

  if (market === 'ETF') {
    return input.instrument.kind ?? 'etf'
  }

  return input.instrument.kind === 'etf' ? 'etf' : undefined
}

export function buildKrDeepScanCrawlerCanonicalUrl(rawInput: DeepScanRawInput) {
  const input = prepareDeepScanRawInputForBuilder(rawInput)
  const searchParams = new URLSearchParams()

  setCrawlerDeepScanQueryValue(searchParams, 'market', input.instrument.market ?? 'KR')
  setCrawlerDeepScanQueryValue(searchParams, 'kind', resolveCrawlerDeepScanKind(input))
  setCrawlerDeepScanQueryValue(searchParams, 'code', input.instrument.code)
  setCrawlerDeepScanQueryValue(searchParams, 'ticker', input.instrument.ticker)
  setCrawlerDeepScanQueryValue(searchParams, 'name', input.instrument.name)
  setCrawlerDeepScanQueryValue(searchParams, 'shares', input.holding?.shares)
  setCrawlerDeepScanQueryValue(searchParams, 'averagePrice', input.holding?.averagePrice)
  setCrawlerDeepScanQueryValue(searchParams, 'averagePriceCurrency', input.holding?.averagePriceCurrency)
  setCrawlerDeepScanQueryValue(searchParams, 'currentPrice', input.holding?.currentPrice)
  setCrawlerDeepScanQueryValue(searchParams, 'currentPriceCurrency', input.holding?.currentPriceCurrency)
  setCrawlerDeepScanQueryValue(searchParams, 'currentProfitRate', input.holding?.currentProfitRate)
  setCrawlerDeepScanQueryValue(searchParams, 'evaluationAmount', input.holding?.evaluationAmount)
  setCrawlerDeepScanQueryValue(searchParams, 'usdKrwRate', input.holding?.usdKrwRate)
  setCrawlerDeepScanQueryValue(searchParams, 'selectedAt', input.selectedAt)
  setCrawlerDeepScanQueryValue(searchParams, 'from', normalizeSourceFrom(input.sourceContext.from))

  return buildCrawlerUrl(
    getCrawlerBaseUrl(),
    `/api/source/wisereport-fnguide-krx-polygon-fmp-deepscan-package/deepscan/canonical?${searchParams.toString()}`,
  )
}

export class CrawlerDeepScanRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CrawlerDeepScanRequestError'
    this.status = status
  }
}

const DEFAULT_KR_DEEPSCAN_BUSY_MAX_WAIT_MS = 30_000
const DEFAULT_KR_DEEPSCAN_BUSY_RETRY_AFTER_MS = 2_000
const DEFAULT_KR_DEEPSCAN_FETCH_TIMEOUT_MS = 45_000
const DEFAULT_US_SLIM_FETCH_TIMEOUT_MS = 30_000

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function clampRetryAfterMs(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_KR_DEEPSCAN_BUSY_RETRY_AFTER_MS
  }

  return Math.min(Math.floor(parsed), 15_000)
}

function resolveCrawlerBusyRetryAfterMs(response: Response, payload: unknown) {
  const retryAfterHeader = response.headers.get('retry-after')
  const retryAfterSeconds = Number(retryAfterHeader)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return clampRetryAfterMs(retryAfterSeconds * 1000)
  }

  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {}
  const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {}

  return clampRetryAfterMs(details.retryAfterMs)
}

function isCrawlerBusyResponse(response: Response, payload: unknown) {
  if (response.status !== 429) {
    return false
  }

  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {}
  const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {}

  return details.status === 'busy'
    || (typeof error.message === 'string' && /busy/i.test(error.message))
}

type KrDeepScanCrawlerFetchOptions = {
  maxBusyWaitMs?: number
  fetchTimeoutMs?: number
  sleep?: (durationMs: number) => Promise<void>
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function unrefTimer(timeoutId: ReturnType<typeof setTimeout>) {
  const timer = timeoutId as ReturnType<typeof setTimeout> & { unref?: () => void }
  timer.unref?.()
}

async function fetchWithDeadline(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
  context: string,
) {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<Response>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new CrawlerDeepScanRequestError(`${context} timed out after ${timeoutMs}ms`, 504))
    }, timeoutMs)
    if (timeoutId) {
      unrefTimer(timeoutId)
    }
  })

  try {
    return await Promise.race([
      fetcher(input, {
        ...init,
        signal: controller.signal,
      }),
      timeout,
    ])
  } catch (error) {
    if (error instanceof CrawlerDeepScanRequestError) {
      throw error
    }

    if (controller.signal.aborted) {
      throw new CrawlerDeepScanRequestError(`${context} timed out after ${timeoutMs}ms`, 504)
    }

    throw new CrawlerDeepScanRequestError(
      error instanceof Error ? `${context} failed: ${error.message}` : `${context} failed`,
      502,
    )
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function readResponseText(response: Response, context: string) {
  try {
    return await response.text()
  } catch (error) {
    throw new CrawlerDeepScanRequestError(
      error instanceof Error ? `${context} response read failed: ${error.message}` : `${context} response read failed`,
      response.ok ? 502 : response.status,
    )
  }
}

async function readJsonPayload(response: Response, context: string) {
  const body = await readResponseText(response, context)

  try {
    return JSON.parse(body)
  } catch {
    throw new CrawlerDeepScanRequestError(
      body.trim()
        ? `${context} returned invalid JSON`
        : `${context} returned an empty response`,
      response.ok ? 502 : response.status,
    )
  }
}

export async function buildKrDeepScanPayloadViaCrawler(
  rawInput: DeepScanRawInput,
  fetcher: typeof fetch = fetch,
  options: KrDeepScanCrawlerFetchOptions = {},
) {
  const upstreamUrl = buildKrDeepScanCrawlerCanonicalUrl(rawInput)
  const maxBusyWaitMs = options.maxBusyWaitMs
    ?? parsePositiveInteger(process.env.DEEPSCAN_KR_BUSY_MAX_WAIT_MS, DEFAULT_KR_DEEPSCAN_BUSY_MAX_WAIT_MS)
  const wait = options.sleep ?? sleep
  const fetchTimeoutMs = options.fetchTimeoutMs
    ?? parsePositiveInteger(process.env.DEEPSCAN_KR_FETCH_TIMEOUT_MS, DEFAULT_KR_DEEPSCAN_FETCH_TIMEOUT_MS)
  let waitedMs = 0

  while (true) {
    const response = await fetchWithDeadline(fetcher, upstreamUrl, { cache: 'no-store' }, fetchTimeoutMs, 'crawler deepscan request')
    const payload = await readJsonPayload(response, 'crawler deepscan request')

    if (response.ok) {
      return attachKrRecoveryForecast(payload as JarooDeepScanPayload)
    }

    if (isCrawlerBusyResponse(response, payload) && waitedMs < maxBusyWaitMs) {
      const retryAfterMs = Math.min(resolveCrawlerBusyRetryAfterMs(response, payload), maxBusyWaitMs - waitedMs)
      waitedMs += retryAfterMs
      await wait(retryAfterMs)
      continue
    }

    throw new CrawlerDeepScanRequestError(
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : `crawler deepscan request failed with HTTP ${response.status}`,
      response.status,
    )
  }
}

function attachKrRecoveryForecast(payload: JarooDeepScanPayload): JarooDeepScanPayload {
  const record = payload as unknown as Record<string, unknown>
  const raw = asRecord(record.recoveryForecastRaw)
  const forecast = raw?.forecast
  const currentPrice = asFiniteNumber(raw?.currentPrice)
  const targetPrice = asFiniteNumber(raw?.targetPrice)
  const { recoveryForecastRaw, ...rest } = record
  if (forecast === undefined || currentPrice === null || targetPrice === null) {
    return rest as JarooDeepScanPayload
  }
  const recoverySourceRefs = [
    createSourceRef('holding', 'recovery-target-average-price', 'average price recovery target'),
    createSourceRef('market', 'kr-relative-return-history', 'KR relative return price history'),
  ]
  const recoveryForecast = shapeRecoveryForecastBlock({
    forecast,
    currentPrice,
    targetPrice,
    currency: 'KRW',
    recoverySourceRefs,
  })
  return { ...rest, recoveryForecast } as JarooDeepScanPayload
}

function buildInputValidityRaw(rawInput: DeepScanRawInput) {
  return structuredClone(rawInput)
}

function createInvalidInputPayload(rawInput: DeepScanRawInput): JarooDeepScanPayload {
  const generatedAt = rawInput.selectedAt ?? new Date().toISOString()
  const sourceRefs = [createSourceRef('system', 'deepscan-input-invalid', 'deepscan invalid input')]
  const fallback = createFallback('input-invalid', '입력 확인 필요')
  const error = createError('input-invalid', 'instrument code or ticker is required')

  const payload: JarooDeepScanPayload = {
    input: {
      instrument: {
        name: rawInput.instrument.name?.trim() || '알 수 없는 종목',
        code: rawInput.instrument.code,
        ticker: rawInput.instrument.ticker,
        market: rawInput.instrument.market,
        kind: rawInput.instrument.kind,
      },
      holding: rawInput.holding,
      selectedAt: rawInput.selectedAt,
      sourceContext: {
        from: normalizeSourceFrom(rawInput.sourceContext.from),
      },
    },
    hero: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      headline: 'DeepScan 입력이 부족합니다',
      body: '종목 코드 또는 티커가 필요합니다.',
      statusText: '입력 확인 필요',
      score: 0,
      scoreLabel: 'Blocked · 0 / 100',
      scoreDelta: '+0',
    },
    committee: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      axes: [],
    },
    insights: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      sectionLabel: '인사이트',
      items: [],
      summaryTags: [],
    },
    strategy: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      weekSignal: '입력 필요',
      weekSignalTone: 'warning',
      weekBadgeText: '입력 필요',
      scenarioLabel: '종목 식별 정보 확인',
      scenarioProbability: '0%',
      scenarioPeriod: '대기',
      scenarioCondition: '코드 또는 티커 입력 후 다시 시도하세요.',
      currentPriceText: 'N/A',
      targetPriceText: 'N/A',
      scenarioDetails: ['입력값 부족으로 분석을 시작하지 않았어요.'],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      realizedText: '입력값 부족으로 즉시 매도 판단을 계산할 수 없어요.',
      rows: [],
    },
    portfolioSimulation: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      beforeScore: 0,
      afterScore: 0,
      deltaLabel: 'blocked:+0',
      caption: '입력값 부족으로 포트폴리오 시뮬레이션을 계산하지 않았어요.',
    },
    metadata: {
      generatedAt,
      version: 'deepscan-runtime-v1',
      degraded: true,
      errorCode: error.code,
      debugId: `deepscan:${rawInput.instrument.market ?? 'NA'}:${rawInput.instrument.code ?? rawInput.instrument.ticker ?? 'missing'}`,
      inputValidity: {
        valid: false,
        reason: error.message,
        missing: ['instrument.code|instrument.ticker'],
        raw: buildInputValidityRaw(rawInput),
      },
      sourceRefs,
      blockStatus: {
        hero: 'blocked',
        committee: 'blocked',
        insights: 'blocked',
        strategy: 'blocked',
        sellNow: 'blocked',
        portfolioSimulation: 'blocked',
      },
    },
  } satisfies JarooDeepScanPayload

  return payload
}

function resolveLatestCellValue(cells: unknown) {
  const record = asRecord(cells)
  if (!record) {
    return null
  }

  const latestKey = Object.keys(record).at(-1)
  return latestKey ? asFiniteNumber(record[latestKey]) : null
}

function findFinancialSummaryRow(rows: unknown[], label: string) {
  return asArray(rows)
    .map((row) => asRecord(row))
    .find((row) => row?.label === label) ?? null
}

function findUsFacts(payload: unknown, ticker: string): UsDeepScanFacts {
  const record = asRecord(payload)
  const company = asRecord(record?.company)
  const pages = asRecord(record?.pages)
  const analysis = asRecord(pages?.analysis)
  const snap = asRecord(pages?.snap)
  const finance = asRecord(pages?.finance)
  const consensus = asRecord(pages?.consensus)
  const analysisMetric = asRecord(asArray(analysis?.metrics).find((item) => asRecord(item)?.ticker?.toString().startsWith(ticker)) ?? asArray(analysis?.metrics)[0])
  const returnRecord = asRecord(asArray(analysis?.returns).find((item) => asRecord(item)?.ticker?.toString().startsWith(ticker)) ?? asArray(analysis?.returns)[0])
  const financialRows = asArray(asRecord(snap?.financialSummary)?.rows)
  const latestPriceRow = asRecord(asArray(asRecord(snap?.priceVolume)?.rows).at(-1))
  const latestConsensus = asArray(consensus?.observations).at(-1)
  const decodedConsensus = latestConsensus ? decodeUsConsensusObservation(latestConsensus) : undefined
  const statements = asRecord(finance?.statements)
  const balanceRows = asArray(asRecord(statements?.balanceSheet)?.rows)
  const totalAssets = resolveLatestCellValue(findFinancialSummaryRow(financialRows, '자산총계')?.cells)
    ?? resolveLatestCellValue(findFinancialSummaryRow(balanceRows, '자산총계')?.cells)
  const totalEquity = resolveLatestCellValue(findFinancialSummaryRow(financialRows, '자본총계')?.cells)
    ?? resolveLatestCellValue(findFinancialSummaryRow(balanceRows, '자본총계')?.cells)
  const revenue = decodedConsensus?.forecastRevenue
    ?? resolveLatestCellValue(findFinancialSummaryRow(financialRows, '매출액')?.cells)
  const operatingIncome = resolveLatestCellValue(findFinancialSummaryRow(financialRows, '영업이익')?.cells)
  const news = asArray(snap?.news)
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => Boolean(item))
    .map((item) => {
      const titles = asRecord(item.titles)
      return {
        title: normalizeText(titles?.ko) ?? normalizeText(titles?.en) ?? '제목 미확인',
        publishedAt: normalizeText(item.publishedAt),
      }
    })
    .filter((item) => item.title)

  return {
    companyName: normalizeText(company?.name) ?? ticker,
    ticker: normalizeText(company?.ticker) ?? ticker,
    market: normalizeText(company?.market) ?? 'US',
    currency: normalizeText(company?.currency) ?? normalizeText(consensus?.currency) ?? 'USD',
    currentPrice: asFiniteNumber(latestPriceRow?.close) ?? decodedConsensus?.spotPrice ?? undefined,
    marketCap: resolveLatestCellValue(findFinancialSummaryRow(financialRows, '시가총액')?.cells) ?? undefined,
    per: asFiniteNumber(analysisMetric?.per) ?? decodedConsensus?.forwardPer ?? undefined,
    pbr: asFiniteNumber(analysisMetric?.pbr) ?? decodedConsensus?.forwardPbr ?? undefined,
    roe: asFiniteNumber(analysisMetric?.roe) ?? undefined,
    eps: asFiniteNumber(analysisMetric?.eps) ?? decodedConsensus?.forecastEps ?? undefined,
    epsGrowth: asFiniteNumber(analysisMetric?.epsGw) ?? undefined,
    revenue: revenue ?? undefined,
    operatingIncome: operatingIncome ?? undefined,
    totalAssets: totalAssets ?? undefined,
    totalEquity: totalEquity ?? undefined,
    returns1w: asFiniteNumber(returnRecord?.['1w']) ?? undefined,
    returns3m: asFiniteNumber(returnRecord?.['3m']) ?? undefined,
    returns1y: asFiniteNumber(returnRecord?.['1y']) ?? undefined,
    news,
    consensus: decodedConsensus,
  }
}

function verdictForScore(score: number): DeepScanAgentResult['verdict'] {
  if (score >= 70) {
    return 'positive'
  }

  if (score >= 55) {
    return 'neutral'
  }

  if (score >= 40) {
    return 'warning'
  }

  return 'negative'
}

const US_AGENT_META: Record<UsMemberKey, Pick<DeepScanAgentResult, 'label' | 'shortLabel' | 'iconTone'>> = {
  valuation: { label: 'Valuation', shortLabel: 'VAL', iconTone: 'blue' },
  growth: { label: 'Growth', shortLabel: 'GRW', iconTone: 'green' },
  'profitability-quality': { label: 'Profitability', shortLabel: 'PQL', iconTone: 'teal' },
  momentum: { label: 'Momentum', shortLabel: 'MOM', iconTone: 'amber' },
  'estimate-revision': { label: 'Revision', shortLabel: 'REV', iconTone: 'purple' },
  'event-risk': { label: 'Event Risk', shortLabel: 'EVT', iconTone: 'red' },
  'financial-safety': { label: 'Safety', shortLabel: 'SAFE', iconTone: 'purple' },
  'ownership-flow': { label: 'Ownership', shortLabel: 'OWN', iconTone: 'amber' },
  'portfolio-fit': { label: '포지션 적합도', shortLabel: 'FIT', iconTone: 'teal' },
}

const US_ETF_AGENT_META: Record<UsMemberKey, Pick<DeepScanAgentResult, 'label' | 'shortLabel' | 'iconTone'>> = {
  valuation: { label: 'ETF 가격/NAV 단서', shortLabel: 'ETF', iconTone: 'blue' },
  growth: { label: '기초자산 흐름', shortLabel: 'IDX', iconTone: 'green' },
  'profitability-quality': { label: '상품 구조', shortLabel: 'FND', iconTone: 'teal' },
  momentum: { label: '가격 모멘텀', shortLabel: 'MOM', iconTone: 'amber' },
  'estimate-revision': { label: '시장 신호', shortLabel: 'SIG', iconTone: 'purple' },
  'event-risk': { label: '뉴스/이벤트', shortLabel: 'EVT', iconTone: 'red' },
  'financial-safety': { label: '유동성/규모', shortLabel: 'LIQ', iconTone: 'purple' },
  'ownership-flow': { label: '수급 단서', shortLabel: 'FLOW', iconTone: 'amber' },
  'portfolio-fit': { label: '내 포지션', shortLabel: 'FIT', iconTone: 'teal' },
}

function isUsExchangeProductInput(rawInput: DeepScanRawInput) {
  return rawInput.instrument.kind === 'etf'
}

function buildUsAgentResultsFromLlm(
  results: Partial<Record<UsMemberKey, { score: number; reason: string; confidence: 'low' | 'medium' | 'high' }>>,
  exchangeProduct = false,
): DeepScanAgentResult[] {
  const meta = exchangeProduct ? US_ETF_AGENT_META : US_AGENT_META
  return (Object.entries(results) as Array<[UsMemberKey, { score: number; reason: string; confidence: 'low' | 'medium' | 'high' }]>)
    .map(([key, result]) => ({
      key,
      ...meta[key],
      score: clamp(result.score),
      reason: result.reason,
      confidence: result.confidence,
      verdict: verdictForScore(clamp(result.score)),
    }))
}

function memberTone(agent: DeepScanAgentResult): JarooDeepScanCommitteeMember['tone'] {
  if (agent.score >= 70) {
    return 'positive'
  }
  if (agent.score >= 50) {
    return 'neutral'
  }
  return 'warning'
}

function scoreText(score: number) {
  return `${score} / 100`
}

function axisStatus(score: number) {
  if (score >= 70) {
    return '우세'
  }
  if (score >= 55) {
    return '보통'
  }
  return '경계'
}

function toMember(agent: DeepScanAgentResult): JarooDeepScanCommitteeMember {
  return {
    memberKey: agent.key,
    shortLabel: agent.shortLabel,
    title: agent.label,
    status: 'success',
    reason: agent.reason,
    score: agent.score,
    scoreLabel: `${agent.score}점`,
    tone: memberTone(agent),
    iconTone: agent.iconTone,
    confidence: agent.confidence,
    error: null,
  }
}

function buildAxes(agentResults: DeepScanAgentResult[], exchangeProduct = false): JarooDeepScanCommitteeAxis[] {
  const groups = exchangeProduct
    ? [
        {
          label: 'ETF 구조',
          subtitle: '기초자산, 상품 구조, 가격 단서를 함께 봅니다.',
          agents: ['growth', 'profitability-quality', 'valuation'] as const,
        },
        {
          label: '시장 흐름',
          subtitle: '가격 모멘텀, 시장 신호, 뉴스 이벤트를 묶어 봅니다.',
          agents: ['momentum', 'estimate-revision', 'event-risk'] as const,
        },
        {
          label: '포지션 적합도',
          subtitle: '유동성, 수급 단서, 내 평단 위치를 함께 봅니다.',
          agents: ['financial-safety', 'ownership-flow', 'portfolio-fit'] as const,
        },
      ]
    : [
        {
          label: '사업 품질',
          subtitle: '성장성과 수익성, 밸류에이션을 함께 봅니다.',
          agents: ['growth', 'profitability-quality', 'valuation'] as const,
        },
        {
          label: '시장 타이밍',
          subtitle: '모멘텀과 추정치 변화, 이벤트 리스크를 묶어 봅니다.',
          agents: ['momentum', 'estimate-revision', 'event-risk'] as const,
        },
        {
          label: '포지션 적합도',
          subtitle: '재무안정성과 소유구조, 내 포지션 적합도를 봅니다.',
          agents: ['financial-safety', 'ownership-flow', 'portfolio-fit'] as const,
        },
      ]

  return groups.map((group) => {
    const members = group.agents
      .map((key) => agentResults.find((agent) => agent.key === key))
      .filter((agent): agent is DeepScanAgentResult => Boolean(agent))
    const score = clamp(members.reduce((sum, agent) => sum + agent.score, 0) / (members.length || 1))

    return {
      label: group.label,
      score,
      scoreText: scoreText(score),
      axisStatusText: axisStatus(score),
      subtitle: group.subtitle,
      avgLabel: `위원 평균 ${score}`,
      members: members.map(toMember),
    }
  })
}

function buildHeroScore(agentResults: DeepScanAgentResult[]) {
  const weights: Record<DeepScanAgentResult['key'], number> = {
    valuation: 14,
    growth: 12,
    'profitability-quality': 12,
    'financial-safety': 12,
    momentum: 10,
    'estimate-revision': 10,
    'ownership-flow': 8,
    'event-risk': 10,
    'portfolio-fit': 12,
  }

  const weightedTotal = agentResults.reduce((sum, agent) => sum + (weights[agent.key] * agent.score), 0)
  return clamp(weightedTotal / 100)
}

function buildUsInsights(
  facts: UsDeepScanFacts,
  agentResults: DeepScanAgentResult[],
  generatedSignals: GeneratedDumpSignalSummary,
): { sectionLabel: string; items: JarooDeepScanInsightItem[]; summaryTags: string[] } {
  const items: JarooDeepScanInsightItem[] = []

  if (generatedSignals.ownershipFlow?.availability === 'present' && generatedSignals.ownershipFlow.eventCount > 0) {
    items.push({
      sourceType: 'report',
      sourceLabel: 'Ownership Flow',
      date: generatedSignals.ownershipFlow.latestEventDate ?? '최근 공시 기준',
      label: 'Ownership',
      title: generatedSignals.ownershipFlow.summary ?? '최근 direct ownership/flow 공시가 포착됐어요.',
      body: `${generatedSignals.ownershipFlow.primarySource} 기준 최근 공시 ${generatedSignals.ownershipFlow.eventCount}건 · 방향 ${generatedSignals.ownershipFlow.direction ?? 'mixed'}`,
    })
  }

  if (generatedSignals.momentum?.availability === 'present' && generatedSignals.momentum.pointCount > 0) {
    const momentumProvenance = describeMomentumProvenance(generatedSignals.momentum.primarySource, generatedSignals.momentum.pointCount)
    items.push({
      sourceType: 'market',
      sourceLabel: 'OHLC',
      date: generatedSignals.momentum.latestDate ?? '최근 시세 기준',
      label: 'OHLC',
      title: momentumProvenance.insightTitle,
      body: `최신 종가 ${formatCurrency(generatedSignals.momentum.latestClose, facts.currency)} · ${generatedSignals.momentum.latestDate ?? '최근'} 기준`,
    })
  }

  items.push(...facts.news.slice(0, Math.max(0, 3 - items.length)).map((item) => ({
    sourceType: 'news' as const,
    sourceLabel: 'US News',
    date: item.publishedAt ?? '발행시각 미확인',
    label: '뉴스',
    title: item.title,
    body: `${facts.companyName} 관련 최근 헤드라인입니다.`,
  })))

  const tags = agentResults
    .filter((agent) => agent.score >= 70 || agent.score <= 40)
    .slice(0, 3)
    .map((agent) => `${agent.label}:${agent.score}`)

  if (generatedSignals.ownershipFlow?.availability === 'present' && generatedSignals.ownershipFlow.eventCount > 0) {
    tags.unshift(`Ownership:${generatedSignals.ownershipFlow.eventCount}`)
  }
  if (generatedSignals.momentum?.availability === 'present' && generatedSignals.momentum.pointCount > 0) {
    tags.unshift(`OHLC:${generatedSignals.momentum.pointCount}`)
  }

  return {
    sectionLabel: '이번 주 체크포인트',
    items: items.slice(0, 3),
    summaryTags: tags.slice(0, 3),
  }
}

function formatUsdKrwRate(rate: number | null) {
  return typeof rate === 'number' && Number.isFinite(rate)
    ? `${Math.round(rate).toLocaleString('ko-KR')}원/$`
    : '환율 미확인'
}

async function fetchUsdKrwRateForDeepScan() {
  const upstreamUrl = buildCrawlerUrl(getCrawlerBaseUrl(), '/api/major/market/fx/usd-krw')

  try {
    const response = await fetch(upstreamUrl, { cache: 'no-store' })
    if (!response.ok) {
      return null
    }

    const payload = await response.json()
    return normalizeUsdKrwRate(payload?.data?.rate)
  } catch {
    return null
  }
}

async function resolveUsDeepScanUsdKrwRate(rawInput: DeepScanRawInput, facts: UsDeepScanFacts) {
  const explicitRate = normalizeUsdKrwRate(rawInput.holding?.usdKrwRate)
  if (explicitRate !== null) {
    return explicitRate
  }

  const averagePriceCurrency = normalizeMoneyCurrency(rawInput.holding?.averagePriceCurrency)
  const currentPriceCurrency = normalizeMoneyCurrency(rawInput.holding?.currentPriceCurrency ?? facts.currency) ?? 'USD'
  if (currentPriceCurrency !== 'USD') {
    return null
  }

  if (averagePriceCurrency === 'KRW') {
    return fetchUsdKrwRateForDeepScan()
  }

  if (averagePriceCurrency === 'USD') {
    return null
  }

  const averagePrice = parseNumberish(rawInput.holding?.averagePrice)
  if (typeof averagePrice === 'number' && typeof facts.currentPrice === 'number' && facts.currentPrice > 0 && averagePrice > facts.currentPrice * 20) {
    return fetchUsdKrwRateForDeepScan()
  }

  return null
}

function sanitizeUsPortfolioFitAgentReason(
  agentResults: DeepScanAgentResult[],
  facts: UsDeepScanFacts,
  rawInput: DeepScanRawInput,
  usdKrwRate: number | null,
  generatedSignals: GeneratedDumpSignalSummary,
) {
  const exchangeProduct = isUsExchangeProductInput(rawInput)
  const costBasis = resolveCurrencyAwareAveragePrice({
    averagePrice: rawInput.holding?.averagePrice,
    averagePriceCurrency: rawInput.holding?.averagePriceCurrency,
    currentPrice: facts.currentPrice,
    currentPriceCurrency: facts.currency,
    usdKrwRate,
  })
  const currentPrice = facts.currentPrice
  const shares = parseNumberish(rawInput.holding?.shares)
  const averagePrice = costBasis.averagePriceInCurrentCurrency

  if (
    typeof currentPrice !== 'number'
    || !Number.isFinite(currentPrice)
    || typeof averagePrice !== 'number'
    || !Number.isFinite(averagePrice)
  ) {
    return agentResults
  }

  const pnlPct = averagePrice === 0 ? null : ((currentPrice - averagePrice) / averagePrice) * 100
  const pnl = typeof shares === 'number' && Number.isFinite(shares)
    ? (currentPrice - averagePrice) * shares
    : null
  const convertedAverageText = formatCurrency(averagePrice, facts.currency)
  const rawAverageText = costBasis.converted && costBasis.averagePriceCurrency === 'KRW'
    ? `${formatCurrency(costBasis.averagePrice, 'KRW')} 원화 평단을 ${convertedAverageText}로 환산`
    : `평단 ${convertedAverageText}`
  const pnlText = typeof pnl === 'number'
    ? `보유 손익은 약 ${formatCurrency(pnl, facts.currency)}(${signedPercent(pnlPct)})`
    : `현재가 대비 수익률은 ${signedPercent(pnlPct)}`
  const targetPrice = facts.consensus?.forecastEps && facts.consensus?.forwardPer
    ? facts.consensus.forecastEps * facts.consensus.forwardPer
    : null
  const targetText = exchangeProduct
    ? '기업 목표가 대신 ETF의 가격 흐름, 유동성, 기초자산 노출'
    : (
        typeof targetPrice === 'number' && Number.isFinite(targetPrice)
          ? `컨센서스 EPS×PER 기준 가격 ${formatCurrency(targetPrice, facts.currency)}`
          : '컨센서스 기준 가격 미확인'
      )
  const positionTone = typeof pnlPct === 'number' && pnlPct >= 0
    ? exchangeProduct
      ? '평단 위 수익권이므로 기초자산 조정과 변동성 확대 여부를 우선 확인해야 합니다.'
      : '평단 위 수익권이므로 추격 매수보다 분할 매도·리스크 관리 기준을 우선 확인해야 합니다.'
    : exchangeProduct
      ? '평단 아래 손실권이므로 기초자산 회복과 거래량 유지 여부를 함께 확인해야 합니다.'
      : '평단 아래 손실권이므로 반등 조건과 손절 기준을 함께 관리해야 합니다.'
  const safeReason = `${rawAverageText}했고 현재가 ${formatCurrency(currentPrice, facts.currency)}와 같은 ${facts.currency ?? 'USD'} 기준으로 비교했습니다. ${pnlText}입니다. ${targetText}를 현재 가격 위치와 함께 보면 ${positionTone}`
  const ownershipSummary = generatedSignals.ownershipFlow?.summary?.replace(/\s*$/u, '').replace(/[.。]?$/u, '.')
  const ownershipReason = `${ownershipSummary ?? 'SEC ownership/insider-flow 공시가 확인되었습니다.'} Ownership/flow는 내부자·소유권 흐름 근거로만 해석하며, 세부 순매수·순매도 규모가 제한적이면 신뢰도는 보수적으로 봅니다.`
  const holdingConfusionPattern = /averagePriceCurrency|currentPriceCurrency|usdKrwRate|averagePriceInQuoteCurrency|평균단가|평단|보유\s*원가|손익\s*평가|수익성\s*평가|환산할\s*수\s*없|통화\s*불일치|현재\s*USD\s*가격|514[,，]?\d{3}/u
  const sanitizeNonPortfolioReason = (reason: string) => {
    if (!holdingConfusionPattern.test(reason)) {
      return reason
    }

    const sentences = reason
      .split(/(?<=\.)\s+|(?<=다\.)\s*/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .filter((sentence) => !holdingConfusionPattern.test(sentence))

    return sentences.join(' ') || '해당 위원은 자기 역할의 시장·기업 근거만 반영하고, 보유 단가·환율 비교는 포지션 적합도 위원에서 별도로 계산합니다.'
  }

  return agentResults.map((agent) => (
    agent.key === 'portfolio-fit'
      ? { ...agent, reason: safeReason }
      : agent.key === 'ownership-flow'
        ? { ...agent, reason: ownershipReason }
        : { ...agent, reason: sanitizeNonPortfolioReason(agent.reason) }
  ))
}

function buildUsStrategy(heroScore: number, facts: UsDeepScanFacts, rawInput: DeepScanRawInput, usdKrwRate: number | null, exchangeProduct = false): JarooDeepScanStrategyBlock {
  const costBasis = resolveCurrencyAwareAveragePrice({
    averagePrice: rawInput.holding?.averagePrice,
    averagePriceCurrency: rawInput.holding?.averagePriceCurrency,
    currentPrice: facts.currentPrice,
    currentPriceCurrency: facts.currency,
    usdKrwRate,
  })
  const shares = parseNumberish(rawInput.holding?.shares)
  const currentPrice = facts.currentPrice
  const normalizedAveragePrice = costBasis.averagePriceInCurrentCurrency
  const gapPct = typeof currentPrice === 'number' && typeof normalizedAveragePrice === 'number' && normalizedAveragePrice > 0
    ? ((currentPrice - normalizedAveragePrice) / normalizedAveragePrice) * 100
    : null
  const targetPrice = facts.consensus?.forecastEps && facts.consensus?.forwardPer
    ? facts.consensus.forecastEps * facts.consensus.forwardPer
    : currentPrice
  const tone = heroScore >= 70 ? 'positive' : heroScore >= 55 ? 'primary' : 'warning'
  const weekSignal = exchangeProduct
    ? heroScore >= 70 ? '흐름 양호' : heroScore >= 55 ? '관찰 지속' : '리스크 점검'
    : heroScore >= 70 ? '보유 유지' : heroScore >= 55 ? '관찰 지속' : '리스크 점검'

  return {
    ...createBlockMeta('ok', [createSourceRef('system', 'deepscan-us-strategy', 'US strategy synthesis')]),
    weekSignal,
    weekSignalTone: tone,
    weekBadgeText: `위원회 ${heroScore}점`,
    scenarioLabel: heroScore >= 70 ? '기본 시나리오' : '주의 시나리오',
    scenarioProbability: `${Math.max(10, heroScore)}%`,
    scenarioPeriod: '약 3개월',
    scenarioCondition: typeof gapPct === 'number'
      ? `평단 대비 ${signedPercent(gapPct)} 구간 유지`
      : costBasis.requiresFx
        ? '원화 평단 환산값 확인 필요'
        : '보유 포지션 기준치 재확인',
    currentPriceText: formatCurrency(currentPrice, facts.currency),
    targetPriceText: exchangeProduct ? 'ETF 기준' : formatCurrency(targetPrice, facts.currency),
    scenarioDetails: [
      `보유 수량 ${formatNumber(shares)}주 기준`,
      costBasis.converted && typeof normalizedAveragePrice === 'number'
        ? `원화 평단을 ${formatCurrency(normalizedAveragePrice, facts.currency)}로 환산 · USD/KRW ${formatUsdKrwRate(costBasis.usdKrwRate)}`
        : `평단 ${formatCurrency(normalizedAveragePrice ?? costBasis.averagePrice, costBasis.averagePriceCurrency ?? facts.currency)}`,
      exchangeProduct
        ? `ETF는 목표가보다 가격 흐름·유동성·기초자산 노출을 우선 확인`
        : `추정 EPS ${formatNumber(facts.consensus?.forecastEps, 2)} · forward PER ${formatNumber(facts.consensus?.forwardPer, 1)}`,
    ],
    otherScenarios: [
      {
        label: '상방',
        probability: `${Math.max(5, 100 - heroScore)}%`,
        condition: exchangeProduct ? '기초지수 상승 + 거래량 유지' : '추정치 상향 지속',
      },
      {
        label: '하방',
        probability: `${Math.max(5, 65 - Math.floor(heroScore / 2))}%`,
        condition: exchangeProduct ? '기초자산 조정 + 변동성 확대' : '모멘텀 둔화 + 뉴스 리스크 확대',
      },
    ],
    otherScenarioTags: [facts.market ?? 'US', facts.currency ?? 'USD'],
  }
}

function buildUsSellNow(heroScore: number, facts: UsDeepScanFacts, rawInput: DeepScanRawInput, usdKrwRate: number | null): JarooDeepScanSellNowBlock {
  const shares = parseNumberish(rawInput.holding?.shares)
  const currentPrice = facts.currentPrice
  const costBasis = resolveCurrencyAwareAveragePrice({
    averagePrice: rawInput.holding?.averagePrice,
    averagePriceCurrency: rawInput.holding?.averagePriceCurrency,
    currentPrice,
    currentPriceCurrency: facts.currency,
    usdKrwRate,
  })
  const averagePrice = costBasis.averagePriceInCurrentCurrency

  if (typeof shares !== 'number' || typeof averagePrice !== 'number' || typeof currentPrice !== 'number') {
    return {
      ...createBlockMeta('blocked', [createSourceRef('holding', 'deepscan-us-sell-now', 'US sell-now missing holding')], {
        fallback: createFallback(costBasis.blockedReason ?? 'holding-context-incomplete', costBasis.requiresFx ? '환율 데이터 부족' : '보유 데이터 부족'),
        error: createError(
          costBasis.blockedReason ?? 'holding-context-incomplete',
          costBasis.requiresFx
            ? '원화 평단을 달러 현재가와 비교하려면 USD/KRW 환율이 필요해요.'
            : '보유 수량/평단/현재가가 부족해 즉시 매도 판단을 계산할 수 없어요.',
        ),
      }),
      realizedText: costBasis.requiresFx
        ? '원화 평단 환산에 필요한 USD/KRW 환율이 없어 즉시 매도 판단을 계산하지 않았어요.'
        : '보유 수량, 평단가, 현재가가 모두 있어야 즉시 매도 판단을 계산할 수 있어요.',
      rows: [],
    }
  }

  const pnl = (currentPrice - averagePrice) * shares
  const pnlPct = averagePrice === 0 ? null : ((currentPrice - averagePrice) / averagePrice) * 100
  const decisionBand = heroScore >= 70 ? 'hold' : heroScore >= 55 ? 'trim' : 'exit-watch'

  return {
    ...createBlockMeta('ok', [createSourceRef('holding', 'deepscan-us-sell-now', 'US sell-now decision')]),
    realizedText: `현재가 기준 평가손익 ${formatCurrency(pnl, facts.currency)} (${signedPercent(pnlPct)}). 즉시 매도 판단은 ${decisionBand} 입니다.`,
    rows: [
      { label: '판단', value: decisionBand, emphasis: true },
      { label: '현재가', value: formatCurrency(currentPrice, facts.currency) },
      {
        label: '평단가',
        value: costBasis.converted
          ? `${formatCurrency(averagePrice, facts.currency)} (${formatUsdKrwRate(costBasis.usdKrwRate)})`
          : formatCurrency(averagePrice, facts.currency),
      },
      { label: '평가손익', value: `${formatCurrency(pnl, facts.currency)} / ${signedPercent(pnlPct)}`, tag: pnl >= 0 ? '수익' : '손실', tagTone: pnl >= 0 ? 'positive' : 'danger', valueTone: pnl >= 0 ? undefined : 'danger' },
    ],
  }
}

function buildUsPortfolioSimulation(heroScore: number, sellNow: JarooDeepScanSellNowBlock): JarooDeepScanPortfolioSimulationBlock {
  if (sellNow.blockState !== 'ok') {
    return {
      ...createBlockMeta('blocked', [createSourceRef('system', 'deepscan-us-portfolio-sim', 'US portfolio simulation blocked')], {
        fallback: createFallback('sell-now-blocked', '시뮬레이션 보류'),
        error: createError('sell-now-blocked', '즉시 매도 판단이 없어 포트폴리오 변화를 계산하지 않았어요.'),
      }),
      beforeScore: heroScore,
      afterScore: heroScore,
      deltaLabel: 'blocked:+0',
      caption: '즉시 매도 판단이 준비되면 포트폴리오 변화를 계산할 수 있어요.',
    }
  }

  const decisionBand = sellNow.rows.find((row) => row.label === '판단')?.value ?? 'hold'
  const delta = decisionBand === 'hold' ? 2 : decisionBand === 'trim' ? 6 : 9
  const beforeScore = clamp(heroScore)
  const afterScore = clamp(heroScore + delta)

  return {
    ...createBlockMeta('ok', [createSourceRef('system', 'deepscan-us-portfolio-sim', 'US portfolio simulation')]),
    beforeScore,
    afterScore,
    deltaLabel: `${decisionBand}:+${delta}`,
    caption: `${decisionBand} 판단 기준 포지션 제거 시 포트폴리오 변화 ${beforeScore} → ${afterScore}.`,
  }
}

function createUsRuntimeFailurePayload(rawInput: DeepScanRawInput, ticker: string, name: string, generatedAt: string, sourceRefs: DeepScanSourceRef[], code: string, message: string): JarooDeepScanPayload {
  const sourceContextFrom = normalizeSourceFrom(rawInput.sourceContext.from)
  const fallback = createFallback(code, 'US LLM runtime 실패')
  const error = createError(code, message, true)

  return {
    input: {
      instrument: {
        name,
        ticker,
        market: 'US',
        kind: rawInput.instrument.kind,
      },
      holding: rawInput.holding,
      selectedAt: rawInput.selectedAt,
      sourceContext: { from: sourceContextFrom },
    },
    hero: {
      ...createBlockMeta('error', sourceRefs, { fallback, error }),
      headline: `${name} US DeepScan LLM 분석에 실패했어요`,
      body: 'US LLM committee runtime을 완료하지 못해 DeepScan canonical payload 생성을 중단했어요.',
      statusText: '요청 실패',
      score: 0,
      scoreLabel: 'Error · 0 / 100',
      scoreDelta: '+0',
    },
    committee: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), axes: [] },
    insights: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), sectionLabel: '이번 주 체크포인트', items: [], summaryTags: [] },
    strategy: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      weekSignal: '대기',
      weekSignalTone: 'warning',
      weekBadgeText: 'LLM 실패',
      scenarioLabel: '데이터 재요청 필요',
      scenarioProbability: '0%',
      scenarioPeriod: '대기',
      scenarioCondition: '잠시 후 다시 시도해주세요.',
      currentPriceText: 'N/A',
      targetPriceText: 'N/A',
      scenarioDetails: ['US LLM committee runtime 재요청이 필요해요.'],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), realizedText: '데이터가 없어 즉시 매도 판단을 계산하지 않았어요.', rows: [] },
    portfolioSimulation: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), beforeScore: 0, afterScore: 0, deltaLabel: 'blocked:+0', caption: '데이터가 없어 포트폴리오 변화를 계산하지 않았어요.' },
    metadata: {
      generatedAt,
      version: 'deepscan-runtime-v1',
      degraded: true,
      errorCode: error.code,
      debugId: `deepscan:US:${ticker}:llm`,
      inputValidity: {
        valid: true,
        raw: buildInputValidityRaw(rawInput),
      },
      sourceRefs,
      blockStatus: {
        hero: 'error',
        committee: 'blocked',
        insights: 'blocked',
        strategy: 'blocked',
        sellNow: 'blocked',
        portfolioSimulation: 'blocked',
      },
    },
  } satisfies JarooDeepScanPayload
}

async function fetchUsSlimPayload(ticker: string) {
  const upstreamUrl = buildCrawlerUrl(getCrawlerBaseUrl(), `/api/major/wisereport-global/us/companies/${encodeURIComponent(ticker)}/slim/v1.1`)
  const fetchTimeoutMs = parsePositiveInteger(process.env.DEEPSCAN_US_SLIM_FETCH_TIMEOUT_MS, DEFAULT_US_SLIM_FETCH_TIMEOUT_MS)
  const response = await fetchWithDeadline(fetch, upstreamUrl, { cache: 'no-store' }, fetchTimeoutMs, 'US slim fetch')

  if (!response.ok) {
    const body = await readResponseText(response, 'US slim fetch')
    throw new CrawlerDeepScanRequestError(`US slim fetch failed (${response.status}): ${body.slice(0, 200)}`, response.status)
  }

  return readJsonPayload(response, 'US slim fetch')
}

async function buildUsPayload(rawInput: DeepScanRawInput): Promise<JarooDeepScanPayload> {
  const ticker = normalizeText(rawInput.instrument.ticker)?.toUpperCase()
  const name = normalizeText(rawInput.instrument.name) ?? ticker ?? '미국 종목'
  const exchangeProduct = isUsExchangeProductInput(rawInput)

  if (!ticker) {
    return createInvalidInputPayload(rawInput)
  }

  const generatedAt = rawInput.selectedAt ?? new Date().toISOString()
  const sourceRefs = [
    createSourceRef('holding', `input:${ticker}`, 'deepscan input'),
    createSourceRef('system', 'deepscan-runtime-us', 'deepscan runtime us baseline'),
  ]

  const issues: SourceIssue[] = []
  let slimPayload: unknown = null

  try {
    slimPayload = await fetchUsSlimPayload(ticker)
  } catch (error) {
    issues.push({
      id: 'us-slim',
      message: error instanceof Error ? error.message : 'US slim fetch failed',
      retryable: true,
    })
  }

  if (!slimPayload) {
    const fallback = createFallback('us-slim-fetch-failed', 'US slim fetch 실패')
    const error = createError('us-slim-fetch-failed', issues[0]?.message ?? 'US slim fetch failed', true)
    const sourceContextFrom = normalizeSourceFrom(rawInput.sourceContext.from)

    const payload = {
      input: {
        instrument: {
          name,
          ticker,
          market: 'US',
          kind: rawInput.instrument.kind,
        },
        holding: rawInput.holding,
        selectedAt: rawInput.selectedAt,
        sourceContext: { from: sourceContextFrom },
      },
      hero: {
        ...createBlockMeta('error', sourceRefs, { fallback, error }),
        headline: `${name} US DeepScan을 불러오지 못했어요`,
        body: 'US slim payload를 가져오지 못해서 DeepScan canonical payload 생성을 중단했어요.',
        statusText: '요청 실패',
        score: 0,
        scoreLabel: 'Error · 0 / 100',
        scoreDelta: '+0',
      },
      committee: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), axes: [] },
      insights: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), sectionLabel: '이번 주 체크포인트', items: [], summaryTags: [] },
      strategy: {
        ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
        weekSignal: '대기',
        weekSignalTone: 'warning',
        weekBadgeText: 'fetch 실패',
        scenarioLabel: '데이터 재요청 필요',
        scenarioProbability: '0%',
        scenarioPeriod: '대기',
        scenarioCondition: '잠시 후 다시 시도해주세요.',
        currentPriceText: 'N/A',
        targetPriceText: 'N/A',
        scenarioDetails: ['US slim payload 재요청이 필요해요.'],
        otherScenarios: [],
        otherScenarioTags: [],
      },
      sellNow: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), realizedText: '데이터가 없어 즉시 매도 판단을 계산하지 않았어요.', rows: [] },
      portfolioSimulation: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), beforeScore: 0, afterScore: 0, deltaLabel: 'blocked:+0', caption: '데이터가 없어 포트폴리오 변화를 계산하지 않았어요.' },
      metadata: {
        generatedAt,
        version: 'deepscan-runtime-v1',
        degraded: true,
        errorCode: error.code,
        debugId: `deepscan:US:${ticker}`,
        inputValidity: {
          valid: true,
          raw: buildInputValidityRaw(rawInput),
        },
        sourceRefs,
        blockStatus: {
          hero: 'error',
          committee: 'blocked',
          insights: 'blocked',
          strategy: 'blocked',
          sellNow: 'blocked',
          portfolioSimulation: 'blocked',
        },
      },
    } satisfies JarooDeepScanPayload

    return payload
  }

  let facts = findUsFacts(slimPayload, ticker)
  let agentResults: DeepScanAgentResult[]
  let llmDebugId: string | undefined

  let llmErrors: Array<{ member: string; error: string }> = []
  let generatedSignals: GeneratedDumpSignalSummary = { momentum: null, ownershipFlow: null }
  let generatedOhlcSeries: Array<Record<string, unknown>> = []

  try {
    const llm = await scoreUsCommitteeFromGeneratedDump(rawInput, ticker)
    agentResults = buildUsAgentResultsFromLlm(llm.results, exchangeProduct)
    llmDebugId = llm.artifacts.manifest.requestId
    llmErrors = llm.errors
    generatedSignals = summarizeGeneratedDumpSignals(llm.artifacts.runtimeShape)
    generatedOhlcSeries = extractGeneratedOhlcSeries(llm.artifacts.runtimeShape)

    if (agentResults.length === 0) {
      throw new Error(llm.errors.map((entry) => `${entry.member}: ${entry.error}`).join(' | ') || 'US LLM runtime returned no successful members')
    }
  } catch (error) {
    return createUsRuntimeFailurePayload(
      rawInput,
      ticker,
      name,
      generatedAt,
      [...sourceRefs, createSourceRef('system', 'deepscan-runtime-us-llm', 'US LLM committee runtime')],
      'us-llm-runtime-failed',
      error instanceof Error ? error.message : 'US LLM runtime failed',
    )
  }

  if (
    typeof facts.currentPrice !== 'number'
    && typeof generatedSignals.momentum?.latestClose === 'number'
    && Number.isFinite(generatedSignals.momentum.latestClose)
  ) {
    facts = { ...facts, currentPrice: generatedSignals.momentum.latestClose }
  }

  const usdKrwRate = await resolveUsDeepScanUsdKrwRate(rawInput, facts)
  agentResults = sanitizeUsPortfolioFitAgentReason(agentResults, facts, rawInput, usdKrwRate, generatedSignals)
  const heroScore = buildHeroScore(agentResults)
  const axes = buildAxes(agentResults, exchangeProduct)
  const insights = buildUsInsights(facts, agentResults, generatedSignals)
  const strategy = buildUsStrategy(heroScore, facts, rawInput, usdKrwRate, exchangeProduct)
  const sellNow = buildUsSellNow(heroScore, facts, rawInput, usdKrwRate)
  const portfolioSimulation = buildUsPortfolioSimulation(heroScore, sellNow)
  const recoveryForecast = buildDeepScanRecoveryForecastBlock({
    rawInput,
    primarySeries: generatedOhlcSeries,
    currentPrice: facts.currentPrice ?? generatedSignals.momentum?.latestClose,
    currency: facts.currency,
    sourceRefs,
    sourceId: `recovery-ohlc:${ticker}`,
    sourceLabel: generatedSignals.momentum?.pointCount
      ? `US OHLC ${generatedSignals.momentum.pointCount} bars for recovery forecast`
      : 'US OHLC recovery forecast input',
  })
  const degraded = agentResults.some((agent) => agent.confidence === 'low') || llmErrors.length > 0
  const sourceContextFrom = normalizeSourceFrom(rawInput.sourceContext.from)
  const momentumProvenance = generatedSignals.momentum
    ? describeMomentumProvenance(generatedSignals.momentum.primarySource, generatedSignals.momentum.pointCount)
    : null
  const sourceRefsWithPayload = [
    ...sourceRefs,
    createSourceRef('report', `us-slim:${ticker}`, 'WiseReport Global slim v1.1', facts.consensus?.asOfDate),
    createSourceRef('market', `us-price:${ticker}`, 'latest price from slim snapshot'),
    ...(generatedSignals.momentum?.availability === 'present'
      ? [createSourceRef('market', `us-ohlc:${ticker}`, momentumProvenance?.sourceRefLabel ?? `OHLC ${generatedSignals.momentum.pointCount} bars`, generatedSignals.momentum.latestDate)]
      : []),
    ...(generatedSignals.ownershipFlow?.availability === 'present'
      ? [createSourceRef('report', `us-ownership:${ticker}`, generatedSignals.ownershipFlow.summary ?? 'SEC ownership/flow summary', generatedSignals.ownershipFlow.latestEventDate)]
      : []),
    createSourceRef('system', `us-llm:${ticker}`, 'OpenRouter US committee runtime', llmDebugId ?? (llmErrors.length > 0 ? `${llmErrors.length} member failures` : undefined)),
  ]

  const heroBodyParts = [
    `현재가 ${formatCurrency(facts.currentPrice, facts.currency)} 확인`,
    exchangeProduct
      ? 'US ETF 기준 가격·유동성 중심'
      : `forward PER ${formatNumber(facts.consensus?.forwardPer ?? facts.per, 1)} / PBR ${formatNumber(facts.consensus?.forwardPbr ?? facts.pbr, 1)}`,
    generatedSignals.momentum?.availability === 'present'
      ? (momentumProvenance?.heroBodyText ?? `OHLC ${generatedSignals.momentum.pointCount}개 반영`)
      : `최근 뉴스 ${facts.news.length}건 반영`,
    generatedSignals.ownershipFlow?.availability === 'present' && generatedSignals.ownershipFlow.eventCount > 0
      ? `${generatedSignals.ownershipFlow.primarySource} ownership 공시 ${generatedSignals.ownershipFlow.eventCount}건`
      : null,
  ].filter((part): part is string => Boolean(part))

  const payload: JarooDeepScanPayload = {
    input: {
      instrument: {
        name,
        ticker,
        market: facts.market ?? 'US',
        kind: rawInput.instrument.kind,
      },
      holding: rawInput.holding,
      selectedAt: rawInput.selectedAt,
      sourceContext: { from: sourceContextFrom },
    },
    hero: {
      ...createBlockMeta('ok', sourceRefsWithPayload, degraded ? { fallback: createFallback('weak-data-degradation', llmErrors.length > 0 ? `일부 위원 실패 ${llmErrors.length}건` : '일부 근거 부족') } : undefined),
      headline: `${name} ${exchangeProduct ? 'US ETF' : 'US'} DeepScan ${heroScore}점`,
      body: heroBodyParts.join(' · '),
      statusText: axisStatus(heroScore),
      score: heroScore,
      scoreLabel: `${heroScore >= 70 ? 'strong' : heroScore >= 55 ? 'moderate' : 'caution'} · ${heroScore} / 100`,
      scoreDelta: degraded ? '-1' : '+0',
    },
    committee: {
      ...createBlockMeta('ok', sourceRefsWithPayload, degraded ? { fallback: createFallback('weak-data-degradation', llmErrors.length > 0 ? `일부 위원 실패 ${llmErrors.length}건` : '일부 위원은 low-confidence') } : undefined),
      axes,
    },
    insights: {
      ...createBlockMeta(insights.items.length > 0 ? 'ok' : 'blocked', sourceRefsWithPayload, insights.items.length > 0 ? undefined : { fallback: createFallback('news-missing', '뉴스 데이터 부족') }),
      ...insights,
    },
    strategy,
    ...(recoveryForecast ? { recoveryForecast } : {}),
    sellNow,
    portfolioSimulation,
    metadata: {
      generatedAt,
      version: 'deepscan-runtime-v1',
      degraded,
      debugId: llmDebugId ?? `deepscan:US:${ticker}:llm`,
      inputValidity: {
        valid: true,
        raw: buildInputValidityRaw(rawInput),
      },
      sourceRefs: sourceRefsWithPayload,
      blockStatus: {
        hero: 'ok',
        committee: 'ok',
        insights: insights.items.length > 0 ? 'ok' : 'blocked',
        strategy: strategy.blockState,
        sellNow: sellNow.blockState,
        portfolioSimulation: portfolioSimulation.blockState,
      },
    },
  } satisfies JarooDeepScanPayload

  return payload
}

export async function buildDeepScanPayloadFromSearchParams(searchParams: URLSearchParams) {
  const rawInput = buildRawInputFromSearchParams(searchParams)
  const route = resolveDeepScanPayloadBuilderRoute(rawInput)

  if (route === 'us') {
    return buildUsPayload(rawInput)
  }

  if (route === 'invalid') {
    return createInvalidInputPayload(rawInput)
  }

  return buildKrDeepScanPayloadViaCrawler(rawInput)
}

export { buildRawInputFromSearchParams }
