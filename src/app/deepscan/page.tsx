'use client'

import type { JarooDeepScanCommitteeAxis, JarooDeepScanConsensusStructured, JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  LineChart,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DeepScanInlineResults } from '@/components/deepscan-inline-results'
import { DeepScanLoadingScreen, type FindingProgress, type LoadingPerformanceComment, type LoadingQuickFact, type LoadingStageKey } from '@/components/deepscan-loading-screen'
import { JarooShell } from '@/components/jaroo-shell'
import { fetchDeepScanCanonicalPayload, type DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import { isFiniteNumber, type LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import { fetchLoadingProxyJson } from '@/lib/loading-fetch-retry'
import { resolveDeepScanPageCacheState } from '@/lib/deepscan-page-projection'
import { resolveDeepScanLoadingCurrentPrice } from '@/lib/deepscan-loading-current-price'
import { isDeepScanInlineResultsReady } from '@/lib/deepscan-loading-behavior'
import { resolveDeepScanTargetSession } from '@/lib/jaroo-home-data'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { getDeepScanTargetKey, type DeepScanTargetInput, type WorkflowMoneyCurrency } from '@/lib/workflow-types'

type DeepScanLoadingSequenceState = {
  targetKey: string | null
  firstSuccessObserved: boolean
  visibleStageCount: number
  sequenceComplete: boolean
}
type DeepScanLoadingStageArrivalState = {
  targetKey: string | null
  stageKeys: LoadingStageKey[]
}
type HomeMarketTone = DeepScanCanonicalTargetSession['holding']['marketTone']

const DEEPSCAN_STAGE_WAIT_MS = 18_000
const DEEPSCAN_STAGE_FILL_DELAY_MS = 3_000
const DEEPSCAN_MEMBER_STAGE_BY_KEY: Record<string, LoadingStageKey> = {
  profitability: 'fundamentalTeam',
  valuation: 'fundamentalTeam',
  ownershipStability: 'fundamentalTeam',
  growth: 'fundamentalTeam',
  'profitability-quality': 'fundamentalTeam',
  trend: 'marketTeam',
  consensusMomentum: 'contextTeam',
  priceLocation: 'marketTeam',
  momentum: 'marketTeam',
  'estimate-revision': 'marketTeam',
  'event-risk': 'marketTeam',
  avgPriceGap: 'contextTeam',
  upsideBuffer: 'contextTeam',
  holdingCompleteness: 'contextTeam',
  'financial-safety': 'contextTeam',
  'ownership-flow': 'contextTeam',
  'portfolio-fit': 'contextTeam',
}
const DEEPSCAN_MEMBER_STAGE_BY_TITLE: Record<string, LoadingStageKey> = {
  '수익성/기본체력': 'fundamentalTeam',
  밸류에이션: 'fundamentalTeam',
  '지분/안정성': 'fundamentalTeam',
  트렌드: 'marketTeam',
  '컨센서스 모멘텀': 'contextTeam',
  '이벤트 스캐너': 'contextTeam',
  '가격 위치': 'marketTeam',
  '평단 격차': 'contextTeam',
  '상방 버퍼': 'contextTeam',
  '입력 완성도': 'contextTeam',
}

function createDeepScanLoadingSequence(targetKey: string | null): DeepScanLoadingSequenceState {
  return {
    targetKey,
    firstSuccessObserved: false,
    visibleStageCount: 1,
    sequenceComplete: false,
  }
}

function createDeepScanLoadingStageArrival(targetKey: string | null): DeepScanLoadingStageArrivalState {
  return {
    targetKey,
    stageKeys: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueLoadingStageKeys(stageKeys: LoadingStageKey[]): LoadingStageKey[] {
  return stageKeys.filter((stageKey, index, values) => values.indexOf(stageKey) === index)
}

function extractLoadingStageKeysFromCommitteeResults(results: unknown): LoadingStageKey[] {
  if (!isRecord(results)) {
    return []
  }

  return uniqueLoadingStageKeys(
    Object.keys(results)
      .map((memberKey) => DEEPSCAN_MEMBER_STAGE_BY_KEY[memberKey])
      .filter((stageKey): stageKey is LoadingStageKey => Boolean(stageKey)),
  )
}

function extractLoadingStageKeysFromCommitteeAxes(committeeAxes: JarooDeepScanCommitteeAxis[] | undefined): LoadingStageKey[] {
  return uniqueLoadingStageKeys(
    (committeeAxes ?? [])
      .flatMap((axis) => axis.members)
      .filter((member) => member.status === 'success' || member.status === 'error')
      .map((member) => (member.memberKey ? DEEPSCAN_MEMBER_STAGE_BY_KEY[member.memberKey] : undefined) ?? DEEPSCAN_MEMBER_STAGE_BY_TITLE[member.title])
      .filter((stageKey): stageKey is LoadingStageKey => Boolean(stageKey)),
  )
}

const emptyDeepScanSteps: ReadonlyArray<{ icon: LucideIcon; label: string; body: string }> = [
  { icon: BadgeCheck, label: '보유 종목 선택', body: '홈에서 분석할 주식 카드를 고릅니다.' },
  { icon: LineChart, label: '시장 데이터 확인', body: '현재가·52주 위치·핵심 근거를 먼저 보여줘요.' },
  { icon: ShieldCheck, label: '세 팀 분석', body: '회복 가능성과 리스크를 순서대로 정리합니다.' },
]

type LoadingFindingKey = 'quality' | 'timing' | 'position' | 'decision'
type LoadingFindingProgressMap = Partial<Record<LoadingFindingKey, FindingProgress>>
type LoadingQuickQuote = {
  targetKey: string
  currentPrice?: number
  currentPriceCurrency?: WorkflowMoneyCurrency
  tradingVolume?: number
  week52High?: number
  week52Low?: number
}
type TargetLoadingBriefingSnapshot = LoadingBriefingSnapshot & {
  targetKey: string
}
type QuotesCurrentProxyResponse = {
  ok?: boolean
  data?: {
    items?: Array<{
      code?: string | null
      ticker?: string | null
      price?: number
      currency?: string | null
      volume?: number
      week52High?: number
      week52Low?: number
    }>
  }
}
type TargetLoadingMarketSnapshot = Pick<LoadingBriefingSnapshot, 'market'> & {
  targetKey: string
}
type UsMarketIndicatorsProxyResponse = {
  ok?: boolean
  data?: {
    sp500?: UsMarketIndicatorItem | null
    nasdaq?: UsMarketIndicatorItem | null
    vix?: UsMarketIndicatorItem | null
  } | null
}
type UsMarketIndicatorItem = {
  close?: number | null
  value?: number | null
  changePct?: number | null
  timestamp?: number | string | null
}

const loadingFindingAxisKeys = ['quality', 'timing', 'position'] as const
const MAX_FINDING_TEXT_LENGTH = 96

function compactFindingText(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }

  return normalized.length > MAX_FINDING_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_FINDING_TEXT_LENGTH - 1).trim()}…`
    : normalized
}

function buildAxisFindingProgress(axis: JarooDeepScanCommitteeAxis | undefined): FindingProgress | null {
  if (!axis) {
    return null
  }

  const members = axis.members ?? []
  const completedMembers = members.filter((member) => member.status === 'success' && compactFindingText(member.reason))
  const pendingCount = members.filter((member) => member.status === 'pending').length
  const errorCount = members.filter((member) => member.status === 'error').length

  if (completedMembers.length === 0) {
    if (errorCount > 0 && pendingCount === 0) {
      return {
        badge: '재시도 필요',
        tone: 'warning',
        body: `${axis.label} 위원 응답을 아직 한 줄 요약으로 만들 수 없어요. 실패 슬롯을 확인하고 재시도가 필요합니다.`,
      }
    }

    return null
  }

  const leadMember = completedMembers[0]
  const extraCount = completedMembers.length - 1
  const memberSuffix = extraCount > 0 ? ` 외 ${extraCount}명` : ''

  return {
    badge: pendingCount > 0 ? `${completedMembers.length}/${members.length} 분석중` : '분석 완료',
    tone: pendingCount > 0 ? 'active' : 'done',
    body: `${leadMember.title}${memberSuffix}: ${compactFindingText(leadMember.reason)}`,
  }
}

function buildLoadingFindingProgress(payload: JarooDeepScanPayload | null): LoadingFindingProgressMap | undefined {
  if (!payload) {
    return undefined
  }

  const progress: LoadingFindingProgressMap = {}

  loadingFindingAxisKeys.forEach((key, index) => {
    const axisProgress = buildAxisFindingProgress(payload.committee.axes[index])
    if (axisProgress) {
      progress[key] = axisProgress
    }
  })

  if (payload.metadata.llmCommittee?.status !== 'partial' && payload.sellNow.blockState === 'ok') {
    progress.decision = {
      badge: '분석 완료',
      tone: 'done',
      body: compactFindingText(payload.sellNow.realizedText) || compactFindingText(payload.portfolioSimulation.caption) || '즉시 매도 판단이 도착했어요.',
    }
  }

  return Object.keys(progress).length > 0 ? progress : undefined
}

function buildLoadingPerformanceComment(payload: JarooDeepScanPayload | null): LoadingPerformanceComment | undefined {
  const comment = payload?.insights.items.find((item) => item.sourceLabel === '기업실적코멘트' || item.title === '기업실적코멘트')
  if (!comment?.body?.trim()) {
    return undefined
  }

  const lines = comment.body.split(/\n+/).map((line) => line.trim()).filter(Boolean)

  return {
    asOf: comment.date,
    body: comment.body,
    ...(comment.sourceBody?.trim() ? { fullBody: comment.sourceBody } : {}),
    ...(lines.length > 1 ? { lines } : {}),
  }
}

function buildLoadingTradingVolume(payload: JarooDeepScanPayload | null) {
  const volume = payload?.insights.items.find((item) => item.sourceLabel === '거래량' || item.label === '거래량')
  if (!volume?.body?.trim()) {
    return undefined
  }

  return volume.body.replace(/^거래량\s*/u, '').replace(/\s*확인$/u, '').trim()
}

function normalizeDeepScanCode(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) {
    return undefined
  }

  const exactCode = normalized.match(/^\d{6}$/u)
  if (exactCode) {
    return exactCode[0]
  }

  const embeddedCode = normalized.match(/(?:^|[^0-9])(\d{6})(?:[^0-9]|$)/u)
  return embeddedCode?.[1]
}

function normalizeDeepScanTicker(value: string | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized || undefined
}


function buildDeepScanTargetInputFromSession(session: ReturnType<typeof resolveDeepScanTargetSession>): DeepScanTargetInput | null {
  const holding = session?.holding
  if (!holding || holding.id === -1 || holding.name === '종목 미선택') {
    return null
  }

  const quantity = parseOcrNumber(holding.shares)
  const averagePrice = parseOcrNumber(holding.averagePrice)
  if (quantity === null || averagePrice === null) {
    return null
  }

  return {
    code: holding.identifierCode ?? holding.code,
    ticker: holding.identifierTicker,
    market: holding.market,
    marketTone: holding.marketTone,
    kind: holding.kind,
    name: holding.name,
    quantity,
    averagePrice,
    snapshotProfitRate: holding.snapshotProfitRate,
    currentPrice: parseOcrNumber(holding.metrics.find((metric) => metric.label === '현재가')?.value ?? '') ?? undefined,
    currentProfitRate: parseOcrNumber(holding.change) ?? undefined,
    currentPriceCurrency: holding.marketTone === 'nasdaq' ? 'USD' : 'KRW',
    evaluationAmount: parseOcrNumber(holding.evaluationAmount ?? '') ?? undefined,
    averagePriceCurrency: holding.averagePriceCurrency,
    identifierLabel: holding.identifierLabel,
  }
}


function needsHydratedUsdKrwRate(target: DeepScanTargetInput) {
  return target.marketTone === 'nasdaq'
    && target.averagePriceCurrency === 'KRW'
    && target.currentPriceCurrency === 'USD'
    && !isFiniteNumber(target.usdKrwRate)
}

async function fetchHydrationUsdKrwRate() {
  try {
    const response = await fetch('/api/market/fx/usd-krw', { cache: 'no-store' })
    if (!response.ok) {
      return undefined
    }

    const payload = await response.json()
    const rate = Number(payload?.data?.rate)
    return Number.isFinite(rate) && rate > 0 ? rate : undefined
  } catch {
    return undefined
  }
}

function buildLoadingQuickQuoteUrl(target: { code?: string; ticker?: string } | null) {
  const code = normalizeDeepScanCode(target?.code)
  const ticker = normalizeDeepScanTicker(target?.ticker)
  if (!code && !ticker) {
    return undefined
  }

  const searchParams = new URLSearchParams()
  if (code) {
    searchParams.set('codes', code)
    searchParams.set('includeContext', '1')
  } else if (ticker) {
    searchParams.set('tickers', ticker)
  }

  return `/api/quotes/current?${searchParams.toString()}`
}

function buildLoadingBriefingSnapshotUrl(target: { code?: string; ticker?: string; market?: string; marketTone?: HomeMarketTone } | null) {
  const code = normalizeDeepScanCode(target?.code)
  if (code) {
    const searchParams = new URLSearchParams({ code })
    return `/api/deepscan/briefing-snapshot?${searchParams.toString()}`
  }

  const ticker = target?.ticker?.trim().toUpperCase()
  if (!ticker || (target?.marketTone !== 'nasdaq' && target?.market?.toUpperCase() !== 'US')) {
    return undefined
  }

  const searchParams = new URLSearchParams({ ticker, market: 'US' })
  return `/api/deepscan/briefing-snapshot?${searchParams.toString()}`
}

function isDeepScanUsTarget(target: { ticker?: string; market?: string; marketTone?: HomeMarketTone } | null) {
  return Boolean(target?.ticker?.trim())
    && (target?.marketTone === 'nasdaq' || target?.market?.toUpperCase() === 'US' || target?.market?.toUpperCase() === 'NASDAQ')
}

function normalizeUsMarketIndicator(item: UsMarketIndicatorItem | null | undefined) {
  if (!item) {
    return null
  }

  const value = isFiniteNumber(item.close) ? item.close : isFiniteNumber(item.value) ? item.value : null
  const changePct = isFiniteNumber(item.changePct) ? item.changePct : null
  const timestamp = item.timestamp
  const asOf = typeof timestamp === 'number'
    ? new Date(timestamp).toISOString()
    : typeof timestamp === 'string' && timestamp.trim()
      ? timestamp
      : null

  return {
    value,
    changePct,
    asOf,
  }
}

function buildUsLoadingMarketSnapshot(body: UsMarketIndicatorsProxyResponse, targetKey: string): TargetLoadingMarketSnapshot | null {
  if (!body.ok || !body.data) {
    return null
  }

  const sp500 = normalizeUsMarketIndicator(body.data.sp500)
  const nasdaq = normalizeUsMarketIndicator(body.data.nasdaq)
  const vix = normalizeUsMarketIndicator(body.data.vix)
  if (!sp500 && !nasdaq && !vix) {
    return null
  }

  return {
    targetKey,
    market: {
      ...(sp500 ? { sp500 } : {}),
      ...(nasdaq ? { nasdaq } : {}),
      ...(vix ? { vix } : {}),
    },
  }
}

function formatLoadingPercent(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value)}%`
}

function formatLoadingMoney(value: number, currency: WorkflowMoneyCurrency = 'KRW') {
  const suffix = currency === 'USD' ? '달러' : '원'
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value)}${suffix}`
}

function clampLoadingPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}

function resolveWeek52PositionLabel(lowGapPct: number | undefined, highGapPct: number | undefined) {
  if (typeof highGapPct === 'number' && highGapPct >= -10) {
    return '고점 근처예요'
  }

  if (typeof lowGapPct !== 'number') {
    return '가격 위치를 확인했어요'
  }

  if (lowGapPct <= 20) {
    return '바닥권 근처예요'
  }

  if (lowGapPct <= 50) {
    return '중하단 구간이에요'
  }

  if (lowGapPct <= 80) {
    return '중상단 구간이에요'
  }

  return '고점권에 가까워요'
}

function buildWeek52LoadingQuickFact(quickQuote: LoadingQuickQuote | null): LoadingQuickFact | null {
  const currentPrice = quickQuote?.currentPrice
  const high = quickQuote?.week52High
  const low = quickQuote?.week52Low
  if (
    typeof currentPrice !== 'number'
    || typeof high !== 'number'
    || typeof low !== 'number'
    || currentPrice <= 0
    || high <= 0
    || low <= 0
    || high <= low
  ) {
    return null
  }

  const lowGapPct = ((currentPrice - low) / low) * 100
  const highGapPct = ((currentPrice - high) / high) * 100
  const rangePositionPct = clampLoadingPercent(((currentPrice - low) / (high - low)) * 100)
  const currency = quickQuote?.currentPriceCurrency ?? 'KRW'

  return {
    key: 'week52-position',
    category: '가격 위치',
    badge: '정보',
    tone: 'info',
    body: `52주 최저 대비 ${formatLoadingPercent(lowGapPct)}, 최고 대비 ${formatLoadingPercent(highGapPct)}`,
    detail: resolveWeek52PositionLabel(lowGapPct, highGapPct),
    indicator: {
      positionPct: rangePositionPct,
      markerLabel: `현재 ${formatLoadingMoney(currentPrice, currency)}`,
      deltaLabels: [`최저 대비 ${formatLoadingPercent(lowGapPct)}`, `최고 대비 ${formatLoadingPercent(highGapPct)}`],
      leftLabel: `최저 ${formatLoadingMoney(low, currency)}`,
      rightLabel: `최고 ${formatLoadingMoney(high, currency)}`,
    },
  }
}


function buildWeek52LoadingQuickFactFromBriefingSnapshot(snapshot: LoadingBriefingSnapshot | null): LoadingQuickFact | null {
  const dailyRows = (snapshot?.daily ?? []).filter((row) => isFiniteNumber(row.close))
  if (dailyRows.length === 0) {
    return null
  }

  const quote = snapshot?.quote
  const currentPrice = isFiniteNumber(quote?.currentPrice) ? quote.currentPrice : dailyRows.at(-1)?.close
  const high = dailyRows.reduce<number | null>((max, row) => {
    const value = isFiniteNumber(row.high) ? row.high : row.close
    return max === null || value > max ? value : max
  }, null)
  const low = dailyRows.reduce<number | null>((min, row) => {
    const value = isFiniteNumber(row.low) ? row.low : row.close
    return min === null || value < min ? value : min
  }, null)

  return buildWeek52LoadingQuickFact({
    targetKey: 'briefing-snapshot',
    ...(isFiniteNumber(currentPrice) ? { currentPrice } : {}),
    ...(isFiniteNumber(high) ? { week52High: high } : {}),
    ...(isFiniteNumber(low) ? { week52Low: low } : {}),
    ...(normalizeQuoteCurrency(quote?.currency) ? { currentPriceCurrency: normalizeQuoteCurrency(quote?.currency) } : {}),
  })
}

function parseLoadingConsensusBody(body: string, structured?: JarooDeepScanConsensusStructured) {
  const s = structured ?? {}
  // Structured fields are authoritative when the crawler emits them; the regex
  // matches below stay as a fallback for older crawlers / the US payload path.
  const analystCountMatch = body.match(/증권사\s*(\d+)\s*곳/u)
  const targetMatch = body.match(/평균\s*목표가\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const upsideMatch = body.match(/현재가\s*대비\s*([+-]?\d+(?:\.\d+)?)%/u)
  const opinionMatch = body.match(/투자의견\s*([0-9]+(?:\.\d+)?)/u)
  const highTargetMatch = body.match(/최고\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const lowTargetMatch = body.match(/최저\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const summaryMatch = body.match(/(모두 매수 의견이에요|매수 의견이 우세해요|의견이 갈리고 있어요|신중한 의견이 많아요)/u)
  const regexTargetCurrency: WorkflowMoneyCurrency = targetMatch?.[2]?.toUpperCase() === 'USD' || targetMatch?.[2] === '달러' ? 'USD' : 'KRW'
  const targetCurrency: WorkflowMoneyCurrency = s.currency?.toUpperCase() === 'USD' ? 'USD' : (s.currency ? 'KRW' : regexTargetCurrency)

  const pickNum = (v: number | null | undefined, fallback: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const regexTargetValue = targetMatch?.[1] ? Number(targetMatch[1].replace(/,/gu, '')) : undefined
  const targetValue = typeof s.targetPrice === 'number' && Number.isFinite(s.targetPrice) && s.targetPrice > 0 ? s.targetPrice : regexTargetValue
  const upsidePct = pickNum(s.targetGapPct, upsideMatch?.[1] ? Number(upsideMatch[1]) : undefined)
  const opinionScore = pickNum(s.recommendationScore, opinionMatch?.[1] ? Number(opinionMatch[1]) : undefined)
  const analystCount = pickNum(s.analystCount, analystCountMatch?.[1] ? Number(analystCountMatch[1]) : undefined)
  const highTargetValue = pickNum(s.highestTargetPrice, highTargetMatch?.[1] ? Number(highTargetMatch[1].replace(/,/gu, '')) : undefined)
  const lowTargetValue = pickNum(s.lowestTargetPrice, lowTargetMatch?.[1] ? Number(lowTargetMatch[1].replace(/,/gu, '')) : undefined)
  const summaryText = typeof s.opinionSummary === 'string' && s.opinionSummary.trim() ? s.opinionSummary.trim() : summaryMatch?.[1]
  const highTargetCurrency: WorkflowMoneyCurrency = highTargetMatch?.[2]?.toUpperCase() === 'USD' || highTargetMatch?.[2] === '달러' ? 'USD' : targetCurrency
  const lowTargetCurrency: WorkflowMoneyCurrency = lowTargetMatch?.[2]?.toUpperCase() === 'USD' || lowTargetMatch?.[2] === '달러' ? 'USD' : targetCurrency
  const currentPrice = typeof targetValue === 'number'
    && Number.isFinite(targetValue)
    && typeof upsidePct === 'number'
    && Number.isFinite(upsidePct)
    && 1 + upsidePct / 100 !== 0
    ? targetValue / (1 + upsidePct / 100)
    : undefined

  return {
    analystCountLabel: typeof analystCount === 'number' ? `증권사 ${analystCount}곳` : undefined,
    targetPriceLabel: typeof targetValue === 'number' && Number.isFinite(targetValue)
      ? formatLoadingMoney(targetValue, targetCurrency)
      : undefined,
    currentPriceLabel: typeof currentPrice === 'number' && Number.isFinite(currentPrice)
      ? formatLoadingMoney(currentPrice, targetCurrency)
      : undefined,
    highTargetLabel: typeof highTargetValue === 'number' && Number.isFinite(highTargetValue)
      ? formatLoadingMoney(highTargetValue, highTargetCurrency)
      : undefined,
    lowTargetLabel: typeof lowTargetValue === 'number' && Number.isFinite(lowTargetValue)
      ? formatLoadingMoney(lowTargetValue, lowTargetCurrency)
      : undefined,
    summary: summaryText,
    upsideLabel: typeof upsidePct === 'number' && Number.isFinite(upsidePct)
      ? formatLoadingPercent(upsidePct)
      : undefined,
    upsidePct: typeof upsidePct === 'number' && Number.isFinite(upsidePct) ? upsidePct : undefined,
    opinionLabel: typeof opinionScore === 'number' && Number.isFinite(opinionScore)
      ? new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(opinionScore)
      : undefined,
    opinionScore: typeof opinionScore === 'number' && Number.isFinite(opinionScore) ? opinionScore : undefined,
    // Raw numeric values feed the target-price fan chart simulation.
    targetPriceValue: typeof targetValue === 'number' && Number.isFinite(targetValue) ? targetValue : undefined,
    currentPriceValue: typeof currentPrice === 'number' && Number.isFinite(currentPrice) ? currentPrice : undefined,
    highTargetValue: typeof highTargetValue === 'number' && Number.isFinite(highTargetValue) ? highTargetValue : undefined,
    lowTargetValue: typeof lowTargetValue === 'number' && Number.isFinite(lowTargetValue) ? lowTargetValue : undefined,
  }
}

function isNoDataConsensusBody(body: string) {
  return /데[이]?타가\s*존재하지\s*않습니다|데[이]?터가\s*존재하지\s*않습니다|최근\s*3개월\s*이내에\s*제시된\s*의견이\s*없습니다|목표가\s*미제공|목표가\s*조회\s*실패/u.test(body)
}

function isTargetPriceFailureText(value: string) {
  return /목표가\s*조회\s*실패|조회\s*실패|수집\s*실패|원천\s*(?:차단|실패|불가)|source[_-]?unavailable/i.test(value)
}

function isTargetPriceMissingText(value: string) {
  return /목표가\s*미제공|ETF는\s*목표가\s*대신|데[이]?타가\s*존재하지\s*않습니다|데[이]?터가\s*존재하지\s*않습니다|최근\s*3개월\s*이내에\s*제시된\s*의견이\s*없습니다/u.test(value)
}

function isExchangeProductMarket(value: string | null | undefined) {
  return /(?:^|\b)(?:ETF|ETN)(?:\b|$)/iu.test(value ?? '')
}

function isExchangeProductPayload(payload: JarooDeepScanPayload | null, fallbackMarket?: string, fallbackKind?: string) {
  return isExchangeProductMarket(payload?.input.instrument.market ?? fallbackMarket)
    || /^(?:etf|etn)$/iu.test(payload?.input.instrument.kind ?? fallbackKind ?? '')
}

function hasHangulBatchim(value: string) {
  const lastChar = Array.from(value.trim()).at(-1)
  if (!lastChar) {
    return false
  }

  const code = lastChar.charCodeAt(0)
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0
}

function getTargetPriceSubject(payload: JarooDeepScanPayload | null, fallbackName?: string) {
  const name = payload?.input.instrument.name?.trim() || fallbackName?.trim()
  return name ? `${name}${hasHangulBatchim(name) ? '은' : '는'}` : '이 종목은'
}

function summarizeTargetPriceReason(value: string, payload: JarooDeepScanPayload | null, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  const subject = getTargetPriceSubject(payload, fallbackName)
  if (isExchangeProductPayload(payload, fallbackMarket, fallbackKind)) {
    return 'ETF는 NAV 괴리율, 기초지수 흐름, 구성종목 비중을 기준으로 해석합니다.'
  }

  if (!normalized) {
    return `${subject} 증권사 목표가를 확인하는 중입니다.`
  }

  if (isTargetPriceFailureText(normalized)) {
    return `${subject} 증권사 목표가를 지금 불러오지 못했습니다.`
  }

  if (isTargetPriceMissingText(normalized)) {
    return `${subject} 아직 증권사 목표가가 제시되지 않은 종목입니다.`
  }

  return normalized
}

function buildTargetPriceStatusQuickFact(payload: JarooDeepScanPayload | null, sourceBody?: string, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string): LoadingQuickFact {
  const exchangeProduct = isExchangeProductPayload(payload, fallbackMarket, fallbackKind)
  const targetPriceText = payload?.strategy.targetPriceText?.trim() ?? ''
  const reasonSource = sourceBody?.trim() || targetPriceText
  const isFailure = isTargetPriceFailureText(reasonSource)
  const isMissing = !isFailure && isTargetPriceMissingText(reasonSource)
  const hasTargetPriceValue = Boolean(targetPriceText && targetPriceText !== 'N/A' && !isFailure && !isMissing)
  const body = exchangeProduct
    ? summarizeTargetPriceReason(reasonSource, payload, fallbackName, fallbackMarket, fallbackKind)
    : hasTargetPriceValue
      ? `목표가 ${targetPriceText}`
      : summarizeTargetPriceReason(reasonSource, payload, fallbackName, fallbackMarket, fallbackKind)

  return {
    key: exchangeProduct ? 'etf-product-context' : 'analyst-consensus',
    category: exchangeProduct ? 'ETF 기준' : '목표가',
    badge: exchangeProduct ? 'NAV·구성' : isFailure ? '조회 실패' : isMissing ? '미제공' : '확인 중',
    tone: isFailure && !exchangeProduct ? 'warning' : 'info',
    body,
    detail: isFailure && !exchangeProduct ? '목표가 없음으로 확정하지 않고, 원천 조회 실패로 분리해 표시합니다.' : undefined,
  }
}

function buildConsensusLoadingQuickFact(payload: JarooDeepScanPayload | null, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string): LoadingQuickFact | null {
  const exchangeProduct = isExchangeProductPayload(payload, fallbackMarket, fallbackKind)
  const consensus = exchangeProduct ? undefined : payload?.insights.items.find((item) => item.sourceLabel === '증권사 의견' || item.label === '컨센서스')
  if (!payload) {
    return buildTargetPriceStatusQuickFact(null, undefined, fallbackName, fallbackMarket, fallbackKind)
  }

  if (!consensus?.body?.trim()) {
    return buildTargetPriceStatusQuickFact(payload, undefined, fallbackName, fallbackMarket, fallbackKind)
  }

  if (isNoDataConsensusBody(consensus.body)) {
    return buildTargetPriceStatusQuickFact(payload, consensus.body, fallbackName, fallbackMarket, fallbackKind)
  }

  const parsedConsensus = parseLoadingConsensusBody(consensus.body, consensus.consensus)
  if (!parsedConsensus.targetPriceLabel) {
    return buildTargetPriceStatusQuickFact(payload, consensus.body, fallbackName, fallbackMarket, fallbackKind)
  }

  const isPositive = /매수|buy|상향|positive/i.test(consensus.body) || (parsedConsensus.upsidePct ?? 0) > 0 || (parsedConsensus.opinionScore ?? 0) >= 3.5
  return {
    key: 'analyst-consensus',
    category: '목표가',
    badge: isPositive ? '긍정' : '정보',
    tone: isPositive ? 'positive' : 'info',
    body: consensus.body,
    ...(parsedConsensus.targetPriceLabel
      ? {
        consensus: {
          targetPriceLabel: parsedConsensus.targetPriceLabel,
          ...(parsedConsensus.currentPriceLabel ? { currentPriceLabel: parsedConsensus.currentPriceLabel } : {}),
          ...(parsedConsensus.analystCountLabel ? { analystCountLabel: parsedConsensus.analystCountLabel } : {}),
          ...(parsedConsensus.highTargetLabel ? { highTargetLabel: parsedConsensus.highTargetLabel } : {}),
          ...(parsedConsensus.lowTargetLabel ? { lowTargetLabel: parsedConsensus.lowTargetLabel } : {}),
          ...(parsedConsensus.summary ? { summary: parsedConsensus.summary } : {}),
          ...(parsedConsensus.upsideLabel ? { upsideLabel: parsedConsensus.upsideLabel } : {}),
          ...(typeof parsedConsensus.upsidePct === 'number' ? { upsidePct: parsedConsensus.upsidePct } : {}),
          ...(parsedConsensus.opinionLabel ? { opinionLabel: parsedConsensus.opinionLabel } : {}),
          ...(typeof parsedConsensus.opinionScore === 'number' ? { opinionScore: parsedConsensus.opinionScore } : {}),
          ...(typeof parsedConsensus.targetPriceValue === 'number' ? { targetPriceValue: parsedConsensus.targetPriceValue } : {}),
          ...(typeof parsedConsensus.currentPriceValue === 'number' ? { currentPriceValue: parsedConsensus.currentPriceValue } : {}),
          ...(typeof parsedConsensus.highTargetValue === 'number' ? { highTargetValue: parsedConsensus.highTargetValue } : {}),
          ...(typeof parsedConsensus.lowTargetValue === 'number' ? { lowTargetValue: parsedConsensus.lowTargetValue } : {}),
        },
      }
      : {}),
  }
}

function buildLoadingQuickFacts(payload: JarooDeepScanPayload | null, quickQuote: LoadingQuickQuote | null, briefingSnapshot: LoadingBriefingSnapshot | null, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string): LoadingQuickFact[] {
  return [
    buildWeek52LoadingQuickFact(quickQuote) ?? buildWeek52LoadingQuickFactFromBriefingSnapshot(briefingSnapshot),
    buildConsensusLoadingQuickFact(payload, fallbackName, fallbackMarket, fallbackKind),
  ].filter((fact): fact is LoadingQuickFact => Boolean(fact))
}

function normalizeQuoteCurrency(value: string | null | undefined): WorkflowMoneyCurrency | undefined {
  return value === 'KRW' || value === 'USD' ? value : undefined
}

function selectLoadingQuickQuoteItem(
  body: QuotesCurrentProxyResponse,
  target: { code?: string; ticker?: string } | null,
) {
  const items = Array.isArray(body.data?.items) ? body.data.items : []
  const code = normalizeDeepScanCode(target?.code)
  const ticker = normalizeDeepScanTicker(target?.ticker)

  return items.find((item) => code && normalizeDeepScanCode(item.code ?? undefined) === code)
    ?? items.find((item) => ticker && normalizeDeepScanTicker(item.ticker ?? undefined) === ticker)
    ?? items[0]
}

function hasCollectedDeepScanEvidence(payload: JarooDeepScanPayload | null) {
  if (!payload) {
    return false
  }

  return payload.metadata.sourceRefs.some((ref) => ref.type === 'report' || ref.type === 'market')
    || payload.insights.items.length > 0
    || payload.committee.sourceRefs.some((ref) => ref.type === 'report' || ref.type === 'market')
}

type DeepScanCommitteeStatusResponse = {
  ok?: boolean
  requestId?: string
  status?: 'partial' | 'complete' | 'error' | 'not_found'
  completed?: number
  results?: Record<string, unknown>
  pending?: string[]
  errors?: unknown[]
  softDeadlineMs?: number
  committeeAxes?: JarooDeepScanCommitteeAxis[]
}

export default function DeepScanPage() {
  const target = useDeepScanStore((state) => state.target)
  const setDeepScanTarget = useDeepScanStore((state) => state.setTarget)
  const requestStatus = useDeepScanStore((state) => state.requestStatus)
  const errorMessage = useDeepScanStore((state) => state.errorMessage)
  const activePayload = useDeepScanStore((state) => state.activePayload)
  const activeTargetKey = useDeepScanStore((state) => state.activeTargetKey)
  const lastSuccessful = useDeepScanStore((state) => state.lastSuccessful)
  const startRequest = useDeepScanStore((state) => state.startRequest)
  const finishSuccess = useDeepScanStore((state) => state.finishSuccess)
  const updateActivePayload = useDeepScanStore((state) => state.updateActivePayload)
  const finishError = useDeepScanStore((state) => state.finishError)
  const abandonInFlight = useDeepScanStore((state) => state.abandonInFlight)
  const [loadingQuickQuote, setLoadingQuickQuote] = useState<LoadingQuickQuote | null>(null)
  const [loadingBriefingSnapshot, setLoadingBriefingSnapshot] = useState<TargetLoadingBriefingSnapshot | null>(null)
  const [loadingMarketSnapshot, setLoadingMarketSnapshot] = useState<TargetLoadingMarketSnapshot | null>(null)
  const [loadingSequence, setLoadingSequence] = useState<DeepScanLoadingSequenceState>(() => createDeepScanLoadingSequence(null))
  const [arrivedLoadingStages, setArrivedLoadingStages] = useState<DeepScanLoadingStageArrivalState>(() => createDeepScanLoadingStageArrival(null))
  const [displayedLoadingStages, setDisplayedLoadingStages] = useState<DeepScanLoadingStageArrivalState>(() => createDeepScanLoadingStageArrival(null))

  useEffect(() => {
    let cancelled = false
    const hydrateTarget = async () => {
      const sessionTarget = resolveDeepScanTargetSession()
      const hydratedTarget = buildDeepScanTargetInputFromSession(sessionTarget)
      if (!hydratedTarget) {
        return
      }

      if (
        target
        && getDeepScanTargetKey(target) === getDeepScanTargetKey(hydratedTarget)
        && Math.abs(target.quantity - hydratedTarget.quantity) < 1e-9
      ) {
        return
      }

      const usdKrwRate = needsHydratedUsdKrwRate(hydratedTarget)
        ? await fetchHydrationUsdKrwRate()
        : hydratedTarget.usdKrwRate

      if (!cancelled) {
        setDeepScanTarget({
          ...hydratedTarget,
          ...(usdKrwRate ? { usdKrwRate } : {}),
        })
      }
    }

    void hydrateTarget()

    return () => {
      cancelled = true
    }
  }, [setDeepScanTarget, target])

  const targetKey = useMemo(() => (target ? getDeepScanTargetKey(target) : null), [target])
  const targetKeyRef = useRef(targetKey)
  const requestSeed = useMemo<DeepScanCanonicalTargetSession | null>(
    () =>
      target
        ? {
            holding: {
              name: target.name,
              code: target.code,
              identifierCode: target.code,
              ticker: target.ticker,
              identifierTicker: target.ticker,
              shares: String(target.quantity),
              averagePrice: String(target.averagePrice),
              averagePriceCurrency: target.averagePriceCurrency,
              currentPrice: typeof target.currentPrice === 'number' ? String(target.currentPrice) : undefined,
              currentPriceCurrency: target.currentPriceCurrency,
              currentProfitRate: typeof target.currentProfitRate === 'number' ? String(target.currentProfitRate) : undefined,
              evaluationAmount: typeof target.evaluationAmount === 'number' ? String(target.evaluationAmount) : undefined,
              usdKrwRate: typeof target.usdKrwRate === 'number' ? String(target.usdKrwRate) : undefined,
              market: target.market ?? target.marketTone?.toUpperCase() ?? '미확인',
              marketTone: (target.marketTone ?? (target.kind === 'etf' ? 'etf' : 'kospi')) as HomeMarketTone,
              kind: target.kind,
            },
            selectedAt: undefined,
          }
        : null,
    [target],
  )
  const { payload, fetchState, shouldStartRequest } = resolveDeepScanPageCacheState({
    hasTarget: Boolean(target),
    targetKey,
    requestStatus,
    activePayload,
    activeTargetKey,
    lastSuccessful,
  })
  useEffect(() => {
    targetKeyRef.current = targetKey
  }, [targetKey])
  const markDeepScanLoadingSuccess = useCallback((successTargetKey: string | null) => {
    if (!successTargetKey) {
      return
    }

    setLoadingSequence((previous) => {
      if (previous.targetKey !== successTargetKey) {
        return {
          ...createDeepScanLoadingSequence(successTargetKey),
          firstSuccessObserved: true,
        }
      }

      if (previous.firstSuccessObserved) {
        return previous
      }

      return {
        ...previous,
        firstSuccessObserved: true,
      }
    })
  }, [])
  const appendArrivedLoadingStageKeys = useCallback((successTargetKey: string | null, stageKeys: LoadingStageKey[]) => {
    if (!successTargetKey || stageKeys.length === 0) {
      return
    }

    setArrivedLoadingStages((previous) => {
      const previousKeys = previous.targetKey === successTargetKey ? previous.stageKeys : []
      const nextStageKeys = uniqueLoadingStageKeys([...previousKeys, ...stageKeys])
      if (previous.targetKey === successTargetKey && nextStageKeys.length === previous.stageKeys.length) {
        return previous
      }

      return {
        targetKey: successTargetKey,
        stageKeys: nextStageKeys,
      }
    })
  }, [])

  useEffect(() => {
    if (!loadingSequence.targetKey || !loadingSequence.firstSuccessObserved || loadingSequence.sequenceComplete) {
      return undefined
    }

    const sequenceTargetKey = loadingSequence.targetKey
    if (loadingSequence.visibleStageCount === 1) {
      const timeoutId = window.setTimeout(() => {
        setLoadingSequence((previous) => (
          previous.targetKey === sequenceTargetKey && previous.visibleStageCount === 1
            ? { ...previous, visibleStageCount: 2 }
            : previous
        ))
      }, DEEPSCAN_STAGE_WAIT_MS)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    if (loadingSequence.visibleStageCount === 2) {
      const timeoutId = window.setTimeout(() => {
        setLoadingSequence((previous) => (
          previous.targetKey === sequenceTargetKey && previous.visibleStageCount === 2
            ? { ...previous, visibleStageCount: 3 }
            : previous
        ))
      }, DEEPSCAN_STAGE_WAIT_MS)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    if (loadingSequence.visibleStageCount === 3) {
      const timeoutId = window.setTimeout(() => {
        setLoadingSequence((previous) => (
          previous.targetKey === sequenceTargetKey && previous.visibleStageCount === 3
            ? { ...previous, sequenceComplete: true }
            : previous
        ))
      }, DEEPSCAN_STAGE_WAIT_MS)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    return undefined
  }, [loadingSequence.firstSuccessObserved, loadingSequence.sequenceComplete, loadingSequence.targetKey, loadingSequence.visibleStageCount])

  useEffect(() => {
    if (!targetKey || arrivedLoadingStages.targetKey !== targetKey) {
      return undefined
    }

    const displayedStageKeys = displayedLoadingStages.targetKey === targetKey ? displayedLoadingStages.stageKeys : []
    if (
      displayedStageKeys.length >= arrivedLoadingStages.stageKeys.length
      || displayedStageKeys.length >= loadingSequence.visibleStageCount
    ) {
      return undefined
    }

    const nextStageKey = arrivedLoadingStages.stageKeys[displayedStageKeys.length]
    if (!nextStageKey) {
      return undefined
    }

    const releaseTargetKey = targetKey
    const timeoutId = window.setTimeout(() => {
      if (targetKeyRef.current !== releaseTargetKey) {
        return
      }

      setDisplayedLoadingStages((previous) => {
        const previousKeys = previous.targetKey === releaseTargetKey ? previous.stageKeys : []
        if (previousKeys.includes(nextStageKey)) {
          return previous
        }

        return {
          targetKey: releaseTargetKey,
          stageKeys: uniqueLoadingStageKeys([...previousKeys, nextStageKey]),
        }
      })
    }, DEEPSCAN_STAGE_FILL_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [arrivedLoadingStages.stageKeys, arrivedLoadingStages.targetKey, displayedLoadingStages.stageKeys, displayedLoadingStages.targetKey, loadingSequence.visibleStageCount, targetKey])

  useEffect(() => {
    if (!shouldStartRequest) {
      return
    }

    startRequest()
  }, [shouldStartRequest, startRequest])

  useEffect(() => {
    const quickQuoteUrl = buildLoadingQuickQuoteUrl(target)
    if (!quickQuoteUrl || !targetKey) {
      return
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()

    const run = async () => {
      const result = await fetchLoadingProxyJson<NonNullable<QuotesCurrentProxyResponse['data']>>(quickQuoteUrl, {
        signal: controller.signal,
      })
      if (!result.ok || controller.signal.aborted) {
        return
      }

      const item = selectLoadingQuickQuoteItem({ ok: true, data: result.data }, target)
      if (!item) {
        return
      }

      setLoadingQuickQuote({
        targetKey: requestedTargetKey,
        ...(typeof item.price === 'number' && Number.isFinite(item.price)
          ? { currentPrice: item.price }
          : {}),
        ...(typeof item.volume === 'number' && Number.isFinite(item.volume)
          ? { tradingVolume: item.volume }
          : {}),
        ...(typeof item.week52High === 'number' && Number.isFinite(item.week52High)
          ? { week52High: item.week52High }
          : {}),
        ...(typeof item.week52Low === 'number' && Number.isFinite(item.week52Low)
          ? { week52Low: item.week52Low }
          : {}),
        ...(normalizeQuoteCurrency(item.currency)
          ? { currentPriceCurrency: normalizeQuoteCurrency(item.currency) }
          : {}),
      })
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [markDeepScanLoadingSuccess, target, targetKey])

  useEffect(() => {
    const snapshotUrl = buildLoadingBriefingSnapshotUrl(target)
    if (!snapshotUrl || !targetKey || loadingBriefingSnapshot?.targetKey === targetKey) {
      return
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()

    const run = async () => {
      // Retry with backoff: briefing snapshot is crawler-backed and can 502
      // transiently when Polygon.io rate-limits (429). Without retries the
      // chart / one-month / volume cards stay stuck in their loading fallback.
      const result = await fetchLoadingProxyJson<LoadingBriefingSnapshot>(snapshotUrl, {
        signal: controller.signal,
      })
      if (!result.ok || controller.signal.aborted) {
        return
      }

      setLoadingBriefingSnapshot({
        ...result.data,
        targetKey: requestedTargetKey,
      })
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [loadingBriefingSnapshot?.targetKey, target, targetKey])

  useEffect(() => {
    if (!isDeepScanUsTarget(target) || !targetKey || loadingMarketSnapshot?.targetKey === targetKey) {
      return undefined
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()

    const run = async () => {
      const result = await fetchLoadingProxyJson<NonNullable<UsMarketIndicatorsProxyResponse['data']>>('/api/market/us-indicators', {
        signal: controller.signal,
      })
      if (!result.ok || controller.signal.aborted) {
        return
      }

      const snapshot = buildUsLoadingMarketSnapshot({ ok: true, data: result.data }, requestedTargetKey)
      if (snapshot) {
        setLoadingMarketSnapshot(snapshot)
      }
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [loadingMarketSnapshot?.targetKey, target, targetKey])

  useEffect(() => {
    if (!requestSeed || !targetKey || requestStatus !== 'loading') {
      return
    }

    const requestedTargetKey = targetKey
    const controller = new AbortController()
    let settled = false

    const run = async () => {
      try {
        const nextPayload = await fetchDeepScanCanonicalPayload(
          requestSeed,
          (input, init) => fetch(input, { ...init, signal: controller.signal }),
        )

        if (controller.signal.aborted || targetKeyRef.current !== requestedTargetKey) {
          return
        }

        settled = true

        if (!nextPayload) {
          finishError('DeepScan 데이터를 표시할 수 없어요. 잠시 후 다시 시도해주세요.')
          return
        }

        markDeepScanLoadingSuccess(requestedTargetKey)
        if (!nextPayload.metadata.llmCommittee?.requestId) {
          appendArrivedLoadingStageKeys(requestedTargetKey, extractLoadingStageKeysFromCommitteeAxes(nextPayload.committee.axes))
        }
        finishSuccess(nextPayload)
      } catch (error) {
        if (controller.signal.aborted || targetKeyRef.current !== requestedTargetKey) {
          return
        }

        settled = true
        finishError(error instanceof Error ? error.message : 'DeepScan 데이터를 표시할 수 없어요. 잠시 후 다시 시도해주세요.')
      }
    }

    void run()

    return () => {
      controller.abort()

      if (!settled) {
        abandonInFlight()
      }
    }
  }, [abandonInFlight, appendArrivedLoadingStageKeys, finishError, finishSuccess, markDeepScanLoadingSuccess, requestSeed, requestStatus, targetKey])

  useEffect(() => {
    const llmCommittee = payload?.metadata.llmCommittee
    const needsPartialPolling = llmCommittee?.status === 'partial'
    const needsCompleteArrivalLookup = llmCommittee?.status === 'complete' && arrivedLoadingStages.targetKey !== targetKey
    if (fetchState !== 'success' || !payload || !targetKey || !llmCommittee?.requestId || (!needsPartialPolling && !needsCompleteArrivalLookup)) {
      return
    }

    const requestedTargetKey = targetKey
    let stopped = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const response = await fetch(`/api/deepscan/committee-status?requestId=${encodeURIComponent(llmCommittee.requestId)}`, { cache: 'no-store' })
        const body = (await response.json()) as DeepScanCommitteeStatusResponse

        if (stopped || !body.ok || body.requestId !== llmCommittee.requestId) {
          return
        }

        if (body.status === 'partial' || body.status === 'complete') {
          markDeepScanLoadingSuccess(requestedTargetKey)
          appendArrivedLoadingStageKeys(
            requestedTargetKey,
            extractLoadingStageKeysFromCommitteeResults(body.results).length > 0
              ? extractLoadingStageKeysFromCommitteeResults(body.results)
              : extractLoadingStageKeysFromCommitteeAxes(body.committeeAxes),
          )
        }

        updateActivePayload((currentPayload: JarooDeepScanPayload) => {
          const currentCommittee = currentPayload.metadata.llmCommittee
          if (currentCommittee?.requestId !== llmCommittee.requestId) {
            return currentPayload
          }

          const nextStatus = body.status === 'not_found'
            ? 'error'
            : body.status === 'complete' || body.status === 'partial' || body.status === 'error'
            ? body.status
            : currentCommittee.status
          const nextPending = body.status === 'not_found'
            ? 0
            : Array.isArray(body.pending) ? body.pending.length : currentCommittee.pending
          const nextErrors = body.status === 'not_found'
            ? Math.max(currentCommittee.errors, 1)
            : Array.isArray(body.errors) ? body.errors.length : currentCommittee.errors

          return {
            ...currentPayload,
            committee: Array.isArray(body.committeeAxes)
              ? {
                  ...currentPayload.committee,
                  axes: body.committeeAxes,
                }
              : currentPayload.committee,
            metadata: {
              ...currentPayload.metadata,
              llmCommittee: {
                ...currentCommittee,
                status: nextStatus,
                completed: typeof body.completed === 'number' ? body.completed : currentCommittee.completed,
                pending: nextPending,
                errors: nextErrors,
                softDeadlineMs: body.softDeadlineMs ?? currentCommittee.softDeadlineMs,
              },
            },
          }
        })

        if (body.status === 'partial') {
          timeoutId = setTimeout(poll, 2500)
        }
      } catch {
        if (!stopped) {
          timeoutId = setTimeout(poll, 5000)
        }
      }
    }

    timeoutId = setTimeout(poll, 1500)

    return () => {
      stopped = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [appendArrivedLoadingStageKeys, arrivedLoadingStages.targetKey, fetchState, markDeepScanLoadingSuccess, payload, targetKey, updateActivePayload])

  const scrollContentToTop = () => {
    const container = document.querySelector<HTMLElement>("[data-slot='jaroo-shell-main']")
    container?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleRetry = useCallback(() => {
    setLoadingSequence(createDeepScanLoadingSequence(targetKey))
    setArrivedLoadingStages(createDeepScanLoadingStageArrival(targetKey))
    setDisplayedLoadingStages(createDeepScanLoadingStageArrival(targetKey))
    startRequest()
    scrollContentToTop()
  }, [startRequest, targetKey])


  const missingTargetTitle = '분석할 종목이 없습니다'

  if (!requestSeed) {
    return (
      <JarooShell
        title='DeepScan'
        subtitle='종목을 선택하면 세 팀이 바로 분석해요'
        backHref='/home'
        showBottomNav={false}
        frameClassName='sm:max-w-[340px]'
        mainClassName='relative overflow-x-hidden bg-[#f4f8fb] px-4 pt-4 pb-6 before:pointer-events-none before:absolute before:inset-x-[-80px] before:top-[-160px] before:h-[320px] before:rounded-full before:bg-[radial-gradient(circle_at_50%_50%,rgba(24,95,165,0.18),rgba(24,95,165,0)_68%)]'
      >
        {/* 최신 DeepScan 테마: 밝은 흰 카드 + 상단 연한 블루 그라데이션 + --jaroo-* 토큰. 로딩/결과 화면(#f4f8fc→#fbfdff) 톤과 정렬. */}
        <section className='relative overflow-hidden rounded-[28px] border border-[color:var(--jaroo-border)] bg-white p-5 shadow-[0_16px_36px_rgba(24,95,165,0.10)]'>
          <div className='pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(135deg,#f4f8fc_0%,#e6f1fb_100%)]' />

          <div className='relative flex items-start justify-between gap-4'>
            <div>
              <span className='inline-flex items-center gap-1.5 rounded-full border border-[color:var(--jaroo-border)] bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--jaroo-primary)]'>
                <span className='size-1.5 rounded-full bg-[color:var(--jaroo-primary)]' />
                대기 화면
              </span>
              <h1 className='mt-4 text-[24px] font-black leading-[1.15] tracking-[-0.03em] text-[color:var(--jaroo-ink)]'>
                {missingTargetTitle}
              </h1>
            </div>
            <div className='grid size-14 shrink-0 place-items-center rounded-2xl bg-[#e6f1fb] text-[color:var(--jaroo-primary)]'>
              <LineChart className='size-7' aria-hidden />
            </div>
          </div>

          <p className='relative mt-4 max-w-[280px] text-sm leading-6 text-[color:var(--jaroo-muted)]'>
            홈에서 분석할 대상을 선택하면 가격 위치, 핵심 근거, 세 팀 판단을 한 흐름으로 보여드려요.
          </p>

          <div className='relative mt-5 grid grid-cols-3 gap-2'>
            {[
              ['52주', '위치'],
              ['핵심', '근거'],
              ['세 팀', '판단'],
            ].map(([top, bottom]) => (
              <div key={top} className='rounded-2xl border border-[color:var(--jaroo-border)] bg-[#f4f8fb] px-3 py-3'>
                <p className='text-[15px] font-black leading-none text-[color:var(--jaroo-ink)]'>{top}</p>
                <p className='mt-1 text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>{bottom}</p>
              </div>
            ))}
          </div>
        </section>

        <Card className='relative mt-4 overflow-hidden rounded-[28px] border border-white bg-white/90 p-4 shadow-[0_16px_40px_rgba(24,95,165,0.12)] backdrop-blur'>
          <div className='absolute right-4 top-4 rounded-full bg-[#e6f1fb] px-2.5 py-1 text-[10px] font-black text-[color:var(--jaroo-primary)]'>
            3 STEP
          </div>
          <p className='text-[11px] font-black tracking-[0.14em] text-[color:var(--jaroo-primary)]'>START GUIDE</p>
          <h2 className='mt-2 text-lg font-black tracking-[-0.03em] text-[color:var(--jaroo-ink)]'>
            이렇게 시작하면 됩니다
          </h2>
          <div className='mt-4 space-y-3'>
            {emptyDeepScanSteps.map((step, index) => {
              const Icon = step.icon

              return (
                <div key={step.label} className='grid grid-cols-[42px_1fr] gap-3 rounded-2xl border border-[color:var(--jaroo-border)] bg-[#fbfdff] p-3'>
                  <div className='relative grid size-10 place-items-center rounded-2xl bg-[#e6f1fb] text-[color:var(--jaroo-primary)]'>
                    <Icon className='size-5' aria-hidden />
                    <span className='absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[color:var(--jaroo-ink)] text-[9px] font-black text-white'>
                      {index + 1}
                    </span>
                  </div>
                  <div className='min-w-0'>
                    <p className='text-sm font-black text-[color:var(--jaroo-ink)]'>{step.label}</p>
                    <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{step.body}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Link
          href='/home'
          className={buttonVariants({
            className: 'mt-4 h-[52px] w-full rounded-[22px] bg-[color:var(--jaroo-primary)] text-[15px] font-black text-white shadow-[0_16px_28px_rgba(24,95,165,0.24)] hover:bg-[color:var(--jaroo-primary-strong)]',
          })}
        >
          홈에서 종목 선택하기
        </Link>
      </JarooShell>
    )
  }

  const isCommitteeHydrating = fetchState === 'success' && payload?.metadata.llmCommittee?.status === 'partial'
  const rawResultsReady = isDeepScanInlineResultsReady({
    fetchState,
    hasPayload: Boolean(payload),
    isCommitteeHydrating,
  })
  const resultsReady = rawResultsReady
  const visibleStageCount = resultsReady ? 3 : loadingSequence.targetKey === targetKey ? loadingSequence.visibleStageCount : 1
  const arrivedStageKeys = displayedLoadingStages.targetKey === targetKey ? displayedLoadingStages.stageKeys : []
  const loadingFindingProgress = buildLoadingFindingProgress(payload)
  const loadingPerformanceComment = buildLoadingPerformanceComment(payload)
  const activeLoadingQuickQuote = loadingQuickQuote?.targetKey === targetKey ? loadingQuickQuote : null
  const activeLoadingBaseBriefingSnapshot = loadingBriefingSnapshot?.targetKey === targetKey ? loadingBriefingSnapshot : null
  const activeLoadingMarketSnapshot = loadingMarketSnapshot?.targetKey === targetKey ? loadingMarketSnapshot : null
  const activeLoadingBriefingSnapshot: TargetLoadingBriefingSnapshot | null = (() => {
    if (!activeLoadingBaseBriefingSnapshot && !activeLoadingMarketSnapshot) {
      return null
    }

    return {
      ...(activeLoadingBaseBriefingSnapshot ?? {}),
      targetKey: targetKey ?? activeLoadingBaseBriefingSnapshot?.targetKey ?? activeLoadingMarketSnapshot?.targetKey ?? '',
      market: {
        ...(activeLoadingBaseBriefingSnapshot?.market ?? {}),
        ...(activeLoadingMarketSnapshot?.market ?? {}),
      },
    }
  })()
  const loadingTradingVolume = activeLoadingBriefingSnapshot?.quote?.volume ?? activeLoadingQuickQuote?.tradingVolume ?? buildLoadingTradingVolume(payload)
  const loadingPayloadCurrentPrice = parseOcrNumber(payload?.strategy.currentPriceText ?? '')
  const loadingCurrentPrice = resolveDeepScanLoadingCurrentPrice({
    payloadCurrentPrice: loadingPayloadCurrentPrice,
    quickQuoteCurrentPrice: activeLoadingQuickQuote?.currentPrice,
    targetCurrentPrice: target?.currentPrice,
    briefingCurrentPrice: activeLoadingBriefingSnapshot?.quote?.currentPrice,
  })
  const loadingCurrentPriceCurrency = target?.currentPriceCurrency
    ?? normalizeQuoteCurrency(activeLoadingBriefingSnapshot?.quote?.currency ?? undefined)
    ?? activeLoadingQuickQuote?.currentPriceCurrency
    ?? (requestSeed.holding.market === 'US' ? 'USD' : undefined)
  const loadingQuickFacts = buildLoadingQuickFacts(payload, activeLoadingQuickQuote, activeLoadingBriefingSnapshot, requestSeed.holding.name, requestSeed.holding.market, requestSeed.holding.kind)
  const evidenceCollected = hasCollectedDeepScanEvidence(payload)
  const requestErrorNotice = {
    badge: '오류',
    title: 'DeepScan 데이터를 표시할 수 없어요',
    body: errorMessage ?? '분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.',
  }

  const identifier = [requestSeed.holding.ticker, requestSeed.holding.code]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(' · ')

  return (
    <div className='flex min-h-screen min-h-dvh justify-center bg-white sm:bg-[color:var(--jaroo-canvas)] sm:px-6 sm:py-4'>
      <DeepScanLoadingScreen
        className='w-full overflow-hidden sm:max-w-[340px] sm:rounded-[32px] sm:border sm:border-white/70 sm:shadow-[0_20px_60px_rgba(12,68,124,0.18)]'
        name={requestSeed.holding.name}
        identifier={identifier}
        market={requestSeed.holding.market}
        instrumentKind={target?.kind}
        shares={target?.quantity}
        averagePrice={target?.averagePrice}
        averagePriceCurrency={target?.averagePriceCurrency}
        currentPrice={loadingCurrentPrice}
        currentPriceCurrency={loadingCurrentPriceCurrency}
        usdKrwRate={target?.usdKrwRate}
        tradingVolume={loadingTradingVolume}
        currentProfitRate={target?.currentProfitRate}
        snapshotProfitRate={target?.snapshotProfitRate}
        briefingSnapshot={activeLoadingBriefingSnapshot}
        findingProgress={loadingFindingProgress}
        committeeAxes={payload?.committee.axes}
        quickFacts={loadingQuickFacts}
        performanceComment={loadingPerformanceComment}
        evidenceCollected={evidenceCollected}
        visibleStageCount={visibleStageCount}
        arrivedStageKeys={arrivedStageKeys}
        resultsReady={resultsReady}
        inlineResults={resultsReady && payload ? <DeepScanInlineResults payload={payload} requestSeed={requestSeed} target={target} /> : null}
        errorNotice={fetchState === 'error' ? requestErrorNotice : null}
        onRetry={handleRetry}
        backHref='/home'
      />
    </div>
  )
}
