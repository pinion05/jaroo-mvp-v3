'use client'

import type { JarooDeepScanCommitteeAxis, JarooDeepScanInsightItem, JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { DeepScanLoadingScreen, type FindingProgress, type LoadingPerformanceComment, type LoadingQuickFact } from '@/components/deepscan-loading-screen'
import { JarooShell } from '@/components/jaroo-shell'
import { fetchDeepScanCanonicalPayload, type DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import {
  buildDeepScanHeroCard,
  buildDeepScanPageHeader,
  buildDeepScanPartialSuccessNotice,
  getDeepScanBlockNotice,
  resolveDeepScanPageCacheState,
} from '@/lib/deepscan-page-projection'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { getDeepScanTargetKey, type WorkflowMoneyCurrency } from '@/lib/workflow-types'
import { cn } from '@/lib/utils'

type TabValue = 'analysis' | 'strategy'
type SectionKey = 'why' | 'news' | 'scenarioDetail' | 'otherScenarios' | 'sellNow' | 'pfSim'
type HomeMarketTone = DeepScanCanonicalTargetSession['holding']['marketTone']

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

function buildConsensusLoadingQuickFact(payload: JarooDeepScanPayload | null): LoadingQuickFact | null {
  const consensus = payload?.insights.items.find((item) => item.sourceLabel === '증권사 의견' || item.label === '컨센서스')
  if (!consensus?.body?.trim()) {
    return null
  }

  const parsedConsensus = parseLoadingConsensusBody(consensus.body)
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

function buildLoadingQuickFacts(payload: JarooDeepScanPayload | null, quickQuote: LoadingQuickQuote | null): LoadingQuickFact[] {
  return [
    buildWeek52LoadingQuickFact(quickQuote),
    buildConsensusLoadingQuickFact(payload),
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
    <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
      <span className='inline-flex rounded-full bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
        {notice.badge}
      </span>
      <p className='mt-3 text-sm font-semibold text-[color:var(--jaroo-ink)]'>{notice.title}</p>
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
    <div className='space-y-2'>
      <button
        type='button'
        onClick={onToggle}
        className='flex w-full items-center justify-between rounded-[24px] border border-[color:var(--jaroo-border)] bg-white px-4 py-4 text-left transition active:scale-[0.99]'
      >
        <div className='min-w-0'>
          <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{label}</p>
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
    why: false,
    news: false,
    scenarioDetail: false,
    otherScenarios: false,
    sellNow: false,
    pfSim: false,
  })
  const [confirmedResultsTargetKey, setConfirmedResultsTargetKey] = useState<string | null>(null)
  const target = useDeepScanStore((state) => state.target)
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

  const targetKey = useMemo(() => (target ? getDeepScanTargetKey(target) : null), [target])
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
              evaluationAmount: typeof target.evaluationAmount === 'number' ? String(target.evaluationAmount) : undefined,
              market: target.market ?? target.marketTone?.toUpperCase() ?? '미확인',
              marketTone: (target.marketTone ?? (target.kind === 'etf' ? 'etf' : 'kospi')) as HomeMarketTone,
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
  }, [target, targetKey])

  useEffect(() => {
    if (!requestSeed || requestStatus !== 'loading') {
      return
    }

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
  }, [abandonInFlight, finishError, finishSuccess, requestSeed, requestStatus])

  useEffect(() => {
    const llmCommittee = payload?.metadata.llmCommittee
    if (fetchState !== 'success' || !payload || llmCommittee?.status !== 'partial' || !llmCommittee.requestId) {
      return
    }

    let stopped = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const response = await fetch(`/api/deepscan/committee-status?requestId=${encodeURIComponent(llmCommittee.requestId)}`, { cache: 'no-store' })
        const body = (await response.json()) as DeepScanCommitteeStatusResponse

        if (stopped || !body.ok || body.requestId !== llmCommittee.requestId) {
          return
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
  }, [fetchState, payload, updateActivePayload])

  const scrollContentToTop = () => {
    const container = document.querySelector<HTMLElement>("[data-slot='jaroo-shell-main']")
    container?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleRetry = useCallback(() => {
    setConfirmedResultsTargetKey(null)
    startRequest()
    scrollContentToTop()
  }, [startRequest])

  const handleViewResults = useCallback(() => {
    setConfirmedResultsTargetKey(targetKey)
    scrollContentToTop()
  }, [targetKey])

  const missingTargetTitle = '분석할 종목이 없습니다'

  if (!requestSeed) {
    return (
      <JarooShell
        title='DeepScan'
        backHref='/home'
        showBottomNav={false}
        mainClassName='px-4 pt-4 pb-6'
      >
        <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-5 shadow-none'>
          <span className='inline-flex rounded-full bg-[color:var(--jaroo-warning-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--jaroo-warning)]'>
            비어 있음
          </span>
          <h1 className='mt-3 text-xl font-semibold text-[color:var(--jaroo-ink)]'>{missingTargetTitle}</h1>
          <p className='mt-2 text-sm leading-6 text-[color:var(--jaroo-muted)]'>
            홈에서 분석할 종목을 선택한 뒤 다시 들어와 주세요.
          </p>
          <div className='mt-5'>
            <Link
              href='/home'
              className={buttonVariants({
                className: 'h-12 w-full rounded-[22px] bg-[color:var(--jaroo-primary)] text-white hover:bg-[color:var(--jaroo-primary-strong)]',
              })}
            >
              /home 으로 가기
            </Link>
          </div>
        </Card>
      </JarooShell>
    )
  }

  const pageHeader = buildDeepScanPageHeader(requestSeed, payload)
  const heroCard = buildDeepScanHeroCard(requestSeed, fetchState, payload)
  const partialSuccessNotice = buildDeepScanPartialSuccessNotice(payload)
  const weekTone = resolveWeekToneClasses(payload?.strategy.weekSignalTone ?? 'neutral')
  const isCommitteeHydrating = fetchState === 'success' && payload?.metadata.llmCommittee?.status === 'partial'
  const resultsReady = fetchState === 'success' && Boolean(payload) && !isCommitteeHydrating
  const hasConfirmedResultsView = targetKey !== null && confirmedResultsTargetKey === targetKey
  const loadingFindingProgress = buildLoadingFindingProgress(payload)
  const loadingPerformanceComment = buildLoadingPerformanceComment(payload)
  const activeLoadingQuickQuote = loadingQuickQuote?.targetKey === targetKey ? loadingQuickQuote : null
  const loadingTradingVolume = activeLoadingQuickQuote?.tradingVolume ?? buildLoadingTradingVolume(payload)
  const loadingCurrentPrice = target?.currentPrice ?? activeLoadingQuickQuote?.currentPrice
  const loadingCurrentPriceCurrency = target?.currentPriceCurrency ?? activeLoadingQuickQuote?.currentPriceCurrency
  const loadingQuickFacts = buildLoadingQuickFacts(payload, activeLoadingQuickQuote)
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

  if (fetchState === 'loading' || isCommitteeHydrating || (resultsReady && !hasConfirmedResultsView)) {
    const identifier = [requestSeed.holding.ticker, requestSeed.holding.code]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
      .join(' · ')

    return (
      <div className='flex min-h-screen justify-center bg-[color:var(--jaroo-canvas)] px-3 py-4 sm:px-6'>
        <DeepScanLoadingScreen
          className='max-w-[390px] overflow-hidden rounded-[32px] border border-white/70 shadow-[0_20px_60px_rgba(12,68,124,0.18)]'
          name={requestSeed.holding.name}
          identifier={identifier}
          market={requestSeed.holding.market}
          shares={target?.quantity}
          averagePrice={target?.averagePrice}
          averagePriceCurrency={target?.averagePriceCurrency}
          currentPrice={loadingCurrentPrice}
          currentPriceCurrency={loadingCurrentPriceCurrency}
          tradingVolume={loadingTradingVolume}
          currentProfitRate={target?.currentProfitRate}
          evaluationAmount={target?.evaluationAmount}
          findingProgress={loadingFindingProgress}
          quickFacts={loadingQuickFacts}
          performanceComment={loadingPerformanceComment}
          evidenceCollected={evidenceCollected}
          resultsReady={resultsReady}
          onViewResults={handleViewResults}
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
      mainClassName='px-4 pt-0 pb-0'
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
        <div className='sticky top-0 z-10 -mx-4 border-b border-[color:var(--jaroo-border)] bg-white px-4 py-2'>
          <TabsList className='grid h-11 w-full grid-cols-2 gap-1 rounded-[20px] bg-[color:var(--jaroo-secondary)] p-1'>
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
          <Card className='rounded-[24px] border-0 bg-[color:var(--jaroo-accent)] p-5 shadow-none'>
            <div className='flex items-center justify-between gap-3'>
              <p className='text-[11px] font-medium tracking-[0.05em] text-[color:var(--jaroo-primary)]'>
                AI 9인 위원회 종합 분석
              </p>
              <div className='flex items-center gap-2'>
                <span className={cn('text-xs font-medium', heroCard.statusToneClass)}>{heroCard.statusText}</span>
                <button
                  type='button'
                  onClick={handleRetry}
                  className={buttonVariants({
                    variant: 'outline',
                    className:
                      'h-8 rounded-[10px] border-[color:var(--jaroo-primary)]/20 bg-white/80 px-3 text-[11px] font-medium text-[color:var(--jaroo-primary)] hover:bg-white disabled:pointer-events-none disabled:opacity-60',
                  })}
                >
                  {fetchState === 'error' ? '다시 시도' : '재분석'}
                </button>
              </div>
            </div>
            <h1 className='mt-3 text-[28px] font-semibold leading-tight text-[color:var(--jaroo-primary-strong)]'>
              {heroCard.headline}
            </h1>
            <p className='mt-3 text-sm leading-7 text-[color:var(--jaroo-ink)]/80'>{heroCard.body}</p>
            <div className='my-4 h-px bg-[color:var(--jaroo-primary)]/15' />
            <div className='flex items-center gap-3'>
              <p className='text-base font-semibold text-[color:var(--jaroo-primary-strong)]'>{heroCard.scoreLabel === 'N/A' ? 'N/A' : heroCard.score}</p>
              <Badge className='rounded-[8px] bg-[#b5d4f4] px-3 py-1 text-[11px] text-[color:var(--jaroo-primary-strong)]'>
                {heroCard.scoreLabel}
              </Badge>
              <span className='ml-auto text-xs text-[color:var(--jaroo-primary)]'>{heroCard.scoreDelta}</span>
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
            label='AI 분석 결과'
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
                    title: '위원회 분석을 표시할 수 없어요',
                    body: '위원회 분석 블록이 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                <div className='grid w-full grid-cols-3 gap-1.5'>
                  {payload.committee.axes.map((axis) => {
                    const tone = resolveAxisTone(axis.score)
                    const scoreLabel = axis.score === null ? 'N/A' : String(axis.score)

                    return (
                      <span
                        key={axis.label}
                        className={cn(
                          'min-w-0 truncate rounded-full px-2 py-1 text-center text-[10px] font-medium leading-4',
                          axisToneStyles[tone].badge,
                        )}
                        title={`${axis.label} ${axis.scoreText}`}
                      >
                        {axis.label} {scoreLabel}
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
                title: '위원회 분석을 표시할 수 없어요',
                body: '위원회 분석 블록이 아직 준비되지 않았어요.',
              })} />
            ) : payload.committee.axes.length === 0 ? (
              <SectionStatusCard notice={{
                badge: '비어 있음',
                title: '위원회 축 데이터가 비어 있어요',
                body: '크롤러가 위원회 축 데이터를 비어 있는 상태로 반환했습니다.',
              }} />
            ) : (
              <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
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
                        <p className={cn('mt-2 text-2xl font-semibold', toneStyle.score)}>{axis.scoreText}</p>
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

                {(() => {
                  const axis = payload.committee.axes[selectedAxis] ?? payload.committee.axes[0]

                  if (!axis) {
                    return null
                  }

                  return (
                    <div key={`${axis.label}-detail`}>
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
                                      {member.reason ?? '이 위원은 추가 LLM 응답을 기다리는 중입니다.'}
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
                                {member.scoreLabel}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
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
              <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] px-4 py-2 shadow-none'>
                {payload.insights.items.map((item) => (
                  <div
                    key={`${item.sourceLabel}-${item.title}`}
                    className='border-b border-[color:var(--jaroo-border)] py-4 last:border-b-0'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <p className='text-[11px] text-[color:var(--jaroo-muted)]'>
                        {item.sourceLabel} · {item.date}
                      </p>
                      <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', newsToneStyles[resolveInsightTone(item)])}>
                        {item.label}
                      </span>
                    </div>
                    <p className='mt-2 text-sm font-semibold leading-6 text-[color:var(--jaroo-ink)]'>{item.title}</p>
                    <p className='mt-1 whitespace-pre-line text-xs leading-5 text-[color:var(--jaroo-muted)]'>{item.body}</p>
                  </div>
                ))}
              </Card>
            )}
          </SectionToggle>

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
              <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] px-4 py-2 shadow-none'>
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
              <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] px-4 py-2 shadow-none'>
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
            label='포트폴리오 점수 변화'
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
