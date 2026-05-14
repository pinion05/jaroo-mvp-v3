'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
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
  quickFacts?: LoadingQuickFact[]
  performanceComment?: LoadingPerformanceComment
  evidenceCollected?: boolean
  resultsReady?: boolean
  className?: string
  onBack?: () => void
  backHref?: string
  onViewResults?: () => void
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

type FindingDefinition = {
  key: FindingKey
  number: string
  title: string
  loadingLabel: string
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

const metaMessages = [
  { icon: '📊', text: '보유 포지션과 현재가 근거를 맞춰보고 있어요.' },
  { icon: '🔍', text: '국내 리포트와 최근 신호를 확인하는 중이에요.' },
  { icon: '🧠', text: 'AI 9인 위원회가 각자 판단을 정리하고 있어요.' },
  { icon: '🧮', text: '손익 부담과 시나리오 영향을 계산하고 있어요.' },
  { icon: '🎯', text: '즉시 매도 판단과 최종 요약을 준비하고 있어요.' },
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

function splitReadableCommentText(value: string) {
  return value
    .split(/\n+/)
    .flatMap((block) => block
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?。])\s+/u))
    .map((line) => line.trim())
    .filter(Boolean)
}

function getExpandedCommentLines(comment: LoadingPerformanceComment) {
  const expandedBody = comment.fullBody?.trim() || comment.body
  const bodyLines = splitReadableCommentText(expandedBody)

  if (hasDisplayValue(bodyLines)) {
    return bodyLines
  }

  const explicitLines = Array.isArray(comment.lines) ? comment.lines : []
  return explicitLines.flatMap(splitReadableCommentText)
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

function hashSparklineSeed(value: string) {
  return value.split('').reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261)
}

function seededSparklineUnit(seed: number, index: number) {
  let state = (seed + index * 1013904223) >>> 0
  state = (state * 1664525 + 1013904223) >>> 0
  state = (state * 1664525 + 1013904223) >>> 0
  return state / 4294967295
}

function clampSparklineY(value: number) {
  return Math.min(48, Math.max(10, value))
}

function buildConsensusSparkline(seedSource: string, upsidePct: number | undefined) {
  const seed = hashSparklineSeed(seedSource)
  const uplift = typeof upsidePct === 'number' && Number.isFinite(upsidePct)
    ? Math.min(20, Math.max(-14, upsidePct / 40 * 20))
    : 8
  const count = 7
  const currentPoints: string[] = []
  const targetPoints: string[] = []

  for (let index = 0; index < count; index += 1) {
    const x = 6 + index * (88 / (count - 1))
    const wave = Math.sin((index + (seed % 7)) * 0.92) * 4.5
    const currentJitter = (seededSparklineUnit(seed, index) - 0.5) * 7
    const targetJitter = (seededSparklineUnit(seed, index + 31) - 0.5) * 5
    const currentY = clampSparklineY(34 + wave + currentJitter)
    const targetY = clampSparklineY(currentY - 8 - uplift + targetJitter)

    currentPoints.push(`${x.toFixed(1)},${currentY.toFixed(1)}`)
    targetPoints.push(`${x.toFixed(1)},${targetY.toFixed(1)}`)
  }

  return {
    current: currentPoints.join(' '),
    target: targetPoints.join(' '),
  }
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

function buildFindingDefinitions(): FindingDefinition[] {
  return [
    {
      key: 'quality',
      number: '01',
      title: '사업 품질',
      loadingLabel: '사업 품질 위원 응답 대기 중',
    },
    {
      key: 'timing',
      number: '02',
      title: '시장 타이밍',
      loadingLabel: '시장 타이밍 위원 응답 대기 중',
    },
    {
      key: 'position',
      number: '03',
      title: '포지션 적합도',
      loadingLabel: '포지션 적합도 위원 응답 대기 중',
    },
    {
      key: 'decision',
      number: '04',
      title: '즉시 매도·시뮬레이션',
      loadingLabel: '최종 판단 블록 응답 대기 중',
    },
  ]
}

function findingBadgeClass(tone: FindingProgressTone) {
  if (tone === 'done') {
    return styles.badgeDone
  }

  if (tone === 'warning') {
    return styles.badgeWarning
  }

  return styles.badgeActive
}

function quickFactBadgeClass(tone: LoadingQuickFact['tone']) {
  if (tone === 'positive') {
    return styles.badgeDone
  }

  if (tone === 'warning') {
    return styles.badgeWarning
  }

  return styles.badgeActive
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
  quickFacts = [],
  performanceComment,
  evidenceCollected = false,
  resultsReady = false,
  className,
  onBack,
  backHref = '/home',
  onViewResults,
}: DeepScanLoadingScreenProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
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
  const metaMessage = metaMessages[Math.min(metaMessages.length - 1, Math.floor(elapsedSeconds / 5))]
  const findings = buildFindingDefinitions()
  const hasConsensusFact = quickFacts.some((fact) => fact.key === 'analyst-consensus' || Boolean(fact.consensus))
  const showConsensusSkeleton = !resultsReady && !hasConsensusFact
  const showPerformanceCommentSkeleton = !resultsReady && !performanceComment
  const showQuickFactsSection = quickFacts.length > 0 || showConsensusSkeleton || showPerformanceCommentSkeleton || Boolean(performanceComment)
  const performanceCommentPreviewLines = performanceComment ? getCommentLines(performanceComment) : []
  const performanceCommentFullLines = performanceComment ? getExpandedCommentLines(performanceComment) : []
  const showPerformanceCommentDetails = performanceComment
    ? Boolean(performanceComment.fullBody?.trim()) || performanceCommentFullLines.join('\n') !== performanceCommentPreviewLines.join('\n')
    : false

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

  return (
    <div className={cn(styles.loadingCard, className)}>
      <div className={styles.topBar}>
        <BackControl onBack={onBack} backHref={backHref} />
        <div className={styles.topTitle}>딥스캔 결과</div>
        <div className={styles.liveTag} aria-live='polite'>
          <span className={styles.liveDot} aria-hidden='true' />
          {resultsReady ? '분석 완료' : '분석 중'}
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.stockHeader} aria-label='분석 대상 종목'>
          <div className={styles.stockHeaderTop}>
            <div className={styles.stockIdentity}>
              <h1 className={styles.stockName}>{name}</h1>
              <p className={styles.stockCode}>{[targetLine, sharesText ? `보유 ${sharesText}` : null].filter(Boolean).join(' · ') || '분석 대상 확인 중'}</p>
            </div>
            <div className={styles.stockPriceBox}>
              <p className={styles.stockPrice}>{currentPriceText ?? '현재가 확인 중'}</p>
              <p className={cn(styles.stockChange, profitRateText && parseNumericValue(profitRateText) !== null && parseNumericValue(profitRateText)! < 0 ? styles.loss : styles.gain)}>
                {profitRateText ? `손익률 ${profitRateText}` : '손익률 계산 중'}
              </p>
            </div>
          </div>
          <div className={cn(styles.stockMetaGrid, tradingVolumeText && styles.stockMetaGridThree)}>
            <div>
              <span className={styles.metaLabel}>평단가</span>
              <span className={styles.metaValue}>{averagePriceText ?? '확인 중'}</span>
            </div>
            <div>
              <span className={styles.metaLabel}>평가금액</span>
              <span className={styles.metaValue}>{evaluationAmountText ?? '계산 중'}</span>
            </div>
            {tradingVolumeText ? (
              <div>
                <span className={styles.metaLabel}>거래량</span>
                <span className={styles.metaValue}>{tradingVolumeText}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className={styles.loadingStatusCard} aria-label='딥스캔 진행 상태'>
          <div
            className={cn(styles.elapsedTimer, resultsReady ? styles.elapsedTimerDone : undefined)}
            aria-label={resultsReady ? `딥스캔 분석 완료, 소요시간 ${formatElapsedTime(elapsedSeconds)}` : `딥스캔 분석 경과 시간 ${formatElapsedTime(elapsedSeconds)}`}
          >
            <span className={styles.elapsedLabel}>{resultsReady ? '분석 완료' : '분석 경과'}</span>
            {resultsReady ? <span className={styles.elapsedSubLabel}>소요시간</span> : null}
            <span className={styles.elapsedValue}>{formatElapsedTime(elapsedSeconds)}</span>
          </div>
          <div className={styles.metaInfo}>
            <span className={styles.metaIcon} aria-hidden='true'>{metaMessage.icon}</span>
            <span>{metaMessage.text}</span>
          </div>
          <span className={styles.statusAnnouncer} role='status' aria-live='polite' aria-atomic='true'>
            {resultsReady ? '딥스캔 분석 완료. 상세 결과 보기가 준비됐어요.' : ''}
          </span>
        </section>

        {!resultsReady ? (
          <section className={styles.contextCard} aria-label='현재 상황'>
            <div className={styles.contextTop}>
              <Sparkles className={styles.contextIcon} aria-hidden />
              <span>현재 상황</span>
            </div>
            <p>
              {[profitRateText ? `손익률 ${profitRateText}` : null, averagePriceText ? `평단 ${averagePriceText}` : null]
                .filter(Boolean)
                .join(' · ') || '보유 포지션'} 기준으로 회복 가능성, 리스크, 즉시 매도 판단을 순서대로 분석하고 있어요.
            </p>
          </section>
        ) : null}

        {showQuickFactsSection ? (
          <>
            <div className={styles.sectionLabel}>빠른 시장 체크</div>
            <section className={styles.quickFactsCard} aria-label='빠른 시장 체크'>
              {quickFacts.map((fact) => {
                const indicator = fact.indicator
                const consensus = fact.consensus
                const segmentLabel = indicator && fact.detail ? fact.detail.replace(/이에요$|예요$/u, '') : fact.badge
                const markerTopPct = indicator ? 100 - indicator.positionPct : 0
                const calloutTopPct = Math.min(84, Math.max(16, markerTopPct))
                const upsidePct = consensus?.upsidePct
                const opinionScore = consensus?.opinionScore
                const opinionPct = typeof opinionScore === 'number' ? Math.min(100, Math.max(0, opinionScore / 5 * 100)) : 0
                const sparkline = consensus ? buildConsensusSparkline(`${fact.body}:${consensus.targetPriceLabel}`, upsidePct) : undefined

                return (
                  <article key={fact.key} className={cn(styles.quickFact, indicator ? styles.positionQuickFact : undefined, consensus ? styles.consensusQuickFact : undefined)}>
                    <div className={styles.findingTop}>
                      <span className={styles.findingCat}>{fact.category}</span>
                      <span className={cn(styles.findingBadge, indicator || consensus ? styles.positionSegmentBadge : quickFactBadgeClass(fact.tone))}>
                        {consensus?.upsideLabel ?? segmentLabel}
                      </span>
                    </div>
                    {indicator ? (
                      <div
                        className={styles.positionIndicator}
                        aria-label={`${fact.category}: ${indicator.leftLabel}부터 ${indicator.rightLabel} 사이 ${indicator.markerLabel ?? '현재 위치'}`}
                      >
                        <div className={styles.positionScale}>
                          <span className={styles.positionTrack} aria-hidden='true' />
                          <span
                            className={styles.positionMarker}
                            style={{ top: `${markerTopPct}%` }}
                            aria-hidden='true'
                          >
                            <span className={styles.positionMarkerDot} />
                            <span className={styles.positionLeader} />
                          </span>
                        </div>
                        <div className={styles.positionReadout}>
                          <span className={styles.positionHighLabel}>{indicator.rightLabel}</span>
                          <div className={styles.positionCurrentCallout} style={{ top: `${calloutTopPct}%` }}>
                            {indicator.markerLabel ? <strong>{indicator.markerLabel}</strong> : null}
                            {indicator.deltaLabels?.length ? (
                              <span className={styles.positionDeltaLine}>{indicator.deltaLabels.join(' · ')}</span>
                            ) : (
                              <span className={styles.positionDeltaLine}>{fact.body}</span>
                            )}
                          </div>
                          <span className={styles.positionLowLabel}>{indicator.leftLabel}</span>
                        </div>
                      </div>
                    ) : consensus ? (
                      <div className={styles.consensusInsight} aria-label={`${fact.category}: ${fact.body}`}>
                        <div className={styles.consensusChartTop}>
                          <div>
                            <span className={styles.consensusEyebrow}>{consensus.analystCountLabel ?? '증권사 평균'}</span>
                            <strong>{consensus.targetPriceLabel}</strong>
                          </div>
                          <span>목표가 비교</span>
                        </div>
                        <div className={styles.consensusLineChart} aria-hidden='true'>
                          <svg viewBox='0 0 100 56' role='img' focusable='false' preserveAspectRatio='none'>
                            <line className={styles.consensusGridLine} x1='4' y1='14' x2='96' y2='14' />
                            <line className={styles.consensusGridLine} x1='4' y1='34' x2='96' y2='34' />
                            <polyline className={styles.consensusCurrentLine} points={sparkline?.current} />
                            <polyline className={styles.consensusTargetLine} points={sparkline?.target} />
                          </svg>
                          <div className={styles.consensusChartLegend}>
                            <span><i className={styles.consensusCurrentSwatch} />현재가{consensus.currentPriceLabel ? ` ${consensus.currentPriceLabel}` : ''}</span>
                            <span><i className={styles.consensusTargetSwatch} />증권사 목표</span>
                          </div>
                        </div>
                        {consensus.summary ? <p className={styles.consensusSummary}>{consensus.summary}</p> : null}
                        {consensus.highTargetLabel || consensus.lowTargetLabel || consensus.opinionLabel ? (
                          <div className={styles.consensusRangeRow}>
                            {consensus.highTargetLabel ? <span>최고 {consensus.highTargetLabel}</span> : null}
                            {consensus.lowTargetLabel ? <span>최저 {consensus.lowTargetLabel}</span> : null}
                            {consensus.opinionLabel ? <span>투자의견 {consensus.opinionLabel}</span> : null}
                          </div>
                        ) : null}
                        {consensus.opinionLabel ? (
                          <div className={styles.consensusOpinionBlock}>
                            <span>신뢰도</span>
                            <div className={styles.consensusOpinionMeter} aria-hidden='true'>
                              <span style={{ width: `${opinionPct}%` }} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <p className={styles.findingText}>{fact.body}</p>
                        {fact.detail ? <p className={styles.quickFactDetail}>{fact.detail}</p> : null}
                      </>
                    )}
                  </article>
                )
              })}
              {showConsensusSkeleton ? (
                <article className={cn(styles.quickFact, styles.consensusQuickFact, styles.consensusSkeletonFact)} aria-label='목표가 조회 중'>
                  <div className={styles.findingTop}>
                    <span className={styles.findingCat}>목표가</span>
                    <span className={cn(styles.findingBadge, styles.positionSegmentBadge)}>조회 중</span>
                  </div>
                  <div className={styles.consensusInsight} aria-hidden='true'>
                    <div className={styles.consensusChartTop}>
                      <div className={styles.consensusSkeletonHeader}>
                        <span className={cn(styles.consensusSkeletonBlock, styles.consensusSkeletonEyebrow)} />
                        <span className={cn(styles.consensusSkeletonBlock, styles.consensusSkeletonValue)} />
                      </div>
                      <span className={cn(styles.consensusSkeletonBlock, styles.consensusSkeletonBadge)} />
                    </div>
                    <div className={cn(styles.consensusLineChart, styles.consensusSkeletonChart)}>
                      <span className={cn(styles.consensusSkeletonLine, styles.consensusSkeletonCurrentLine)} />
                      <span className={cn(styles.consensusSkeletonLine, styles.consensusSkeletonTargetLine)} />
                      <div className={styles.consensusChartLegend}>
                        <span><i className={styles.consensusCurrentSwatch} />현재가 확인 중</span>
                        <span><i className={styles.consensusTargetSwatch} />목표가 수집 중</span>
                      </div>
                    </div>
                    <span className={cn(styles.consensusSkeletonBlock, styles.consensusSkeletonSummary)} />
                    <div className={styles.consensusRangeRow}>
                      <span className={styles.consensusSkeletonPill}>최고 목표가</span>
                      <span className={styles.consensusSkeletonPill}>최저 목표가</span>
                      <span className={styles.consensusSkeletonPill}>투자의견</span>
                    </div>
                  </div>
                </article>
              ) : null}
              {showPerformanceCommentSkeleton ? (
                <article className={cn(styles.quickFact, styles.commentaryQuickFact, styles.commentarySkeletonFact)} aria-label='기업실적코멘트 조회 중'>
                  <div className={styles.commentaryTop}>
                    <Factory className={styles.commentaryIcon} aria-hidden />
                    <span>기업실적코멘트</span>
                    <span className={styles.commentaryDate}>수집 중</span>
                  </div>
                  <div className={styles.commentarySkeletonBody} aria-hidden='true'>
                    <span className={cn(styles.consensusSkeletonBlock, styles.commentarySkeletonHeadline)} />
                    <div className={styles.commentarySkeletonRows}>
                      <span className={cn(styles.consensusSkeletonBlock, styles.commentarySkeletonRow)} />
                      <span className={cn(styles.consensusSkeletonBlock, styles.commentarySkeletonRowShort)} />
                      <span className={cn(styles.consensusSkeletonBlock, styles.commentarySkeletonRowLong)} />
                    </div>
                    <div className={styles.commentarySkeletonDetail}>
                      <span>자세히 보기 준비 중</span>
                      <i className={cn(styles.consensusSkeletonBlock, styles.commentarySkeletonDetailPill)} />
                    </div>
                  </div>
                </article>
              ) : null}
              {performanceComment ? (
                <article className={cn(styles.quickFact, styles.commentaryQuickFact)} aria-label='기업실적코멘트'>
                  <div className={styles.commentaryTop}>
                    <Factory className={styles.commentaryIcon} aria-hidden />
                    <span>기업실적코멘트</span>
                    {performanceComment.asOf ? <span className={styles.commentaryDate}>기준 {performanceComment.asOf}</span> : null}
                  </div>
                  <ul className={styles.commentaryLines}>
                    {performanceCommentPreviewLines.map((line, index) => (
                      <li key={`${index}-${line}`}>{line}</li>
                    ))}
                  </ul>
                  {showPerformanceCommentDetails ? (
                    <details className={styles.commentaryDetails}>
                      <summary className={styles.commentaryDetailsSummary}>
                        <span>원문 자세히 보기</span>
                        <small>{performanceCommentFullLines.length}개 문장</small>
                      </summary>
                      <div className={styles.commentaryFullText}>
                        <ol className={styles.commentaryFullList}>
                          {performanceCommentFullLines.map((line, index) => (
                            <li key={`${index}-${line}`}>
                              <span className={styles.commentaryFullIndex}>{String(index + 1).padStart(2, '0')}</span>
                              <p>{line}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </details>
                  ) : null}
                </article>
              ) : null}
            </section>
          </>
        ) : null}


        <div className={styles.sectionLabel}>진행 요약</div>
        <section className={styles.findingCard} aria-label='딥스캔 진행 요약'>
          {findings.map((finding) => {
            const progress = findingProgress?.[finding.key]

            return (
              <article key={finding.key} className={cn(styles.finding, progress ? styles.findingAnswered : styles.findingLoading)}>
                {progress ? (
                  <div className={styles.findingContent}>
                    <div className={styles.findingTop}>
                      <span className={styles.findingNum}>{finding.number}</span>
                      <span className={styles.findingCat}>{finding.title}</span>
                      <span className={cn(styles.findingBadge, findingBadgeClass(progress.tone))}>{progress.badge}</span>
                    </div>
                    <p className={styles.findingText}>{progress.body}</p>
                  </div>
                ) : (
                  <div className={styles.skeleton} aria-label={finding.loadingLabel}>
                    <div className={styles.skeletonLabel}>
                      <Loader2 className={styles.skeletonSpinner} aria-hidden />
                      <span className={styles.findingNum}>{finding.number}</span>
                      <span className={styles.findingCat}>{finding.title}</span>
                      <span className={styles.pendingBadge}>응답 대기</span>
                    </div>
                    <div className={cn(styles.skeletonRow, styles.skeletonMid)} />
                    <div className={cn(styles.skeletonRow, styles.skeletonBottom)} />
                    <p className={styles.pendingText}>실제 위원회 응답이 도착하면 이 카드의 한 줄 요약을 채워요.</p>
                  </div>
                )}
              </article>
            )
          })}
        </section>

        <section className={cn(styles.scoreCard, !resultsReady ? styles.scoreCardWaiting : undefined)} aria-label='최종 점수 준비 상태'>
          <div className={styles.scoreLabel}>자루의 확신도</div>
          <div className={styles.scoreValue}>{resultsReady ? '준비 완료' : '계산 중'}</div>
          <div className={styles.scoreBar} aria-hidden='true'>
            <div className={styles.scoreBarFill} />
          </div>
          <p className={styles.scoreDesc}>
            {resultsReady ? '아래 버튼을 누르면 상세 결과 화면으로 이동해요.' : '위원회 의견이 도착하면 점수와 판단을 바로 보여드릴게요.'}
          </p>
        </section>

        <details className={styles.progressDetails}>
          <summary className={styles.progressDetailsSummary}>세부 진행 단계·위원회 상태</summary>
          <div className={styles.stepsWrap} aria-label='분석 단계'>
            {[
              { label: '대상 종목 확인', state: 'done' },
              { label: '근거 데이터 수집', state: evidenceCollected ? 'done' : 'active' },
              { label: 'AI 9인 위원회 응답 대기', state: resultsReady ? 'done' : evidenceCollected ? 'active' : 'wait' },
              { label: '최종 리포트 생성', state: resultsReady ? 'done' : 'wait' },
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

        <button type='button' className={styles.primaryButton} disabled={!resultsReady} onClick={onViewResults}>
          {resultsReady ? '상세 결과 보기' : '상세 결과 준비 중'}
        </button>
        <p className={styles.privacy}>분석 결과는 투자 권유가 아닌 참고 자료입니다.</p>
      </div>
    </div>
  )
}
