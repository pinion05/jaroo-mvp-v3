'use client'

import type { JarooDeepScanCommitteeAxis, JarooDeepScanInsightItem, JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'

import Link from 'next/link'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JarooShell } from '@/components/jaroo-shell'
import { buildDeepScanCanonicalQuery, fetchDeepScanCanonicalPayload, type DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import { buildDeepScanHeroCard, buildDeepScanPageHeader, getDeepScanBlockNotice, type DeepScanPageFetchState } from '@/lib/deepscan-page-projection'
import {
  DEEPSCAN_TARGET_EVENT,
  DEEPSCAN_TARGET_STORAGE_KEY,
  resolveDeepScanTargetServerSnapshot,
  resolveDeepScanTargetSession,
} from '@/lib/jaroo-home-data'
import { cn } from '@/lib/utils'

type TabValue = 'analysis' | 'strategy'
type SectionKey = 'why' | 'news' | 'scenarioDetail' | 'otherScenarios' | 'sellNow' | 'pfSim'

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

function resolveAxisTone(score: number) {
  if (score >= 67) {
    return 'positive' as const
  }

  if (score >= 55) {
    return 'primary' as const
  }

  return 'warning' as const
}

function resolveMemberScoreClass(member: JarooDeepScanCommitteeAxis['members'][number]) {
  if (member.tone === 'positive') {
    return scorePillClass(75)
  }

  if (member.tone === 'neutral') {
    return scorePillClass(52)
  }

  return scorePillClass(35)
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

function subscribeDeepScanTarget(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === DEEPSCAN_TARGET_STORAGE_KEY) {
      callback()
    }
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(DEEPSCAN_TARGET_EVENT, callback)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(DEEPSCAN_TARGET_EVENT, callback)
  }
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
  const targetSession = useSyncExternalStore(
    subscribeDeepScanTarget,
    resolveDeepScanTargetSession,
    resolveDeepScanTargetServerSnapshot,
  )
  const [payloadState, setPayloadState] = useState<{
    requestKey: string
    payload: JarooDeepScanPayload | null
    error: boolean
  }>({
    requestKey: '',
    payload: null,
    error: false,
  })
  const requestSeed = useMemo<DeepScanCanonicalTargetSession>(
    () => ({
      holding: {
        name: targetSession.holding.name,
        code: targetSession.holding.code,
        identifierCode: targetSession.holding.identifierCode,
        ticker: targetSession.holding.identifierTicker,
        identifierTicker: targetSession.holding.identifierTicker,
        shares: targetSession.holding.shares,
        averagePrice: targetSession.holding.averagePrice,
        evaluationAmount: targetSession.holding.evaluationAmount,
        market: targetSession.holding.market,
        marketTone: targetSession.holding.marketTone,
      },
      selectedAt: targetSession.selectedAt,
    }),
    [
      targetSession.holding.name,
      targetSession.holding.code,
      targetSession.holding.identifierCode,
      targetSession.holding.identifierTicker,
      targetSession.holding.shares,
      targetSession.holding.averagePrice,
      targetSession.holding.evaluationAmount,
      targetSession.holding.market,
      targetSession.holding.marketTone,
      targetSession.selectedAt,
    ],
  )
  const requestKey = useMemo(() => buildDeepScanCanonicalQuery(requestSeed).toString(), [requestSeed])

  useEffect(() => {
    let cancelled = false

    void fetchDeepScanCanonicalPayload(requestSeed)
      .then((nextPayload) => {
        if (cancelled) {
          return
        }

        setPayloadState({
          requestKey,
          payload: nextPayload,
          error: !nextPayload,
        })
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        setPayloadState({
          requestKey,
          payload: null,
          error: true,
        })
      })

    return () => {
      cancelled = true
    }
  }, [requestKey, requestSeed])

  const payload = payloadState.requestKey === requestKey && !payloadState.error ? payloadState.payload : null
  const fetchState: DeepScanPageFetchState = payloadState.requestKey !== requestKey
    ? 'loading'
    : payloadState.error
      ? 'error'
      : payload
        ? 'success'
        : 'idle'

  const scrollContentToTop = () => {
    const container = document.querySelector<HTMLElement>("[data-slot='jaroo-shell-main']")
    container?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const pageHeader = buildDeepScanPageHeader(requestSeed, payload)
  const heroCard = buildDeepScanHeroCard(requestSeed, fetchState, payload)
  const weekTone = resolveWeekToneClasses(payload?.strategy.weekSignalTone ?? 'neutral')
  const analysisLoadingNotice = {
    badge: 'Loading',
    title: 'AI 분석 결과를 불러오는 중',
    body: '선택한 종목의 canonical committee/insights payload를 요청하고 있어요.',
  }
  const strategyLoadingNotice = {
    badge: 'Loading',
    title: '전략 데이터를 불러오는 중',
    body: '선택한 종목의 canonical strategy/sell-now payload를 요청하고 있어요.',
  }
  const requestErrorNotice = {
    badge: 'Error',
    title: 'DeepScan 데이터를 표시할 수 없어요',
    body: 'canonical payload 요청에 실패했습니다. 잠시 후 다시 시도해주세요.',
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
        <TabsList
          variant='line'
          className='sticky top-0 z-10 -mx-4 flex h-auto w-[calc(100%+2rem)] gap-0 rounded-none border-b border-[color:var(--jaroo-border)] bg-white px-4'
        >
          <TabsTrigger
            value='analysis'
            className='h-auto rounded-none border-0 px-0 py-3.5 text-sm font-medium text-[color:var(--jaroo-muted)] data-active:text-[color:var(--jaroo-primary)] after:bottom-[-1px] after:h-[2.5px] after:bg-[color:var(--jaroo-primary)]'
          >
            분석
          </TabsTrigger>
          <TabsTrigger
            value='strategy'
            className='h-auto rounded-none border-0 px-0 py-3.5 text-sm font-medium text-[color:var(--jaroo-muted)] data-active:text-[color:var(--jaroo-primary)] after:bottom-[-1px] after:h-[2.5px] after:bg-[color:var(--jaroo-primary)]'
          >
            전략
          </TabsTrigger>
        </TabsList>

        <TabsContent value='analysis' className='mt-0 space-y-4 py-4'>
          <Card className='rounded-[24px] border-0 bg-[color:var(--jaroo-accent)] p-5 shadow-none'>
            <div className='flex items-center justify-between gap-3'>
              <p className='text-[11px] font-medium tracking-[0.05em] text-[color:var(--jaroo-primary)]'>
                AI 9인 위원회 종합 분석
              </p>
              <span className={cn('text-xs font-medium', heroCard.statusToneClass)}>{heroCard.statusText}</span>
            </div>
            <h1 className='mt-3 text-[28px] font-semibold leading-tight text-[color:var(--jaroo-primary-strong)]'>
              {heroCard.headline}
            </h1>
            <p className='mt-3 text-sm leading-7 text-[color:var(--jaroo-ink)]/80'>{heroCard.body}</p>
            <div className='my-4 h-px bg-[color:var(--jaroo-primary)]/15' />
            <div className='flex items-center gap-3'>
              <p className='text-base font-semibold text-[color:var(--jaroo-primary-strong)]'>{heroCard.score}</p>
              <Badge className='rounded-[8px] bg-[#b5d4f4] px-3 py-1 text-[11px] text-[color:var(--jaroo-primary-strong)]'>
                {heroCard.scoreLabel}
              </Badge>
              <span className='ml-auto text-xs text-[color:var(--jaroo-primary)]'>{heroCard.scoreDelta}</span>
            </div>
          </Card>

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
                    badge: 'Blocked',
                    title: '위원회 분석을 표시할 수 없어요',
                    body: 'canonical committee block이 아직 준비되지 않았어요.',
                  }).badge}
                </span>
              ) : (
                payload.committee.axes.map((axis) => {
                  const tone = resolveAxisTone(axis.score)

                  return (
                    <span
                      key={axis.label}
                      className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', axisToneStyles[tone].badge)}
                    >
                      {axis.label} {axis.scoreText}
                    </span>
                  )
                })
              )
            }
          >
            {fetchState !== 'success' || !payload ? (
              <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : analysisLoadingNotice} />
            ) : payload.committee.blockState !== 'ok' ? (
              <SectionStatusCard notice={getDeepScanBlockNotice(payload.committee, {
                badge: 'Blocked',
                title: '위원회 분석을 표시할 수 없어요',
                body: 'canonical committee block이 아직 준비되지 않았어요.',
              })} />
            ) : payload.committee.axes.length === 0 ? (
              <SectionStatusCard notice={{
                badge: 'Empty',
                title: '위원회 축 데이터가 비어 있어요',
                body: 'crawler가 canonical committee axes를 비어 있는 상태로 반환했습니다.',
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
                          <div className={cn('h-full rounded-full', toneStyle.bar)} style={{ width: `${Math.max(0, Math.min(axis.score, 100))}%` }} />
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
                        {axis.members.map((member) => (
                          <div
                            key={`${axis.label}-${member.title}`}
                            className='flex items-center gap-3 border-b border-[color:var(--jaroo-border)]/80 py-3 first:pt-0 last:border-b-0 last:pb-0'
                          >
                            <div
                              className={cn(
                                'flex size-10 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                                memberIconStyles[member.iconTone],
                              )}
                            >
                              {member.shortLabel}
                            </div>
                            <div className='min-w-0 flex-1'>
                              <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{member.title}</p>
                              <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{member.reason}</p>
                            </div>
                            <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium', resolveMemberScoreClass(member))}>
                              {member.scoreLabel}
                            </span>
                          </div>
                        ))}
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
                    badge: 'Blocked',
                    title: '인사이트를 표시할 수 없어요',
                    body: 'canonical insights block이 아직 준비되지 않았어요.',
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
                badge: 'Blocked',
                title: '인사이트를 표시할 수 없어요',
                body: 'canonical insights block이 아직 준비되지 않았어요.',
              })} />
            ) : payload.insights.items.length === 0 ? (
              <SectionStatusCard notice={{
                badge: 'Empty',
                title: '인사이트 항목이 없어요',
                body: 'crawler가 canonical insights items를 비어 있는 상태로 반환했습니다.',
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
                    <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{item.body}</p>
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
          {fetchState !== 'success' || !payload ? (
            <SectionStatusCard notice={fetchState === 'error' ? requestErrorNotice : strategyLoadingNotice} />
          ) : payload.strategy.blockState !== 'ok' ? (
            <SectionStatusCard notice={getDeepScanBlockNotice(payload.strategy, {
              badge: 'Blocked',
              title: '전략 블록을 표시할 수 없어요',
              body: 'canonical strategy block이 아직 준비되지 않았어요.',
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
                    badge: 'Blocked',
                    title: '다른 시나리오를 표시할 수 없어요',
                    body: 'canonical strategy block이 아직 준비되지 않았어요.',
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
                badge: 'Blocked',
                title: '다른 시나리오를 표시할 수 없어요',
                body: 'canonical strategy block이 아직 준비되지 않았어요.',
              })} />
            ) : payload.strategy.otherScenarios.length === 0 ? (
              <SectionStatusCard notice={{
                badge: 'Empty',
                title: '비교 시나리오가 없어요',
                body: 'crawler가 canonical otherScenarios를 비어 있는 상태로 반환했습니다.',
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
                    badge: 'Blocked',
                    title: 'sell-now를 표시할 수 없어요',
                    body: 'canonical sell-now block이 아직 준비되지 않았어요.',
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
                badge: 'Blocked',
                title: 'sell-now를 표시할 수 없어요',
                body: 'canonical sell-now block이 아직 준비되지 않았어요.',
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
                    badge: 'Blocked',
                    title: '포트폴리오 시뮬레이션을 표시할 수 없어요',
                    body: 'canonical portfolioSimulation block이 아직 준비되지 않았어요.',
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
                badge: 'Blocked',
                title: '포트폴리오 시뮬레이션을 표시할 수 없어요',
                body: 'canonical portfolioSimulation block이 아직 준비되지 않았어요.',
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
