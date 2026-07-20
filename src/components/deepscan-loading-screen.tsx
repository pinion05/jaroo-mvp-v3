'use client'

import type { JarooDeepScanCommitteeAxis } from '../../packages/contracts/src/deepscan'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  Activity,
  BadgeDollarSign,
  Brain,
  ChartCandlestick,
  CheckCircle2,
  Factory,
  Landmark,
  Loader2,
  Radar,
  Scale,
  TrendingUp,
} from 'lucide-react'
import {
  calculateBriefingOneMonthChangePct,
  calculateBriefingShortStreak,
  getLatestBriefingDailyRow,
  getPreviousBriefingDailyRow,
  isFiniteNumber,
  type LoadingBriefingDailyRow,
  type LoadingBriefingSnapshot,
  type MoneyCurrency,
} from '@/lib/deepscan-briefing-snapshot'
import { resolveDeepScanBriefingCardCurrentPrice, resolveDeepScanLoadingCurrentPrice } from '@/lib/deepscan-loading-current-price'
import {
  getVisibleDeepScanBriefingItemCount,
  isHiddenDeepScanLoadingQuickFact,
  isDeepScanBriefingItemContentReady,
  shouldAdvanceDeepScanTimeline,
  shouldDisplayDeepScanReadyResults,
  shouldShowDeepScanSummarySkeleton,
} from '@/lib/deepscan-loading-behavior'
import { getFinancialValueTone, type FinancialValue } from '@/lib/financial-value-tone'
import { buildDeepScanReturnRateDisplay } from '@/lib/deepscan-loading-metrics'
import {
  buildConsensusFanGeometry,
  estimateDailyVolatility,
} from '@/lib/deepscan-target-price-paths'
import { cn } from '@/lib/utils'
import styles from './deepscan-loading-screen.module.css'

type DeepScanLoadingScreenProps = {
  name?: string
  identifier?: string
  market?: string
  instrumentKind?: string
  shares?: string | number
  averagePrice?: string | number
  averagePriceCurrency?: MoneyCurrency
  currentPrice?: string | number
  currentPriceCurrency?: MoneyCurrency
  usdKrwRate?: number | null
  tradingVolume?: string | number
  currentProfitRate?: string | number
  snapshotProfitRate?: string | number
  briefingSnapshot?: LoadingBriefingSnapshot | null
  findingProgress?: Partial<Record<FindingKey, FindingProgress>>
  committeeAxes?: JarooDeepScanCommitteeAxis[]
  quickFacts?: LoadingQuickFact[]
  performanceComment?: LoadingPerformanceComment
  evidenceCollected?: boolean
  visibleStageCount?: number
  arrivedStageKeys?: LoadingStageKey[]
  resultsReady?: boolean
  className?: string
  onBack?: () => void
  backHref?: string
  inlineResults?: ReactNode
  errorNotice?: { title: string; body: string } | null
  onRetry?: () => void
}

type CommitteeMemberState = 'done' | 'active' | 'wait'
type CommitteeMemberIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
type FindingKey = 'quality' | 'timing' | 'position' | 'decision'
type FindingProgressTone = 'active' | 'done' | 'warning'
export type FindingProgress = {
  badge: string
  body: string
  tone: FindingProgressTone
}

export type LoadingPerformanceComment = {
  asOf?: string
  body: string
  fullBody?: string
  lines?: string[]
}

export type LoadingQuickFact = {
  key: string
  category: string
  badge: string
  tone: 'info' | 'positive' | 'warning'
  body: string
  detail?: string
  indicator?: {
    positionPct: number
    markerLabel?: string
    deltaLabels?: string[]
    leftLabel: string
    rightLabel: string
  }
  consensus?: {
    targetPriceLabel: string
    currentPriceLabel?: string
    analystCountLabel?: string
    highTargetLabel?: string
    lowTargetLabel?: string
    summary?: string
    upsideLabel?: string
    upsidePct?: number
    opinionLabel?: string
    opinionScore?: number
    // Raw numeric values used to simulate the target-price fan chart.
    targetPriceValue?: number
    currentPriceValue?: number
    highTargetValue?: number
    lowTargetValue?: number
  }
}

export type LoadingStageKey = 'fundamentalTeam' | 'marketTeam' | 'contextTeam'
type PlaceholderStageKey = `pendingStage${number}`
type NarrativeCardKey = LoadingStageKey | PlaceholderStageKey
type NarrativeTone = 'positive' | 'warning' | 'neutral' | 'info'
type CommitteeTeamMemberDefinition = {
  sourceMemberKey?: string | string[]
  sourceTitle: string | string[]
  alias: string
}
type CommitteeTeamDefinition = {
  key: LoadingStageKey
  analystName: string
  description: string
  avatar: string
  members: CommitteeTeamMemberDefinition[]
}
type NarrativeCard = {
  key: NarrativeCardKey
  teamKey?: LoadingStageKey
  analystName: string
  description: string
  avatar: string
  body: string
  tags: Array<{ text: string; tone: NarrativeTone }>
  statusLabel: string
  statusTone: NarrativeTone
  complete: boolean
  summarizable: boolean
  placeholder: boolean
}

type TeamSummaryState = {
  inputKey: string
  status: 'loading' | 'success' | 'error'
  summary?: string
}

type CompletionState = {
  ready: boolean
  eyebrow: string
  title: string
  body: string
}

const TODAY_BRIEFING_FIRST_REVEAL_SECONDS = 5
const TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS = 5
const TODAY_BRIEFING_SKELETON_SECONDS = 3
const TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS = 0.9
const COMPLETION_SOON_REVEAL_SECONDS = 43
const TODAY_BRIEFING_ITEM_COUNT = 6
const TODAY_BRIEFING_ITEM_SELECTOR = '[data-today-briefing-item="true"]'
const DEEPSCAN_MOBILE_AUTO_SCROLL_QUERY = '(max-width: 640px)'
const DEEPSCAN_AUTO_SCROLL_BOTTOM_GAP_PX = 16
const TEAM_BRIDGE_REVEAL_SECONDS = 38
const TEAM_BRIDGE_FINAL_MESSAGE_MIN_SECONDS = 30
const TEAM_BRIDGE_DONE_SECONDS = COMPLETION_SOON_REVEAL_SECONDS + TEAM_BRIDGE_FINAL_MESSAGE_MIN_SECONDS
const TEAM_SEQUENCE_COMPLETE_SECONDS = TEAM_BRIDGE_DONE_SECONDS + 8
const TEAM_PRESENTATION_ORDER: LoadingStageKey[] = ['marketTeam', 'contextTeam', 'fundamentalTeam']
const TEAM_REVEAL_SECONDS: Record<LoadingStageKey, number> = {
  marketTeam: TEAM_BRIDGE_DONE_SECONDS,
  contextTeam: TEAM_BRIDGE_DONE_SECONDS + 2.5,
  fundamentalTeam: TEAM_BRIDGE_DONE_SECONDS + 5,
}
const TEAM_BRIDGE_STATUS_MESSAGES = [
  '증권사 리포트를 읽는 중…',
  '시장 흐름과 평단을 맞춰보는 중…',
  '세 팀이 의견을 정리하는 중…',
] as const

const committeeMembers: ReadonlyArray<{ key: string; Icon: CommitteeMemberIcon; label: string; state: CommitteeMemberState }> = [
  { key: 'valuation', Icon: Scale, label: '가치\n분석가', state: 'active' },
  { key: 'growth', Icon: TrendingUp, label: '성장\n전략가', state: 'active' },
  { key: 'finance', Icon: Landmark, label: '재무\n감사관', state: 'active' },
  { key: 'chart', Icon: ChartCandlestick, label: '차트\n마스터', state: 'active' },
  { key: 'flow', Icon: Activity, label: '수급\n추적기', state: 'active' },
  { key: 'momentum', Icon: Radar, label: '모멘텀\n스카우터', state: 'active' },
  { key: 'sentiment', Icon: Brain, label: '심리\n분석AI', state: 'active' },
  { key: 'industry', Icon: Factory, label: '산업\n전문가', state: 'active' },
  { key: 'event', Icon: BadgeDollarSign, label: '이벤트\n스캐너', state: 'active' },
] as const

const committeeTeams: readonly CommitteeTeamDefinition[] = [
  {
    key: 'fundamentalTeam',
    analystName: '가치·기본 팀',
    description: '가치 분석가 · 성장 전략가 · 재무 감사관',
    avatar: '🏛️',
    members: [
      { sourceMemberKey: ['valuation', 'valuation'], sourceTitle: ['밸류에이션', '가격/NAV 단서', 'Valuation'], alias: '가치 분석가' },
      { sourceMemberKey: ['profitability', 'growth'], sourceTitle: ['수익성/기본체력', '상품 구조/운용 품질', 'Growth'], alias: '성장 전략가' },
      { sourceMemberKey: ['ownershipStability', 'profitability-quality'], sourceTitle: ['지분/안정성', '구성/분산 안정성', 'Profitability'], alias: '재무 감사관' },
    ],
  },
  {
    key: 'marketTeam',
    analystName: '시장·차트 팀',
    description: '차트 마스터 · 수급 추적기 · 모멘텀 스카우터',
    avatar: '📈',
    members: [
      { sourceMemberKey: ['priceLocation', 'momentum'], sourceTitle: ['가격 위치', 'Momentum'], alias: '차트 마스터' },
      { sourceMemberKey: ['avgPriceGap', 'estimate-revision'], sourceTitle: ['평단 격차', 'Revision'], alias: '수급 추적기' },
      { sourceMemberKey: ['trend', 'event-risk'], sourceTitle: ['트렌드', '지수/가격 흐름', 'Event Risk'], alias: '모멘텀 스카우터' },
    ],
  },
  {
    key: 'contextTeam',
    analystName: '심리·환경 팀',
    description: '심리 분석AI · 산업 전문가 · 이벤트 스캐너',
    avatar: '🧠',
    members: [
      { sourceMemberKey: ['holdingCompleteness', 'financial-safety'], sourceTitle: ['입력 완성도', 'Safety'], alias: '심리 분석AI' },
      { sourceMemberKey: ['upsideBuffer', 'ownership-flow'], sourceTitle: ['상방 버퍼', '상하방 여지', 'Ownership'], alias: '산업 전문가' },
      { sourceMemberKey: ['consensusMomentum', 'portfolio-fit'], sourceTitle: ['이벤트 스캐너', '컨센서스 모멘텀', '시장 신호/정보 밀도', '포지션 적합도'], alias: '이벤트 스캐너' },
    ],
  },
] as const

const pendingCommitteeMemberCount = committeeMembers.length
const COMMENT_LINE_MAX_LENGTH = 74
const COMMENT_BODY_MAX_LENGTH = 168

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function parseNumericValue(value: string | number | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
}

function formatQuantityNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(value)
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatSignedPercent(value: string | number | undefined) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().includes('%') ? value.trim() : `${value.trim()}%`
  }

  const numericValue = parseNumericValue(value)
  if (numericValue === null) {
    return null
  }

  const sign = numericValue > 0 ? '+' : ''
  return `${sign}${formatNumber(numericValue)}%`
}

function formatMoney(value: string | number | undefined, currency: MoneyCurrency = 'KRW') {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    if (/원|₩|\$|USD|KRW/i.test(trimmed)) {
      return trimmed
    }
  }

  const numericValue = parseNumericValue(value)
  if (numericValue === null) {
    return null
  }

  if (currency === 'USD') {
    return `$${formatNumber(numericValue)}`
  }

  return `${formatNumber(numericValue)}원`
}

function formatSignedMoney(value: number | null, currency: MoneyCurrency = 'KRW') {
  if (value === null) {
    return null
  }

  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  const absoluteValue = Math.abs(value)

  if (currency === 'USD') {
    return `${sign}$${formatNumber(absoluteValue)}`
  }

  return `${sign}${formatNumber(Math.round(absoluteValue))}원`
}

function calculateProfitRate({
  currentPrice,
  averagePrice,
}: Pick<DeepScanLoadingScreenProps, 'currentPrice' | 'averagePrice'>) {
  const currentPriceValue = parseNumericValue(currentPrice)
  const averagePriceValue = parseNumericValue(averagePrice)

  if (currentPriceValue === null || averagePriceValue === null || averagePriceValue === 0) {
    return null
  }

  return ((currentPriceValue / averagePriceValue) - 1) * 100
}

function calculateProfitAmount({
  currentPrice,
  averagePrice,
  shares,
}: Pick<DeepScanLoadingScreenProps, 'currentPrice' | 'averagePrice' | 'shares'>) {
  const currentPriceValue = parseNumericValue(currentPrice)
  const averagePriceValue = parseNumericValue(averagePrice)
  const shareCount = parseNumericValue(shares)

  if (currentPriceValue === null || averagePriceValue === null || shareCount === null) {
    return null
  }

  return (currentPriceValue - averagePriceValue) * shareCount
}

function normalizeMoneyValueToCurrency(
  value: number | null,
  fromCurrency: MoneyCurrency,
  toCurrency: MoneyCurrency,
  usdKrwRate?: number | null,
) {
  if (value === null) {
    return null
  }

  if (fromCurrency === toCurrency) {
    return value
  }

  if (typeof usdKrwRate !== 'number' || !Number.isFinite(usdKrwRate) || usdKrwRate <= 0) {
    return null
  }

  return fromCurrency === 'KRW' && toCurrency === 'USD'
    ? value / usdKrwRate
    : value * usdKrwRate
}

function hasDisplayValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasDisplayValue)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(hasDisplayValue)
  }

  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

function hashSummaryInput(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }

  return `${value.length}:${Math.abs(hash)}`
}

function normalizeSummaryText(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    : null
}

function compactCommentLine(value: string, maxLength = COMMENT_LINE_MAX_LENGTH) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function getCommentLines(comment: LoadingPerformanceComment) {
  const explicitLines = Array.isArray(comment.lines) ? comment.lines : []
  const sourceLines = hasDisplayValue(explicitLines) ? explicitLines : comment.body.split(/\n+/)
  const lines = sourceLines.map((line) => compactCommentLine(line)).filter(Boolean).slice(0, 3)

  if (hasDisplayValue(lines)) {
    return lines
  }

  return [compactCommentLine(comment.body, COMMENT_BODY_MAX_LENGTH)].filter(Boolean)
}


function formatShares(value: string | number | undefined) {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    return /주|좌|개$/.test(trimmed) ? trimmed : `${trimmed}주`
  }

  const numericValue = parseNumericValue(value)
  return numericValue === null ? null : `${formatQuantityNumber(numericValue)}주`
}

function formatTradingVolume(value: string | number | undefined) {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    if (!/\d/u.test(trimmed)) {
      return null
    }
    return /주$/.test(trimmed) ? trimmed : `${trimmed}주`
  }

  const numericValue = parseNumericValue(value)
  if (numericValue === null) {
    return null
  }

  return `${formatCompactNumber(numericValue)}주`
}


function memberStateClass(state: CommitteeMemberState) {
  if (state === 'done') {
    return styles.memberDone
  }

  if (state === 'active') {
    return styles.memberActive
  }

  return styles.memberWait
}

function BackControl({ onBack, backHref }: Pick<DeepScanLoadingScreenProps, 'onBack' | 'backHref'>) {
  if (onBack) {
    return (
      <button type='button' className={styles.backButton} onClick={onBack} aria-label='뒤로 가기'>
        ←
      </button>
    )
  }

  return (
    <Link href={backHref ?? '/home'} className={styles.backButton} aria-label='홈으로 가기'>
      ←
    </Link>
  )
}


function narrativeToneClass(tone: NarrativeTone) {
  if (tone === 'positive') {
    return styles.narrativeTonePositive
  }

  if (tone === 'warning') {
    return styles.narrativeToneWarning
  }

  if (tone === 'neutral') {
    return styles.narrativeToneNeutral
  }

  return styles.narrativeToneInfo
}

function quickFactToneToNarrativeTone(tone: LoadingQuickFact['tone']): NarrativeTone {
  if (tone === 'positive') {
    return 'positive'
  }

  if (tone === 'warning') {
    return 'warning'
  }

  return 'info'
}

function getQuickFactByKey(facts: LoadingQuickFact[], key: string) {
  return facts.find((fact) => fact.key === key)
}

function isExchangeTradedProductMarket(value: string | undefined) {
  return /(?:^|\b)(?:ETF|ETN)(?:\b|$)/iu.test(value ?? '')
}

function isExchangeTradedProduct(market: string | undefined, instrumentKind: string | undefined) {
  return isExchangeTradedProductMarket(market) || /^(?:etf|etn)$/iu.test(instrumentKind ?? '')
}

function flattenCommitteeMembers(committeeAxes: JarooDeepScanCommitteeAxis[] | undefined) {
  return (committeeAxes ?? []).flatMap((axis) => axis.members)
}

function findCommitteeMemberBySourceTitle(
  members: ReturnType<typeof flattenCommitteeMembers>,
  definition: Pick<CommitteeTeamMemberDefinition, 'sourceTitle' | 'sourceMemberKey'>,
) {
  const sourceMemberKeys = definition.sourceMemberKey
    ? Array.isArray(definition.sourceMemberKey) ? definition.sourceMemberKey : [definition.sourceMemberKey]
    : []
  const memberByKey = sourceMemberKeys.length > 0
    ? members.find((candidate) => candidate.memberKey && sourceMemberKeys.includes(candidate.memberKey))
    : undefined
  if (memberByKey) {
    return memberByKey
  }

  const sourceTitles = Array.isArray(definition.sourceTitle) ? definition.sourceTitle : [definition.sourceTitle]
  return members.find((candidate) => sourceTitles.includes(candidate.title))
}

function buildCommitteeTeamBody(
  team: CommitteeTeamDefinition,
  committeeAxes: JarooDeepScanCommitteeAxis[] | undefined,
) {
  const members = flattenCommitteeMembers(committeeAxes)
  const lines = team.members.map((definition, index) => {
    const internalOpinionLabel = `의견 ${index + 1}`
    const member = findCommitteeMemberBySourceTitle(members, definition)
    if (member?.status === 'success' && typeof member.reason === 'string' && member.reason.trim()) {
      return `${internalOpinionLabel}: ${member.reason}`
    }
    if (member?.status === 'error') {
      return `${internalOpinionLabel}: 응답 실패`
    }
    return `${internalOpinionLabel}: 응답 대기 중`
  })

  return {
    body: lines.join('\n'),
    readyCount: team.members.filter((definition) => {
      const member = findCommitteeMemberBySourceTitle(members, definition)
      return member?.status === 'success' && typeof member.reason === 'string' && member.reason.trim().length > 0
    }).length,
    errorCount: team.members.filter((definition) => {
      const member = findCommitteeMemberBySourceTitle(members, definition)
      return member?.status === 'error'
    }).length,
  }
}

function buildCompletionState(resultsReady: boolean, elapsedSeconds: number): CompletionState {
  if (resultsReady) {
    return {
      ready: true,
      eyebrow: '분석 완료',
      title: '실제 분석 결과가 도착했어요',
      body: `실제 응답이 도착했습니다. ${formatElapsedTime(elapsedSeconds)} 동안 모은 근거를 바로 아래 결과 카드에서 이어서 확인하세요.`,
    }
  }

  if (elapsedSeconds >= COMPLETION_SOON_REVEAL_SECONDS) {
    return {
      ready: false,
      eyebrow: '마무리 중',
      title: '곧 결과를 보여드릴게요…',
      body: '세 팀의 의견을 정리해 결과 카드로 연결하고 있어요.',
    }
  }

  return {
    ready: false,
    eyebrow: '분석 진행 중',
    title: '세 팀이 의견을 정리하는 중…',
    body: '근거와 해석을 맞춰 보면서 결과 카드로 넘길 준비를 하고 있어요.',
  }
}


function TargetPriceFanChart({
  consensus,
  dailyCloses,
  seedKey,
}: {
  consensus: NonNullable<LoadingQuickFact['consensus']>
  dailyCloses?: Array<number | null | undefined>
  seedKey?: string
}) {
  const geometry = useMemo(() => {
    const current = consensus.currentPriceValue
    const target = consensus.targetPriceValue
    if (!isFiniteNumber(current) || current <= 0 || !isFiniteNumber(target) || target <= 0) {
      return null
    }
    const volatility = estimateDailyVolatility(dailyCloses ?? [])
    return buildConsensusFanGeometry({
      currentPrice: current,
      averageTarget: target,
      highTarget: consensus.highTargetValue,
      lowTarget: consensus.lowTargetValue,
      recentCloses: dailyCloses,
      volatility,
      seed: seedKey ?? `${current}|${target}`,
    })
  }, [consensus.currentPriceValue, consensus.targetPriceValue, consensus.highTargetValue, consensus.lowTargetValue, dailyCloses, seedKey])

  if (!geometry) {
    return null
  }

  const curveClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanHighPath,
    average: styles.consensusFanTargetPath,
    low: styles.consensusFanLowPath,
  }
  const dotClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanHighDot,
    average: styles.consensusFanTargetDot,
    low: styles.consensusFanLowDot,
  }
  const legendClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanLegendHigh,
    average: styles.consensusFanLegendTarget,
    low: styles.consensusFanLegendLow,
  }
  const legendLabel: Record<'high' | 'average' | 'low', string> = {
    high: '최고',
    average: '평균',
    low: '최저',
  }
  const legendOrder: Array<'high' | 'average' | 'low'> = ['average', 'high', 'low']
  const activeKeys = new Set(geometry.curves.map((c) => c.key))

  return (
    <div className={styles.consensusFanWrap}>
      <svg className={styles.consensusFanChart} viewBox='0 0 300 120' role='img' aria-label='현재가에서 목표가까지 예상 경로'>
        {geometry.recentPath ? (
          <path className={styles.consensusFanCurrentPath} d={geometry.recentPath} />
        ) : (
          <line className={styles.consensusFanCurrentLine} x1={geometry.leftX} y1={geometry.currentY} x2={geometry.fanStartX} y2={geometry.currentY} />
        )}
        {geometry.curves.map((curve) => (
          <path key={`path-${curve.key}`} className={curveClass[curve.key]} d={curve.pathD} pathLength={1} />
        ))}
        {geometry.curves.map((curve) => (
          <circle key={`dot-${curve.key}`} className={dotClass[curve.key]} cx={geometry.rightX} cy={curve.dotY} r='3.6' />
        ))}
      </svg>
      <div className={styles.consensusFanLegend}>
        <span className={styles.consensusFanLegendCurrent}><i />현재가</span>
        {legendOrder.filter((key) => activeKeys.has(key)).map((key) => (
          <span key={`legend-${key}`} className={legendClass[key]}><i />{legendLabel[key]}</span>
        ))}
      </div>
    </div>
  )
}

function QuickFactCard({
  fact,
}: {
  fact: LoadingQuickFact
}) {
  const indicator = fact.indicator

  return (
    <article className={cn(styles.quickFact, fact.key === 'week52-position' ? styles.positionQuickFact : undefined)}>
      <div className={styles.narrativeTags}>
        <span className={cn(styles.narrativeTag, narrativeToneClass(quickFactToneToNarrativeTone(fact.tone)))}>{fact.category}</span>
        <span className={cn(styles.narrativeTag, fact.key === 'week52-position' ? styles.positionSegmentBadge : narrativeToneClass(quickFactToneToNarrativeTone(fact.tone)))}>{fact.badge}</span>
      </div>
      <p className={styles.quickFactDetail}>{fact.body}</p>
      {fact.detail ? <p className={styles.positionDeltaLine}>{fact.detail}</p> : null}
      {indicator ? (
        <div className={styles.positionIndicator} aria-label={`${fact.category}: ${indicator.leftLabel}부터 ${indicator.rightLabel} 사이 ${indicator.markerLabel ?? '현재 위치'}`}>
          <div className={styles.positionScale} aria-hidden='true'>
            <span className={styles.positionTrack} />
            <span className={styles.positionMarker} style={{ top: `${100 - indicator.positionPct}%` }}>
              <span className={styles.positionLeader} />
              <span className={styles.positionMarkerDot} />
            </span>
          </div>
          <div className={styles.positionReadout}>
            <span className={styles.positionHighLabel}>{indicator.rightLabel}</span>
            <span className={styles.positionLowLabel}>{indicator.leftLabel}</span>
            <span className={styles.positionCurrentCallout} style={{ top: `${100 - indicator.positionPct}%` }}>
              <strong>{indicator.markerLabel ?? '현재 위치'}</strong>
              {indicator.deltaLabels?.length ? <span className={styles.positionDeltaLine}>{indicator.deltaLabels.join(' · ')}</span> : null}
            </span>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function isHiddenLoadingQuickFact(fact: LoadingQuickFact) {
  return isHiddenDeepScanLoadingQuickFact({ key: fact.key, hasIndicator: Boolean(fact.indicator) })
}

function buildLoadingStages({
  displayQuickFacts,
  findingProgress,
  performanceComment,
  committeeAxes,
  currentPriceText,
  tradingVolumeText,
  exchangeProduct,
}: {
  displayQuickFacts: LoadingQuickFact[]
  findingProgress?: Partial<Record<FindingKey, FindingProgress>>
  performanceComment?: LoadingPerformanceComment
  committeeAxes?: JarooDeepScanCommitteeAxis[]
  currentPriceText: string | null
  tradingVolumeText: string | null
  exchangeProduct?: boolean
}): NarrativeCard[] {
  const positionFact = displayQuickFacts.find((fact) => fact.key === 'week52-position' || Boolean(fact.indicator))
  const consensusFact = getQuickFactByKey(displayQuickFacts, 'analyst-consensus') ?? getQuickFactByKey(displayQuickFacts, 'etf-product-context')
  const completedFindings = findingProgress ? Object.values(findingProgress).filter(Boolean) : []
  const performanceLines = performanceComment && hasDisplayValue(performanceComment) ? getCommentLines(performanceComment) : []

  return committeeTeams.map((team) => {
    const teamBody = buildCommitteeTeamBody(team, committeeAxes)
    const tags = team.key === 'fundamentalTeam'
      ? [
          { text: exchangeProduct ? '상품 구조 확인' : performanceLines.length ? '실적 코멘트 확인' : '실적 대기', tone: exchangeProduct || performanceLines.length ? 'positive' as const : 'neutral' as const },
          { text: completedFindings.length ? `근거 ${completedFindings.length}개 확인` : '세 팀 대기', tone: completedFindings.length ? 'info' as const : 'neutral' as const },
        ]
      : team.key === 'marketTeam'
        ? [
            { text: currentPriceText ? '가격 확인' : '가격 대기', tone: currentPriceText ? 'positive' as const : 'neutral' as const },
            { text: tradingVolumeText ? `거래량 ${tradingVolumeText}` : '가격 위치 대기', tone: positionFact ? 'info' as const : 'neutral' as const },
          ]
        : [
            { text: consensusFact?.badge ?? '확인 중', tone: consensusFact ? quickFactToneToNarrativeTone(consensusFact.tone) : 'neutral' as const },
            { text: consensusFact?.detail ? '일부 데이터 대기' : '데이터 상태 확인', tone: consensusFact?.tone === 'warning' ? 'warning' as const : 'info' as const },
          ]

    return {
      key: team.key,
      teamKey: team.key,
      analystName: team.analystName,
      description: team.description,
      avatar: team.avatar,
      body: teamBody.body,
      tags,
      statusLabel: teamBody.readyCount === team.members.length ? '위원 응답 완료' : teamBody.errorCount > 0 ? '일부 응답 실패' : `${teamBody.readyCount}/${team.members.length} 응답`,
      statusTone: teamBody.errorCount > 0 ? 'warning' : teamBody.readyCount > 0 ? 'positive' : 'neutral',
      complete: teamBody.readyCount + teamBody.errorCount === team.members.length,
      summarizable: teamBody.readyCount > 0 && teamBody.readyCount + teamBody.errorCount === team.members.length,
      placeholder: false,
    }
  })
}

function buildPlaceholderNarrativeCard(index: number, teamKey?: LoadingStageKey): NarrativeCard {
  const team = teamKey ? committeeTeams.find((definition) => definition.key === teamKey) : undefined

  return {
    key: `pendingStage${index + 1}`,
    teamKey,
    analystName: team?.analystName ?? '',
    description: team?.description ?? '',
    avatar: team?.avatar ?? '',
    body: '',
    tags: [],
    statusLabel: '응답 대기',
    statusTone: 'neutral',
    complete: false,
    summarizable: false,
    placeholder: true,
  }
}

function buildOrderedNarrativeCards(cards: NarrativeCard[], arrivedStageKeys: LoadingStageKey[]): NarrativeCard[] {
  const cardsByKey = new Map<LoadingStageKey, NarrativeCard>(
    cards.flatMap((card) => (card.teamKey ? [[card.teamKey, card] as const] : [])),
  )
  const arrivedKeySet = new Set(arrivedStageKeys)

  return TEAM_PRESENTATION_ORDER.map((stageKey, index) => (
    arrivedKeySet.has(stageKey) ? cardsByKey.get(stageKey) ?? buildPlaceholderNarrativeCard(index, stageKey) : buildPlaceholderNarrativeCard(index, stageKey)
  ))
}

function buildVisibleNarrativeCards(cards: NarrativeCard[], visibleStageCount: number): NarrativeCard[] {
  return cards.slice(0, Math.min(Math.max(visibleStageCount, 1), cards.length))
}

function buildTimelineNarrativeCards(cards: NarrativeCard[], elapsedSeconds: number, resultsReady: boolean): NarrativeCard[] {
  const revealCount = resultsReady
    ? cards.length
    : TEAM_PRESENTATION_ORDER.filter((stageKey) => elapsedSeconds >= TEAM_REVEAL_SECONDS[stageKey]).length

  if (revealCount <= 0) {
    return []
  }

  return buildVisibleNarrativeCards(cards, revealCount)
}

function getTeamSummaryState(card: NarrativeCard, teamSummaries: Partial<Record<LoadingStageKey, TeamSummaryState>>) {
  const summaryInputKey = hashSummaryInput(card.body)
  const summaryState = card.teamKey ? teamSummaries[card.teamKey] : undefined
  const summaryMatchesCard = summaryState?.inputKey === summaryInputKey
  const summaryReady = summaryMatchesCard && summaryState.status === 'success' && summaryState.summary
  const summaryLoading = summaryMatchesCard && summaryState.status === 'loading'
  const summaryFailed = summaryMatchesCard && summaryState.status === 'error'

  return {
    summaryInputKey,
    summaryState,
    summaryReady,
    summaryLoading,
    summaryFailed,
    summaryText: summaryReady ? summaryState.summary! : null,
  }
}

function buildNarrativeFallbackSummary(card: NarrativeCard, summaryFailed: boolean) {
  if (card.placeholder || !card.complete) {
    return null
  }

  if (summaryFailed) {
    return `${card.analystName}의 원문 요약은 잠시 불러오지 못했지만, 도착한 팀 응답은 결과 계산에 반영했어요.`
  }

  if (!card.summarizable) {
    return `${card.analystName}에서 요약할 수 있는 확정 의견은 부족하지만, 확인 가능한 응답 상태는 반영했어요.`
  }

  return null
}

function hasNarrativeLoadingSkeleton(card: NarrativeCard, teamSummaries: Partial<Record<LoadingStageKey, TeamSummaryState>>) {
  if (card.placeholder) {
    return true
  }

  const { summaryText, summaryFailed } = getTeamSummaryState(card, teamSummaries)
  const fallbackSummary = buildNarrativeFallbackSummary(card, Boolean(summaryFailed))

  return !summaryText && !fallbackSummary
}

function buildSequentialNarrativeCards(cards: NarrativeCard[], teamSummaries: Partial<Record<LoadingStageKey, TeamSummaryState>>) {
  const sequentialCards: NarrativeCard[] = []

  for (const card of cards) {
    sequentialCards.push(card)

    if (hasNarrativeLoadingSkeleton(card, teamSummaries)) {
      break
    }
  }

  return sequentialCards
}

function buildTeamBridgeState(elapsedSeconds: number, resultsReady: boolean) {
  if (resultsReady || elapsedSeconds < TEAM_BRIDGE_REVEAL_SECONDS || elapsedSeconds >= TEAM_BRIDGE_DONE_SECONDS) {
    return null
  }

  const remainingSeconds = TEAM_BRIDGE_DONE_SECONDS - elapsedSeconds
  const statusText = elapsedSeconds >= COMPLETION_SOON_REVEAL_SECONDS
    ? '곧 결과를 보여드릴게요…'
    : TEAM_BRIDGE_STATUS_MESSAGES[Math.floor(Math.max(0, elapsedSeconds - TEAM_BRIDGE_REVEAL_SECONDS) / 2) % TEAM_BRIDGE_STATUS_MESSAGES.length]

  return {
    statusText,
    remainingText: formatElapsedTime(remainingSeconds),
  }
}

export function splitTeamSummarySentences(value: string) {
  const decimalDotPlaceholder = '__JAROO_DECIMAL_DOT__'
  const normalized = value
    .replace(/(\d)\.(\d)/g, `$1${decimalDotPlaceholder}$2`)
    .replace(/\s+/g, ' ')
    .trim()

  return normalized
    .match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/gu)
    ?.map((sentence) => sentence.replaceAll(decimalDotPlaceholder, '.').trim())
    .filter(Boolean) ?? []
}

export function shouldCollapseTeamSummaryText(value: string) {
  return splitTeamSummarySentences(value).length >= 2
}

export function getCollapsedTeamSummaryText(value: string) {
  const sentences = splitTeamSummarySentences(value)
  return sentences.length >= 2 ? `${sentences[0]} ....` : value.trim()
}


function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatAsOfTime(value: string | null | undefined) {
  if (!value) {
    return '방금 조회'
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const [, month, day] = value.split('-')
    return `${Number(month)}월 ${Number(day)}일 종가 기준`
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '방금 조회'
  }

  return `${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(parsed)} 조회`
}

function formatPercentValue(value: number | null | undefined) {
  if (!isFiniteNumber(value)) {
    return null
  }

  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(value))}%`
}

function financialToneClass(value: FinancialValue) {
  const tone = getFinancialValueTone(value)
  return tone === 'profit' ? styles.gain : tone === 'loss' ? styles.loss : styles.financialNeutral
}

function pctToneClass(value: number | null | undefined) {
  return financialToneClass(value)
}

function buildChartGeometry(rows: LoadingBriefingDailyRow[], averagePriceValue: number | null) {
  const values = rows.map((row) => row.close).filter(isFiniteNumber)
  if (values.length === 0) {
    return {
      hasData: false,
      linePath: '',
      areaPath: '',
      lastPoint: { x: 296, y: 36 },
      averageY: 35,
    }
  }

  const chartValues = isFiniteNumber(averagePriceValue) ? [...values, averagePriceValue] : values
  const minValue = Math.min(...chartValues)
  const maxValue = Math.max(...chartValues)
  const range = maxValue - minValue || Math.max(1, maxValue * 0.02)
  const left = 4
  const right = 296
  const top = 14
  const bottom = 108
  const width = right - left

  const points = values.map((value, index) => {
    const x = values.length === 1 ? right : left + (width * index) / (values.length - 1)
    const y = bottom - ((value - minValue) / range) * (bottom - top)
    return { x: Math.round(x * 10) / 10, y: Math.round(clamp(y, top, bottom) * 10) / 10 }
  })
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const areaPath = `${linePath} L${lastPoint.x} 116 L${firstPoint.x} 116 Z`
  const averageY = isFiniteNumber(averagePriceValue)
    ? Math.round(clamp(bottom - ((averagePriceValue - minValue) / range) * (bottom - top), top, bottom) * 10) / 10
    : 35

  return { hasData: true, linePath, areaPath, lastPoint, averageY }
}

/**
 * Project the simulated target-price fan bands into SVG geometry (viewBox
 * 300x120) consistent with buildChartGeometry. Produces a filled outer band,
 * a median line, the current-price anchor and the target-price line.
 */
function buildOneMonthMeaning(value: number | null) {
  if (!isFiniteNumber(value)) {
    return '가격 흐름을 불러오는 중이에요.'
  }

  if (value >= 5) {
    return '한 달 기준으로 상승 흐름이 이어지고 있어요.'
  }

  if (value <= -5) {
    return '한 달 기준으론 아직 눌림이 남아 있어요.'
  }

  return '큰 방향성보다는 박스권 흐름에 가까워요.'
}

function buildTodayFlow({ current, open, high, low }: { current: number | null; open: number | null; high: number | null; low: number | null }) {
  if (!isFiniteNumber(current) || !isFiniteNumber(open)) {
    return { label: '장중 흐름 확인 중', meaning: '시초가·고저가 데이터를 불러오는 중이에요.', tone: 'neutral' as const }
  }

  const openChangePct = ((current / open) - 1) * 100
  const nearHigh = isFiniteNumber(high) && isFiniteNumber(low) && high > low
    ? current >= high - (high - low) * 0.25
    : current >= open
  const lowText = isFiniteNumber(low) ? `저가 ${formatNumber(low)}에서 ` : ''
  const highText = nearHigh ? '고가 부근, ' : ''

  if (openChangePct >= 0.3) {
    return {
      label: nearHigh ? '반등 흐름' : '상승 흐름',
      meaning: `${lowText}올라 ${highText}시초가보다 ${formatPercentValue(openChangePct)}.`,
      tone: 'positive' as const,
    }
  }

  if (openChangePct <= -0.3) {
    return {
      label: '장중 약세',
      meaning: `시초가보다 ${formatPercentValue(openChangePct)}라 장중 탄력이 약해요.`,
      tone: 'negative' as const,
    }
  }

  return {
    label: '보합권 등락',
    meaning: `시초가와 비교하면 ${formatPercentValue(openChangePct)} 수준이에요.`,
    tone: 'neutral' as const,
  }
}

function shouldAutoScrollDeepScanOnMobile() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DEEPSCAN_MOBILE_AUTO_SCROLL_QUERY).matches
}

function prefersReducedAutoScrollMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getScrollableDeepScanContainer(item: HTMLElement) {
  const loadingCard = item.closest<HTMLElement>(`.${styles.loadingCard}`)
  if (!loadingCard || loadingCard.scrollHeight <= loadingCard.clientHeight + 1) {
    return null
  }

  return loadingCard
}

function scrollDeepScanElementBottomIntoView(item: HTMLElement) {
  if (!shouldAutoScrollDeepScanOnMobile()) {
    return
  }

  const behavior: ScrollBehavior = prefersReducedAutoScrollMotion() ? 'auto' : 'smooth'
  const container = getScrollableDeepScanContainer(item)
  const itemRect = item.getBoundingClientRect()

  if (container) {
    const containerRect = container.getBoundingClientRect()
    const bottomOverflow = itemRect.bottom - (containerRect.bottom - DEEPSCAN_AUTO_SCROLL_BOTTOM_GAP_PX)

    if (bottomOverflow > 1) {
      container.scrollTo({
        top: container.scrollTop + bottomOverflow,
        behavior,
      })
    }

    return
  }

  const viewportBottom = window.innerHeight - DEEPSCAN_AUTO_SCROLL_BOTTOM_GAP_PX
  const bottomOverflow = itemRect.bottom - viewportBottom
  if (bottomOverflow > 1) {
    window.scrollTo({
      top: window.scrollY + bottomOverflow,
      behavior,
    })
  }
}

function startDeepScanMobileAutoScroll(targetElement: HTMLElement | null) {
  if (!targetElement || !shouldAutoScrollDeepScanOnMobile()) {
    return undefined
  }

  let stopped = false
  let animationFrameId: number | null = null
  let resizeObserver: ResizeObserver | null = null
  const timeoutIds: number[] = []

  const queueScroll = () => {
    if (stopped) {
      return
    }

    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
    }

    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = null
      if (!stopped) {
        scrollDeepScanElementBottomIntoView(targetElement)
      }
    })
  }

  queueScroll()
  timeoutIds.push(
    window.setTimeout(queueScroll, 460),
    window.setTimeout(queueScroll, 960),
    window.setTimeout(queueScroll, 1860),
  )

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(queueScroll)
    resizeObserver.observe(targetElement)
  }

  return () => {
    stopped = true
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
    }
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    resizeObserver?.disconnect()
  }
}

function startTodayBriefingMobileAutoScroll(listElement: HTMLDivElement | null, visibleItemCount: number) {
  if (!listElement || visibleItemCount <= 0 || !shouldAutoScrollDeepScanOnMobile()) {
    return undefined
  }

  const targetItem = listElement.querySelectorAll<HTMLElement>(TODAY_BRIEFING_ITEM_SELECTOR).item(visibleItemCount - 1)
  return startDeepScanMobileAutoScroll(targetItem)
}

function TodayBriefingCard({
  currentPriceText,
  currentPriceCurrency,
  averagePriceText,
  averagePriceCurrency,
  usdKrwRate,
  sharesText,
  profitRateText,
  profitAmountText,
  forceReady = false,
  elapsedSeconds,
  briefingSnapshot,
  tradingVolumeText,
  consensus,
  dailyCloses,
  seedKey,
}: {
  currentPriceText: string | null
  currentPriceCurrency: MoneyCurrency
  averagePriceText: string | null
  averagePriceCurrency: MoneyCurrency
  usdKrwRate?: number | null
  sharesText: string | null
  profitRateText: string | null
  profitAmountText: string | null
  forceReady?: boolean
  elapsedSeconds: number
  briefingSnapshot?: LoadingBriefingSnapshot | null
  tradingVolumeText?: string | null
  consensus?: LoadingQuickFact['consensus']
  dailyCloses?: Array<number | null | undefined>
  seedKey?: string
}) {
  const todayBriefListRef = useRef<HTMLDivElement | null>(null)
  const quote = briefingSnapshot?.quote
  const averagePriceValue = parseNumericValue(averagePriceText ?? undefined)
  const chartAveragePriceValue = normalizeMoneyValueToCurrency(
    averagePriceValue,
    averagePriceCurrency,
    currentPriceCurrency,
    usdKrwRate,
  )
  const sharesValue = parseNumericValue(sharesText ?? undefined)
  const briefingModel = (() => {
    const dailyRows = (briefingSnapshot?.daily ?? []).filter((row) => isFiniteNumber(row.close))
    const latestRow = getLatestBriefingDailyRow(dailyRows)
    const previousRow = getPreviousBriefingDailyRow(dailyRows)
    const displayCurrentPriceValue = parseNumericValue(currentPriceText ?? undefined)
    const currentPriceValue = resolveDeepScanBriefingCardCurrentPrice({
      displayCurrentPrice: displayCurrentPriceValue,
      briefingQuotePrice: quote?.currentPrice,
      latestClose: latestRow?.close,
    }) ?? null
    const oneMonthPct = calculateBriefingOneMonthChangePct(dailyRows)
    const shortStreak = calculateBriefingShortStreak(dailyRows)
    const todayFlow = buildTodayFlow({
      current: currentPriceValue,
      open: quote?.openPrice ?? latestRow?.open ?? null,
      high: quote?.highPrice ?? latestRow?.high ?? null,
      low: quote?.lowPrice ?? latestRow?.low ?? null,
    })
    const volume = quote?.volume ?? latestRow?.volume ?? null
    const previousVolume = quote?.previousVolume ?? previousRow?.volume ?? null
    const volumeRatio = isFiniteNumber(volume) && isFiniteNumber(previousVolume) && previousVolume > 0 ? volume / previousVolume : null
    const chartRows = dailyRows.slice(-60)
    const chartRowsWithDisplayPrice = isFiniteNumber(currentPriceValue) && chartRows.length > 0
      ? chartRows.map((row, index) => index === chartRows.length - 1 ? { ...row, close: currentPriceValue } : row)
      : chartRows
    const chart = buildChartGeometry(chartRowsWithDisplayPrice, chartAveragePriceValue)

    return {
      currentPriceValue,
      latestRow,
      oneMonthPct,
      shortStreak,
      todayFlow,
      volumeRatio,
      chart,
    }
  })()
  const currentPriceValue = briefingModel.currentPriceValue
  const sameMoneyCurrency = currentPriceCurrency === averagePriceCurrency
  const displayCurrentPrice = currentPriceText ?? formatMoney(currentPriceValue ?? undefined, currentPriceCurrency) ?? '현재가 확인 중'
  const displayAveragePrice = averagePriceText ?? '평단 확인 중'
  const displayChartAveragePrice = (
    chartAveragePriceValue !== null && chartAveragePriceValue !== averagePriceValue
      ? formatMoney(chartAveragePriceValue, currentPriceCurrency)
      : displayAveragePrice
  ) ?? '확인 중'
  const chartAverageLabel = chartAveragePriceValue !== null && chartAveragePriceValue !== averagePriceValue ? '환산 평단' : '내 평단'
  const chartContextLabel = chartAverageLabel === '환산 평단' ? '최근 3개월 · 점선은 환산 평단' : '최근 3개월 · 점선은 내 평단'
  const displayShares = sharesText ?? '수량 확인 중'
  const comparableAveragePriceValue = sameMoneyCurrency ? averagePriceValue : chartAveragePriceValue
  const canCompareCostBasis = isFiniteNumber(currentPriceValue) && isFiniteNumber(comparableAveragePriceValue) && comparableAveragePriceValue !== 0
  const calculatedProfitRate = canCompareCostBasis
    ? ((currentPriceValue / comparableAveragePriceValue) - 1) * 100
    : null
  const calculatedProfitAmount = canCompareCostBasis && isFiniteNumber(sharesValue)
    ? (currentPriceValue - comparableAveragePriceValue) * sharesValue
    : null
  const profitRateFromBroker = parseNumericValue(profitRateText ?? undefined)
  const displayProfitRate = formatSignedPercent(calculatedProfitRate ?? undefined) ?? profitRateText ?? '계산 중'
  const displayProfitAmount = formatSignedMoney(calculatedProfitAmount, currentPriceCurrency) ?? profitAmountText ?? '계산 중'
  const oneMonthPct = briefingModel.oneMonthPct
  const oneMonthLabel = formatPercentValue(oneMonthPct)
  const shortStreak = briefingModel.shortStreak
  const streakLabel = shortStreak.direction === 'up'
    ? `${shortStreak.count}일 연속 상승`
    : shortStreak.direction === 'down'
      ? `${shortStreak.count}일 연속 하락`
      : '전일과 비슷한 흐름'
  const positionPct = calculatedProfitRate ?? profitRateFromBroker
  const needToBreakeven = canCompareCostBasis && currentPriceValue < comparableAveragePriceValue
    ? ((comparableAveragePriceValue / currentPriceValue) - 1) * 100
    : null
  const breakevenGap = canCompareCostBasis
    ? Math.abs(comparableAveragePriceValue - currentPriceValue)
    : null
  const breakevenGapText = breakevenGap !== null ? formatMoney(breakevenGap, currentPriceCurrency) : null
  const breakevenRecoveryText = breakevenGapText
    ? currentPriceCurrency === 'USD' ? `${breakevenGapText} 더 오르면 원금 회복이에요.` : `${breakevenGapText}만 오르면 원금 회복이에요.`
    : '조금만 더 오르면 원금 회복이에요.'
  const positionLabel = isFiniteNumber(positionPct)
    ? canCompareCostBasis
      ? positionPct >= 0
        ? `${chartAverageLabel}보다 ${formatPercentValue(positionPct)}`
        : isFiniteNumber(needToBreakeven) ? `본전까지 ${formatPercentValue(needToBreakeven)}` : `손실률 ${formatPercentValue(positionPct)}`
      : `보유 수익률 ${formatPercentValue(positionPct)}`
    : sameMoneyCurrency ? '평단 위치 계산 중' : '환산 평단 확인 중'
  const positionMeaning = isFiniteNumber(positionPct)
    ? canCompareCostBasis
      ? positionPct >= 0
        ? chartAverageLabel === '환산 평단'
          ? `원화 평단 ${displayAveragePrice}을 ${displayChartAveragePrice}로 환산하면 현재가가 평단 위예요.`
          : '지금 가격은 평단 위라 수익 구간이에요.'
        : breakevenRecoveryText
      : `보유 화면에서 확인한 수익률 기준으로 ${positionPct >= 0 ? '수익' : '손실'} 구간이에요.`
    : sameMoneyCurrency ? '현재가와 평단을 맞춰 보는 중이에요.' : '현재가는 달러, 평단은 원화 기준이라 환율 환산 후 비교해야 해요.'
  const todayFlow = briefingModel.todayFlow
  const volumeRatio = briefingModel.volumeRatio
  const volumeRatioLabel = isFiniteNumber(volumeRatio) ? `어제의 ${formatNumber(volumeRatio)}배` : '거래량 확인 중'
  const volumeMeaning = isFiniteNumber(volumeRatio)
    ? volumeRatio >= 1.3
      ? '평소보다 관심이 붙은 하루예요.'
      : volumeRatio >= 0.8
        ? '어제와 비슷한 수준으로 거래되고 있어요.'
        : '어제보다는 거래가 차분한 편이에요.'
    : '거래량 비교 데이터를 불러오는 중이에요.'
  const chart = briefingModel.chart
  const briefStartSeconds = Array.from(
    { length: TODAY_BRIEFING_ITEM_COUNT },
    (_, index) => TODAY_BRIEFING_FIRST_REVEAL_SECONDS + index * TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS,
  )
  const consensusAt = TODAY_BRIEFING_FIRST_REVEAL_SECONDS + TODAY_BRIEFING_ITEM_COUNT * TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS
  const visibleBriefingItemCount = getVisibleDeepScanBriefingItemCount(elapsedSeconds, briefStartSeconds, { forceReady })

  useEffect(() => (
    startTodayBriefingMobileAutoScroll(todayBriefListRef.current, visibleBriefingItemCount)
  ), [visibleBriefingItemCount])

  return (
    <section className={styles.todayBriefingCard} aria-label='오늘 장 기준 시세 브리핑'>
      <div className={styles.todayBriefingHead}>
        <div className={styles.todayLiveLabel}><span className={styles.todayLiveDot} />오늘 장 기준 · {formatAsOfTime(quote?.asOf ?? briefingSnapshot?.asOf)}</div>
        <div className={styles.todayPriceRow}>
          <div>
            <div className={styles.todayPrice}>{displayCurrentPrice}</div>
            <div className={styles.todayPriceSub}>평단 {displayAveragePrice} · {displayShares} · 거래량 {tradingVolumeText ?? '확인 중'}</div>
          </div>
          <div className={styles.todayProfitBox}>
            <div className={cn(styles.todayProfitRate, financialToneClass(calculatedProfitRate ?? profitRateText))}>{displayProfitRate}</div>
            <div className={cn(styles.todayProfitAmount, financialToneClass(calculatedProfitAmount ?? profitAmountText))}>{displayProfitAmount}</div>
          </div>
        </div>
      </div>

      <div className={styles.todayChartWrap}>
        <div className={styles.todayChartLabel}>
          <span>{chartContextLabel}</span>
          <span>일봉</span>
        </div>
        {chart.hasData ? (
          <svg className={styles.todayChartSvg} viewBox='0 0 300 120' aria-label='최근 3개월 일봉 차트'>
            <path className={styles.todayChartArea} d={chart.areaPath} />
            <path className={styles.todayChartLine} d={chart.linePath} pathLength={1} />
            <line className={styles.todayAvgLine} x1='4' y1={chart.averageY} x2='296' y2={chart.averageY} />
              <text className={styles.todayAvgText} x='296' y={Math.max(12, chart.averageY - 6)} textAnchor='end'>{chartAverageLabel} {displayChartAveragePrice.replace(/원$/u, '')}</text>
            <circle className={styles.todayChartDot} cx={chart.lastPoint.x} cy={chart.lastPoint.y} r='3' />
            <circle className={styles.todayChartRing} cx={chart.lastPoint.x} cy={chart.lastPoint.y} r='7' />
          </svg>
        ) : (
          <div className={styles.todayChartEmpty} role='status'>차트 데이터를 확인하는 중이에요</div>
        )}

      </div>

      <div className={styles.todayBriefList} ref={todayBriefListRef}>
        <TodayBriefingItem at={briefStartSeconds[0]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon='🗓️' question='최근 한 달, 어떻게 흘러왔나요?' data={<span className={pctToneClass(oneMonthPct)}>{oneMonthLabel ? `한 달 전보다 ${oneMonthLabel}` : '한 달 흐름 계산 중'}</span>} meaning={buildOneMonthMeaning(oneMonthPct)} />
        <TodayBriefingItem at={briefStartSeconds[1]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon='📈' question='단기 흐름은요?' data={<span className={shortStreak.direction === 'up' ? styles.todayUp : shortStreak.direction === 'down' ? styles.todayDown : styles.todayBlue}>{streakLabel}</span>} meaning={shortStreak.direction === 'up' ? '짧게 봐도 흐름이 살아나고 있어요.' : shortStreak.direction === 'down' ? '단기적으로는 숨 고르기가 이어지고 있어요.' : '아직 한쪽 방향으로 강하게 기울지는 않았어요.'} />
        <TodayBriefingItem at={briefStartSeconds[2]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon='🎯' question='내 자리는 어디쯤일까요?' data={<span className={financialToneClass(positionPct)}>{positionLabel}</span>} meaning={<><b>{positionMeaning}</b></>} />
        <TodayMarketBriefing
          at={briefStartSeconds[3]}
          elapsedSeconds={elapsedSeconds}
          forceReady={forceReady}
          firstLabel={briefingSnapshot?.market?.sp500 ? 'S&P 500' : '코스피'}
          firstPct={briefingSnapshot?.market?.sp500?.changePct ?? briefingSnapshot?.market?.kospi?.changePct ?? null}
          secondLabel={briefingSnapshot?.market?.nasdaq ? 'NASDAQ' : '코스닥'}
          secondPct={briefingSnapshot?.market?.nasdaq?.changePct ?? briefingSnapshot?.market?.kosdaq?.changePct ?? null}
          stockPct={quote?.changePct ?? briefingModel.latestRow?.changePct ?? null}
        />
        <TodayBriefingItem at={briefStartSeconds[4]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon='📊' question='오늘 하루는 어땠나요?' data={<span className={todayFlow.tone === 'positive' ? styles.todayUp : todayFlow.tone === 'negative' ? styles.todayDown : styles.todayBlue}>{todayFlow.label}</span>} meaning={todayFlow.meaning} />
        <TodayBriefingItem at={briefStartSeconds[5]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon='🔥' question='거래는 활발했나요?' data={<span className={isFiniteNumber(volumeRatio) && volumeRatio >= 1 ? styles.todayBlue : styles.todayDown}>{volumeRatioLabel}</span>} meaning={volumeMeaning} />
        {consensus ? (
          <article
            className={cn(styles.todayBriefItem, (forceReady || elapsedSeconds >= consensusAt) ? styles.todayBriefItemIn : undefined, styles.todayBriefConsensusItem)}
            data-today-briefing-item='true'
          >
            <div className={styles.todayBriefQuestionRow}>
              <span className={styles.todayBriefIcon} aria-hidden='true'>🔭</span>
              <span className={styles.todayBriefQuestion}>애널리스트 목표가는 어디쯤일까?</span>
            </div>
            {forceReady || elapsedSeconds >= consensusAt + TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS ? (
              <div className={styles.consensusInsight}>
                <div className={styles.consensusChartTop}>
                  <div>
                    <span className={styles.consensusEyebrow}>{consensus.analystCountLabel ?? 'TARGET VIEW'}</span>
                    <strong>{consensus.targetPriceLabel}</strong>
                  </div>
                  {consensus.upsideLabel ? <span>{consensus.upsideLabel}</span> : null}
                </div>
                <TargetPriceFanChart consensus={consensus} dailyCloses={dailyCloses} seedKey={seedKey} />
                <dl className={styles.consensusStats}>
                  {consensus.currentPriceLabel ? (<div className={styles.consensusStat}><dt>현재가</dt><dd>{consensus.currentPriceLabel}</dd></div>) : null}
                  {consensus.opinionLabel ? (<div className={styles.consensusStat}><dt>투자의견</dt><dd>{consensus.opinionLabel}</dd></div>) : null}
                  {consensus.highTargetLabel ? (<div className={styles.consensusStat}><dt>최고</dt><dd>{consensus.highTargetLabel}</dd></div>) : null}
                  {consensus.lowTargetLabel ? (<div className={styles.consensusStat}><dt>최저</dt><dd>{consensus.lowTargetLabel}</dd></div>) : null}
                </dl>
                {consensus.summary ? <p className={styles.consensusSummary}>{consensus.summary}</p> : null}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  )
}

function TodayBriefingItem({
  at,
  elapsedSeconds,
  icon,
  question,
  data,
  meaning,
  forceReady = false,
}: {
  at: number
  elapsedSeconds: number
  icon: string
  question: string
  data: ReactNode
  meaning: ReactNode
  forceReady?: boolean
}) {
  const isVisible = forceReady || elapsedSeconds >= at
  const isContentReady = isDeepScanBriefingItemContentReady({
    elapsedSeconds,
    revealAtSeconds: at,
    skeletonSeconds: TODAY_BRIEFING_SKELETON_SECONDS,
    forceReady,
  })

  return (
    <article className={cn(styles.todayBriefItem, isVisible ? styles.todayBriefItemIn : undefined)} data-today-briefing-item='true'>
      <div className={styles.todayBriefQuestionRow}>
        <span className={styles.todayBriefIcon} aria-hidden='true'>{icon}</span>
        <span className={styles.todayBriefQuestion}>{question}</span>
      </div>
      <div className={cn(styles.todayBriefBody, isVisible ? styles.todayBriefBodyIn : undefined)}>
        <div className={cn(styles.todayBriefBodyContent, isContentReady ? styles.todayBriefBodyContentIn : undefined)}>
          <div className={styles.todayBriefData}>{data}</div>
          <p className={styles.todayBriefMeaning}>{meaning}</p>
        </div>
        <div className={cn(styles.todayBriefSkeleton, isContentReady ? styles.todayBriefSkeletonOut : undefined)} aria-hidden='true'>
          <span className={styles.todayBriefSkeletonBar} />
          <span className={styles.todayBriefSkeletonBar} />
        </div>
      </div>
    </article>
  )
}


function buildMarketMeaning(firstPct: number | null, secondPct: number | null, stockPct: number | null) {
  if (!isFiniteNumber(stockPct)) {
    return '내 종목의 장중 등락률을 확인하는 중이에요.'
  }

  const marketValues = [firstPct, secondPct].filter(isFiniteNumber)
  if (marketValues.length === 0) {
    return '시장 지수와 내 종목 흐름을 맞춰 보는 중이에요.'
  }

  const marketAverage = marketValues.reduce((sum, value) => sum + value, 0) / marketValues.length
  if (stockPct >= marketAverage + 0.5) {
    return '시장보다 더 강하게 움직이고 있어요.'
  }

  if (stockPct <= marketAverage - 0.5) {
    return '시장 흐름 대비 아직 덜 따라온 상태예요.'
  }

  return '시장 흐름과 비슷한 속도로 움직이고 있어요.'
}

function TodayMarketBriefing({
  at,
  elapsedSeconds,
  firstLabel,
  firstPct,
  secondLabel,
  secondPct,
  stockPct,
  forceReady = false,
}: {
  at: number
  elapsedSeconds: number
  firstLabel: string
  firstPct: number | null
  secondLabel: string
  secondPct: number | null
  stockPct: number | null
  forceReady?: boolean
}) {
  const isVisible = forceReady || elapsedSeconds >= at
  const isContentReady = isDeepScanBriefingItemContentReady({
    elapsedSeconds,
    revealAtSeconds: at,
    skeletonSeconds: TODAY_BRIEFING_SKELETON_SECONDS,
    forceReady,
  })
  const firstPctLabel = formatPercentValue(firstPct) ?? '확인 중'
  const secondPctLabel = formatPercentValue(secondPct) ?? '확인 중'
  const stockLabel = formatPercentValue(stockPct) ?? '확인 중'

  return (
    <article className={cn(styles.todayBriefItem, isVisible ? styles.todayBriefItemIn : undefined)} data-today-briefing-item='true'>
      <div className={styles.todayBriefQuestionRow}>
        <span className={styles.todayBriefIcon} aria-hidden='true'>🏛️</span>
        <span className={styles.todayBriefQuestion}>오늘 시장 속에서는?</span>
      </div>
      <div className={cn(styles.todayBriefBody, isVisible ? styles.todayBriefBodyIn : undefined)}>
        <div className={cn(styles.todayBriefBodyContent, isContentReady ? styles.todayBriefBodyContentIn : undefined)}>
          <div className={styles.todayMarketGrid}>
            <div className={styles.todayMarketCell}><span>{firstLabel}</span><b className={pctToneClass(firstPct)}>{firstPctLabel}</b></div>
            <div className={styles.todayMarketCell}><span>{secondLabel}</span><b className={pctToneClass(secondPct)}>{secondPctLabel}</b></div>
            <div className={`${styles.todayMarketCell} ${styles.todayMarketCellMe}`}><span>내 종목</span><b className={pctToneClass(stockPct)}>{stockLabel}</b></div>
          </div>
          <p className={styles.todayBriefMeaning}><b>{buildMarketMeaning(firstPct, secondPct, stockPct)}</b></p>
        </div>
        <div className={cn(styles.todayBriefSkeleton, isContentReady ? styles.todayBriefSkeletonOut : undefined)} aria-hidden='true'>
          <span className={styles.todayBriefSkeletonBar} />
          <span className={styles.todayBriefSkeletonBar} />
        </div>
      </div>
    </article>
  )
}


export function DeepScanLoadingScreen({
  name = '선택 종목',
  identifier,
  market,
  instrumentKind,
  shares,
  averagePrice,
  averagePriceCurrency = 'KRW',
  currentPrice,
  currentPriceCurrency = averagePriceCurrency,
  usdKrwRate,
  tradingVolume,
  currentProfitRate,
  snapshotProfitRate,
  briefingSnapshot,
  findingProgress,
  committeeAxes,
  quickFacts = [],
  performanceComment,
  evidenceCollected = false,
  visibleStageCount = 1,
  arrivedStageKeys = [],
  resultsReady = false,
  className,
  onBack,
  backHref = '/home',
  inlineResults,
  errorNotice,
  onRetry,
}: DeepScanLoadingScreenProps) {
  const isError = Boolean(errorNotice)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [teamSummaries, setTeamSummaries] = useState<Partial<Record<LoadingStageKey, TeamSummaryState>>>({})
  const [expandedTeamSummaries, setExpandedTeamSummaries] = useState<ReadonlySet<LoadingStageKey>>(() => new Set())
  const requestedTeamSummariesRef = useRef<Set<string>>(new Set())
  const teamBridgeRef = useRef<HTMLElement | null>(null)
  const targetLine = [identifier, market].filter(Boolean).join(' · ')
  const exchangeProduct = isExchangeTradedProduct(market, instrumentKind)
  const sharesText = formatShares(shares)
  const averagePriceText = formatMoney(averagePrice, averagePriceCurrency)
  const currentPriceText = formatMoney(currentPrice, currentPriceCurrency)
  const tradingVolumeText = formatTradingVolume(tradingVolume)
  const snapshotCurrentPrice = briefingSnapshot?.quote?.currentPrice ?? undefined
  const effectiveCurrentPrice = resolveDeepScanLoadingCurrentPrice({
    quickQuoteCurrentPrice: parseNumericValue(currentPrice),
    briefingCurrentPrice: snapshotCurrentPrice,
  })
  const canCalculatePositionInOneCurrency = currentPriceCurrency === averagePriceCurrency
  const profitRateText = formatSignedPercent(
    (canCalculatePositionInOneCurrency ? calculateProfitRate({ currentPrice: effectiveCurrentPrice, averagePrice }) : null)
      ?? currentProfitRate,
  )
  const profitAmountText = formatSignedMoney(
    canCalculatePositionInOneCurrency ? calculateProfitAmount({ currentPrice: effectiveCurrentPrice, averagePrice, shares }) : null,
    currentPriceCurrency,
  )
  const returnRateDisplay = buildDeepScanReturnRateDisplay({
    currentProfitRate: profitRateText ?? undefined,
    snapshotProfitRate,
  })
  const displayQuickFacts = useMemo(() => quickFacts.filter(hasDisplayValue), [quickFacts])
  const standaloneQuickFacts = useMemo(
    () => displayQuickFacts.filter((fact) => !isHiddenLoadingQuickFact(fact)),
    [displayQuickFacts],
  )
  const consensusQuickFact = displayQuickFacts.find((fact) => Boolean(fact.consensus))
  const consensusData = consensusQuickFact?.consensus
  const briefingDailyCloses = useMemo(
    () => (briefingSnapshot?.daily ?? []).map((row) => row.close),
    [briefingSnapshot?.daily],
  )
  const loadingStages = useMemo(
    () => buildLoadingStages({
      displayQuickFacts,
      findingProgress,
      performanceComment,
      committeeAxes,
      currentPriceText,
      tradingVolumeText,
      exchangeProduct,
    }),
    [committeeAxes, currentPriceText, displayQuickFacts, exchangeProduct, findingProgress, performanceComment, tradingVolumeText],
  )
  const orderedNarrativeCards = useMemo(
    () => buildOrderedNarrativeCards(loadingStages, arrivedStageKeys),
    [arrivedStageKeys, loadingStages],
  )
  const teamSummaryRequests = useMemo(
    () => loadingStages.flatMap((card) => {
      const teamKey = card.teamKey
      if (!teamKey || !card.summarizable || !card.body.trim()) {
        return []
      }

      const inputKey = hashSummaryInput(card.body)

      const requestScopeKey = `${market ?? 'unknown'}:${instrumentKind ?? 'unknown'}:${exchangeProduct ? 'etf' : 'stock'}`

      return [{
        teamKey,
        inputKey,
        requestKey: `${requestScopeKey}:${teamKey}:${inputKey}`,
        cardKey: card.key,
        analystName: card.analystName,
        body: card.body,
      }]
    }),
    [exchangeProduct, instrumentKind, loadingStages, market],
  )
  const visibleNarrativeCards = useMemo(
    () => buildVisibleNarrativeCards(orderedNarrativeCards, visibleStageCount),
    [orderedNarrativeCards, visibleStageCount],
  )
  const resultsReadyForDisplay = shouldDisplayDeepScanReadyResults(resultsReady)
  const timelineNarrativeCards = useMemo(
    () => buildTimelineNarrativeCards(orderedNarrativeCards, elapsedSeconds, resultsReadyForDisplay),
    [elapsedSeconds, orderedNarrativeCards, resultsReadyForDisplay],
  )
  const sequentialNarrativeCards = useMemo(
    () => buildSequentialNarrativeCards(timelineNarrativeCards, teamSummaries),
    [teamSummaries, timelineNarrativeCards],
  )
  const completionState = buildCompletionState(resultsReadyForDisplay, elapsedSeconds)
  const teamBridgeState = buildTeamBridgeState(elapsedSeconds, resultsReadyForDisplay)
  const isTeamBridgeVisible = Boolean(teamBridgeState)
  const shouldAdvanceTimeline = shouldAdvanceDeepScanTimeline({ resultsReadyForDisplay, elapsedSeconds, sequenceCompleteSeconds: TEAM_SEQUENCE_COMPLETE_SECONDS })
  const progressPct = resultsReadyForDisplay ? 100 : Math.min(92, 12 + elapsedSeconds * 7)
  const activeNarrativeCard = sequentialNarrativeCards.findLast((card) => !card.placeholder) ?? sequentialNarrativeCards.at(-1) ?? visibleNarrativeCards.at(-1) ?? orderedNarrativeCards[0]
  const progressLabel = resultsReadyForDisplay
    ? '상세 결과 준비 완료'
    : teamBridgeState
      ? teamBridgeState.statusText
    : activeNarrativeCard.placeholder
      ? '분석가 응답을 기다리는 중…'
      : `${activeNarrativeCard.analystName}가 살펴보는 중…`

  useEffect(() => {
    if (!shouldAdvanceTimeline) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1)
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [shouldAdvanceTimeline])

  useEffect(() => (
    isTeamBridgeVisible
      ? startDeepScanMobileAutoScroll(teamBridgeRef.current)
      : undefined
  ), [isTeamBridgeVisible])

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false

    teamSummaryRequests.forEach((request) => {
      const { teamKey, inputKey, requestKey } = request
      if (requestedTeamSummariesRef.current.has(requestKey)) {
        return
      }

      requestedTeamSummariesRef.current.add(requestKey)
      setTeamSummaries((previous) => ({
        ...previous,
        [teamKey]: { inputKey, status: 'loading' },
      }))

      fetch('/api/deepscan/team-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          teamKey: request.cardKey,
          teamName: request.analystName,
          body: request.body,
          market,
          instrumentKind: exchangeProduct ? 'etf' : 'stock',
        }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as { ok?: boolean; summary?: unknown } | null
          const summary = body?.ok === true ? normalizeSummaryText(body.summary) : null
          if (!response.ok || !summary) {
            throw new Error('team summary unavailable')
          }

          if (stopped || controller.signal.aborted) {
            return
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'success', summary },
          }))
        })
        .catch(() => {
          if (stopped || controller.signal.aborted) {
            return
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'error' },
          }))
        })
    })

    return () => {
      stopped = true
      controller.abort()
    }
  }, [exchangeProduct, market, teamSummaryRequests])

  return (
    <div className={cn(styles.loadingCard, className)}>
      <header className={styles.topBar}>
        <div className={styles.topBarRow}>
          <BackControl onBack={onBack} backHref={backHref} />
          <div className={styles.stockIdentity}>
            <h1 className={styles.stockName}>{name}</h1>
            <p className={styles.stockCode}>{[targetLine, sharesText ? `보유 ${sharesText}` : null].filter(Boolean).join(' · ') || '분석 대상 확인 중'}</p>
          </div>
          <div className={styles.stockPriceBox}>
            <p className={styles.stockPrice}>{currentPriceText ?? '현재가 확인 중'}</p>
            <p className={cn(styles.stockChange, financialToneClass(returnRateDisplay.current))}>
              <span className={styles.returnRateContext}>현재가 기준</span>{' '}
              {returnRateDisplay.current ?? '계산 중'}
            </p>
            {returnRateDisplay.snapshot ? (
              <p className={styles.snapshotReturnRate}>
                촬영 당시 <strong className={financialToneClass(returnRateDisplay.snapshot)}>{returnRateDisplay.snapshot}</strong>
              </p>
            ) : null}
          </div>
        </div>
        <div className={cn(styles.headerProgress, isError ? styles.headerProgressError : resultsReadyForDisplay ? styles.headerProgressDone : undefined)} aria-label={isError ? '딥스캔 실패' : resultsReadyForDisplay ? '딥스캔 완료' : '딥스캔 진행 중'}>
          <span className={styles.headerProgressText}>{isError ? '분석 요청에 실패했어요' : progressLabel}</span>
          <span className={styles.headerProgressTrack} aria-hidden='true'>
            <span className={styles.headerProgressFill} style={{ width: `${isError ? 100 : progressPct}%` }} />
          </span>
          <span className={styles.headerProgressTime}>{isError ? '실패' : resultsReadyForDisplay ? '완료' : formatElapsedTime(elapsedSeconds)}</span>
        </div>
      </header>

      <div className={styles.body}>
        {isError ? (
          <section className={styles.errorCard} aria-label='딥스캔 오류'>
            <div className={styles.errorHead}>
              <span className={styles.errorIcon} aria-hidden='true'>!</span>
              <div>
                <span className={styles.errorEyebrow}>분석 요청 실패</span>
                <h2 className={styles.errorTitle}>{errorNotice?.title ?? 'DeepScan 데이터를 표시할 수 없어요'}</h2>
              </div>
            </div>
            <p className={styles.errorBody}>{errorNotice?.body ?? '분석 데이터 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'}</p>
            <div className={styles.errorActions}>
              {onRetry ? (
                <button type='button' className={styles.errorRetryButton} onClick={onRetry}>다시 시도</button>
              ) : null}
              <Link href={backHref} className={styles.errorBackLink}>다른 종목 선택</Link>
            </div>
          </section>
        ) : (
          <>
        <section className={styles.intro} aria-label='딥스캔 안내'>
          <p className={styles.introGreet}>{new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</p>
          <h2 className={styles.introTitle}>세 분석가가 {exchangeProduct ? 'ETF를' : '종목을'}<br />차례로 살펴보고 있어요</h2>
          <p className={styles.introBody}>{resultsReadyForDisplay ? '실제 응답이 도착했어요. 아래 결과 카드가 바로 이어집니다.' : '완료 신호가 오면 기다림 없이 이 화면 아래에 결과가 이어집니다.'}</p>
        </section>

        <TodayBriefingCard
          currentPriceText={currentPriceText}
          currentPriceCurrency={currentPriceCurrency}
          averagePriceText={averagePriceText}
          averagePriceCurrency={averagePriceCurrency}
          usdKrwRate={usdKrwRate}
          sharesText={sharesText}
          profitRateText={profitRateText}
          profitAmountText={profitAmountText}
          elapsedSeconds={elapsedSeconds}
          forceReady={resultsReadyForDisplay}
          briefingSnapshot={briefingSnapshot}
          tradingVolumeText={tradingVolumeText}
          consensus={consensusData}
          dailyCloses={briefingDailyCloses}
          seedKey={identifier}
        />


        {standaloneQuickFacts.length > 0 ? (
          <section className={styles.quickFactsCard} aria-label='수집된 빠른 근거'>
            {standaloneQuickFacts.map((fact) => <QuickFactCard key={fact.key} fact={fact} />)}
          </section>
        ) : null}

        <section ref={teamBridgeRef} className={cn(styles.teamBridgeCard, teamBridgeState ? styles.teamBridgeCardShow : styles.teamBridgeCardDone)} aria-label='세 팀 분석 전환 상태' aria-hidden={teamBridgeState ? undefined : true}>
          <p className={styles.teamBridgeText}>시세는 다 봤어요. 이제 <b>세 팀이 더 깊이</b> 분석하는 중이에요.</p>
          <div className={styles.teamBridgeProgress}>
            <span className={styles.teamBridgeSpinner} aria-hidden='true' />
            <span className={styles.teamBridgeStatus}>{teamBridgeState?.statusText ?? '세 팀이 의견을 정리하는 중…'}</span>
            <span className={styles.teamBridgeTime}>{teamBridgeState?.remainingText ?? '0:00'}</span>
          </div>
        </section>

        <section className={styles.narrativeStream} aria-label='분석가 진행 메시지'>
          {sequentialNarrativeCards.map((card) => {
            const {
              summaryReady,
              summaryLoading,
              summaryFailed,
              summaryText,
            } = getTeamSummaryState(card, teamSummaries)
            const fallbackSummaryText = buildNarrativeFallbackSummary(card, Boolean(summaryFailed))
            const resolvedSummaryText = summaryText ?? fallbackSummaryText
            const summaryCollapsible = Boolean(summaryText && shouldCollapseTeamSummaryText(summaryText))
            const summaryExpanded = Boolean(card.teamKey && expandedTeamSummaries.has(card.teamKey))
            const displaySummaryText = summaryText && summaryCollapsible && !summaryExpanded ? getCollapsedTeamSummaryText(summaryText) : resolvedSummaryText
            const summaryTextId = `team-summary-${card.key}`
            const showSummarySkeleton = shouldShowDeepScanSummarySkeleton({ placeholder: card.placeholder, resolvedSummaryText })
            const cardSettled = resultsReadyForDisplay || card.complete
            const statusLabel = summaryReady ? '요약 완료' : summaryLoading ? '요약 중' : summaryFailed ? '요약 생략' : cardSettled && !card.complete ? '확인 가능한 정보' : card.statusLabel
            const statusTone = summaryReady ? 'positive' : summaryLoading ? 'info' : summaryFailed ? 'warning' : cardSettled && !card.complete ? 'info' : card.statusTone
            const tags = [
              ...card.tags,
              card.summarizable
                ? { text: summaryReady ? '요약 완료' : summaryFailed ? '요약 생략' : '요약 중', tone: summaryReady ? 'positive' as const : summaryFailed ? 'warning' as const : 'info' as const }
                : null,
            ].filter((tag): tag is { text: string; tone: NarrativeTone } => Boolean(tag))

            return (
              <article key={card.key} className={cn(styles.narrativeCard, cardSettled ? styles.narrativeCardComplete : styles.narrativeCardPending)}>
                <div className={styles.narrativeHead}>
                  <span className={cn(styles.narrativeAvatar, card.placeholder && !card.teamKey ? styles.narrativeAvatarPending : undefined)} aria-hidden='true'>{card.placeholder && !card.teamKey ? <Loader2 className={styles.narrativeSpinner} aria-hidden /> : card.avatar}</span>
                  <div className={styles.narrativeNameWrap}>
                    <strong>{card.placeholder && !card.teamKey ? <span className={styles.narrativeTitleSkeleton} aria-hidden='true' /> : card.analystName}</strong>
                    <span>{card.placeholder && !card.teamKey ? <span className={styles.narrativeDescriptionSkeleton} aria-hidden='true' /> : card.description}</span>
                  </div>
                  <span className={cn(styles.narrativeStatus, narrativeToneClass(statusTone))}>{statusLabel}</span>
                </div>
                <div className={styles.narrativeBubble}>
                  {card.placeholder || showSummarySkeleton ? (
                    <div className={styles.narrativeTextSkeleton} aria-hidden='true'>
                      <span />
                    </div>
                  ) : (
                    <div className={styles.narrativeSummaryTextWrap}>
                      <p className={cn(styles.narrativeText, styles.narrativeTextSummarized)} id={summaryTextId}>{displaySummaryText}</p>
                      {summaryCollapsible && card.teamKey ? (
                        <button
                          type='button'
                          className={styles.narrativeSummaryAppendixToggle}
                          aria-expanded={summaryExpanded}
                          aria-controls={summaryTextId}
                          onClick={() => {
                            setExpandedTeamSummaries((previous) => {
                              const next = new Set(previous)
                              if (next.has(card.teamKey!)) {
                                next.delete(card.teamKey!)
                              } else {
                                next.add(card.teamKey!)
                              }
                              return next
                            })
                          }}
                        >
                          <span>{summaryExpanded ? '상세 해석 접기' : '상세 해석 펼치기'}</span>
                          <span className={styles.narrativeSummaryAppendixIcon} aria-hidden='true'>{summaryExpanded ? '⌃' : '⌄'}</span>
                        </button>
                      ) : null}
                    </div>
                  )}
                  <div className={styles.narrativeTags}>
                    {tags.map((tag) => (
                      <span key={`${card.key}-${tag.text}`} className={cn(styles.narrativeTag, narrativeToneClass(tag.tone))}>{tag.text}</span>
                    ))}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
        {resultsReadyForDisplay ? (
          <section className={cn(styles.completionCard, styles.completionCardReady)} aria-label='완료 전환 상태'>
            <div className={styles.completionHead}>
              <span className={styles.completionIcon} aria-hidden='true'>✓</span>
              <div>
                <span className={styles.completionEyebrow}>{completionState.eyebrow}</span>
                <h2 className={styles.completionTitle}>{completionState.title}</h2>
              </div>
            </div>
            <p className={styles.completionBody}>{completionState.body}</p>
          </section>
        ) : null}

        <details className={styles.progressDetails}>
          <summary className={styles.progressDetailsSummary}>세부 진행 단계·분석 상태</summary>
          <div className={styles.stepsWrap} aria-label='분석 단계'>
            {[
              { label: '대상 종목 확인', state: 'done' },
              { label: '근거 데이터 수집', state: evidenceCollected ? 'done' : 'active' },
              { label: '세 팀 분석 대기', state: resultsReadyForDisplay ? 'done' : evidenceCollected ? 'active' : 'wait' },
              { label: '상세 리포트 연결', state: resultsReadyForDisplay ? 'done' : 'wait' },
            ].map((step, index) => {
              const isDone = step.state === 'done'
              const isActive = step.state === 'active'

              return (
                <div key={step.label} className={styles.stepRow}>
                  <div className={cn(styles.stepIcon, isDone && styles.stepDone, isActive && styles.stepActive, !isDone && !isActive && styles.stepWait)}>
                    {isDone ? <CheckCircle2 className={styles.stepSvg} aria-hidden /> : isActive ? <Loader2 className={styles.stepSvg} aria-hidden /> : index + 1}
                  </div>
                  <div className={cn(styles.stepLabel, isDone && styles.stepLabelDone, isActive && styles.stepLabelActive, !isDone && !isActive && styles.stepLabelWait)}>
                    {step.label}
                  </div>
                  {index === 2 ? <div className={styles.stepCount}>{resultsReadyForDisplay ? '완료' : `${pendingCommitteeMemberCount}명 대기`}</div> : null}
                </div>
              )
            })}
          </div>

          <section className={styles.committeeWrap} aria-label='세 팀 분석 진행 상태'>
            <div className={styles.committeeTitle}>{resultsReadyForDisplay ? '세 팀 분석 완료' : '세 팀 분석 대기 중'}</div>
            <div className={styles.membersGrid}>
              {committeeMembers.map((member) => (
                <div key={member.key} className={styles.member}>
                  <div className={cn(styles.memberIcon, memberStateClass(resultsReadyForDisplay ? 'done' : member.state))}>
                    <member.Icon className={styles.memberSvgIcon} aria-hidden />
                  </div>
                  <div className={styles.memberName}>
                    {member.label.split('\n').map((line) => (
                      <span key={line}>
                        {line}
                        <br />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </details>

        {resultsReadyForDisplay && inlineResults ? <div className={styles.inlineResultsSlot}>{inlineResults}</div> : null}
          </>
        )}
        <p className={styles.privacy}>분석 결과는 투자 권유가 아닌 참고 자료입니다.</p>
      </div>
    </div>
  )
}
