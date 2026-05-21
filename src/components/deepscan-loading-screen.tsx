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
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import styles from './deepscan-loading-screen.module.css'

type MoneyCurrency = 'KRW' | 'USD'

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
  findingProgress?: Partial<Record<FindingKey, FindingProgress>>
  committeeAxes?: JarooDeepScanCommitteeAxis[]
  quickFacts?: LoadingQuickFact[]
  performanceComment?: LoadingPerformanceComment
  evidenceCollected?: boolean
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

type LoadingStageKey = 'fundamentalTeam' | 'marketTeam' | 'contextTeam'
type NarrativeTone = 'positive' | 'warning' | 'neutral' | 'info'
type CommitteeTeamMemberDefinition = {
  sourceTitle: string
  alias: string
}
type CommitteeTeamDefinition = {
  key: LoadingStageKey
  revealAt: number
  analystName: string
  description: string
  avatar: string
  members: CommitteeTeamMemberDefinition[]
}
type NarrativeCard = {
  key: LoadingStageKey
  revealAt: number
  analystName: string
  description: string
  avatar: string
  body: string
  tags: Array<{ text: string; tone: NarrativeTone }>
  statusLabel: string
  statusTone: NarrativeTone
  complete: boolean
  summarizable: boolean
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
    revealAt: 0,
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
    revealAt: 4,
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
    revealAt: 8,
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
      revealAt: team.revealAt,
      analystName: team.analystName,
      description: team.description,
      avatar: team.avatar,
      body: teamBody.body,
      tags,
      statusLabel: teamBody.readyCount === team.members.length ? '위원 응답 완료' : teamBody.errorCount > 0 ? '일부 응답 실패' : `${teamBody.readyCount}/${team.members.length} 응답`,
      statusTone: teamBody.errorCount > 0 ? 'warning' : teamBody.readyCount > 0 ? 'positive' : 'neutral',
      complete: teamBody.readyCount + teamBody.errorCount === team.members.length,
      summarizable: teamBody.readyCount === team.members.length,
    }
  })
}

function buildVisibleNarrativeCards(cards: NarrativeCard[], elapsedSeconds: number, resultsReady: boolean): NarrativeCard[] {
  if (resultsReady) {
    return cards
  }

  return cards.filter((card) => elapsedSeconds >= card.revealAt)
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
  findingProgress,
  committeeAxes,
  quickFacts = [],
  performanceComment,
  evidenceCollected = false,
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
  const profitRateText = formatSignedPercent(currentProfitRate)
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
  const visibleNarrativeCards = useMemo(
    () => buildVisibleNarrativeCards(loadingStages, elapsedSeconds, resultsReady),
    [elapsedSeconds, loadingStages, resultsReady],
  )
  const completionState = buildCompletionState(resultsReady, elapsedSeconds)
  const progressPct = resultsReady ? 100 : Math.min(92, 12 + elapsedSeconds * 7)
  const activeNarrativeCard = visibleNarrativeCards.at(-1) ?? loadingStages[0]
  const progressLabel = resultsReady ? '상세 결과 준비 완료' : `${activeNarrativeCard.analystName}가 살펴보는 중…`

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
      if (!card.summarizable || !card.body.trim()) {
        return
      }

      const inputKey = hashSummaryInput(card.body)
      const requestKey = `${card.key}:${inputKey}`
      if (requestedTeamSummariesRef.current.has(requestKey)) {
        return
      }

      requestedTeamSummariesRef.current.add(requestKey)
      setTeamSummaries((previous) => ({
        ...previous,
        [card.key]: { inputKey, status: 'loading' },
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
            [card.key]: { inputKey, status: 'success', summary },
          }))
        })
        .catch(() => {
          setTeamSummaries((previous) => ({
            ...previous,
            [card.key]: { inputKey, status: 'error' },
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
            const summaryState = teamSummaries[card.key]
            const summaryReady = summaryState?.inputKey === summaryInputKey && summaryState.status === 'success' && summaryState.summary
            const summaryLoading = summaryState?.inputKey === summaryInputKey && summaryState.status === 'loading'
            const displayBody = summaryReady ? summaryState.summary! : card.body
            const cardSettled = resultsReady || card.complete
            const statusLabel = summaryReady ? '팀 요약 완료' : summaryLoading ? '팀 요약 중' : cardSettled && !card.complete ? '확인 가능한 정보' : card.statusLabel
            const statusTone = summaryReady ? 'positive' : summaryLoading ? 'info' : cardSettled && !card.complete ? 'info' : card.statusTone
            const tags = [
              ...card.tags,
              card.summarizable
                ? { text: summaryReady ? '한줄 요약 완료' : summaryLoading ? '한줄 요약 중' : '원문 표시', tone: summaryReady ? 'positive' as const : summaryLoading ? 'info' as const : 'neutral' as const }
                : null,
            ].filter((tag): tag is { text: string; tone: NarrativeTone } => Boolean(tag))

            return (
              <article key={card.key} className={cn(styles.narrativeCard, cardSettled ? styles.narrativeCardComplete : styles.narrativeCardPending)}>
                <div className={styles.narrativeHead}>
                  <span className={cn(styles.narrativeAvatar, cardSettled ? undefined : styles.narrativeAvatarPending)} aria-hidden='true'>{cardSettled ? card.avatar : <Loader2 className={styles.narrativeSpinner} aria-hidden />}</span>
                  <div className={styles.narrativeNameWrap}>
                    <strong>{card.analystName}</strong>
                    <span>{card.description}</span>
                  </div>
                  <span className={cn(styles.narrativeStatus, narrativeToneClass(statusTone))}>{statusLabel}</span>
                </div>
                <div className={styles.narrativeBubble}>
                  <p className={cn(styles.narrativeText, summaryReady ? styles.narrativeTextSummarized : undefined)}>{displayBody}</p>
                  {card.key === 'marketTeam' && positionQuickFact?.indicator ? (
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
