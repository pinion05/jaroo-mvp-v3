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
import { cn } from '@/lib/utils'
import styles from './deepscan-loading-screen.module.css'

type DeepScanLoadingScreenProps = {
  name?: string
  identifier?: string
  market?: string
  shares?: string | number
  averagePrice?: string | number
  averagePriceCurrency?: MoneyCurrency
  currentPrice?: string | number
  currentPriceCurrency?: MoneyCurrency
  tradingVolume?: string | number
  currentProfitRate?: string | number
  evaluationAmount?: string | number
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
  }
}

export type LoadingStageKey = 'fundamentalTeam' | 'marketTeam' | 'contextTeam'
type PlaceholderStageKey = `pendingStage${number}`
type NarrativeCardKey = LoadingStageKey | PlaceholderStageKey
type NarrativeTone = 'positive' | 'warning' | 'neutral' | 'info'
type CommitteeTeamMemberDefinition = {
  sourceTitle: string
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
const TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS = 0.9
const TODAY_BRIEFING_MEANING_REVEAL_DELAY_SECONDS = 1.8
const TODAY_BRIEFING_ITEM_COUNT = 6

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
    analystName: '가치/기본 팀',
    description: '가치 분석가 · 성장 전략가 · 재무 감사관',
    avatar: '🏛️',
    members: [
      { sourceTitle: '밸류에이션', alias: '가치 분석가' },
      { sourceTitle: '수익성/기본체력', alias: '성장 전략가' },
      { sourceTitle: '지분/안정성', alias: '재무 감사관' },
    ],
  },
  {
    key: 'marketTeam',
    analystName: '시장/차트 팀',
    description: '차트 마스터 · 수급 추적기 · 모멘텀 스카우터',
    avatar: '📈',
    members: [
      { sourceTitle: '가격 위치', alias: '차트 마스터' },
      { sourceTitle: '평단 격차', alias: '수급 추적기' },
      { sourceTitle: '트렌드', alias: '모멘텀 스카우터' },
    ],
  },
  {
    key: 'contextTeam',
    analystName: '심리/환경 팀',
    description: '심리 분석AI · 산업 전문가 · 이벤트 스캐너',
    avatar: '🧠',
    members: [
      { sourceTitle: '입력 완성도', alias: '심리 분석AI' },
      { sourceTitle: '상방 버퍼', alias: '산업 전문가' },
      { sourceTitle: '컨센서스 모멘텀', alias: '이벤트 스캐너' },
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

function calculateFallbackEvaluationAmount({
  evaluationAmount,
  currentPrice,
  shares,
  averagePrice,
  currentProfitRate,
}: Pick<DeepScanLoadingScreenProps, 'evaluationAmount' | 'currentPrice' | 'shares' | 'averagePrice' | 'currentProfitRate'>) {
  if (parseNumericValue(evaluationAmount) !== null) {
    return evaluationAmount
  }

  const shareCount = parseNumericValue(shares)
  if (shareCount === null) {
    return undefined
  }

  const currentPriceValue = parseNumericValue(currentPrice)
  if (currentPriceValue !== null) {
    return currentPriceValue * shareCount
  }

  const averagePriceValue = parseNumericValue(averagePrice)
  const profitRateValue = parseNumericValue(currentProfitRate)
  if (averagePriceValue !== null && profitRateValue !== null) {
    return averagePriceValue * (1 + profitRateValue / 100) * shareCount
  }

  return undefined
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
  return numericValue === null ? null : `${formatNumber(numericValue)}주`
}

function formatTradingVolume(value: string | number | undefined) {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
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

function flattenCommitteeMembers(committeeAxes: JarooDeepScanCommitteeAxis[] | undefined) {
  return (committeeAxes ?? []).flatMap((axis) => axis.members)
}

function buildCommitteeTeamBody(
  team: CommitteeTeamDefinition,
  committeeAxes: JarooDeepScanCommitteeAxis[] | undefined,
) {
  const members = flattenCommitteeMembers(committeeAxes)
  const lines = team.members.map((definition) => {
    const member = members.find((candidate) => candidate.title === definition.sourceTitle)
    if (member?.status === 'success' && typeof member.reason === 'string' && member.reason.trim()) {
      return `${definition.alias}: ${member.reason}`
    }
    if (member?.status === 'error') {
      return `${definition.alias}: 응답 실패`
    }
    return `${definition.alias}: 응답 대기 중`
  })

  return {
    body: lines.join('\n'),
    readyCount: team.members.filter((definition) => {
      const member = members.find((candidate) => candidate.title === definition.sourceTitle)
      return member?.status === 'success' && typeof member.reason === 'string' && member.reason.trim().length > 0
    }).length,
    errorCount: team.members.filter((definition) => {
      const member = members.find((candidate) => candidate.title === definition.sourceTitle)
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

  return {
    ready: false,
    eyebrow: '분석 진행 중',
    title: '분석가 의견을 차례로 모으는 중이에요',
    body: '완료 신호가 오면 기다리지 않고 바로 상세 결과로 넘어갈 수 있게 바뀝니다.',
  }
}

function buildLoadingStages({
  displayQuickFacts,
  findingProgress,
  performanceComment,
  committeeAxes,
  currentPriceText,
  tradingVolumeText,
}: {
  displayQuickFacts: LoadingQuickFact[]
  findingProgress?: Partial<Record<FindingKey, FindingProgress>>
  performanceComment?: LoadingPerformanceComment
  committeeAxes?: JarooDeepScanCommitteeAxis[]
  currentPriceText: string | null
  tradingVolumeText: string | null
}): NarrativeCard[] {
  const positionFact = displayQuickFacts.find((fact) => fact.key === 'week52-position' || Boolean(fact.indicator))
  const consensusFact = getQuickFactByKey(displayQuickFacts, 'analyst-consensus')
  const completedFindings = findingProgress ? Object.values(findingProgress).filter(Boolean) : []
  const performanceLines = performanceComment && hasDisplayValue(performanceComment) ? getCommentLines(performanceComment) : []

  return committeeTeams.map((team) => {
    const teamBody = buildCommitteeTeamBody(team, committeeAxes)
    const tags = team.key === 'fundamentalTeam'
      ? [
          { text: performanceLines.length ? '실적 코멘트 확인' : '실적 대기', tone: performanceLines.length ? 'positive' as const : 'neutral' as const },
          { text: completedFindings.length ? `위원회 ${completedFindings.length}개 응답` : '위원회 대기', tone: completedFindings.length ? 'info' as const : 'neutral' as const },
        ]
      : team.key === 'marketTeam'
        ? [
            { text: currentPriceText ? '현재가 확인' : '현재가 대기', tone: currentPriceText ? 'positive' as const : 'neutral' as const },
            { text: tradingVolumeText ? `거래량 ${tradingVolumeText}` : '가격 위치 대기', tone: positionFact ? 'info' as const : 'neutral' as const },
          ]
        : [
            { text: consensusFact?.badge ?? '확인 중', tone: consensusFact ? quickFactToneToNarrativeTone(consensusFact.tone) : 'neutral' as const },
            { text: consensusFact?.detail ? '조회 실패 분리' : '원천 상태 표시', tone: consensusFact?.tone === 'warning' ? 'warning' as const : 'info' as const },
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

function buildPlaceholderNarrativeCard(index: number): NarrativeCard {
  return {
    key: `pendingStage${index + 1}`,
    analystName: '',
    description: '',
    avatar: '',
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
  const arrivedCards = arrivedStageKeys
    .map((stageKey) => cardsByKey.get(stageKey))
    .filter((card): card is NarrativeCard => typeof card !== 'undefined')
  const remainingSlotCount = Math.max(0, cards.length - arrivedCards.length)

  return [
    ...arrivedCards,
    ...Array.from({ length: remainingSlotCount }, (_, index) => buildPlaceholderNarrativeCard(arrivedCards.length + index)),
  ]
}

function buildVisibleNarrativeCards(cards: NarrativeCard[], visibleStageCount: number): NarrativeCard[] {
  return cards.slice(0, Math.min(Math.max(visibleStageCount, 1), cards.length))
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

function pctToneClass(value: number | null | undefined) {
  if (!isFiniteNumber(value) || value === 0) {
    return styles.todayBlue
  }

  return value > 0 ? styles.todayUp : styles.todayDown
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

function TodayBriefingCard({
  currentPriceText,
  averagePriceText,
  sharesText,
  profitRateText,
  profitAmountText,
  elapsedSeconds,
  briefingSnapshot,
}: {
  currentPriceText: string | null
  averagePriceText: string | null
  sharesText: string | null
  profitRateText: string | null
  profitAmountText: string | null
  elapsedSeconds: number
  briefingSnapshot?: LoadingBriefingSnapshot | null
}) {
  const quote = briefingSnapshot?.quote
  const averagePriceValue = parseNumericValue(averagePriceText ?? undefined)
  const sharesValue = parseNumericValue(sharesText ?? undefined)
  const briefingModel = useMemo(() => {
    const dailyRows = (briefingSnapshot?.daily ?? []).filter((row) => isFiniteNumber(row.close))
    const latestRow = getLatestBriefingDailyRow(dailyRows)
    const previousRow = getPreviousBriefingDailyRow(dailyRows)
    const currentPriceValue = quote?.currentPrice ?? latestRow?.close ?? parseNumericValue(currentPriceText ?? undefined)
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
    const chart = buildChartGeometry(dailyRows.slice(-60), averagePriceValue)

    return {
      currentPriceValue,
      latestRow,
      oneMonthPct,
      shortStreak,
      todayFlow,
      volumeRatio,
      chart,
    }
  }, [averagePriceValue, briefingSnapshot?.daily, currentPriceText, quote])
  const currentPriceValue = briefingModel.currentPriceValue
  const displayCurrentPrice = formatMoney(currentPriceValue ?? undefined, 'KRW') ?? currentPriceText ?? '현재가 확인 중'
  const displayAveragePrice = averagePriceText ?? '평단 확인 중'
  const displayShares = sharesText ?? '수량 확인 중'
  const calculatedProfitRate = isFiniteNumber(currentPriceValue) && isFiniteNumber(averagePriceValue) && averagePriceValue !== 0
    ? ((currentPriceValue / averagePriceValue) - 1) * 100
    : null
  const calculatedProfitAmount = isFiniteNumber(currentPriceValue) && isFiniteNumber(averagePriceValue) && isFiniteNumber(sharesValue)
    ? (currentPriceValue - averagePriceValue) * sharesValue
    : null
  const displayProfitRate = formatSignedPercent(calculatedProfitRate ?? undefined) ?? profitRateText ?? '계산 중'
  const displayProfitAmount = formatSignedMoney(calculatedProfitAmount, 'KRW') ?? profitAmountText ?? '계산 중'
  const oneMonthPct = briefingModel.oneMonthPct
  const oneMonthLabel = formatPercentValue(oneMonthPct)
  const shortStreak = briefingModel.shortStreak
  const streakLabel = shortStreak.direction === 'up'
    ? `${shortStreak.count}일 연속 상승`
    : shortStreak.direction === 'down'
      ? `${shortStreak.count}일 연속 하락`
      : '전일과 비슷한 흐름'
  const positionPct = calculatedProfitRate
  const needToBreakeven = isFiniteNumber(currentPriceValue) && isFiniteNumber(averagePriceValue) && currentPriceValue < averagePriceValue
    ? ((averagePriceValue / currentPriceValue) - 1) * 100
    : null
  const breakevenGap = isFiniteNumber(currentPriceValue) && isFiniteNumber(averagePriceValue)
    ? Math.round(Math.abs(averagePriceValue - currentPriceValue))
    : null
  const positionLabel = isFiniteNumber(positionPct)
    ? positionPct >= 0
      ? `평단보다 ${formatPercentValue(positionPct)}`
      : `본전까지 ${formatPercentValue(needToBreakeven)}`
    : '평단 위치 계산 중'
  const positionMeaning = isFiniteNumber(positionPct)
    ? positionPct >= 0
      ? '지금 가격은 평단 위라 수익 구간이에요.'
      : `${formatNumber(breakevenGap ?? 0)}원만 오르면 원금 회복이에요.`
    : '현재가와 평단을 맞춰 보는 중이에요.'
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

  return (
    <section className={styles.todayBriefingCard} aria-label='오늘 장 기준 시세 브리핑'>
      <div className={styles.todayBriefingHead}>
        <div className={styles.todayLiveLabel}><span className={styles.todayLiveDot} />오늘 장 기준 · {formatAsOfTime(quote?.asOf ?? briefingSnapshot?.asOf)}</div>
        <div className={styles.todayPriceRow}>
          <div>
            <div className={styles.todayPrice}>{displayCurrentPrice}</div>
            <div className={styles.todayPriceSub}>평단 {displayAveragePrice} · {displayShares}</div>
          </div>
          <div className={styles.todayProfitBox}>
            <div className={cn(styles.todayProfitRate, isFiniteNumber(calculatedProfitRate) && calculatedProfitRate < 0 ? styles.todayDown : styles.todayUp)}>{displayProfitRate}</div>
            <div className={styles.todayProfitAmount}>{displayProfitAmount}</div>
          </div>
        </div>
      </div>

      <div className={styles.todayChartWrap}>
        <div className={styles.todayChartLabel}>
          <span>최근 3개월 · 점선은 내 평단</span>
          <span>일봉</span>
        </div>
        {chart.hasData ? (
          <svg className={styles.todayChartSvg} viewBox='0 0 300 120' aria-label='최근 3개월 일봉 차트'>
            <path className={styles.todayChartArea} d={chart.areaPath} />
            <path className={styles.todayChartLine} d={chart.linePath} pathLength={1} />
            <line className={styles.todayAvgLine} x1='4' y1={chart.averageY} x2='296' y2={chart.averageY} />
            <text className={styles.todayAvgText} x='296' y={Math.max(12, chart.averageY - 6)} textAnchor='end'>내 평단 {displayAveragePrice.replace(/원$/u, '')}</text>
            <circle className={styles.todayChartDot} cx={chart.lastPoint.x} cy={chart.lastPoint.y} r='3' />
            <circle className={styles.todayChartRing} cx={chart.lastPoint.x} cy={chart.lastPoint.y} r='7' />
          </svg>
        ) : (
          <div className={styles.todayChartEmpty} role='status'>차트 데이터를 확인하는 중이에요</div>
        )}
      </div>

      <div className={styles.todayBriefList}>
        <TodayBriefingItem at={briefStartSeconds[0]} elapsedSeconds={elapsedSeconds} icon='🗓️' question='최근 한 달, 어떻게 흘러왔나요?' data={<span className={pctToneClass(oneMonthPct)}>{oneMonthLabel ? `한 달 전보다 ${oneMonthLabel}` : '한 달 흐름 계산 중'}</span>} meaning={buildOneMonthMeaning(oneMonthPct)} />
        <TodayBriefingItem at={briefStartSeconds[1]} elapsedSeconds={elapsedSeconds} icon='📈' question='단기 흐름은요?' data={<span className={shortStreak.direction === 'up' ? styles.todayUp : shortStreak.direction === 'down' ? styles.todayDown : styles.todayBlue}>{streakLabel}</span>} meaning={shortStreak.direction === 'up' ? '짧게 봐도 흐름이 살아나고 있어요.' : shortStreak.direction === 'down' ? '단기적으로는 숨 고르기가 이어지고 있어요.' : '아직 한쪽 방향으로 강하게 기울지는 않았어요.'} />
        <TodayBriefingItem at={briefStartSeconds[2]} elapsedSeconds={elapsedSeconds} icon='🎯' question='내 자리는 어디쯤일까요?' data={<span className={isFiniteNumber(positionPct) && positionPct < 0 ? styles.todayDown : styles.todayUp}>{positionLabel}</span>} meaning={<><b>{positionMeaning}</b></>} />
        <TodayMarketBriefing at={briefStartSeconds[3]} elapsedSeconds={elapsedSeconds} kospiPct={briefingSnapshot?.market?.kospi?.changePct ?? null} kosdaqPct={briefingSnapshot?.market?.kosdaq?.changePct ?? null} stockPct={quote?.changePct ?? briefingModel.latestRow?.changePct ?? null} />
        <TodayBriefingItem at={briefStartSeconds[4]} elapsedSeconds={elapsedSeconds} icon='📊' question='오늘 하루는 어땠나요?' data={<span className={todayFlow.tone === 'positive' ? styles.todayUp : todayFlow.tone === 'negative' ? styles.todayDown : styles.todayBlue}>{todayFlow.label}</span>} meaning={todayFlow.meaning} />
        <TodayBriefingItem at={briefStartSeconds[5]} elapsedSeconds={elapsedSeconds} icon='🔥' question='거래는 활발했나요?' data={<span className={isFiniteNumber(volumeRatio) && volumeRatio >= 1 ? styles.todayBlue : styles.todayDown}>{volumeRatioLabel}</span>} meaning={volumeMeaning} />
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
}: {
  at: number
  elapsedSeconds: number
  icon: string
  question: string
  data: ReactNode
  meaning: ReactNode
}) {
  const isVisible = elapsedSeconds >= at
  const isDataVisible = elapsedSeconds >= at + TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS
  const isMeaningVisible = elapsedSeconds >= at + TODAY_BRIEFING_MEANING_REVEAL_DELAY_SECONDS

  return (
    <article className={cn(styles.todayBriefItem, isVisible ? styles.todayBriefItemIn : undefined)}>
      <div className={styles.todayBriefQuestionRow}>
        <span className={styles.todayBriefIcon} aria-hidden='true'>{icon}</span>
        <span className={styles.todayBriefQuestion}>{question}</span>
      </div>
      <div className={cn(styles.todayBriefBody, isDataVisible ? styles.todayBriefBodyIn : undefined)}>
        <div className={styles.todayBriefData}>{data}</div>
        <p className={cn(styles.todayBriefMeaning, isMeaningVisible ? styles.todayBriefMeaningIn : undefined)}>{meaning}</p>
      </div>
    </article>
  )
}


function buildMarketMeaning(kospiPct: number | null, kosdaqPct: number | null, stockPct: number | null) {
  if (!isFiniteNumber(stockPct)) {
    return '내 종목의 장중 등락률을 확인하는 중이에요.'
  }

  const marketValues = [kospiPct, kosdaqPct].filter(isFiniteNumber)
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
  kospiPct,
  kosdaqPct,
  stockPct,
}: {
  at: number
  elapsedSeconds: number
  kospiPct: number | null
  kosdaqPct: number | null
  stockPct: number | null
}) {
  const isVisible = elapsedSeconds >= at
  const isDataVisible = elapsedSeconds >= at + TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS
  const isMeaningVisible = elapsedSeconds >= at + TODAY_BRIEFING_MEANING_REVEAL_DELAY_SECONDS
  const kospiLabel = formatPercentValue(kospiPct) ?? '확인 중'
  const kosdaqLabel = formatPercentValue(kosdaqPct) ?? '확인 중'
  const stockLabel = formatPercentValue(stockPct) ?? '확인 중'

  return (
    <article className={cn(styles.todayBriefItem, isVisible ? styles.todayBriefItemIn : undefined)}>
      <div className={styles.todayBriefQuestionRow}>
        <span className={styles.todayBriefIcon} aria-hidden='true'>🏛️</span>
        <span className={styles.todayBriefQuestion}>오늘 시장 속에서는?</span>
      </div>
      <div className={cn(styles.todayBriefBody, isDataVisible ? styles.todayBriefBodyIn : undefined)}>
        <div className={styles.todayMarketGrid}>
          <div className={styles.todayMarketCell}><span>코스피</span><b className={pctToneClass(kospiPct)}>{kospiLabel}</b></div>
          <div className={styles.todayMarketCell}><span>코스닥</span><b className={pctToneClass(kosdaqPct)}>{kosdaqLabel}</b></div>
          <div className={`${styles.todayMarketCell} ${styles.todayMarketCellMe}`}><span>내 종목</span><b className={pctToneClass(stockPct)}>{stockLabel}</b></div>
        </div>
        <p className={cn(styles.todayBriefMeaning, isMeaningVisible ? styles.todayBriefMeaningIn : undefined)}><b>{buildMarketMeaning(kospiPct, kosdaqPct, stockPct)}</b></p>
      </div>
    </article>
  )
}


export function DeepScanLoadingScreen({
  name = '선택 종목',
  identifier,
  market,
  shares,
  averagePrice,
  averagePriceCurrency = 'KRW',
  currentPrice,
  currentPriceCurrency = averagePriceCurrency,
  tradingVolume,
  currentProfitRate,
  evaluationAmount,
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
}: DeepScanLoadingScreenProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [teamSummaries, setTeamSummaries] = useState<Partial<Record<LoadingStageKey, TeamSummaryState>>>({})
  const requestedTeamSummariesRef = useRef<Set<string>>(new Set())
  const targetLine = [identifier, market].filter(Boolean).join(' · ')
  const sharesText = formatShares(shares)
  const averagePriceText = formatMoney(averagePrice, averagePriceCurrency)
  const currentPriceText = formatMoney(currentPrice, currentPriceCurrency)
  const tradingVolumeText = formatTradingVolume(tradingVolume)
  const evaluationAmountText = formatMoney(
    calculateFallbackEvaluationAmount({ evaluationAmount, currentPrice, shares, averagePrice, currentProfitRate }),
    currentPriceCurrency,
  )
  const snapshotCurrentPrice = briefingSnapshot?.quote?.currentPrice ?? undefined
  const effectiveCurrentPrice = snapshotCurrentPrice ?? currentPrice
  const profitRateText = formatSignedPercent(calculateProfitRate({ currentPrice: effectiveCurrentPrice, averagePrice }) ?? currentProfitRate)
  const profitAmountText = formatSignedMoney(
    calculateProfitAmount({ currentPrice: effectiveCurrentPrice, averagePrice, shares }),
    currentPriceCurrency,
  )
  const displayQuickFacts = useMemo(() => quickFacts.filter(hasDisplayValue), [quickFacts])
  const positionQuickFact = displayQuickFacts.find((fact) => fact.key === 'week52-position' || Boolean(fact.indicator))
  const loadingStages = useMemo(
    () => buildLoadingStages({
      displayQuickFacts,
      findingProgress,
      performanceComment,
      committeeAxes,
      currentPriceText,
      tradingVolumeText,
    }),
    [committeeAxes, currentPriceText, displayQuickFacts, findingProgress, performanceComment, tradingVolumeText],
  )
  const orderedNarrativeCards = useMemo(
    () => buildOrderedNarrativeCards(loadingStages, arrivedStageKeys),
    [arrivedStageKeys, loadingStages],
  )
  const visibleNarrativeCards = useMemo(
    () => buildVisibleNarrativeCards(orderedNarrativeCards, visibleStageCount),
    [orderedNarrativeCards, visibleStageCount],
  )
  const completionState = buildCompletionState(resultsReady, elapsedSeconds)
  const progressPct = resultsReady ? 100 : Math.min(92, 12 + elapsedSeconds * 7)
  const activeNarrativeCard = visibleNarrativeCards.findLast((card) => !card.placeholder) ?? visibleNarrativeCards.at(-1) ?? orderedNarrativeCards[0]
  const progressLabel = resultsReady
    ? '상세 결과 준비 완료'
    : activeNarrativeCard.placeholder
      ? '분석가 응답을 기다리는 중…'
      : `${activeNarrativeCard.analystName}가 살펴보는 중…`

  useEffect(() => {
    if (resultsReady) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1)
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [resultsReady])

  useEffect(() => {
    loadingStages.forEach((card) => {
      const teamKey = card.teamKey
      if (!teamKey || !card.summarizable || !card.body.trim()) {
        return
      }

      const inputKey = hashSummaryInput(card.body)
      const requestKey = `${teamKey}:${inputKey}`
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
        body: JSON.stringify({
          teamKey: card.key,
          teamName: card.analystName,
          body: card.body,
        }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as { ok?: boolean; summary?: unknown } | null
          const summary = body?.ok === true ? normalizeSummaryText(body.summary) : null
          if (!response.ok || !summary) {
            throw new Error('team summary unavailable')
          }

          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'success', summary },
          }))
        })
        .catch(() => {
          setTeamSummaries((previous) => ({
            ...previous,
            [teamKey]: { inputKey, status: 'error' },
          }))
        })
    })
  }, [loadingStages])

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
            <p className={cn(styles.stockChange, profitRateText && parseNumericValue(profitRateText) !== null && parseNumericValue(profitRateText)! < 0 ? styles.loss : styles.gain)}>
              {profitRateText ? profitRateText : '계산 중'}
            </p>
          </div>
        </div>
        <div className={cn(styles.headerProgress, resultsReady ? styles.headerProgressDone : undefined)} aria-label={resultsReady ? '딥스캔 완료' : '딥스캔 진행 중'}>
          <span className={styles.headerProgressText}>{progressLabel}</span>
          <span className={styles.headerProgressTrack} aria-hidden='true'>
            <span className={styles.headerProgressFill} style={{ width: `${progressPct}%` }} />
          </span>
          <span className={styles.headerProgressTime}>{resultsReady ? '완료' : formatElapsedTime(elapsedSeconds)}</span>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-label='딥스캔 안내'>
          <p className={styles.introGreet}>{new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())}</p>
          <h2 className={styles.introTitle}>세 분석가가 종목을<br />차례로 살펴보고 있어요</h2>
          <p className={styles.introBody}>{resultsReady ? '실제 응답이 도착했어요. 아래 결과 카드가 바로 이어집니다.' : '완료 신호가 오면 기다림 없이 이 화면 아래에 결과가 이어집니다.'}</p>
        </section>

        <TodayBriefingCard
          currentPriceText={currentPriceText}
          averagePriceText={averagePriceText}
          sharesText={sharesText}
          profitRateText={profitRateText}
          profitAmountText={profitAmountText}
          elapsedSeconds={elapsedSeconds}
          briefingSnapshot={briefingSnapshot}
        />

        <section className={styles.positionSummaryCard} aria-label='보유 포지션 요약'>
          <div>
            <span className={styles.metaLabel}>평단가</span>
            <span className={styles.metaValue}>{averagePriceText ?? '확인 중'}</span>
          </div>
          <div>
            <span className={styles.metaLabel}>평가금액</span>
            <span className={styles.metaValue}>{evaluationAmountText ?? '계산 중'}</span>
          </div>
          <div>
            <span className={styles.metaLabel}>거래량</span>
            <span className={styles.metaValue}>{tradingVolumeText ?? '확인 중'}</span>
          </div>
        </section>

        <section className={styles.narrativeStream} aria-label='분석가 진행 메시지'>
          {visibleNarrativeCards.map((card) => {
            const summaryInputKey = hashSummaryInput(card.body)
            const summaryState = card.teamKey ? teamSummaries[card.teamKey] : undefined
            const summaryReady = summaryState?.inputKey === summaryInputKey && summaryState.status === 'success' && summaryState.summary
            const summaryLoading = summaryState?.inputKey === summaryInputKey && summaryState.status === 'loading'
            const summaryText = summaryReady ? summaryState.summary! : null
            const showSummarySkeleton = !card.placeholder && !summaryText
            const cardSettled = resultsReady || card.complete
            const statusLabel = summaryReady ? '팀 요약 완료' : summaryLoading ? '팀 요약 중' : cardSettled && !card.complete ? '확인 가능한 정보' : card.statusLabel
            const statusTone = summaryReady ? 'positive' : summaryLoading ? 'info' : cardSettled && !card.complete ? 'info' : card.statusTone
            const tags = [
              ...card.tags,
              card.summarizable
                ? { text: summaryReady ? '한줄 요약 완료' : '한줄 요약 중', tone: summaryReady ? 'positive' as const : 'info' as const }
                : null,
            ].filter((tag): tag is { text: string; tone: NarrativeTone } => Boolean(tag))

            return (
              <article key={card.key} className={cn(styles.narrativeCard, cardSettled ? styles.narrativeCardComplete : styles.narrativeCardPending)}>
                <div className={styles.narrativeHead}>
                  <span className={cn(styles.narrativeAvatar, cardSettled && !card.placeholder ? undefined : styles.narrativeAvatarPending)} aria-hidden='true'>{cardSettled && !card.placeholder ? card.avatar : <Loader2 className={styles.narrativeSpinner} aria-hidden />}</span>
                  <div className={styles.narrativeNameWrap}>
                    <strong>{card.placeholder ? <span className={styles.narrativeTitleSkeleton} aria-hidden='true' /> : card.analystName}</strong>
                    <span>{card.placeholder ? <span className={styles.narrativeDescriptionSkeleton} aria-hidden='true' /> : card.description}</span>
                  </div>
                  <span className={cn(styles.narrativeStatus, narrativeToneClass(statusTone))}>{statusLabel}</span>
                </div>
                <div className={styles.narrativeBubble}>
                  {card.placeholder || showSummarySkeleton ? (
                    <div className={styles.narrativeTextSkeleton} aria-hidden='true'>
                      <span />
                    </div>
                  ) : (
                    <p className={cn(styles.narrativeText, styles.narrativeTextSummarized)}>{summaryText}</p>
                  )}
                  {card.teamKey === 'marketTeam' && positionQuickFact?.indicator ? (
                    <div
                      className={styles.narrativePricebar}
                      aria-label={`시장/차트 팀 가격 위치: ${positionQuickFact.indicator.leftLabel}부터 ${positionQuickFact.indicator.rightLabel} 사이 ${positionQuickFact.indicator.markerLabel ?? '현재 위치'}`}
                    >
                      <div className={styles.narrativePricebarRow}>
                        <span>{positionQuickFact.indicator.leftLabel}</span>
                        <span>{positionQuickFact.indicator.rightLabel}</span>
                      </div>
                      <div className={styles.narrativePricebarTrack} aria-hidden='true'>
                        <span
                          className={styles.narrativePricebarMarker}
                          style={{ left: `${positionQuickFact.indicator.positionPct}%` }}
                        />
                      </div>
                      <div className={styles.narrativePricebarNow}>
                        <strong>{positionQuickFact.indicator.markerLabel ?? '현재 위치'}</strong>
                        {positionQuickFact.indicator.deltaLabels?.length ? <span>{positionQuickFact.indicator.deltaLabels.join(' · ')}</span> : null}
                      </div>
                    </div>
                  ) : null}
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




        <section className={cn(styles.completionCard, completionState.ready ? styles.completionCardReady : styles.completionCardWaiting)} aria-label='완료 전환 상태'>
          <div className={styles.completionHead}>
            <span className={styles.completionIcon} aria-hidden='true'>{completionState.ready ? '✓' : '…'}</span>
            <div>
              <span className={styles.completionEyebrow}>{completionState.eyebrow}</span>
              <h2 className={styles.completionTitle}>{completionState.title}</h2>
            </div>
          </div>
          <p className={styles.completionBody}>{completionState.body}</p>
        </section>

        <details className={styles.progressDetails}>
          <summary className={styles.progressDetailsSummary}>세부 진행 단계·위원회 상태</summary>
          <div className={styles.stepsWrap} aria-label='분석 단계'>
            {[
              { label: '대상 종목 확인', state: 'done' },
              { label: '근거 데이터 수집', state: evidenceCollected ? 'done' : 'active' },
              { label: 'AI 9인 위원회 응답 대기', state: resultsReady ? 'done' : evidenceCollected ? 'active' : 'wait' },
              { label: '상세 리포트 연결', state: resultsReady ? 'done' : 'wait' },
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
                  {index === 2 ? <div className={styles.stepCount}>{resultsReady ? '완료' : `${pendingCommitteeMemberCount}명 대기`}</div> : null}
                </div>
              )
            })}
          </div>

          <section className={styles.committeeWrap} aria-label='AI 위원회 진행 상태'>
            <div className={styles.committeeTitle}>{resultsReady ? 'AI 9인 위원회 응답 완료' : 'AI 9인 위원회 응답 대기 중'}</div>
            <div className={styles.membersGrid}>
              {committeeMembers.map((member) => (
                <div key={member.key} className={styles.member}>
                  <div className={cn(styles.memberIcon, memberStateClass(resultsReady ? 'done' : member.state))}>
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

        {inlineResults ? <div className={styles.inlineResultsSlot}>{inlineResults}</div> : null}
        <p className={styles.privacy}>분석 결과는 투자 권유가 아닌 참고 자료입니다.</p>
      </div>
    </div>
  )
}
