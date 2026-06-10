'use client'

import type { DeepScanSourceRef, JarooDeepScanCommitteeAxis, JarooDeepScanInsightItem, JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  BadgeCheck,
  BadgePercent,
  ChartCandlestick,
  CircleDollarSign,
  ClipboardCheck,
  Landmark,
  LineChart,
  MapPin,
  Scale,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
  ChevronDown,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeepScanInlineResults } from '@/components/deepscan-inline-results'
import { DeepScanLoadingScreen, type FindingProgress, type LoadingPerformanceComment, type LoadingQuickFact, type LoadingStageKey } from '@/components/deepscan-loading-screen'
import { JarooShell } from '@/components/jaroo-shell'
import { fetchDeepScanCanonicalPayload, type DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import { isFiniteNumber, type LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import {
  buildDeepScanHeroCard,
  buildDeepScanPageHeader,
  buildDeepScanPartialSuccessNotice,
  getDeepScanBlockNotice,
  resolveDeepScanPageCacheState,
} from '@/lib/deepscan-page-projection'
import { resolveDeepScanLoadingCurrentPrice } from '@/lib/deepscan-loading-current-price'
import { resolveDeepScanTargetSession } from '@/lib/jaroo-home-data'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { getDeepScanTargetKey, type DeepScanTargetInput, type WorkflowMoneyCurrency } from '@/lib/workflow-types'
import { cn } from '@/lib/utils'

type TabValue = 'analysis' | 'strategy'
type SectionKey = 'why' | 'news' | 'scenarioDetail' | 'otherScenarios' | 'sellNow' | 'pfSim'
type HomeMarketTone = DeepScanCanonicalTargetSession['holding']['marketTone']
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

const DEEPSCAN_STAGE_WAIT_MS = 18_000
const DEEPSCAN_STAGE_FILL_DELAY_MS = 3_000
const DEEPSCAN_MEMBER_STAGE_BY_KEY: Record<string, LoadingStageKey> = {
  profitability: 'fundamentalTeam',
  valuation: 'fundamentalTeam',
  ownershipStability: 'fundamentalTeam',
  growth: 'fundamentalTeam',
  'profitability-quality': 'fundamentalTeam',
  trend: 'marketTeam',
  consensusMomentum: 'marketTeam',
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
  '컨센서스 모멘텀': 'marketTeam',
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

const axisToneStyles = {
  positive: {
    score: 'text-[color:var(--jaroo-success)]',
    badge: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
    bar: 'bg-[color:var(--jaroo-success)]',
    border: 'border-[color:var(--jaroo-success)]/40',
    ring: 'ring-[color:var(--jaroo-success)]/15',
  },
  primary: {
    score: 'text-[color:var(--jaroo-primary)]',
    badge: 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
    bar: 'bg-[color:var(--jaroo-primary)]',
    border: 'border-[color:var(--jaroo-primary)]/40',
    ring: 'ring-[color:var(--jaroo-primary)]/15',
  },
  warning: {
    score: 'text-[color:var(--jaroo-warning)]',
    badge: 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]',
    bar: 'bg-[color:var(--jaroo-warning)]',
    border: 'border-[color:var(--jaroo-warning)]/40',
    ring: 'ring-[color:var(--jaroo-warning)]/15',
  },
} as const

const memberIconStyles = {
  blue: 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
  green: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
  amber: 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]',
  red: 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
  purple: 'bg-[#eeedfe] text-[#534ab7]',
  teal: 'bg-[#e1f5ee] text-[#0f6e56]',
} as const

const committeeMemberIcons: Record<string, LucideIcon> = {
  수익성: BadgePercent,
  밸류: Scale,
  지배: ShieldCheck,
  트렌드: TrendingUp,
  컨센: LineChart,
  가격: MapPin,
  평단: CircleDollarSign,
  여지: ChartCandlestick,
  입력: ClipboardCheck,
  VAL: Scale,
  GROW: TrendingUp,
  PROF: BadgePercent,
  MOM: Activity,
  REV: LineChart,
  EVT: ChartCandlestick,
  SAFE: Landmark,
  OWN: ShieldCheck,
  FIT: ClipboardCheck,
}

const emptyDeepScanSteps: ReadonlyArray<{ icon: LucideIcon; label: string; body: string }> = [
  { icon: BadgeCheck, label: '보유 종목 선택', body: '홈에서 분석할 주식 카드를 고릅니다.' },
  { icon: LineChart, label: '시장 데이터 확인', body: '현재가·52주 위치·핵심 근거를 먼저 보여줘요.' },
  { icon: ShieldCheck, label: '세 팀 분석', body: '회복 가능성과 리스크를 순서대로 정리합니다.' },
]

const newsToneStyles = {
  positive: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
  danger: 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
  neutral: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
} as const

const scenarioToneStyles = {
  positive: {
    pill: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
    value: 'text-[color:var(--jaroo-success)]',
  },
  primary: {
    pill: 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
    value: 'text-[color:var(--jaroo-primary)]',
  },
  warning: {
    pill: 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]',
    value: 'text-[color:var(--jaroo-warning)]',
  },
} as const

function scorePillClass(score: number) {
  if (score >= 67) {
    return 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]'
  }

  if (score >= 55) {
    return 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'
  }

  if (score >= 45) {
    return 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]'
  }

  return 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]'
}

function resolveAxisTone(score: number | null) {
  if (score === null) {
    return 'warning' as const
  }

  if (score >= 67) {
    return 'positive' as const
  }

  if (score >= 55) {
    return 'primary' as const
  }

  return 'warning' as const
}

function resolveMemberScoreClass(member: JarooDeepScanCommitteeAxis['members'][number]) {
  if (member.status === 'pending') {
    return 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]'
  }

  if (member.status === 'error') {
    return 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]'
  }

  if (member.tone === 'positive') {
    return scorePillClass(75)
  }

  if (member.tone === 'neutral') {
    return scorePillClass(52)
  }

  return scorePillClass(35)
}

function resolveCommitteeMemberIcon(member: JarooDeepScanCommitteeAxis['members'][number]) {
  return committeeMemberIcons[member.shortLabel] ?? committeeMemberIcons[member.title] ?? BadgeCheck
}

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
type BriefingSnapshotProxyResponse = {
  ok?: boolean
  data?: LoadingBriefingSnapshot
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

function parseLoadingConsensusBody(body: string) {
  const analystCountMatch = body.match(/증권사\s*(\d+)\s*곳/u)
  const targetMatch = body.match(/평균\s*목표가\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const upsideMatch = body.match(/현재가\s*대비\s*([+-]?\d+(?:\.\d+)?)%/u)
  const opinionMatch = body.match(/투자의견\s*([0-9]+(?:\.\d+)?)/u)
  const highTargetMatch = body.match(/최고\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const lowTargetMatch = body.match(/최저\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const summaryMatch = body.match(/(모두 매수 의견이에요|매수 의견이 우세해요|의견이 갈리고 있어요|신중한 의견이 많아요)/u)
  const targetValue = targetMatch?.[1] ? Number(targetMatch[1].replace(/,/gu, '')) : undefined
  const targetCurrency: WorkflowMoneyCurrency = targetMatch?.[2]?.toUpperCase() === 'USD' || targetMatch?.[2] === '달러' ? 'USD' : 'KRW'
  const upsidePct = upsideMatch?.[1] ? Number(upsideMatch[1]) : undefined
  const opinionScore = opinionMatch?.[1] ? Number(opinionMatch[1]) : undefined
  const highTargetValue = highTargetMatch?.[1] ? Number(highTargetMatch[1].replace(/,/gu, '')) : undefined
  const highTargetCurrency: WorkflowMoneyCurrency = highTargetMatch?.[2]?.toUpperCase() === 'USD' || highTargetMatch?.[2] === '달러' ? 'USD' : targetCurrency
  const lowTargetValue = lowTargetMatch?.[1] ? Number(lowTargetMatch[1].replace(/,/gu, '')) : undefined
  const lowTargetCurrency: WorkflowMoneyCurrency = lowTargetMatch?.[2]?.toUpperCase() === 'USD' || lowTargetMatch?.[2] === '달러' ? 'USD' : targetCurrency
  const currentPrice = typeof targetValue === 'number'
    && Number.isFinite(targetValue)
    && typeof upsidePct === 'number'
    && Number.isFinite(upsidePct)
    && 1 + upsidePct / 100 !== 0
    ? targetValue / (1 + upsidePct / 100)
    : undefined

  return {
    analystCountLabel: analystCountMatch?.[1] ? `증권사 ${analystCountMatch[1]}곳` : undefined,
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
    summary: summaryMatch?.[1],
    upsideLabel: typeof upsidePct === 'number' && Number.isFinite(upsidePct)
      ? formatLoadingPercent(upsidePct)
      : undefined,
    upsidePct: typeof upsidePct === 'number' && Number.isFinite(upsidePct) ? upsidePct : undefined,
    opinionLabel: typeof opinionScore === 'number' && Number.isFinite(opinionScore)
      ? new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(opinionScore)
      : undefined,
    opinionScore: typeof opinionScore === 'number' && Number.isFinite(opinionScore) ? opinionScore : undefined,
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

  const parsedConsensus = parseLoadingConsensusBody(consensus.body)
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

function resolveInsightTone(item: JarooDeepScanInsightItem): keyof typeof newsToneStyles {
  if (item.sourceType === 'report' || item.sourceType === 'market') {
    return 'positive'
  }

  if (item.sourceType === 'system') {
    return 'danger'
  }

  return 'neutral'
}

function normalizeInsightDate(date: string | undefined) {
  const normalized = date?.trim()
  if (!normalized || normalized.startsWith('1970-01-01')) {
    return '수집 완료'
  }

  return normalized.replace(/T/u, ' ').replace(/\+09:00$/u, '')
}

function splitInsightBodyParts(body: string) {
  return body
    .split(/\s*·\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

function formatInsightMetricValue(value: string) {
  const metric = value.trim()
  const match = metric.match(/^([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러|주)$/iu)
  if (!match) {
    return metric
  }

  const numericValue = Number(match[1].replace(/,/gu, ''))
  if (!Number.isFinite(numericValue)) {
    return metric
  }

  const unit = match[2].toUpperCase()
  if (unit === '주') {
    return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(numericValue)}주`
  }

  return formatLoadingMoney(numericValue, unit === 'USD' || match[2] === '달러' ? 'USD' : 'KRW')
}

function extractInsightMetric(item: JarooDeepScanInsightItem) {
  const sourceLabel = item.sourceLabel
  const body = item.body.trim()

  if (sourceLabel === '현재가') {
    return formatInsightMetricValue(body.replace(/^현재가\s*/u, '').replace(/\s*확인$/u, '').trim())
  }

  if (sourceLabel === '거래량') {
    return formatInsightMetricValue(body.replace(/^거래량\s*/u, '').replace(/\s*확인$/u, '').trim())
  }

  if (sourceLabel === '증권사 의견') {
    const target = body.match(/평균\s*목표가\s*([^·]+)/u)?.[1]?.trim()
    return target ? `목표가 ${formatInsightMetricValue(target)}` : '목표가 확인'
  }

  if (sourceLabel === '국내 리포트') {
    return body.match(/(\d+\s*\/\s*\d+)/u)?.[1]?.replace(/\s+/gu, '') ?? '리포트 확보'
  }

  if (sourceLabel === '기업실적코멘트') {
    const salesGrowth = body.match(/매출(?:은|액은)?\s*([+-]?\d+(?:\.\d+)?)%/u)?.[1]
    const profitGrowth = body.match(/(?:영업이익|본업 이익)(?:은)?\s*([+-]?\d+(?:\.\d+)?)%/u)?.[1]
    if (salesGrowth && profitGrowth) {
      return `매출 +${salesGrowth}% · 이익 +${profitGrowth}%`
    }
    return '실적 요약'
  }

  if (sourceLabel === '보유 맥락') {
    const shares = body.match(/보유\s*([^/\s]+주)/u)?.[1]
    return shares ? `보유 ${shares}` : '포지션 확인'
  }

  return item.label
}

function buildInsightPills(item: JarooDeepScanInsightItem) {
  const body = item.body.trim()
  const sourceLabel = item.sourceLabel

  if (sourceLabel === '현재가') {
    return ['실시간 가격', '근거 확인']
  }

  if (sourceLabel === '거래량') {
    return ['체결 관심도', '당일 거래량']
  }

  if (sourceLabel === '기업실적코멘트') {
    return body
      .split(/\n+/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
  }

  if (sourceLabel === '보유 맥락') {
    return body
      .split(/\s*\/\s*/u)
      .map((part) => part.replace(/\s*확인$/u, '').trim())
      .filter(Boolean)
  }

  return splitInsightBodyParts(body)
    .map((part) => part.replace(/\s*확보$/u, '').trim())
    .filter(Boolean)
    .slice(0, 4)
}

function splitInsightDetailLines(value: string) {
  return value
    .split(/\n+/u)
    .flatMap((block) => block
      .replace(/\s+/gu, ' ')
      .trim()
      .split(/(?<=[.!?。])\s+/u))
    .map((line) => line.trim())
    .filter(Boolean)
}

function getInsightDetailLines(item: JarooDeepScanInsightItem) {
  if (item.sourceLabel !== '기업실적코멘트') {
    return []
  }

  const detailBody = item.sourceBody?.trim() || item.body.trim()
  const lines = splitInsightDetailLines(detailBody)

  return lines.length > 0 ? lines : [detailBody].filter(Boolean)
}

function getInsightPresentation(item: JarooDeepScanInsightItem): {
  Icon: LucideIcon
  eyebrow: string
  cardClass: string
  iconClass: string
  metricClass: string
} {
  switch (item.sourceLabel) {
    case '현재가':
      return {
        Icon: CircleDollarSign,
        eyebrow: 'PRICE TICK',
        cardClass: 'border-[#b9daf8] bg-[linear-gradient(135deg,#f3f9ff,#ffffff)]',
        iconClass: 'bg-[#185fa5] text-white',
        metricClass: 'text-[#185fa5]',
      }
    case '거래량':
      return {
        Icon: Activity,
        eyebrow: 'VOLUME PULSE',
        cardClass: 'border-[#c6e7d5] bg-[linear-gradient(135deg,#f2fbf6,#ffffff)]',
        iconClass: 'bg-[#26794f] text-white',
        metricClass: 'text-[#26794f]',
      }
    case '증권사 의견':
      return {
        Icon: LineChart,
        eyebrow: 'TARGET VIEW',
        cardClass: 'border-[#b9daf8] bg-[linear-gradient(135deg,#eef7ff,#ffffff)]',
        iconClass: 'bg-[#102f4e] text-white',
        metricClass: 'text-[#102f4e]',
      }
    case '국내 리포트':
      return {
        Icon: ClipboardCheck,
        eyebrow: 'REPORT COVERAGE',
        cardClass: 'border-[#d7ddea] bg-[linear-gradient(135deg,#f7f9fc,#ffffff)]',
        iconClass: 'bg-[#64748b] text-white',
        metricClass: 'text-[#334155]',
      }
    case '기업실적코멘트':
      return {
        Icon: Landmark,
        eyebrow: 'EARNINGS MEMO',
        cardClass: 'border-[#f1d7a5] bg-[linear-gradient(135deg,#fff8ec,#ffffff)]',
        iconClass: 'bg-[#a16207] text-white',
        metricClass: 'text-[#854f0b]',
      }
    case '보유 맥락':
      return {
        Icon: ShieldCheck,
        eyebrow: 'POSITION',
        cardClass: 'border-[#d8d4fb] bg-[linear-gradient(135deg,#f6f4ff,#ffffff)]',
        iconClass: 'bg-[#534ab7] text-white',
        metricClass: 'text-[#534ab7]',
      }
    default:
      return {
        Icon: BadgeCheck,
        eyebrow: 'EVIDENCE',
        cardClass: 'border-white bg-white',
        iconClass: 'bg-[color:var(--jaroo-primary)] text-white',
        metricClass: 'text-[color:var(--jaroo-primary)]',
      }
  }
}

function InsightEvidenceCard({ item }: { item: JarooDeepScanInsightItem }) {
  const presentation = getInsightPresentation(item)
  const metric = extractInsightMetric(item)
  const pills = buildInsightPills(item)
  const detailLines = getInsightDetailLines(item)
  const showDetails = detailLines.length > 0
  const InsightIcon = presentation.Icon

  return (
    <article className={cn('relative overflow-hidden rounded-[24px] border p-4 shadow-[0_14px_30px_rgba(15,47,78,0.07)]', presentation.cardClass)}>
      <div className='pointer-events-none absolute -right-10 -top-12 size-28 rounded-full bg-white/70 blur-xl' />
      <div className='relative flex items-start gap-3'>
        <div className={cn('grid size-11 shrink-0 place-items-center rounded-2xl shadow-[0_10px_20px_rgba(15,47,78,0.14)]', presentation.iconClass)}>
          <InsightIcon className='size-5' aria-hidden />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <span className='text-[10px] font-black tracking-[0.12em] text-[color:var(--jaroo-muted)]'>
              {presentation.eyebrow}
            </span>
            <span className='rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-[color:var(--jaroo-muted)] shadow-[inset_0_0_0_1px_rgba(17,24,39,0.05)]'>
              {normalizeInsightDate(item.date)}
            </span>
          </div>
          <h3 className='mt-1 text-sm font-black leading-5 tracking-[-0.03em] text-[color:var(--jaroo-ink)]'>
            {item.sourceLabel}
          </h3>
          <p className='mt-0.5 text-[11px] leading-4 text-[color:var(--jaroo-muted)]'>{item.title}</p>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', newsToneStyles[resolveInsightTone(item)])}>
          {item.label}
        </span>
      </div>

      <div className='relative mt-4 rounded-[18px] bg-white/78 p-3 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.05)]'>
        <p className={cn('text-xl font-black leading-none tracking-[-0.05em]', presentation.metricClass)}>
          {metric}
        </p>
        {pills.length > 0 ? (
          <div className='mt-3 flex flex-wrap gap-1.5'>
            {pills.map((pill) => (
              <span
                key={pill}
                className='rounded-full bg-[#f7f9fb] px-2.5 py-1 text-[11px] font-bold leading-4 text-[#4b647c] shadow-[inset_0_0_0_1px_rgba(15,47,78,0.06)]'
              >
                {pill}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {showDetails ? (
        <details className='relative mt-3 overflow-hidden rounded-[18px] bg-white/82 shadow-[inset_0_0_0_1px_rgba(133,79,11,0.12)]'>
          <summary className='flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[12px] font-black text-[#854f0b] [&::-webkit-details-marker]:hidden'>
            <span>자세히 보기</span>
            <span className='rounded-full bg-[#fff4dc] px-2.5 py-1 text-[10px] font-black text-[#a16207]'>
              원문 {detailLines.length}문장
            </span>
          </summary>
          <ol className='grid gap-2 border-t border-[#f1d7a5]/60 p-3'>
            {detailLines.map((line, index) => (
              <li key={`${index}-${line}`} className='grid grid-cols-[30px_minmax(0,1fr)] gap-2 rounded-[14px] bg-[#fffaf0] p-2.5'>
                <span className='grid size-7 place-items-center rounded-[10px] bg-[#a16207] text-[10px] font-black text-white'>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className='m-0 text-xs leading-5 text-[#5f4218]'>{line}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  )
}

const sourceTypeLabels: Record<DeepScanSourceRef['type'], string> = {
  ocr: 'OCR',
  holding: '보유',
  report: '리포트',
  news: '뉴스',
  market: '시장',
  system: '시스템',
}

function SourceRefsCard({ sourceRefs }: { sourceRefs: DeepScanSourceRef[] }) {
  if (sourceRefs.length === 0) {
    return null
  }

  return (
    <Card className='rounded-[26px] border border-white/90 bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.08)]'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-[11px] font-black tracking-[0.1em] text-[color:var(--jaroo-primary)]'>SOURCE MAP</p>
          <p className='mt-1 text-sm font-black text-[color:var(--jaroo-ink)]'>이번 분석에 들어간 원천 데이터</p>
        </div>
        <span className='rounded-full bg-[#e6f1fb] px-2.5 py-1 text-[11px] font-bold text-[color:var(--jaroo-primary)]'>
          {sourceRefs.length}개
        </span>
      </div>
      <div className='mt-3 grid gap-2'>
        {sourceRefs.map((sourceRef) => (
          <div
            key={`${sourceRef.type}-${sourceRef.id}`}
            className='rounded-[18px] border border-[#e6edf4] bg-[#f8fbfe] px-3 py-2'
          >
            <div className='flex items-center gap-2'>
              <span className='shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-[#185fa5] shadow-[inset_0_0_0_1px_rgba(24,95,165,0.12)]'>
                {sourceTypeLabels[sourceRef.type]}
              </span>
              <p className='min-w-0 truncate text-xs font-bold text-[color:var(--jaroo-ink)]'>
                {sourceRef.label ?? sourceRef.id}
              </p>
            </div>
            <p className='mt-1 truncate text-[11px] text-[color:var(--jaroo-muted)]'>
              {[sourceRef.id, sourceRef.note, sourceRef.at].filter(Boolean).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function resolveScenarioTone(index: number, total: number): keyof typeof scenarioToneStyles {
  if (index === 0) {
    return 'primary'
  }

  if (index === total - 1) {
    return 'warning'
  }

  return 'positive'
}

function resolveWeekToneClasses(tone: string) {
  if (tone === 'positive') {
    return {
      text: 'text-[color:var(--jaroo-success)]',
      pill: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
      dot: 'bg-[color:var(--jaroo-success)]',
    }
  }

  if (tone === 'warning') {
    return {
      text: 'text-[color:var(--jaroo-warning)]',
      pill: 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]',
      dot: 'bg-[color:var(--jaroo-warning)]',
    }
  }

  if (tone === 'danger') {
    return {
      text: 'text-[color:var(--jaroo-danger)]',
      pill: 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
      dot: 'bg-[color:var(--jaroo-danger)]',
    }
  }

  if (tone === 'primary') {
    return {
      text: 'text-[color:var(--jaroo-primary)]',
      pill: 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]',
      dot: 'bg-[color:var(--jaroo-primary)]',
    }
  }

  return {
    text: 'text-[color:var(--jaroo-muted)]',
    pill: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
    dot: 'bg-[color:var(--jaroo-muted)]',
  }
}

function SectionStatusCard({ notice }: { notice: { badge: string; title: string; body: string } }) {
  return (
    <Card className='rounded-[26px] border border-white/90 bg-white/90 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.09)] backdrop-blur'>
      <span className='inline-flex rounded-full bg-[#e6f1fb] px-2.5 py-1 text-[11px] font-bold text-[color:var(--jaroo-primary)]'>
        {notice.badge}
      </span>
      <p className='mt-3 text-sm font-black tracking-[-0.02em] text-[color:var(--jaroo-ink)]'>{notice.title}</p>
      <p className='mt-2 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{notice.body}</p>
    </Card>
  )
}

function SectionToggle({
  label,
  tags,
  isOpen,
  onToggle,
  children,
}: {
  label: string
  tags?: ReactNode
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className='space-y-3'>
      <button
        type='button'
        onClick={onToggle}
        className='flex w-full items-center justify-between rounded-[26px] border border-white/90 bg-white/95 px-4 py-4 text-left shadow-[0_12px_30px_rgba(24,95,165,0.08)] transition active:scale-[0.99]'
      >
        <div className='min-w-0'>
          <p className='text-sm font-black tracking-[-0.02em] text-[color:var(--jaroo-ink)]'>{label}</p>
          {tags ? <div className='mt-2 flex flex-wrap gap-1.5'>{tags}</div> : null}
        </div>
        <ChevronDown
          className={cn(
            'ml-4 size-4 shrink-0 text-[color:var(--jaroo-muted)] transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>
      {isOpen ? children : null}
    </div>
  )
}

export default function DeepScanPage() {
  const [tab, setTab] = useState<TabValue>('analysis')
  const [selectedAxis, setSelectedAxis] = useState(0)
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    why: true,
    news: true,
    scenarioDetail: true,
    otherScenarios: true,
    sellNow: true,
    pfSim: true,
  })
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
      try {
        const response = await fetch(quickQuoteUrl, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          return
        }

        const body = (await response.json()) as QuotesCurrentProxyResponse
        if (!body.ok || controller.signal.aborted) {
          return
        }

        const item = selectLoadingQuickQuoteItem(body, target)
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
      } catch {
        // The loading page should not fail just because quick quote decoration is unavailable.
      }
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
      try {
        const response = await fetch(snapshotUrl, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          return
        }

        const body = (await response.json()) as BriefingSnapshotProxyResponse
        if (!body.ok || !body.data || controller.signal.aborted) {
          return
        }

        setLoadingBriefingSnapshot({
          ...body.data,
          targetKey: requestedTargetKey,
        })
      } catch {
        // The loading page should keep working even if the v7 briefing snapshot is unavailable.
      }
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
      try {
        const response = await fetch('/api/market/us-indicators', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          return
        }

        const body = (await response.json()) as UsMarketIndicatorsProxyResponse
        if (controller.signal.aborted) {
          return
        }

        const snapshot = buildUsLoadingMarketSnapshot(body, requestedTargetKey)
        if (snapshot) {
          setLoadingMarketSnapshot(snapshot)
        }
      } catch {
        // Market comparison is decorative; DeepScan loading should continue if US market data is unavailable.
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

        if (controller.signal.aborted) {
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
        if (controller.signal.aborted) {
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
        <section className='relative overflow-hidden rounded-[30px] border border-white/80 bg-[#102f4e] p-5 text-white shadow-[0_22px_48px_rgba(16,47,78,0.24)]'>
          <div className='pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-[#5fb0ff]/20 blur-2xl' />
          <div className='pointer-events-none absolute bottom-0 right-0 h-28 w-36 rounded-tl-[80px] bg-[linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0))]' />

          <div className='relative flex items-start justify-between gap-4'>
            <div>
              <span className='inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold text-[#d6ecff] backdrop-blur'>
                <span className='size-1.5 rounded-full bg-[#8ee6b8]' />
                대기 화면
              </span>
              <h1 className='mt-4 text-[26px] font-black leading-[1.12] tracking-[-0.04em]'>
                {missingTargetTitle}
              </h1>
            </div>
            <div className='grid size-14 shrink-0 place-items-center rounded-2xl bg-white text-[#185fa5] shadow-[0_14px_28px_rgba(0,0,0,0.18)]'>
              <LineChart className='size-7' aria-hidden />
            </div>
          </div>

          <p className='relative mt-4 max-w-[260px] text-sm leading-6 text-[#c8d8e8]'>
            홈에서 분석할 대상을 선택하면 가격 위치, 핵심 근거, 세 팀 판단을 한 흐름으로 보여드려요.
          </p>

          <div className='relative mt-5 grid grid-cols-3 gap-2'>
            {[
              ['52주', '위치'],
              ['핵심', '근거'],
              ['세 팀', '판단'],
            ].map(([top, bottom]) => (
              <div key={top} className='rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-3 backdrop-blur'>
                <p className='text-[15px] font-black leading-none text-white'>{top}</p>
                <p className='mt-1 text-[10px] font-semibold text-[#a9c9e8]'>{bottom}</p>
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
                <div key={step.label} className='grid grid-cols-[42px_1fr] gap-3 rounded-2xl border border-[#e8eef5] bg-[#fbfdff] p-3'>
                  <div className='relative grid size-10 place-items-center rounded-2xl bg-[#e6f1fb] text-[color:var(--jaroo-primary)]'>
                    <Icon className='size-5' aria-hidden />
                    <span className='absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[#102f4e] text-[9px] font-black text-white'>
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
            className: 'mt-4 h-[52px] w-full rounded-[22px] bg-[#185fa5] text-[15px] font-black text-white shadow-[0_16px_28px_rgba(24,95,165,0.24)] hover:bg-[#0f4f8d]',
          })}
        >
          홈에서 종목 선택하기
        </Link>
      </JarooShell>
    )
  }

  const pageHeader = buildDeepScanPageHeader(requestSeed, payload)
  const heroCard = buildDeepScanHeroCard(requestSeed, fetchState, payload)
  const partialSuccessNotice = buildDeepScanPartialSuccessNotice(payload)
  const weekTone = resolveWeekToneClasses(payload?.strategy.weekSignalTone ?? 'neutral')
  const isCommitteeHydrating = fetchState === 'success' && payload?.metadata.llmCommittee?.status === 'partial'
  const rawResultsReady = fetchState === 'success' && Boolean(payload) && !isCommitteeHydrating
  const loadingSequenceComplete = loadingSequence.targetKey === targetKey && loadingSequence.sequenceComplete
  const canReuseReadyPayloadWithoutSequence = rawResultsReady && loadingSequence.targetKey !== targetKey
  const resultsReady = rawResultsReady && (loadingSequenceComplete || canReuseReadyPayloadWithoutSequence)
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
  const analysisLoadingNotice = {
    badge: '로딩 중',
    title: 'AI 분석 결과를 불러오는 중',
    body: '선택한 종목의 위원회·인사이트 분석 데이터를 요청하고 있어요.',
  }
  const strategyLoadingNotice = {
    badge: '로딩 중',
    title: '전략 데이터를 불러오는 중',
    body: '선택한 종목의 전략·즉시 매도 분석 데이터를 요청하고 있어요.',
  }
  const requestErrorNotice = {
    badge: '오류',
    title: 'DeepScan 데이터를 표시할 수 없어요',
    body: errorMessage ?? '분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.',
  }

  if (fetchState === 'loading' || isCommitteeHydrating || rawResultsReady) {
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
          evaluationAmount={target?.evaluationAmount}
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
          backHref='/home'
        />
      </div>
    )
  }

  const handleTabChange = (value: TabValue) => {
    setTab(value)
    scrollContentToTop()
  }

  const toggleSection = (key: SectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  return (
    <JarooShell
      title={
        <span className='flex items-center gap-1.5'>
          <span>{pageHeader.name}</span>
          <span className='text-[13px] font-normal text-[color:var(--jaroo-muted)]'>{pageHeader.identifierText}</span>
        </span>
      }
      backHref='/home'
      showBottomNav={false}
      frameClassName='sm:max-w-[340px]'
      mainClassName='bg-[#f4f8fb] px-4 pt-0 pb-0'
      action={
        <Link
          href='/sharecard'
          className={buttonVariants({
            variant: 'outline',
            className:
              'h-8 rounded-[10px] border-[color:#b5d4f4] bg-[color:var(--jaroo-accent)] px-3 text-xs font-medium text-[color:var(--jaroo-primary)] hover:bg-[color:var(--jaroo-accent)]/90',
          })}
        >
          공유
        </Link>
      }
    >
      <Tabs value={tab} onValueChange={(value) => handleTabChange(value as TabValue)} className='gap-0'>
        <div className='sticky top-0 z-10 -mx-4 border-b border-white/80 bg-[#f4f8fb]/95 px-4 py-2 backdrop-blur'>
          <TabsList className='grid h-11 w-full grid-cols-2 gap-1 rounded-[20px] bg-white/80 p-1 shadow-[inset_0_0_0_1px_rgba(181,212,244,0.55)]'>
            <TabsTrigger
              value='analysis'
              className='h-full rounded-[16px] border-0 px-0 py-0 text-sm font-semibold text-[color:var(--jaroo-muted)] after:hidden data-active:bg-[color:var(--jaroo-primary)] data-active:text-white data-active:shadow-[0_8px_18px_rgba(24,95,165,0.22)]'
            >
              분석
            </TabsTrigger>
            <TabsTrigger
              value='strategy'
              className='h-full rounded-[16px] border-0 px-0 py-0 text-sm font-semibold text-[color:var(--jaroo-muted)] after:hidden data-active:bg-[color:var(--jaroo-primary)] data-active:text-white data-active:shadow-[0_8px_18px_rgba(24,95,165,0.22)]'
            >
              전략
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value='analysis' className='mt-0 space-y-4 py-4'>
          <Card className='relative overflow-hidden rounded-[30px] border border-white/80 bg-[#102f4e] p-5 text-white shadow-[0_22px_48px_rgba(16,47,78,0.22)]'>
            <div className='pointer-events-none absolute -right-12 -top-14 size-44 rounded-full bg-[#5fb0ff]/20 blur-2xl' />
            <div className='pointer-events-none absolute bottom-0 right-0 h-32 w-40 rounded-tl-[90px] bg-[linear-gradient(135deg,rgba(255,255,255,0.13),rgba(255,255,255,0))]' />
            <div className='relative flex items-center justify-between gap-3'>
              <p className='rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.08em] text-[#d6ecff]'>
                세 팀 종합 분석
              </p>
              <div className='flex items-center gap-2'>
                <span className={cn('rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold', heroCard.statusToneClass)}>{heroCard.statusText}</span>
                <button
                  type='button'
                  onClick={handleRetry}
                  className={buttonVariants({
                    variant: 'outline',
                    className:
                      'h-8 rounded-[10px] border-white/20 bg-white px-3 text-[11px] font-bold text-[#185fa5] hover:bg-white disabled:pointer-events-none disabled:opacity-60',
                  })}
                >
                  {fetchState === 'error' ? '다시 시도' : '재분석'}
                </button>
              </div>
            </div>
            <h1 className='relative mt-4 text-[30px] font-black leading-[1.08] tracking-[-0.05em] text-white'>
              {heroCard.headline}
            </h1>
            <p className='relative mt-3 text-sm leading-7 text-[#c8d8e8]'>{heroCard.body}</p>
            <div className='relative my-4 h-px bg-white/15' />
            <div className='relative flex items-center gap-3'>
              <p className='text-3xl font-black leading-none tracking-[-0.04em] text-white'>{heroCard.statusText}</p>
              <Badge className='rounded-[10px] bg-white/12 px-3 py-1 text-[11px] font-bold text-[#d6ecff]'>
                세 팀 판단
              </Badge>
            </div>
          </Card>

          {fetchState === 'error' ? (
            <Card className='rounded-[24px] border border-[color:var(--jaroo-danger)]/20 bg-[color:var(--jaroo-danger-soft)] p-4 shadow-none'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <p className='text-sm font-semibold text-[color:var(--jaroo-danger)]'>{requestErrorNotice.title}</p>
                  <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-danger)]/80'>{requestErrorNotice.body}</p>
                </div>
                <button
                  type='button'
                  onClick={handleRetry}
                  className={buttonVariants({
                    variant: 'outline',
                    className:
                      'h-8 rounded-[10px] border-[color:var(--jaroo-danger)]/20 bg-white px-3 text-[11px] font-medium text-[color:var(--jaroo-danger)] hover:bg-white',
                  })}
                >
                  다시 시도
                </button>
              </div>
            </Card>
          ) : null}

          {partialSuccessNotice ? (
            <Card className='rounded-[24px] border border-[color:var(--jaroo-warning)]/20 bg-[color:var(--jaroo-warning-soft)] p-4 shadow-none'>
              <span className='inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-warning)]'>
                {partialSuccessNotice.badge}
              </span>
              <p className='mt-3 text-sm font-semibold text-[color:var(--jaroo-warning)]'>{partialSuccessNotice.title}</p>
              <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-warning)]/80'>{partialSuccessNotice.body}</p>
            </Card>
          ) : null}

          <SectionToggle
            label='세 팀 분석 결과'
            isOpen={openSections.why}
            onToggle={() => toggleSection('why')}
            tags={
              fetchState !== 'success' || !payload ? (
                <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
                  {fetchState === 'error' ? '요청 실패' : '로딩 중'}
                </span>
              ) : payload.committee.blockState !== 'ok' ? (
                <span className='rounded-full bg-[color:var(--jaroo-warning-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-warning)]'>
                  {getDeepScanBlockNotice(payload.committee, {
                    badge: '보류',
                    title: '세 팀 분석을 표시할 수 없어요',
                    body: '세 팀 분석 데이터가 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                <div className='grid w-full grid-cols-3 gap-1.5'>
                  {payload.committee.axes.map((axis) => {
                    const tone = resolveAxisTone(axis.score)
                    return (
                      <span
                        key={axis.label}
                        className={cn(
                          'min-w-0 truncate rounded-full px-2 py-1 text-center text-[10px] font-medium leading-4',
                          axisToneStyles[tone].badge,
                        )}
                        title={`${axis.label} ${axis.axisStatusText}`}
                      >
                        {axis.label} {axis.axisStatusText}
                      </span>
                    )
                  })}
                </div>
              )
            }
          >
            {fetchState !== 'success' || !payload ? (
              <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : analysisLoadingNotice} />
            ) : payload.committee.blockState !== 'ok' ? (
              <SectionStatusCard notice={getDeepScanBlockNotice(payload.committee, {
                badge: '보류',
                title: '세 팀 분석을 표시할 수 없어요',
                body: '세 팀 분석 데이터가 아직 준비되지 않았어요.',
              })} />
            ) : payload.committee.axes.length === 0 ? (
              <SectionStatusCard notice={{
                badge: '비어 있음',
                title: '세 팀 분석 데이터가 비어 있어요',
                body: '현재 표시할 세 팀 분석 데이터가 없습니다.',
              }} />
            ) : (
              <Card className='rounded-[26px] border border-white/90 bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.08)]'>
                <div className='grid grid-cols-3 gap-2'>
                  {payload.committee.axes.map((axis, index) => {
                    const tone = resolveAxisTone(axis.score)
                    const toneStyle = axisToneStyles[tone]
                    const active = index === selectedAxis

                    return (
                      <button
                        key={axis.label}
                        type='button'
                        onClick={() => setSelectedAxis(index)}
                        className={cn(
                          'rounded-[16px] border bg-white px-2 py-3 text-center transition',
                          active ? cn(toneStyle.border, 'border-[1.5px]') : 'border-[color:var(--jaroo-border)]',
                        )}
                      >
                        <p className='text-[11px] text-[color:var(--jaroo-muted)]'>{axis.label}</p>
                        <p className={cn('mt-2 text-lg font-semibold', toneStyle.score)}>{axis.axisStatusText}</p>
                        <span className={cn('mt-2 inline-flex rounded-[8px] px-2.5 py-1 text-[10px] font-medium', toneStyle.badge)}>
                          {axis.axisStatusText}
                        </span>
                        <div className='mt-3 h-1 rounded-full bg-[color:var(--jaroo-secondary)]'>
                          <div className={cn('h-full rounded-full', toneStyle.bar)} style={{ width: `${Math.max(0, Math.min(axis.score ?? 0, 100))}%` }} />
                        </div>
                        <p className='mt-2 text-[10px] leading-4 text-[color:var(--jaroo-muted)]/80'>{axis.subtitle}</p>
                      </button>
                    )
                  })}
                </div>

                <div className='my-4 h-px bg-[color:var(--jaroo-border)]' />

                <div className='grid gap-5'>
                  {payload.committee.axes.map((axis) => (
                    <div key={`${axis.label}-detail`} className='rounded-[22px] border border-[#e6edf4] bg-[#fbfdff] p-3'>
                      <div className='mb-3 flex items-center justify-between gap-3'>
                        <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{axis.label} — {axis.members.length}인 위원</p>
                        <p className='text-xs text-[color:var(--jaroo-muted)]'>{axis.avgLabel}</p>
                      </div>

                      <div>
                        {axis.members.map((member) => {
                          const isErrorMember = member.status === 'error'
                          const isPendingMember = member.status === 'pending'
                          const MemberIcon = resolveCommitteeMemberIcon(member)

                          return (
                            <div
                              key={`${axis.label}-${member.title}`}
                              className={cn(
                                'flex items-center gap-3 border-b border-[color:var(--jaroo-border)]/80 py-3 first:pt-0 last:border-b-0 last:pb-0',
                                isErrorMember && 'rounded-[16px] border border-[color:var(--jaroo-danger)]/20 bg-[color:var(--jaroo-danger-soft)]/70 px-3',
                                isPendingMember && 'rounded-[16px] border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)]/70 px-3',
                              )}
                            >
                              <div
                                className={cn(
                                  'flex size-10 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                                  memberIconStyles[member.iconTone],
                                )}
                                aria-label={member.shortLabel}
                              >
                                <MemberIcon className='size-4' aria-hidden />
                              </div>
                              <div className='min-w-0 flex-1'>
                                <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{member.title}</p>
                                {isErrorMember ? (
                                  <>
                                    <p className='mt-1 text-xs font-medium leading-5 text-[color:var(--jaroo-danger)]'>
                                      {member.error?.message ?? 'LLM 응답 실패'}
                                    </p>
                                    <p className='mt-0.5 text-[11px] leading-4 text-[color:var(--jaroo-danger)]/80'>
                                      다시 실행이 필요합니다.
                                    </p>
                                  </>
                                ) : isPendingMember ? (
                                  <>
                                    <p className='mt-1 text-xs font-medium leading-5 text-[color:var(--jaroo-muted)]'>
                                      {member.reason ?? '이 분석은 추가 데이터를 기다리는 중입니다.'}
                                    </p>
                                    <p className='mt-0.5 text-[11px] leading-4 text-[color:var(--jaroo-muted)]/80'>
                                      완료되는 대로 자동 반영합니다.
                                    </p>
                                  </>
                                ) : (
                                  <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{member.reason}</p>
                                )}
                              </div>
                              <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium', resolveMemberScoreClass(member))}>
                                {member.status === 'success' ? '확인' : member.status === 'pending' ? '대기' : '보류'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </SectionToggle>

          <SectionToggle
            label={payload?.insights.sectionLabel ?? '인사이트'}
            isOpen={openSections.news}
            onToggle={() => toggleSection('news')}
            tags={
              fetchState !== 'success' || !payload ? (
                <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
                  {fetchState === 'error' ? '요청 실패' : '로딩 중'}
                </span>
              ) : payload.insights.blockState !== 'ok' ? (
                <span className='rounded-full bg-[color:var(--jaroo-warning-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-warning)]'>
                  {getDeepScanBlockNotice(payload.insights, {
                    badge: '보류',
                    title: '인사이트를 표시할 수 없어요',
                    body: '인사이트 분석 블록이 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                payload.insights.summaryTags.map((tag) => (
                  <span
                    key={tag}
                    className='rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'
                  >
                    {tag}
                  </span>
                ))
              )
            }
          >
            {fetchState !== 'success' || !payload ? (
              <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : analysisLoadingNotice} />
            ) : payload.insights.blockState !== 'ok' ? (
              <SectionStatusCard notice={getDeepScanBlockNotice(payload.insights, {
                badge: '보류',
                title: '인사이트를 표시할 수 없어요',
                body: '인사이트 분석 블록이 아직 준비되지 않았어요.',
              })} />
            ) : payload.insights.items.length === 0 ? (
              <SectionStatusCard notice={{
                badge: '비어 있음',
                title: '인사이트 항목이 없어요',
                body: '크롤러가 인사이트 항목을 비어 있는 상태로 반환했습니다.',
              }} />
            ) : (
              <Card className='rounded-[28px] border border-white/90 bg-white/80 p-3 shadow-[0_14px_34px_rgba(24,95,165,0.08)] backdrop-blur'>
                <div className='mb-3 flex items-center justify-between px-1'>
                  <div>
                    <p className='text-[11px] font-black tracking-[0.1em] text-[color:var(--jaroo-primary)]'>EVIDENCE BOARD</p>
                    <p className='mt-0.5 text-xs text-[color:var(--jaroo-muted)]'>가격·거래·리포트·보유 맥락을 역할별 카드로 정리했어요.</p>
                  </div>
                  <span className='rounded-full bg-[#e6f1fb] px-2.5 py-1 text-[11px] font-bold text-[color:var(--jaroo-primary)]'>
                    {payload.insights.items.length}개
                  </span>
                </div>
                <div className='grid gap-3'>
                  {payload.insights.items.map((item) => (
                    <InsightEvidenceCard key={`${item.sourceLabel}-${item.title}`} item={item} />
                  ))}
                </div>
              </Card>
            )}
          </SectionToggle>

          {fetchState === 'success' && payload ? (
            <SourceRefsCard sourceRefs={payload.metadata.sourceRefs} />
          ) : null}

          <button
            type='button'
            onClick={() => handleTabChange('strategy')}
            className={buttonVariants({
              variant: 'outline',
              className: 'h-12 w-full rounded-[22px] border-[color:var(--jaroo-border)] text-sm',
            })}
          >
            전략 탭 보기 →
          </button>
        </TabsContent>

        <TabsContent value='strategy' className='mt-0 space-y-4 py-4'>
          {fetchState === 'error' ? (
            <Card className='rounded-[24px] border border-[color:var(--jaroo-danger)]/20 bg-[color:var(--jaroo-danger-soft)] p-4 shadow-none'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <p className='text-sm font-semibold text-[color:var(--jaroo-danger)]'>{requestErrorNotice.title}</p>
                  <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-danger)]/80'>{requestErrorNotice.body}</p>
                </div>
                <button
                  type='button'
                  onClick={handleRetry}
                  className={buttonVariants({
                    variant: 'outline',
                    className:
                      'h-8 rounded-[10px] border-[color:var(--jaroo-danger)]/20 bg-white px-3 text-[11px] font-medium text-[color:var(--jaroo-danger)] hover:bg-white',
                  })}
                >
                  다시 시도
                </button>
              </div>
            </Card>
          ) : null}

          {partialSuccessNotice ? (
            <Card className='rounded-[24px] border border-[color:var(--jaroo-warning)]/20 bg-[color:var(--jaroo-warning-soft)] p-4 shadow-none'>
              <span className='inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-warning)]'>
                {partialSuccessNotice.badge}
              </span>
              <p className='mt-3 text-sm font-semibold text-[color:var(--jaroo-warning)]'>{partialSuccessNotice.title}</p>
              <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-warning)]/80'>{partialSuccessNotice.body}</p>
            </Card>
          ) : null}

          {fetchState !== 'success' || !payload ? (
            <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : strategyLoadingNotice} />
          ) : payload.strategy.blockState !== 'ok' ? (
            <SectionStatusCard notice={getDeepScanBlockNotice(payload.strategy, {
              badge: '보류',
              title: '전략 블록을 표시할 수 없어요',
              body: '전략 분석 블록이 아직 준비되지 않았어요.',
            })} />
          ) : (
            <>
              <Card className='rounded-[24px] border-0 bg-[color:var(--jaroo-success-ghost)] px-4 py-4 shadow-none'>
                <div className='flex items-center gap-3'>
                  <div className={cn('size-2 rounded-full', weekTone.dot)} />
                  <p className={cn('flex-1 text-sm font-semibold', weekTone.text)}>{payload.strategy.weekSignal}</p>
                  <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', weekTone.pill)}>{payload.strategy.weekBadgeText}</span>
                </div>
              </Card>

              <Card className='rounded-[28px] border border-[color:var(--jaroo-border)] p-5 shadow-none'>
                <p className='text-[11px] font-medium tracking-[0.08em] text-[color:var(--jaroo-muted)]'>추천 시나리오</p>
                <div className='mt-4 flex items-end gap-4'>
                  <div className='flex-1'>
                    <p className='text-4xl font-semibold leading-none text-[color:var(--jaroo-primary)]'>{payload.strategy.scenarioLabel}</p>
                    <p className='mt-2 text-sm text-[color:var(--jaroo-primary)]'>
                      {payload.strategy.scenarioCondition} · {payload.strategy.scenarioPeriod}
                    </p>
                  </div>
                  <div className='text-right'>
                    <p className='text-4xl font-semibold leading-none text-[color:var(--jaroo-primary)]'>{payload.strategy.scenarioProbability}</p>
                    <p className='mt-2 text-[11px] text-[color:var(--jaroo-muted)]'>가능성</p>
                  </div>
                </div>
                <div className='mt-4 h-1.5 rounded-full bg-[color:var(--jaroo-secondary)]'>
                  <div className='h-full rounded-full bg-[color:var(--jaroo-primary)]' style={{ width: payload.strategy.scenarioProbability }} />
                </div>
                <p className='mt-3 text-xs text-[color:var(--jaroo-muted)]'>
                  현재 {payload.strategy.currentPriceText} → 목표 {payload.strategy.targetPriceText}
                </p>
                <button
                  type='button'
                  onClick={() => toggleSection('scenarioDetail')}
                  className='mt-4 flex w-full items-center justify-between border-t border-[color:var(--jaroo-border)] pt-4 text-left'
                >
                  <span className='text-sm font-semibold text-[color:var(--jaroo-primary)]'>상세 분석 보기</span>
                  <ChevronDown
                    className={cn(
                      'size-4 text-[color:var(--jaroo-primary)] transition-transform',
                      openSections.scenarioDetail && 'rotate-180',
                    )}
                  />
                </button>
                {openSections.scenarioDetail ? (
                  payload.strategy.scenarioDetails.length > 0 ? (
                    <div className='mt-3 space-y-3'>
                      {payload.strategy.scenarioDetails.map((detail, index) => (
                        <div
                          key={detail}
                          className='flex items-start gap-3 border-b border-[color:var(--jaroo-border)] pb-3 last:border-b-0 last:pb-0'
                        >
                          <div className='flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--jaroo-accent)] text-[11px] font-semibold text-[color:var(--jaroo-primary)]'>
                            {index + 1}
                          </div>
                          <p className='text-sm leading-6 text-[color:var(--jaroo-ink)]/80'>{detail}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className='mt-3 text-xs leading-5 text-[color:var(--jaroo-muted)]'>상세 시나리오 설명이 아직 없습니다.</p>
                  )
                ) : null}
              </Card>
            </>
          )}

          <SectionToggle
            label='다른 시나리오 비교'
            isOpen={openSections.otherScenarios}
            onToggle={() => toggleSection('otherScenarios')}
            tags={
              fetchState !== 'success' || !payload ? (
                <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
                  {fetchState === 'error' ? '요청 실패' : '로딩 중'}
                </span>
              ) : payload.strategy.blockState !== 'ok' ? (
                <span className='rounded-full bg-[color:var(--jaroo-warning-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-warning)]'>
                  {getDeepScanBlockNotice(payload.strategy, {
                    badge: '보류',
                    title: '다른 시나리오를 표시할 수 없어요',
                    body: '전략 분석 블록이 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                payload.strategy.otherScenarioTags.map((tag) => (
                  <span
                    key={tag}
                    className='rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'
                  >
                    {tag}
                  </span>
                ))
              )
            }
          >
            {fetchState !== 'success' || !payload ? (
              <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : strategyLoadingNotice} />
            ) : payload.strategy.blockState !== 'ok' ? (
              <SectionStatusCard notice={getDeepScanBlockNotice(payload.strategy, {
                badge: '보류',
                title: '다른 시나리오를 표시할 수 없어요',
                body: '전략 분석 블록이 아직 준비되지 않았어요.',
              })} />
            ) : payload.strategy.otherScenarios.length === 0 ? (
              <SectionStatusCard notice={{
                badge: '비어 있음',
                title: '비교 시나리오가 없어요',
                body: '크롤러가 비교 시나리오를 비어 있는 상태로 반환했습니다.',
              }} />
            ) : (
              <Card className='rounded-[26px] border border-white/90 bg-white/95 px-4 py-2 shadow-[0_14px_34px_rgba(24,95,165,0.08)]'>
                {payload.strategy.otherScenarios.map((scenario, index) => {
                  const tone = resolveScenarioTone(index, payload.strategy.otherScenarios.length)

                  return (
                    <div
                      key={`${scenario.label}-${scenario.probability}`}
                      className={cn(
                        'flex items-center gap-3 border-b border-[color:var(--jaroo-border)] py-4 last:border-b-0',
                        tone === 'primary' && 'bg-[color:var(--jaroo-accent)]/10',
                      )}
                    >
                      <span className={cn('rounded-full px-3 py-1.5 text-sm font-semibold', scenarioToneStyles[tone].pill)}>
                        {scenario.label}
                      </span>
                      <div className='min-w-0 flex-1'>
                        <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{scenario.label}</p>
                        <p className='mt-1 text-xs text-[color:var(--jaroo-muted)]'>{scenario.condition}</p>
                      </div>
                      <p className={cn('text-sm font-semibold', scenarioToneStyles[tone].value)}>{scenario.probability}</p>
                    </div>
                  )
                })}
              </Card>
            )}
          </SectionToggle>

          <SectionToggle
            label='지금 팔면'
            isOpen={openSections.sellNow}
            onToggle={() => toggleSection('sellNow')}
            tags={
              fetchState !== 'success' || !payload ? (
                <span className='text-sm font-semibold text-[color:var(--jaroo-muted)]'>
                  {fetchState === 'error' ? '요청 실패' : '로딩 중'}
                </span>
              ) : payload.sellNow.blockState !== 'ok' ? (
                <span className='text-sm font-semibold text-[color:var(--jaroo-warning)]'>
                  {getDeepScanBlockNotice(payload.sellNow, {
                    badge: '보류',
                    title: '즉시 매도 판단을 표시할 수 없어요',
                    body: '즉시 매도 판단 블록이 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                <span className={cn('text-sm font-semibold', heroCard.statusToneClass)}>{payload.sellNow.realizedText}</span>
              )
            }
          >
            {fetchState !== 'success' || !payload ? (
              <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : strategyLoadingNotice} />
            ) : payload.sellNow.blockState !== 'ok' ? (
              <SectionStatusCard notice={getDeepScanBlockNotice(payload.sellNow, {
                badge: '보류',
                title: '즉시 매도 판단을 표시할 수 없어요',
                body: '즉시 매도 판단 블록이 아직 준비되지 않았어요.',
              })} />
            ) : (
              <Card className='rounded-[26px] border border-white/90 bg-white/95 px-4 py-2 shadow-[0_14px_34px_rgba(24,95,165,0.08)]'>
                {payload.sellNow.rows.map((row) => {
                  const isTagRow = row.tag && row.tagTone
                  const valueClass = row.valueTone === 'danger'
                    ? 'text-[color:var(--jaroo-danger)]'
                    : row.emphasis
                      ? 'text-[color:var(--jaroo-ink)]'
                      : 'text-[color:var(--jaroo-muted)]'

                  return (
                    <div
                      key={`${row.label}-${row.value}`}
                      className='flex items-center justify-between gap-3 border-b border-[color:var(--jaroo-border)] py-3 last:border-b-0'
                    >
                      <div className='flex items-center gap-2'>
                        <span
                          className={cn(
                            'text-sm',
                            row.emphasis ? 'font-semibold text-[color:var(--jaroo-ink)]' : 'text-[color:var(--jaroo-ink)]/80',
                          )}
                        >
                          {row.label}
                        </span>
                        {isTagRow ? (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-medium',
                              row.tagTone === 'danger'
                                ? 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]'
                                : 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
                            )}
                          >
                            {row.tag}
                          </span>
                        ) : null}
                      </div>
                      <span className={cn('text-sm font-medium', valueClass)}>{row.value}</span>
                    </div>
                  )
                })}
              </Card>
            )}
          </SectionToggle>

          <SectionToggle
            label='포트폴리오 변화'
            isOpen={openSections.pfSim}
            onToggle={() => toggleSection('pfSim')}
            tags={
              fetchState !== 'success' || !payload ? (
                <span className='text-sm font-semibold text-[color:var(--jaroo-muted)]'>
                  {fetchState === 'error' ? '요청 실패' : '로딩 중'}
                </span>
              ) : payload.portfolioSimulation.blockState !== 'ok' ? (
                <span className='text-sm font-semibold text-[color:var(--jaroo-warning)]'>
                  {getDeepScanBlockNotice(payload.portfolioSimulation, {
                    badge: '보류',
                    title: '포트폴리오 시뮬레이션을 표시할 수 없어요',
                    body: '포트폴리오 시뮬레이션 블록이 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                <span className='text-sm font-semibold text-[color:var(--jaroo-success)]'>
                  {payload.portfolioSimulation.beforeScore}점 → {payload.portfolioSimulation.afterScore}점 예상
                </span>
              )
            }
          >
            {fetchState !== 'success' || !payload ? (
              <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : strategyLoadingNotice} />
            ) : payload.portfolioSimulation.blockState !== 'ok' ? (
              <SectionStatusCard notice={getDeepScanBlockNotice(payload.portfolioSimulation, {
                badge: '보류',
                title: '포트폴리오 시뮬레이션을 표시할 수 없어요',
                body: '포트폴리오 시뮬레이션 블록이 아직 준비되지 않았어요.',
              })} />
            ) : (
              <Card className='rounded-[24px] border-0 bg-[color:var(--jaroo-secondary)] p-5 text-center shadow-none'>
                <p className='text-[11px] text-[color:var(--jaroo-muted)]'>{pageHeader.name} 대응 후 재배분 시</p>
                <div className='mt-4 flex items-center justify-center gap-4'>
                  <p className='text-4xl font-semibold text-[color:var(--jaroo-muted)]/70'>{payload.portfolioSimulation.beforeScore}</p>
                  <span className='text-xl text-[color:var(--jaroo-muted)]'>→</span>
                  <p className='text-4xl font-semibold text-[color:var(--jaroo-success)]'>{payload.portfolioSimulation.afterScore}</p>
                  <span className='rounded-full bg-[color:var(--jaroo-success-soft)] px-3 py-1 text-xs font-medium text-[color:var(--jaroo-success)]'>
                    {payload.portfolioSimulation.deltaLabel}
                  </span>
                </div>
                <p className='mt-3 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{payload.portfolioSimulation.caption}</p>
              </Card>
            )}
          </SectionToggle>

          <div className='space-y-2'>
            <Link
              href='/sharecard'
              className={buttonVariants({
                variant: 'outline',
                className: 'h-12 w-full rounded-[22px] border-[color:#b5d4f4] bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)] hover:bg-[color:var(--jaroo-accent)]/90',
              })}
            >
              결과 공유하기
            </Link>
            <button
              type='button'
              onClick={() => handleTabChange('analysis')}
              className={buttonVariants({
                variant: 'outline',
                className: 'h-12 w-full rounded-[22px] border-[color:var(--jaroo-border)]',
              })}
            >
              분석 보기 ←
            </button>
          </div>
        </TabsContent>

        <div className='sticky bottom-0 -mx-4 mt-2 grid grid-cols-[1fr,1.6fr] gap-2 border-t border-[color:var(--jaroo-border)] bg-white/95 px-4 pt-3 pb-3 backdrop-blur'>
          <button
            type='button'
            onClick={() => handleTabChange(tab === 'analysis' ? 'strategy' : 'analysis')}
            className={buttonVariants({
              variant: 'outline',
              className: 'h-12 rounded-[22px] border-[color:var(--jaroo-border)] px-3 text-xs',
            })}
          >
            {tab === 'analysis' ? '전략 보기 →' : '분석 보기 ←'}
          </button>
          <Link
            href='/home'
            className={buttonVariants({
              className:
                'h-12 rounded-[22px] bg-[color:var(--jaroo-primary)] text-xs text-white hover:bg-[color:var(--jaroo-primary-strong)]',
            })}
          >
            포트폴리오로 돌아가기
          </Link>
        </div>
      </Tabs>
    </JarooShell>
  )
}
