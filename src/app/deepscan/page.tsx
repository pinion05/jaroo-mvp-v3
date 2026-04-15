'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JarooShell } from '@/components/jaroo-shell'
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

function getDeepScanIdentifierText(target: {
  identifierTicker?: string
  identifierCode?: string
  identifierLabel?: string
  code?: string
  market?: string
}) {
  const identifiers = [target.identifierTicker, target.identifierCode, target.code].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  )

  return identifiers.length > 0 ? identifiers.join(' · ') : target.identifierLabel ?? target.market ?? '코드 미확인'
}

function scorePillClass(score: number) {
  if (score >= 7) {
    return 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]'
  }

  if (score >= 6) {
    return 'bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-primary)]'
  }

  if (score >= 5) {
    return 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]'
  }

  return 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]'
}

function summaryTagClass(tone: 'positive' | 'danger' | 'neutral' | 'primary' | 'warning') {
  if (tone === 'positive') {
    return newsToneStyles.positive
  }

  if (tone === 'danger') {
    return newsToneStyles.danger
  }

  if (tone === 'neutral') {
    return newsToneStyles.neutral
  }

  return scenarioToneStyles[tone].pill
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
  const viewModel = targetSession.viewModel

  const scrollContentToTop = () => {
    const container = document.querySelector<HTMLElement>("[data-slot='jaroo-shell-main']")
    container?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const identifierText = getDeepScanIdentifierText(viewModel.holding)

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
          <span>{viewModel.holding.name}</span>
          <span className='text-[13px] font-normal text-[color:var(--jaroo-muted)]'>{identifierText}</span>
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
              <span className={cn('text-xs font-medium', viewModel.statusToneClass)}>{viewModel.statusText}</span>
            </div>
            <h1 className='mt-3 text-[28px] font-semibold leading-tight text-[color:var(--jaroo-primary-strong)]'>
              {viewModel.title}
            </h1>
            <p className='mt-3 text-sm leading-7 text-[color:var(--jaroo-ink)]/80'>{viewModel.body}</p>
            <div className='my-4 h-px bg-[color:var(--jaroo-primary)]/15' />
            <div className='flex items-center gap-3'>
              <p className='text-base font-semibold text-[color:var(--jaroo-primary-strong)]'>{viewModel.score} / 10</p>
              <Badge className='rounded-[8px] bg-[#b5d4f4] px-3 py-1 text-[11px] text-[color:var(--jaroo-primary-strong)]'>
                {viewModel.scoreLabel}
              </Badge>
              <span className='ml-auto text-xs text-[color:var(--jaroo-primary)]'>
                지난주 {(viewModel.score - viewModel.scoreDelta).toFixed(1)} → {viewModel.score.toFixed(1)} ↑
              </span>
            </div>
          </Card>

          <SectionToggle
            label='AI 분석 결과'
            isOpen={openSections.why}
            onToggle={() => toggleSection('why')}
            tags={viewModel.axisGroups.map((axis) => (
              <span
                key={axis.label}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium',
                  axisToneStyles[axis.tone].badge,
                )}
              >
                {axis.label} {axis.scoreText}
              </span>
            ))}
          >
            <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] p-4 shadow-none'>
              <div className='grid grid-cols-3 gap-2'>
                {viewModel.axisGroups.map((axis, index) => {
                  const toneStyle = axisToneStyles[axis.tone]
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
                        {axis.status}
                      </span>
                      <div className='mt-3 h-1 rounded-full bg-[color:var(--jaroo-secondary)]'>
                        <div className={cn('h-full rounded-full', toneStyle.bar)} style={{ width: `${axis.score * 10}%` }} />
                      </div>
                      <p className='mt-2 text-[10px] leading-4 text-[color:var(--jaroo-muted)]/80'>{axis.subtitle}</p>
                    </button>
                  )
                })}
              </div>

              <div className='my-4 h-px bg-[color:var(--jaroo-border)]' />

              {(() => {
                const axis = viewModel.axisGroups[selectedAxis] ?? viewModel.axisGroups[0]

                return (
                  <div key={`${axis.label}-detail`}>
                    <div className='mb-3 flex items-center justify-between gap-3'>
                      <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{axis.label} — 3인 위원</p>
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
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                              scorePillClass(member.score),
                            )}
                          >
                            {member.scoreLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </Card>
          </SectionToggle>

          <SectionToggle
            label={viewModel.insightSectionLabel}
            isOpen={openSections.news}
            onToggle={() => toggleSection('news')}
            tags={viewModel.insightSummaryTags.map((tag) => (
              <span
                key={tag.key}
                className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', summaryTagClass(tag.tone))}
              >
                {tag.text}
              </span>
            ))}
          >
            <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] px-4 py-2 shadow-none'>
              {viewModel.insightItems.map((item) => (
                <div
                  key={`${item.source}-${item.title}`}
                  className='border-b border-[color:var(--jaroo-border)] py-4 last:border-b-0'
                >
                  <div className='flex items-start justify-between gap-3'>
                    <p className='text-[11px] text-[color:var(--jaroo-muted)]'>
                      {item.source} · {item.date}
                    </p>
                    <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', newsToneStyles[item.tone])}>
                      {item.label}
                    </span>
                  </div>
                  <p className='mt-2 text-sm font-semibold leading-6 text-[color:var(--jaroo-ink)]'>{item.title}</p>
                  <p className='mt-1 text-xs leading-5 text-[color:var(--jaroo-muted)]'>{item.body}</p>
                </div>
              ))}
            </Card>
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
          <Card className='rounded-[24px] border-0 bg-[color:var(--jaroo-success-ghost)] px-4 py-4 shadow-none'>
            <div className='flex items-center gap-3'>
              <div className='size-2 rounded-full bg-[color:var(--jaroo-success)]' />
              <p className={cn('flex-1 text-sm font-semibold', viewModel.weekSignalTone)}>{viewModel.weekSignal}</p>
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', viewModel.weekBadgeClass)}>{viewModel.weekBadgeText}</span>
            </div>
          </Card>

          <Card className='rounded-[28px] border border-[color:var(--jaroo-border)] p-5 shadow-none'>
            <p className='text-[11px] font-medium tracking-[0.08em] text-[color:var(--jaroo-muted)]'>추천 시나리오</p>
            <div className='mt-4 flex items-end gap-4'>
              <div className='flex-1'>
                <p className='text-4xl font-semibold leading-none text-[color:var(--jaroo-primary)]'>{viewModel.scenarioLabel}</p>
                <p className='mt-2 text-sm text-[color:var(--jaroo-primary)]'>
                  {viewModel.scenarioCondition} · {viewModel.scenarioPeriod}
                </p>
              </div>
              <div className='text-right'>
                <p className='text-4xl font-semibold leading-none text-[color:var(--jaroo-primary)]'>{viewModel.scenarioProbability}</p>
                <p className='mt-2 text-[11px] text-[color:var(--jaroo-muted)]'>가능성</p>
              </div>
            </div>
            <div className='mt-4 h-1.5 rounded-full bg-[color:var(--jaroo-secondary)]'>
              <div className='h-full rounded-full bg-[color:var(--jaroo-primary)]' style={{ width: viewModel.scenarioProbability }} />
            </div>
            <p className='mt-3 text-xs text-[color:var(--jaroo-muted)]'>
              현재 {viewModel.currentPriceText} → 목표 {viewModel.targetPriceText}
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
              <div className='mt-3 space-y-3'>
                {viewModel.scenarioDetails.map((detail, index) => (
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
            ) : null}
          </Card>

          <SectionToggle
            label='다른 시나리오 비교'
            isOpen={openSections.otherScenarios}
            onToggle={() => toggleSection('otherScenarios')}
            tags={viewModel.otherScenarioTags.map((tag) => (
              <span
                key={tag.key}
                className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', summaryTagClass(tag.tone))}
              >
                {tag.text}
              </span>
            ))}
          >
            <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] px-4 py-2 shadow-none'>
              {viewModel.otherScenarios.map((scenario) => (
                <div
                  key={`${scenario.label}-${scenario.period}`}
                  className={cn(
                    'flex items-center gap-3 border-b border-[color:var(--jaroo-border)] py-4 last:border-b-0',
                    scenario.tone === 'primary' && 'bg-[color:var(--jaroo-accent)]/10',
                  )}
                >
                  <span className={cn('rounded-full px-3 py-1.5 text-sm font-semibold', scenarioToneStyles[scenario.tone].pill)}>
                    {scenario.label}
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-semibold text-[color:var(--jaroo-ink)]'>{scenario.period}</p>
                    <p className='mt-1 text-xs text-[color:var(--jaroo-muted)]'>{scenario.condition}</p>
                  </div>
                  <p className={cn('text-sm font-semibold', scenarioToneStyles[scenario.tone].value)}>{scenario.probability}</p>
                </div>
              ))}
            </Card>
          </SectionToggle>

          <SectionToggle
            label='지금 팔면'
            isOpen={openSections.sellNow}
            onToggle={() => toggleSection('sellNow')}
            tags={<span className={cn('text-sm font-semibold', viewModel.statusToneClass)}>{viewModel.realizedText}</span>}
          >
            <Card className='rounded-[24px] border border-[color:var(--jaroo-border)] px-4 py-2 shadow-none'>
              {viewModel.sellRows.map((row) => {
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
          </SectionToggle>

          <SectionToggle
            label='포트폴리오 점수 변화'
            isOpen={openSections.pfSim}
            onToggle={() => toggleSection('pfSim')}
            tags={
              <span className='text-sm font-semibold text-[color:var(--jaroo-success)]'>
                {viewModel.portfolioScoreBefore}점 → {viewModel.portfolioScoreAfter}점 예상
              </span>
            }
          >
            <Card className='rounded-[24px] border-0 bg-[color:var(--jaroo-secondary)] p-5 text-center shadow-none'>
              <p className='text-[11px] text-[color:var(--jaroo-muted)]'>{viewModel.holding.name} 대응 후 재배분 시</p>
              <div className='mt-4 flex items-center justify-center gap-4'>
                <p className='text-4xl font-semibold text-[color:var(--jaroo-muted)]/70'>{viewModel.portfolioScoreBefore}</p>
                <span className='text-xl text-[color:var(--jaroo-muted)]'>→</span>
                <p className='text-4xl font-semibold text-[color:var(--jaroo-success)]'>{viewModel.portfolioScoreAfter}</p>
                <span className='rounded-full bg-[color:var(--jaroo-success-soft)] px-3 py-1 text-xs font-medium text-[color:var(--jaroo-success)]'>
                  +{viewModel.portfolioScoreAfter - viewModel.portfolioScoreBefore}p
                </span>
              </div>
              <p className='mt-3 text-xs leading-5 text-[color:var(--jaroo-muted)]'>실제 인식 종목 기준으로 포트폴리오 균형을 다시 봐요.</p>
            </Card>
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
