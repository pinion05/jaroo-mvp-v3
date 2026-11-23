'use client'

/**
 * AI 트레이더 쇼케이스 — 초안③ 증거 체인 타임라인형
 *
 * 컨셉: 시간 역순 통합 활동 피드. "모든 매매는 deepscan 리포트에서 나온다"는
 * 신뢰 입증이 주인공. 리포트 발행(파랑) → 판단(캐릭터색) → 체결(녹색/빨강)의
 * 사가를 세로 커넥터로 한 눈에 연결해 "이 매매가 왜 나왔는지" 추적 가능하게 만든다.
 * 모든 데이터는 시연용 목업이며 외부 API 호출은 없다.
 */
import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Minus,
  Plane,
  ReceiptText,
  ShieldCheck,
  Target,
  TriangleAlert,
  Wallet,
} from 'lucide-react'

import { JarooShell } from '@/components/jaroo-shell'
import { cn } from '@/lib/utils'

import {
  ACCOUNT_SUMMARIES,
  AI_TRADERS,
  REPORT_SAGAS,
  TRADER_BY_ID,
  buildSagaStats,
  type CharacterId,
  type ExecutionRecord,
  type JudgmentEntry,
  type JudgmentLog,
  type ReportSaga,
} from './mock-data'

const TODAY_KEY = '2026-11-16'

const PERIOD_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: 'today', label: '오늘 11-16' },
  { key: 'past', label: '지난 기록' },
] as const
type PeriodFilter = (typeof PERIOD_OPTIONS)[number]['key']

type CharacterFilter = 'all' | CharacterId

/* ------------------------------------------------------------------ */
/* 포맷 헬퍼                                                            */
/* ------------------------------------------------------------------ */

const fmtWon = (value: number) => `${value.toLocaleString('ko-KR')}원`
const fmtSigned = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}원`
const fmtPct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const fmtTime = (iso: string) => iso.slice(11, 16)

/** #266 규율: 데이터 색은 토큰만 — 수익/강세=빨강, 손실/주의=파랑, 중립=녹색 */
const pnlTextClass = (value: number) =>
  value > 0
    ? 'text-[color:var(--jaroo-profit)]'
    : value < 0
      ? 'text-[color:var(--jaroo-loss)]'
      : 'text-[color:var(--jaroo-muted)]'

const pnlSoftClass = (value: number) =>
  value > 0
    ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
    : value < 0
      ? 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]'
      : 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-muted)]'

/** hero statusLabel → 리포트 강도 색 (강세=빨강, 중립=녹색, 주의=파랑) */
function statusTone(label: string) {
  if (label === '강세') return { text: 'text-[color:var(--jaroo-profit)]', bg: 'bg-[color:var(--jaroo-profit-soft)]' }
  if (label === '주의') return { text: 'text-[color:var(--jaroo-loss)]', bg: 'bg-[color:var(--jaroo-loss-soft)]' }
  return { text: 'text-[color:var(--jaroo-flat)]', bg: 'bg-[color:var(--jaroo-neutral-soft)]' }
}

const SIDE_TOKEN = {
  BUY: {
    color: 'var(--jaroo-flat)',
    badge: 'bg-[color:var(--jaroo-flat)] text-white',
    label: 'BUY',
  },
  SELL: {
    color: 'var(--jaroo-profit)',
    badge: 'bg-[color:var(--jaroo-profit)] text-white',
    label: 'SELL',
  },
} as const

function actionBadge(action: JudgmentLog['action']) {
  if (action === 'BUY') return { label: '매수 판단', cls: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-flat)]' }
  if (action === 'SELL') return { label: '매도 판단', cls: 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]' }
  return { label: '홀딩 유지', cls: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-muted)]' }
}

/** 위원회 톤 → 점 컬러 (강세=빨강, 중립=녹색, 주의=파랑) */
const toneDot = (tone: 'positive' | 'neutral' | 'warning') =>
  tone === 'positive'
    ? 'var(--jaroo-profit)'
    : tone === 'warning'
      ? 'var(--jaroo-loss)'
      : 'var(--jaroo-flat)'

/* ------------------------------------------------------------------ */
/* 페이지                                                              */
/* ------------------------------------------------------------------ */

export default function AiTraderDraft3Page() {
  const [charFilter, setCharFilter] = useState<CharacterFilter>('all')
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const visibleSagas = useMemo(() => {
    const byPeriod = REPORT_SAGAS.filter((saga) => {
      if (periodFilter === 'today') return saga.reportDateKey === TODAY_KEY
      if (periodFilter === 'past') return saga.reportDateKey < TODAY_KEY
      return true
    })
    if (charFilter === 'all') return byPeriod
    return byPeriod
      .map((saga) => ({ ...saga, judgments: saga.judgments.filter((entry) => entry.characterId === charFilter) }))
      .filter((saga) => saga.judgments.length > 0)
  }, [charFilter, periodFilter])

  const stats = useMemo(() => buildSagaStats(visibleSagas), [visibleSagas])
  const traceableCount = useMemo(
    () =>
      visibleSagas.reduce(
        (acc, saga) => acc + saga.judgments.filter((entry) => entry.execution && entry.log.debugId === saga.report.metadata.debugId).length,
        0,
      ),
    [visibleSagas],
  )
  const traceablePct = stats.executionCount > 0 ? Math.round((traceableCount / stats.executionCount) * 100) : 0

  return (
    <JarooShell
      title='AI 트레이더 쇼케이스'
      subtitle='모든 매매의 근거는 deepscan 리포트에서 시작됩니다'
      backHref='/'
      showBottomNav={false}
      action={
        <span className='rounded-full bg-[color:var(--jaroo-secondary)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--jaroo-muted)]'>
          초안③
        </span>
      }
    >
      {/* 신뢰 배너 — 판단 로그 × 매매 원장 = 공개 입증 체인 */}
      <section className='rounded-2xl bg-[color:var(--jaroo-primary)] p-3.5 text-white'>
        <div className='text-[13px] font-bold'>판단 로그 × 매매 원장 = 공개 입증 체인</div>
        <div className='mt-2 flex flex-wrap items-center gap-1 text-[11px]'>
          <span className='inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1'>
            <FileText className='size-3' aria-hidden='true' />
            판단 로그
          </span>
          <ArrowRight className='size-3 text-white/60' aria-hidden='true' />
          <span className='inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1'>
            <ReceiptText className='size-3' aria-hidden='true' />
            매매 원장
          </span>
          <ArrowRight className='size-3 text-white/60' aria-hidden='true' />
          <span className='inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1'>
            <ShieldCheck className='size-3' aria-hidden='true' />
            성능 입증
          </span>
        </div>
        <p className='mt-2 text-[11px] leading-snug text-white/75'>
          4명의 AI 트레이더가 나와 똑같은 deepscan 리포트를 보고 각자의 성향대로 매매했어요. 모든 체결의 근거 리포트(debugId)를 추적할 수 있습니다.
        </p>
      </section>

      {/* 캐릭터 필터 칩 */}
      <section aria-label='캐릭터 필터' className='flex flex-wrap gap-1.5'>
        <button
          type='button'
          onClick={() => setCharFilter('all')}
          aria-pressed={charFilter === 'all'}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition',
            charFilter === 'all'
              ? 'border-[color-mix(in_srgb,var(--jaroo-primary)_45%,white)] bg-[color:var(--jaroo-accent)] text-[color:var(--jaroo-ink)]'
              : 'border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
          )}
        >
          전체
        </button>
        {AI_TRADERS.map((trader) => {
          const active = charFilter === trader.id
          return (
            <button
              key={trader.id}
              type='button'
              onClick={() => setCharFilter(active ? 'all' : trader.id)}
              aria-pressed={active}
              style={active ? { borderColor: trader.colorVar, background: trader.colorSoftVar } : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition',
                active
                  ? 'text-[color:var(--jaroo-ink)]'
                  : 'border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]',
              )}
            >
              <span aria-hidden='true'>{trader.emoji}</span>
              {trader.name}
            </button>
          )
        })}
      </section>

      {/* 기간 탭 */}
      <section aria-label='기간 필터' className='flex rounded-full bg-[color:var(--jaroo-secondary)] p-0.5'>
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.key}
            type='button'
            onClick={() => setPeriodFilter(option.key)}
            aria-pressed={periodFilter === option.key}
            className={cn(
              'flex-1 rounded-full py-1.5 text-xs font-semibold transition',
              periodFilter === option.key
                ? 'bg-white text-[color:var(--jaroo-ink)] shadow-sm'
                : 'text-[color:var(--jaroo-muted)]',
            )}
          >
            {option.label}
          </button>
        ))}
      </section>

      {/* 세로 타임라인 피드 (시간 역순 사가 — 최신이 최상단) */}
      <div className='space-y-3'>
        {[...visibleSagas]
          .sort((a, b) => b.reportDateKey.localeCompare(a.reportDateKey))
          .map((saga) => (
            <SagaCard key={saga.id} saga={saga} expanded={expanded} onToggle={toggle} />
          ))}
        {visibleSagas.length === 0 ? (
          <div className='rounded-2xl border border-dashed border-[color:var(--jaroo-border)] bg-white p-6 text-center text-xs text-[color:var(--jaroo-muted)]'>
            해당 조건의 활동 기록이 없어요
          </div>
        ) : null}
      </div>

      {/* 전체 사가 통계 */}
      <section className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-3.5'>
        <div className='flex items-center gap-1.5'>
          <ShieldCheck className='size-4 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
          <h2 className='text-sm font-bold text-[color:var(--jaroo-ink)]'>전체 사가 통계</h2>
          <span className='text-[10px] text-[color:var(--jaroo-muted)]'>(현재 필터 기준)</span>
        </div>

        <div className='mt-2.5 flex items-center gap-1.5'>
          <div className='flex flex-1 flex-col items-center gap-0.5 rounded-xl bg-[color:var(--jaroo-accent)] py-2'>
            <FileText className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>리포트</span>
            <span className='text-sm font-bold text-[color:var(--jaroo-ink)]'>{stats.reportCount}건</span>
          </div>
          <ArrowRight className='size-3.5 shrink-0 text-[color:var(--jaroo-muted)]' aria-hidden='true' />
          <div className='flex flex-1 flex-col items-center gap-0.5 rounded-xl bg-[color:var(--jaroo-warning-soft)] py-2'>
            <Brain className='size-3.5 text-[color:var(--jaroo-warning)]' aria-hidden='true' />
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>판단</span>
            <span className='text-sm font-bold text-[color:var(--jaroo-ink)]'>{stats.judgmentCount}건</span>
          </div>
          <ArrowRight className='size-3.5 shrink-0 text-[color:var(--jaroo-muted)]' aria-hidden='true' />
          <div className='flex flex-1 flex-col items-center gap-0.5 rounded-xl bg-[color:var(--jaroo-neutral-soft)] py-2'>
            <ReceiptText className='size-3.5 text-[color:var(--jaroo-flat)]' aria-hidden='true' />
            <span className='text-[10px] text-[color:var(--jaroo-muted)]'>체결</span>
            <span className='text-sm font-bold text-[color:var(--jaroo-ink)]'>{stats.executionCount}건</span>
          </div>
        </div>

        <div className='mt-2 grid grid-cols-2 gap-1.5'>
          <div className='rounded-xl bg-[color:var(--jaroo-secondary)] px-2.5 py-2'>
            <div className='text-[10px] text-[color:var(--jaroo-muted)]'>명중률 (수익 체결)</div>
            <div className='text-base font-bold text-[color:var(--jaroo-ink)]'>
              {stats.hitRatePct}%
              <span className='ml-1 text-[10px] font-medium text-[color:var(--jaroo-muted)]'>
                {stats.winCount}/{stats.executionCount}
              </span>
            </div>
          </div>
          <div className='rounded-xl bg-[color:var(--jaroo-secondary)] px-2.5 py-2'>
            <div className='text-[10px] text-[color:var(--jaroo-muted)]'>근거 추적률 (debugId 연결)</div>
            <div className='text-base font-bold text-[color:var(--jaroo-primary)]'>{traceablePct}%</div>
          </div>
        </div>

        <div className='mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]'>
          <span className={cn('font-semibold', pnlTextClass(1))}>수익 체결 {stats.winCount}건</span>
          <span className='text-[color:var(--jaroo-border)]'>·</span>
          <span className={cn('font-semibold', pnlTextClass(-1))}>손실 체결 {stats.lossCount}건</span>
          <span className='text-[color:var(--jaroo-border)]'>·</span>
          <span className='text-[color:var(--jaroo-muted)]'>손실도 그대로 공개합니다</span>
        </div>
      </section>

      {/* 캐릭터별 계좌 원장 */}
      <section className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-3.5'>
        <div className='flex items-center gap-1.5'>
          <Wallet className='size-4 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
          <h2 className='text-sm font-bold text-[color:var(--jaroo-ink)]'>캐릭터별 계좌 원장</h2>
        </div>
        <div className='mt-2.5 space-y-2'>
          {ACCOUNT_SUMMARIES.map((account) => {
            const trader = TRADER_BY_ID[account.characterId]
            return (
              <div key={account.characterId} className='rounded-xl bg-[color:var(--jaroo-secondary)] px-2.5 py-2'>
                <div className='flex items-center gap-2'>
                  <span
                    className='flex size-6 items-center justify-center rounded-full text-[13px]'
                    style={{ background: trader.colorSoftVar }}
                    aria-hidden='true'
                  >
                    {trader.emoji}
                  </span>
                  <span className='text-xs font-bold text-[color:var(--jaroo-ink)]'>{trader.name}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-bold',
                      account.totalReturnPct >= 0
                        ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
                        : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
                    )}
                  >
                    {fmtPct(account.totalReturnPct)}
                  </span>
                </div>
                <div className='mt-1.5 grid grid-cols-3 gap-1 text-[10px]'>
                  <div>
                    <div className='text-[color:var(--jaroo-muted)]'>현금</div>
                    <div className='font-semibold text-[color:var(--jaroo-ink)]'>{fmtWon(account.cash)}</div>
                  </div>
                  <div>
                    <div className='text-[color:var(--jaroo-muted)]'>매입원본</div>
                    <div className='font-semibold text-[color:var(--jaroo-ink)]'>{fmtWon(account.costBasis)}</div>
                  </div>
                  <div>
                    <div className='text-[color:var(--jaroo-muted)]'>평가금액</div>
                    <div className='font-semibold text-[color:var(--jaroo-ink)]'>{fmtWon(account.evaluation)}</div>
                  </div>
                </div>
                {account.goal ? (
                  <div className='mt-2'>
                    <div className='flex items-center gap-1 text-[10px] text-[color:var(--jaroo-muted)]'>
                      <Plane className='size-3' aria-hidden='true' />
                      {account.goal.label} 목표 {fmtWon(account.goal.target)}
                      <span className='ml-auto font-bold text-[color:var(--jaroo-warning)]'>{account.goal.progressPct}% 달성</span>
                    </div>
                    <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-white'>
                      <div
                        className='h-full rounded-full bg-[color:var(--jaroo-warning)]'
                        style={{ width: `${Math.min(100, account.goal.progressPct)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <p className='px-1 pb-1 text-center text-[10px] leading-snug text-[color:var(--jaroo-muted)]'>
        본 페이지는 2026-11-16 기준 시연용 목업 데이터입니다. 실제 매매 · deepscan 리포트가 아닙니다.
      </p>
    </JarooShell>
  )
}

/* ------------------------------------------------------------------ */
/* 사가 카드 — 리포트 → 판단 → 체결 수직 체인                            */
/* ------------------------------------------------------------------ */

function SagaCard({
  saga,
  expanded,
  onToggle,
}: {
  saga: ReportSaga
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const report = saga.report
  const executionCount = saga.judgments.filter((entry) => entry.execution).length
  const tone = statusTone(report.hero.scoreLabel)

  return (
    <section className='rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-3.5'>
      {/* 사가 헤더 */}
      <div className='flex items-center gap-2'>
        <span className='shrink-0 rounded-md bg-[color:var(--jaroo-secondary)] px-1.5 py-0.5 text-[11px] font-bold text-[color:var(--jaroo-ink)]'>
          {saga.dateLabel} ({saga.weekday})
        </span>
        <span className='truncate text-sm font-bold text-[color:var(--jaroo-ink)]'>{report.input.instrument.name}</span>
        <span className='shrink-0 text-[11px] text-[color:var(--jaroo-muted)]'>{report.input.instrument.code}</span>
        <span className={cn('ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', tone.bg, tone.text)}>
          hero {report.hero.score} · {report.hero.scoreLabel}
        </span>
      </div>
      <div className='mt-1 flex items-center gap-1 text-[11px] text-[color:var(--jaroo-muted)]'>
        <span className='inline-flex items-center gap-1'>
          <span className='size-1.5 rounded-full bg-[color:var(--jaroo-primary)]' aria-hidden='true' />
          리포트 1
        </span>
        <ArrowRight className='size-3' aria-hidden='true' />
        <span className='inline-flex items-center gap-1'>
          <span className='size-1.5 rounded-full bg-[color:var(--jaroo-warning)]' aria-hidden='true' />
          판단 {saga.judgments.length}
        </span>
        <ArrowRight className='size-3' aria-hidden='true' />
        <span className='inline-flex items-center gap-1'>
          <span className='size-1.5 rounded-full bg-[color:var(--jaroo-flat)]' aria-hidden='true' />
          체결 {executionCount}
        </span>
      </div>

      {/* 타임라인 본문 */}
      <div className='mt-3'>
        {/* 1. 리포트 발행 노드 (파랑 계열) */}
        <div className='flex items-start gap-2.5'>
          <span className='mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--jaroo-primary)] text-white'>
            <FileText className='size-3.5' aria-hidden='true' />
          </span>
          <ReportNode saga={saga} expanded={expanded.has(`r-${saga.id}`)} onToggle={onToggle} />
        </div>

        {/* 2·3. 판단 → 체결 (캐릭터색 노드, 세로 커넥터로 리포트와 연결) */}
        <div className='ml-[13px] mt-2 space-y-2 border-l-2 border-dashed border-[color:var(--jaroo-border)] pl-3.5'>
          {saga.judgments.map((entry) => (
            <JudgmentNode key={entry.id} entry={entry} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 노드 1 — 리포트 발행                                                 */
/* ------------------------------------------------------------------ */

function ReportNode({
  saga,
  expanded,
  onToggle,
}: {
  saga: ReportSaga
  expanded: boolean
  onToggle: (id: string) => void
}) {
  const report = saga.report
  const horizons = report.recoveryForecast?.recoveryHorizonProbabilities ?? null
  const h3m = horizons?.['3m'] ?? null

  return (
    <div className='min-w-0 flex-1 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--jaroo-primary)_22%,white)] bg-[color:var(--jaroo-accent)]'>
      <button type='button' onClick={() => onToggle(`r-${saga.id}`)} aria-expanded={expanded} className='w-full px-2.5 py-2 text-left'>
        <div className='flex items-center gap-1.5'>
          <span className='text-xs font-bold text-[color:var(--jaroo-primary-strong)]'>deepscan 리포트 발행</span>
          <span className='ml-auto inline-flex items-center gap-0.5 text-[10px] text-[color:var(--jaroo-muted)]'>
            <Clock className='size-3' aria-hidden='true' />
            {fmtTime(saga.reportAt)} KST
          </span>
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-[color:var(--jaroo-primary)] transition', expanded && 'rotate-180')}
            aria-hidden='true'
          />
        </div>
        <div className='mt-0.5 truncate text-[11px] text-[color:var(--jaroo-muted)]'>
          {report.input.instrument.name} hero {report.hero.score} · debugId {report.metadata.debugId}
          {h3m !== null ? ` · 3m 회수확률 ${h3m}%` : ''}
        </div>
      </button>

      {expanded ? (
        <div className='space-y-2.5 border-t border-[color-mix(in_srgb,var(--jaroo-primary)_15%,white)] px-2.5 py-2.5'>
          {/* hero score 게이지 */}
          <div className='flex items-center gap-2'>
            <span className='shrink-0 text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>hero score</span>
            <div className='h-2 flex-1 overflow-hidden rounded-full bg-white'>
              <div className='h-full rounded-full bg-[color:var(--jaroo-primary)]' style={{ width: `${report.hero.score}%` }} />
            </div>
            <span className='w-10 shrink-0 text-right text-xs font-bold text-[color:var(--jaroo-primary)]'>{report.hero.score}</span>
          </div>

          {/* 근거 fact 전체 */}
          <ul className='space-y-1'>
            {(report.hero.evidenceFacts ?? []).map((fact) => (
              <li key={fact} className='flex gap-1.5 text-[11px] leading-snug text-[color:var(--jaroo-ink)]'>
                <Check className='mt-0.5 size-3 shrink-0 text-[color:var(--jaroo-flat)]' aria-hidden='true' />
                {fact}
              </li>
            ))}
            {(report.hero.evidenceCautions ?? []).map((caution) => (
              <li key={caution} className='flex gap-1.5 text-[11px] leading-snug text-[color:var(--jaroo-ink)]'>
                <TriangleAlert className='mt-0.5 size-3 shrink-0 text-[color:var(--jaroo-warning)]' aria-hidden='true' />
                {caution}
              </li>
            ))}
          </ul>

          {/* 위원회 축 요약 */}
          {report.committee.axes.map((axe) => (
            <div key={axe.label} className='rounded-lg bg-white px-2 py-1.5'>
              <div className='flex items-center gap-1.5 text-[11px]'>
                <span className='font-semibold text-[color:var(--jaroo-ink)]'>{axe.label}</span>
                <span className='font-bold text-[color:var(--jaroo-primary)]'>{axe.scoreText}</span>
                <span className='text-[color:var(--jaroo-muted)]'>{axe.axisStatusText}</span>
              </div>
              <div className='mt-1 flex flex-wrap gap-1'>
                {axe.members.map((member) => (
                  <span
                    key={member.shortLabel}
                    className='inline-flex items-center gap-1 rounded-full bg-[color:var(--jaroo-secondary)] px-1.5 py-0.5 text-[10px] text-[color:var(--jaroo-muted)]'
                  >
                    <span className='size-1.5 rounded-full' style={{ background: toneDot(member.tone) }} aria-hidden='true' />
                    {member.shortLabel} {member.score}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* 기간별 회수확률 */}
          {horizons ? (
            <div className='rounded-lg bg-white px-2 py-1.5'>
              <div className='text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>기간별 본전 회복확률</div>
              <div className='mt-1 space-y-1'>
                {(['3m', '6m', '1y', '2y', '3y'] as const).map((horizon) => {
                  const value = horizons[horizon]
                  if (value === null || value === undefined) return null
                  return (
                    <div key={horizon} className='flex items-center gap-2'>
                      <span className='w-6 shrink-0 text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>{horizon}</span>
                      <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--jaroo-secondary)]'>
                        <div className='h-full rounded-full bg-[color:var(--jaroo-primary)]' style={{ width: `${value}%` }} />
                      </div>
                      <span className='w-8 shrink-0 text-right text-[10px] font-bold text-[color:var(--jaroo-ink)]'>{value}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* 전략 · 메타 */}
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]'>
            <span className='inline-flex items-center gap-1 font-semibold text-[color:var(--jaroo-ink)]'>
              <Target className='size-3 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
              {report.strategy.currentPriceText} → {report.strategy.targetPriceText}
            </span>
            <span className='rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>
              {report.strategy.weekBadgeText} · {report.strategy.weekSignal}
            </span>
          </div>
          <div className='text-[10px] leading-snug text-[color:var(--jaroo-muted)]'>
            생성 {fmtTime(report.metadata.generatedAt)} KST · v{report.metadata.version} · debugId {report.metadata.debugId}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 노드 2 — 캐릭터 판단 (+ 노드 3 체결)                                  */
/* ------------------------------------------------------------------ */

function JudgmentNode({
  entry,
  expanded,
  onToggle,
}: {
  entry: JudgmentEntry
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const trader = TRADER_BY_ID[entry.characterId]
  const log = entry.log
  const badge = actionBadge(log.action)
  const isOpen = expanded.has(entry.id)
  const execOpen = expanded.has(`x-${entry.id}`)

  return (
    <div className='relative'>
      {/* 판단 노드 점 — 커넥터 라인 위에 캐릭터 아바타 */}
      <span
        className='absolute -left-[24px] top-1 z-10 flex size-6 items-center justify-center rounded-full border-2 bg-white text-[12px]'
        style={{ borderColor: trader.colorVar }}
        aria-hidden='true'
      >
        {trader.emoji}
      </span>

      <div
        className='overflow-hidden rounded-xl border bg-white'
        style={{ borderColor: `color-mix(in srgb, ${trader.colorVar} 45%, white)` }}
      >
        <button type='button' onClick={() => onToggle(entry.id)} aria-expanded={isOpen} className='w-full px-2.5 py-2 text-left'>
          <div className='flex items-center gap-1.5'>
            <span className='text-xs font-bold' style={{ color: trader.colorVar }}>
              {trader.name} 판단
            </span>
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', badge.cls)}>{badge.label}</span>
            <span className='ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px] text-[color:var(--jaroo-muted)]'>
              <Clock className='size-3' aria-hidden='true' />
              {fmtTime(entry.at)} KST
            </span>
            <ChevronDown className={cn('size-3.5 shrink-0 text-[color:var(--jaroo-muted)] transition', isOpen && 'rotate-180')} aria-hidden='true' />
          </div>
          <p className='mt-1 text-[12px] leading-snug text-[color:var(--jaroo-ink)]'>“{log.narrative}”</p>
          <div className='mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[color:var(--jaroo-muted)]'>
            <span>근거: heroScore {log.heroScore}</span>
            <span>·</span>
            <span>
              회수확률({log.recoveryHorizon}) {log.recoveryPct}%
            </span>
            <span>·</span>
            <span>debugId {log.debugId}</span>
          </div>
        </button>

        {isOpen ? (
          <div className='border-t border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-2.5 py-2'>
            <div className='grid grid-cols-3 gap-1.5 text-[10px]'>
              <div className='rounded-lg bg-white px-1.5 py-1'>
                <div className='text-[color:var(--jaroo-muted)]'>목표가</div>
                <div className='font-bold text-[color:var(--jaroo-ink)]'>{fmtWon(log.targetPrice)}</div>
              </div>
              <div className='rounded-lg bg-white px-1.5 py-1'>
                <div className='text-[color:var(--jaroo-muted)]'>리포트 생성</div>
                <div className='font-bold text-[color:var(--jaroo-ink)]'>{log.generatedAt.slice(5, 10)}</div>
              </div>
              <div className='rounded-lg bg-white px-1.5 py-1'>
                <div className='text-[color:var(--jaroo-muted)]'>reasonCode</div>
                <div className='truncate font-bold text-[color:var(--jaroo-ink)]'>{log.reasonCode}</div>
              </div>
            </div>
            <div className='mt-1.5 flex items-center gap-1 text-[10px] text-[color:var(--jaroo-muted)]'>
              <Brain className='size-3' aria-hidden='true' />
              판단 철학 — {trader.philosophy}
            </div>
          </div>
        ) : null}

        {entry.execution ? (
          <div className='px-2 pb-2 pt-0'>
            <div className='flex'>
              {/* 판단 → 체결 ㄱ자 커넥터 */}
              <div className='flex w-4 shrink-0 flex-col' aria-hidden='true'>
                <div className='ml-[6px] h-3 w-0 border-l-2 border-dashed' style={{ borderColor: 'var(--jaroo-border)' }} />
                <div
                  className='ml-[6px] h-5 w-[10px] rounded-bl-lg border-b-2 border-l-2 border-dashed'
                  style={{ borderColor: 'var(--jaroo-border)' }}
                />
              </div>
              <div className='min-w-0 flex-1 pt-1'>
                <ExecutionNode execution={entry.execution} judgmentId={entry.id} expanded={execOpen} onToggle={onToggle} />
              </div>
            </div>
          </div>
        ) : (
          <div className='px-2.5 pb-2'>
            <span className='inline-flex items-center gap-1 rounded-full bg-[color:var(--jaroo-neutral-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--jaroo-muted)]'>
              <Minus className='size-3' aria-hidden='true' />
              홀딩 유지 — 체결 없음
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 노드 3 — 체결 (매매 원장)                                            */
/* ------------------------------------------------------------------ */

function ExecutionNode({
  execution,
  judgmentId,
  expanded,
  onToggle,
}: {
  execution: ExecutionRecord
  judgmentId: string
  expanded: boolean
  onToggle: (id: string) => void
}) {
  const side = SIDE_TOKEN[execution.side]

  return (
    <button
      type='button'
      onClick={() => onToggle(`x-${judgmentId}`)}
      aria-expanded={expanded}
      className='w-full rounded-lg border border-l-2 px-2 py-1.5 text-left'
      style={{
        borderColor: `color-mix(in srgb, ${side.color} 35%, white)`,
        borderLeftColor: side.color,
        background: `color-mix(in srgb, ${side.color} 7%, white)`,
      }}
    >
      <div className='flex items-center gap-1.5'>
        <span className={cn('shrink-0 rounded px-1 py-0.5 text-[10px] font-bold', side.badge)}>{side.label}</span>
        <span className='truncate text-[12px] font-bold text-[color:var(--jaroo-ink)]'>
          {execution.instrument} {execution.quantity}주 @ {execution.price.toLocaleString('ko-KR')}
        </span>
      </div>
      <div className='mt-0.5 flex items-center gap-1 text-[10px] text-[color:var(--jaroo-muted)]'>
        <span className='min-w-0 flex-1 truncate'>
          orderId {execution.orderId} · {fmtTime(execution.at)} KST 체결
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
            pnlSoftClass(execution.pnl.value),
          )}
        >
          {execution.pnl.realized ? '실현 ' : ''}
          {fmtSigned(execution.pnl.value)} ({fmtPct(execution.pnl.pct)})
        </span>
        <ChevronDown className={cn('size-3 shrink-0 transition', expanded && 'rotate-180')} aria-hidden='true' />
      </div>

      {expanded ? (
        <div className='mt-1.5 rounded-md bg-white px-2 py-1.5'>
          <div className='text-[10px] font-semibold text-[color:var(--jaroo-muted)]'>매매 원장 디테일</div>
          <dl className='mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]'>
            <div className='flex justify-between gap-1'>
              <dt className='text-[color:var(--jaroo-muted)]'>체결시각</dt>
              <dd className='font-semibold text-[color:var(--jaroo-ink)]'>{execution.at.slice(5, 16).replace('T', ' ')} KST</dd>
            </div>
            <div className='flex justify-between gap-1'>
              <dt className='text-[color:var(--jaroo-muted)]'>수량</dt>
              <dd className='font-semibold text-[color:var(--jaroo-ink)]'>{execution.quantity}주</dd>
            </div>
            <div className='flex justify-between gap-1'>
              <dt className='text-[color:var(--jaroo-muted)]'>단가</dt>
              <dd className='font-semibold text-[color:var(--jaroo-ink)]'>{fmtWon(execution.price)}</dd>
            </div>
            <div className='flex justify-between gap-1'>
              <dt className='text-[color:var(--jaroo-muted)]'>금액</dt>
              <dd className='font-semibold text-[color:var(--jaroo-ink)]'>{fmtWon(execution.amount)}</dd>
            </div>
            <div className='flex justify-between gap-1'>
              <dt className='text-[color:var(--jaroo-muted)]'>수수료</dt>
              <dd className='font-semibold text-[color:var(--jaroo-ink)]'>{fmtWon(execution.fee)}</dd>
            </div>
            <div className='flex justify-between gap-1'>
              <dt className='text-[color:var(--jaroo-muted)]'>{execution.pnl.realized ? '실현손익' : '평가손익'}</dt>
              <dd className={cn('font-bold', pnlTextClass(execution.pnl.value))}>
                {fmtSigned(execution.pnl.value)} ({fmtPct(execution.pnl.pct)})
              </dd>
            </div>
          </dl>
          <div className='mt-1 flex items-center gap-1 border-t border-[color:var(--jaroo-border)] pt-1 text-[10px] text-[color:var(--jaroo-muted)]'>
            <ReceiptText className='size-3 shrink-0' aria-hidden='true' />
            <span className='truncate'>
              체결 근거 리포트 — 딥스캔 판단 노드의 debugId와 동일 스냅샷 ({execution.orderId})
            </span>
          </div>
        </div>
      ) : null}
    </button>
  )
}
