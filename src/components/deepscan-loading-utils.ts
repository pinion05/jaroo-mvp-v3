import type { JarooDeepScanCommitteeAxis } from '../../packages/contracts/src/deepscan'

import {
  isFiniteNumber,
  type LoadingBriefingDailyRow,
  type MoneyCurrency,
} from '@/lib/deepscan-briefing-snapshot'
import { isHiddenDeepScanLoadingQuickFact } from '@/lib/deepscan-loading-behavior'
import { getFinancialValueTone, type FinancialValue } from '@/lib/financial-value-tone'
import styles from './deepscan-loading-screen.module.css'
import type {
  CommitteeMemberState,
  CommitteeTeamDefinition,
  CommitteeTeamMemberDefinition,
  CompletionState,
  DeepScanLoadingScreenProps,
  FindingKey,
  FindingProgress,
  LoadingPerformanceComment,
  LoadingQuickFact,
  LoadingStageKey,
  NarrativeCard,
  NarrativeTone,
  TeamSummaryState,
} from './deepscan-loading-types'
import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_LINE_MAX_LENGTH,
  COMPLETION_SOON_REVEAL_SECONDS,
  committeeTeams,
  DEEPSCAN_AUTO_SCROLL_BOTTOM_GAP_PX,
  DEEPSCAN_MOBILE_AUTO_SCROLL_QUERY,
  TEAM_BRIDGE_DONE_SECONDS,
  TEAM_BRIDGE_REVEAL_SECONDS,
  TEAM_BRIDGE_STATUS_MESSAGES,
  TEAM_PRESENTATION_ORDER,
  TEAM_REVEAL_SECONDS,
  TODAY_BRIEFING_ITEM_SELECTOR,
} from './deepscan-loading-types'

export function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function parseNumericValue(value: string | number | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
}

export function formatQuantityNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(value)
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatSignedPercent(value: string | number | undefined) {
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

export function formatMoney(value: string | number | undefined, currency: MoneyCurrency = 'KRW') {
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

export function formatSignedMoney(value: number | null, currency: MoneyCurrency = 'KRW') {
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

export function calculateProfitRate({
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

export function calculateProfitAmount({
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

export function normalizeMoneyValueToCurrency(
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

export function hasDisplayValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasDisplayValue)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(hasDisplayValue)
  }

  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

export function hashSummaryInput(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }

  return `${value.length}:${Math.abs(hash)}`
}

export function normalizeSummaryText(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    : null
}

export function compactCommentLine(value: string, maxLength = COMMENT_LINE_MAX_LENGTH) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

export function getCommentLines(comment: LoadingPerformanceComment) {
  const explicitLines = Array.isArray(comment.lines) ? comment.lines : []
  const sourceLines = hasDisplayValue(explicitLines) ? explicitLines : comment.body.split(/\n+/)
  const lines = sourceLines.map((line) => compactCommentLine(line)).filter(Boolean).slice(0, 3)

  if (hasDisplayValue(lines)) {
    return lines
  }

  return [compactCommentLine(comment.body, COMMENT_BODY_MAX_LENGTH)].filter(Boolean)
}

export function formatShares(value: string | number | undefined) {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    return /주|좌|개$/.test(trimmed) ? trimmed : `${trimmed}주`
  }

  const numericValue = parseNumericValue(value)
  return numericValue === null ? null : `${formatQuantityNumber(numericValue)}주`
}

export function formatTradingVolume(value: string | number | undefined) {
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

export function memberStateClass(state: CommitteeMemberState) {
  if (state === 'done') {
    return styles.memberDone
  }

  if (state === 'active') {
    return styles.memberActive
  }

  return styles.memberWait
}

export function narrativeToneClass(tone: NarrativeTone) {
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

export function quickFactToneToNarrativeTone(tone: LoadingQuickFact['tone']): NarrativeTone {
  if (tone === 'positive') {
    return 'positive'
  }

  if (tone === 'warning') {
    return 'warning'
  }

  return 'info'
}

export function getQuickFactByKey(facts: LoadingQuickFact[], key: string) {
  return facts.find((fact) => fact.key === key)
}

export function isExchangeTradedProductMarket(value: string | undefined) {
  return /(?:^|\b)(?:ETF|ETN)(?:\b|$)/iu.test(value ?? '')
}

export function isExchangeTradedProduct(market: string | undefined, instrumentKind: string | undefined) {
  return isExchangeTradedProductMarket(market) || /^(?:etf|etn)$/iu.test(instrumentKind ?? '')
}

export function flattenCommitteeMembers(committeeAxes: JarooDeepScanCommitteeAxis[] | undefined) {
  return (committeeAxes ?? []).flatMap((axis) => axis.members)
}

export function findCommitteeMemberBySourceTitle(
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

export function buildCommitteeTeamBody(
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

export function buildCompletionState(resultsReady: boolean, elapsedSeconds: number): CompletionState {
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

export function isHiddenLoadingQuickFact(fact: LoadingQuickFact) {
  return isHiddenDeepScanLoadingQuickFact({ key: fact.key, hasIndicator: Boolean(fact.indicator) })
}

export function buildLoadingStages({
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

export function buildPlaceholderNarrativeCard(index: number, teamKey?: LoadingStageKey): NarrativeCard {
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

export function buildOrderedNarrativeCards(cards: NarrativeCard[], arrivedStageKeys: LoadingStageKey[]): NarrativeCard[] {
  const cardsByKey = new Map<LoadingStageKey, NarrativeCard>(
    cards.flatMap((card) => (card.teamKey ? [[card.teamKey, card] as const] : [])),
  )
  const arrivedKeySet = new Set(arrivedStageKeys)

  return TEAM_PRESENTATION_ORDER.map((stageKey, index) => (
    arrivedKeySet.has(stageKey) ? cardsByKey.get(stageKey) ?? buildPlaceholderNarrativeCard(index, stageKey) : buildPlaceholderNarrativeCard(index, stageKey)
  ))
}

export function buildVisibleNarrativeCards(cards: NarrativeCard[], visibleStageCount: number): NarrativeCard[] {
  return cards.slice(0, Math.min(Math.max(visibleStageCount, 1), cards.length))
}

export function buildTimelineNarrativeCards(cards: NarrativeCard[], elapsedSeconds: number, resultsReady: boolean): NarrativeCard[] {
  const revealCount = resultsReady
    ? cards.length
    : TEAM_PRESENTATION_ORDER.filter((stageKey) => elapsedSeconds >= TEAM_REVEAL_SECONDS[stageKey]).length

  if (revealCount <= 0) {
    return []
  }

  return buildVisibleNarrativeCards(cards, revealCount)
}

export function getTeamSummaryState(card: NarrativeCard, teamSummaries: Partial<Record<LoadingStageKey, TeamSummaryState>>) {
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

export function buildNarrativeFallbackSummary(card: NarrativeCard, summaryFailed: boolean) {
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

export function hasNarrativeLoadingSkeleton(card: NarrativeCard, teamSummaries: Partial<Record<LoadingStageKey, TeamSummaryState>>) {
  if (card.placeholder) {
    return true
  }

  const { summaryText, summaryFailed } = getTeamSummaryState(card, teamSummaries)
  const fallbackSummary = buildNarrativeFallbackSummary(card, Boolean(summaryFailed))

  return !summaryText && !fallbackSummary
}

export function buildSequentialNarrativeCards(cards: NarrativeCard[], teamSummaries: Partial<Record<LoadingStageKey, TeamSummaryState>>) {
  const sequentialCards: NarrativeCard[] = []

  for (const card of cards) {
    sequentialCards.push(card)

    if (hasNarrativeLoadingSkeleton(card, teamSummaries)) {
      break
    }
  }

  return sequentialCards
}

export function buildTeamBridgeState(elapsedSeconds: number, resultsReady: boolean) {
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

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function formatAsOfTime(value: string | null | undefined) {
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

export function formatPercentValue(value: number | null | undefined) {
  if (!isFiniteNumber(value)) {
    return null
  }

  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(value))}%`
}

export function financialToneClass(value: FinancialValue) {
  const tone = getFinancialValueTone(value)
  return tone === 'profit' ? styles.gain : tone === 'loss' ? styles.loss : styles.financialNeutral
}

export function pctToneClass(value: number | null | undefined) {
  return financialToneClass(value)
}

export function buildChartGeometry(rows: LoadingBriefingDailyRow[], averagePriceValue: number | null) {
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
export function buildOneMonthMeaning(value: number | null) {
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

export function buildTodayFlow({ current, open, high, low }: { current: number | null; open: number | null; high: number | null; low: number | null }) {
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

export function shouldAutoScrollDeepScanOnMobile() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DEEPSCAN_MOBILE_AUTO_SCROLL_QUERY).matches
}

export function prefersReducedAutoScrollMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function getScrollableDeepScanContainer(item: HTMLElement) {
  const loadingCard = item.closest<HTMLElement>(`.${styles.loadingCard}`)
  if (!loadingCard || loadingCard.scrollHeight <= loadingCard.clientHeight + 1) {
    return null
  }

  return loadingCard
}

export function scrollDeepScanElementBottomIntoView(item: HTMLElement) {
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

export function startDeepScanMobileAutoScroll(targetElement: HTMLElement | null) {
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

export function startTodayBriefingMobileAutoScroll(listElement: HTMLDivElement | null, visibleItemCount: number) {
  if (!listElement || visibleItemCount <= 0 || !shouldAutoScrollDeepScanOnMobile()) {
    return undefined
  }

  const targetItem = listElement.querySelectorAll<HTMLElement>(TODAY_BRIEFING_ITEM_SELECTOR).item(visibleItemCount - 1)
  return startDeepScanMobileAutoScroll(targetItem)
}
