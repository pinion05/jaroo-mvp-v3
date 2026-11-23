'use client'

/**
 * 초안② — 리더보드/순위경쟁형 AI 트레이더 쇼케이스 (홍보용 목업).
 * "같은 deepscan 리포트를 보고 각자 매수/매도한 4명의 AI 트레이더,
 *  이번 달 누가 제일 잘 벌었나" 경쟁 구도가 메인.
 * 데이터는 전부 mock-data.ts의 가상 목업이다 (외부 API 없음).
 */
import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Crown,
  Flame,
  Minus,
  ReceiptText,
  ScrollText,
  Sparkles,
  Target,
  Wallet,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { JarooShell } from '@/components/jaroo-shell'

import {
  HIGHLIGHT_TRADES,
  MOCK_REPORT,
  RECENT_TRADES,
  SEASON_TABS,
  TRADERS,
  type HighlightTagTone,
  type SeasonKey,
  type SeasonRecord,
  type Trader,
  type TradeExecution,
} from './mock-data'

// ── 포맷 유틸 ────────────────────────────────────────────────────────────────

function formatWon(value: number) {
  return `${value.toLocaleString('ko-KR')}원`
}

function formatSignedWon(value: number) {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}원`
}

function formatPct(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

/** #266 규율: 데이터 색은 토큰만 — 상승/이익=profit(빨강), 하락/손실=loss(파랑) */
function pctToneClass(value: number) {
  if (value > 0) return 'text-[color:var(--jaroo-profit)]'
  if (value < 0) return 'text-[color:var(--jaroo-loss)]'
  return 'text-[color:var(--jaroo-muted)]'
}

/** 히어로 점수 게이지 색 — 강세=빨강, 중립대=녹색, 주의=파랑 (deepscan 화면 규칙과 동일) */
function heroBarClass(score: number) {
  if (score >= 67) return 'bg-[color:var(--jaroo-profit)]'
  if (score >= 45) return 'bg-[color:var(--jaroo-flat)]'
  return 'bg-[color:var(--jaroo-loss)]'
}

function heroTextClass(score: number) {
  if (score >= 67) return 'text-[color:var(--jaroo-profit)]'
  if (score >= 45) return 'text-[color:var(--jaroo-flat)]'
  return 'text-[color:var(--jaroo-loss)]'
}

// ── 소부품 ──────────────────────────────────────────────────────────────────

function AvatarChip({ trader, className }: { trader: Trader; className?: string }) {
  return (
    <span
      aria-hidden='true'
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-lg', trader.accentSoft, className)}
    >
      {trader.emoji}
    </span>
  )
}

function RankDeltaBadge({ delta, onDark = false }: { delta: number; onDark?: boolean }) {
  if (delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-[10px] font-semibold',
          onDark ? 'text-white/70' : 'text-[color:var(--jaroo-muted)]'
        )}
      >
        <Minus className='size-3' aria-hidden='true' />
        유지
      </span>
    )
  }
  const up = delta > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums',
        onDark ? 'text-white' : up ? 'text-[color:var(--jaroo-profit)]' : 'text-[color:var(--jaroo-loss)]'
      )}
    >
      {up ? <ChevronUp className='size-3' aria-hidden='true' /> : <ChevronDown className='size-3' aria-hidden='true' />}
      {Math.abs(delta)}
    </span>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Crown
  title: string
  hint?: string
}) {
  return (
    <div className='flex items-center gap-1.5'>
      <Icon className='size-4 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
      <h2 className='text-sm font-bold text-[color:var(--jaroo-ink)]'>{title}</h2>
      {hint ? <span className='ml-auto text-[11px] text-[color:var(--jaroo-muted)]'>{hint}</span> : null}
    </div>
  )
}

function StatTile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className='rounded-lg bg-white px-2 py-1.5 text-center'>
      <div className='text-[10px] text-[color:var(--jaroo-muted)]'>{label}</div>
      <div className={cn('mt-0.5 text-xs font-bold tabular-nums text-[color:var(--jaroo-ink)]', valueClass)}>
        {value}
      </div>
    </div>
  )
}

/** 펼친 순위 항목 하단: 최근 판단 로그 + 계좌 요약 + 그 트레이더의 최근 체결 */
function TraderDetail({ trader, trades }: { trader: Trader; trades: TradeExecution[] }) {
  const judgment = trader.judgment
  const recent = trades.filter((trade) => trade.traderId === trader.id).slice(-3).toReversed()
  const evalPnl = trader.account.evaluation - trader.account.principal

  return (
    <div className='space-y-3 border-t border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)]/60 px-3.5 py-3'>
      {/* 최근 판단 로그 */}
      <div>
        <div className='flex items-center gap-1.5'>
          <ScrollText className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
          <span className='text-[11px] font-bold text-[color:var(--jaroo-ink)]'>최근 판단 로그</span>
          <Badge variant='outline' className='ml-auto px-1.5 font-mono text-[10px]'>
            {judgment.reasonCode}
          </Badge>
        </div>
        <p className='mt-1.5 rounded-xl border border-[color:var(--jaroo-border)] bg-white px-3 py-2 text-xs leading-relaxed text-[color:var(--jaroo-ink)]'>
          <span className='mr-1' aria-hidden='true'>
            💬
          </span>
          {judgment.narrative}
        </p>
        <div className='mt-2 grid grid-cols-3 gap-1.5'>
          <StatTile label='리포트 점수' value={`${judgment.heroScore}점`} />
          <StatTile label='6M 회복 확률' value={`${judgment.recoveryPct}%`} />
          <StatTile label='목표가' value={formatWon(judgment.targetPrice)} />
        </div>
        <div className='mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px] text-[color:var(--jaroo-muted)]'>
          <span className='truncate'>{judgment.debugId}</span>
          <span className='shrink-0'>{judgment.generatedAt}</span>
        </div>
      </div>

      {/* 계좌 요약 */}
      <div>
        <div className='flex items-center gap-1.5'>
          <Wallet className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
          <span className='text-[11px] font-bold text-[color:var(--jaroo-ink)]'>계좌 요약</span>
        </div>
        <div className='mt-1.5 grid grid-cols-2 gap-1.5'>
          <StatTile label='현금' value={formatWon(trader.account.cash)} />
          <StatTile label='매입 원가' value={formatWon(trader.account.principal)} />
          <StatTile label='평가 금액' value={formatWon(trader.account.evaluation)} />
          <StatTile
            label='평가손익 (시즌 수익률)'
            value={`${formatSignedWon(evalPnl)} (${formatPct(trader.account.seasonReturnPct)})`}
            valueClass={pctToneClass(trader.account.seasonReturnPct)}
          />
        </div>
      </div>

      {/* 이 트레이더의 최근 체결 */}
      {recent.length > 0 ? (
        <div>
          <div className='flex items-center gap-1.5'>
            <ReceiptText className='size-3.5 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
            <span className='text-[11px] font-bold text-[color:var(--jaroo-ink)]'>최근 체결</span>
          </div>
          <div className='mt-1.5 space-y-1'>
            {recent.map((trade) => (
              <div key={trade.id} className='flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5'>
                <span
                  className={cn(
                    'w-8 shrink-0 rounded-md py-0.5 text-center text-[10px] font-bold',
                    trade.side === 'BUY'
                      ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
                      : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]'
                  )}
                >
                  {trade.side === 'BUY' ? '매수' : '매도'}
                </span>
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-[11px] font-semibold text-[color:var(--jaroo-ink)]'>
                    {trade.instrument}{' '}
                    <span className='font-normal tabular-nums text-[color:var(--jaroo-muted)]'>
                      {trade.quantity}주 · {formatWon(trade.unitPrice)}
                    </span>
                  </div>
                  <div className='truncate font-mono text-[9px] text-[color:var(--jaroo-muted)]'>
                    {trade.orderId} · 수수료 {formatWon(trade.fee)} · {trade.at} KST
                  </div>
                </div>
                <span className='shrink-0 text-[11px] font-bold tabular-nums text-[color:var(--jaroo-ink)]'>
                  {formatWon(trade.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GoalProgressBar({ trader }: { trader: Trader }) {
  const pct = Math.min(100, Math.round((trader.goalCurrent / trader.goalTarget) * 100))
  return (
    <div>
      <div className='mb-1.5 flex items-center gap-2'>
        <AvatarChip trader={trader} className='size-6 text-[11px]' />
        <span className='shrink-0 text-xs font-bold text-[color:var(--jaroo-ink)]'>{trader.name}</span>
        <span className='min-w-0 flex-1 truncate text-[11px] text-[color:var(--jaroo-muted)]'>{trader.goalLabel}</span>
        <span className={cn('shrink-0 text-[11px] font-extrabold tabular-nums', trader.accentText)}>{pct}%</span>
      </div>
      <div className='h-2 overflow-hidden rounded-full bg-[color:var(--jaroo-secondary)]'>
        <div className={cn('h-full rounded-full', trader.accentBar)} style={{ width: `${pct}%` }} />
      </div>
      <div className='mt-1 flex justify-between text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>
        <span>현재 {formatWon(trader.goalCurrent)}</span>
        <span>목표 {formatWon(trader.goalTarget)}</span>
      </div>
    </div>
  )
}

const HIGHLIGHT_TAG_TONE: Record<HighlightTagTone, string> = {
  profit: 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]',
  loss: 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]',
  neutral: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-ink)]',
}

function HighlightCard({ trade }: { trade: (typeof HIGHLIGHT_TRADES)[number] }) {
  const trader = TRADERS.find((candidate) => candidate.id === trade.traderId)
  if (!trader) return null
  return (
    <div className='overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-white'>
      <div className='flex items-center gap-2 px-3.5 pt-3'>
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold', HIGHLIGHT_TAG_TONE[trade.tagTone])}>
          {trade.tag}
        </span>
        <span className='text-[10px] tabular-nums text-[color:var(--jaroo-muted)]'>{trade.at}</span>
      </div>
      <div className='mt-2 flex items-center gap-2.5 px-3.5'>
        <AvatarChip trader={trader} className='size-8 text-sm' />
        <div className='min-w-0'>
          <p className='truncate text-sm font-bold text-[color:var(--jaroo-ink)]'>{trade.title}</p>
          <p className='mt-0.5 truncate text-[11px] tabular-nums text-[color:var(--jaroo-muted)]'>{trade.detail}</p>
        </div>
      </div>
      <div className='m-3 rounded-xl bg-[color:var(--jaroo-secondary)] px-3 py-2'>
        <div className='flex items-center gap-1 text-[10px] font-bold text-[color:var(--jaroo-primary)]'>
          <Sparkles className='size-3' aria-hidden='true' />
          근거가 된 deepscan 리포트
        </div>
        <p className='mt-1 text-[11px] leading-relaxed text-[color:var(--jaroo-ink)]'>“{trade.reportQuote}”</p>
        <div className='mt-1.5 flex items-center justify-between gap-2'>
          <span className='truncate font-mono text-[9px] text-[color:var(--jaroo-muted)]'>{trade.reportDebugId}</span>
          <span className='shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[9px] font-semibold text-[color:var(--jaroo-muted)]'>
            {trade.ruleTag}
          </span>
        </div>
      </div>
    </div>
  )
}

function FeedRow({ trade }: { trade: TradeExecution }) {
  const trader = TRADERS.find((candidate) => candidate.id === trade.traderId)
  if (!trader) return null
  return (
    <div className='flex items-center gap-2.5 px-3 py-2.5'>
      <span
        className={cn(
          'w-8 shrink-0 rounded-md py-0.5 text-center text-[10px] font-bold',
          trade.side === 'BUY'
            ? 'bg-[color:var(--jaroo-profit-soft)] text-[color:var(--jaroo-profit)]'
            : 'bg-[color:var(--jaroo-loss-soft)] text-[color:var(--jaroo-loss)]'
        )}
      >
        {trade.side === 'BUY' ? '매수' : '매도'}
      </span>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-xs font-semibold text-[color:var(--jaroo-ink)]'>
          {trade.instrument}{' '}
          <span className='font-normal tabular-nums text-[color:var(--jaroo-muted)]'>
            {trade.quantity}주 · {formatWon(trade.unitPrice)}
          </span>
        </p>
        <p className='mt-0.5 text-[10px] text-[color:var(--jaroo-muted)]'>
          {trader.emoji} {trader.name} · {trade.at} KST
        </p>
      </div>
      <span className='shrink-0 text-xs font-bold tabular-nums text-[color:var(--jaroo-ink)]'>
        {formatWon(trade.amount)}
      </span>
    </div>
  )
}

// ── 페이지 ──────────────────────────────────────────────────────────────────

export default function AiTraderDraft2Page() {
  const [season, setSeason] = useState<SeasonKey>('week')
  const [expandedTraderId, setExpandedTraderId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  const seasonMeta = SEASON_TABS.find((tab) => tab.key === season) ?? SEASON_TABS[0]
  const ranked = useMemo(
    () => [...TRADERS].sort((a, b) => a.seasons[season].rank - b.seasons[season].rank),
    [season]
  )
  const champion = ranked[0]
  const runnersUp = ranked.slice(1)
  const championRecord: SeasonRecord = champion.seasons[season]
  const feedTrades = useMemo(() => [...RECENT_TRADES].toReversed(), [])

  const handleSeasonChange = (value: string | number) => {
    if (typeof value === 'string') setSeason(value as SeasonKey)
  }

  const toggleTrader = (traderId: string) => {
    setExpandedTraderId((current) => (current === traderId ? null : traderId))
  }

  return (
    <JarooShell
      title='AI 트레이더 리그'
      subtitle='같은 리포트, 다른 결단 — 주간 배틀'
      backHref='/home'
      showBottomNav={false}
    >
      <h1 className='sr-only'>AI 트레이더 리그 리더보드</h1>

      {/* 1. 시즌 헤더 */}
      <section className='overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-white'>
        <div className='bg-gradient-to-br from-[color:var(--jaroo-primary)] to-[color:var(--jaroo-primary-strong)] px-4 py-3.5 text-white'>
          <div className='flex items-center justify-between gap-2'>
            <div className='min-w-0'>
              <p className='text-[11px] font-medium text-white/75'>AI 트레이더 리그 · 11월 시즌</p>
              <p className='mt-0.5 text-lg font-extrabold'>2026년 11월 · 2주차</p>
            </div>
            <span className='flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold'>
              <Flame className='size-3' aria-hidden='true' />
              시즌 진행 중
            </span>
          </div>
          <p className='mt-1.5 text-[11px] leading-relaxed text-white/80'>
            🏆 주간 1위는 명예의 전당 등재 + deepscan 프로 3개월 쿠폰
          </p>
        </div>
        <div className='p-2'>
          <Tabs value={season} onValueChange={handleSeasonChange}>
            <TabsList className='w-full'>
              {SEASON_TABS.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </section>

      {/* 공용 리포트 스트립 — 4명이 모두 이 리포트를 보고 판단했다 */}
      <button
        type='button'
        onClick={() => setReportOpen((open) => !open)}
        aria-expanded={reportOpen}
        className='w-full rounded-2xl border border-[color:var(--jaroo-border)] bg-white px-3.5 py-3 text-left transition hover:border-[color:var(--jaroo-primary)]'
      >
        <div className='flex items-center gap-1.5'>
          <Badge variant='secondary' className='text-[10px]'>
            이번 주 공용 리포트
          </Badge>
          <span className='truncate text-[11px] text-[color:var(--jaroo-muted)]'>4명의 트레이더가 같은 리포트로 판단</span>
          <ChevronDown
            className={cn('ml-auto size-4 shrink-0 text-[color:var(--jaroo-muted)] transition-transform', reportOpen && 'rotate-180')}
            aria-hidden='true'
          />
        </div>
        <div className='mt-2 flex items-end justify-between gap-2'>
          <div className='min-w-0'>
            <p className='truncate text-sm font-bold text-[color:var(--jaroo-ink)]'>
              {MOCK_REPORT.input.instrument.name}{' '}
              <span className='text-xs font-normal text-[color:var(--jaroo-muted)]'>
                {MOCK_REPORT.input.instrument.code}
              </span>
            </p>
            <p className='mt-0.5 truncate text-[11px] text-[color:var(--jaroo-muted)]'>
              주간 시그널 · {MOCK_REPORT.strategy.weekSignal}
            </p>
          </div>
          <div className='shrink-0 text-right'>
            <p className='text-2xl font-extrabold leading-none tabular-nums text-[color:var(--jaroo-ink)]'>
              {MOCK_REPORT.hero.score}
              <span className='text-xs font-bold'>점</span>
            </p>
            <p className={cn('mt-0.5 text-[10px] font-semibold', heroTextClass(MOCK_REPORT.hero.score))}>
              {MOCK_REPORT.hero.scoreLabel}
            </p>
          </div>
        </div>
        <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--jaroo-secondary)]'>
          <div className={cn('h-full rounded-full', heroBarClass(MOCK_REPORT.hero.score))} style={{ width: `${MOCK_REPORT.hero.score}%` }} />
        </div>
        {reportOpen ? (
          <div className='mt-3 space-y-2 border-t border-[color:var(--jaroo-border)] pt-3'>
            <ul className='space-y-1'>
              {MOCK_REPORT.hero.evidenceFacts?.map((fact) => (
                <li key={fact} className='flex gap-1.5 text-[11px] leading-relaxed text-[color:var(--jaroo-ink)]'>
                  <span className='text-[color:var(--jaroo-primary)]' aria-hidden='true'>
                    •
                  </span>
                  {fact}
                </li>
              ))}
            </ul>
            {MOCK_REPORT.hero.evidenceCautions?.length ? (
              <p className='rounded-xl bg-[color:var(--jaroo-warning-soft)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[color:var(--jaroo-warning)]'>
                ⚠️ {MOCK_REPORT.hero.evidenceCautions.join(' ')}
              </p>
            ) : null}
            <div className='flex items-center justify-between gap-2 font-mono text-[10px] text-[color:var(--jaroo-muted)]'>
              <span className='truncate'>debugId {MOCK_REPORT.metadata.debugId}</span>
              <span className='shrink-0'>목표가 {MOCK_REPORT.strategy.targetPriceText}</span>
            </div>
          </div>
        ) : null}
      </button>

      {/* 2. 순위 리스트 */}
      <section className='space-y-2'>
        <SectionHeader icon={Crown} title={`${seasonMeta.label} 순위`} hint={seasonMeta.period} />

        {/* 1위 — 크게 강조 */}
        <button
          type='button'
          onClick={() => toggleTrader(champion.id)}
          aria-expanded={expandedTraderId === champion.id}
          className='block w-full overflow-hidden rounded-2xl text-left shadow-[0_12px_32px_rgba(12,68,124,0.28)]'
        >
          <div className='relative bg-gradient-to-br from-[color:var(--jaroo-primary)] to-[color:var(--jaroo-primary-strong)] px-4 pb-4 pt-3.5 text-white'>
            <Crown className='absolute right-3.5 top-3.5 size-5 text-white/85' aria-hidden='true' />
            <div className='flex items-center gap-1 text-[11px] font-semibold text-white/80'>
              <Crown className='size-3' aria-hidden='true' />
              {seasonMeta.championLabel}
            </div>
            <div className='mt-2.5 flex items-center gap-3'>
              <span className='flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl' aria-hidden='true'>
                {champion.emoji}
              </span>
              <div className='min-w-0'>
                <p className='text-base font-extrabold'>
                  {champion.name}
                  <span className='ml-1.5 text-[11px] font-medium text-white/75'>{champion.tagline}</span>
                </p>
                <p className='mt-0.5 truncate text-xs text-white/85'>“{champion.philosophy}”</p>
              </div>
            </div>
            <div className='mt-3 flex items-end justify-between gap-2'>
              <div>
                <p className='text-3xl font-extrabold leading-none tabular-nums'>{formatPct(championRecord.returnPct)}</p>
                <p className='mt-1 text-xs tabular-nums text-white/85'>
                  평가손익 {formatSignedWon(championRecord.pnl)}
                </p>
              </div>
              <span className='shrink-0 rounded-full bg-white/15 px-2 py-1'>
                <RankDeltaBadge delta={championRecord.rankDelta} onDark />
              </span>
            </div>
          </div>
          {expandedTraderId === champion.id ? <TraderDetail trader={champion} trades={RECENT_TRADES} /> : null}
          <div className='flex items-center justify-center gap-1 bg-white py-1.5 text-[10px] font-medium text-[color:var(--jaroo-muted)]'>
            {expandedTraderId === champion.id ? (
              <>
                <ChevronUp className='size-3' aria-hidden='true' />
                접기
              </>
            ) : (
              <>
                <ChevronDown className='size-3' aria-hidden='true' />
                판단 로그 · 계좌 펼치기
              </>
            )}
          </div>
        </button>

        {/* 2~4위 */}
        {runnersUp.map((trader) => {
          const record = trader.seasons[season]
          const expanded = expandedTraderId === trader.id
          return (
            <button
              key={trader.id}
              type='button'
              onClick={() => toggleTrader(trader.id)}
              aria-expanded={expanded}
              className='block w-full overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-white text-left transition hover:border-[color:var(--jaroo-primary)]'
            >
              <div className='flex items-center gap-2.5 px-3 py-2.5'>
                <span className='w-5 shrink-0 text-center text-sm font-extrabold tabular-nums text-[color:var(--jaroo-muted)]'>
                  {record.rank}
                </span>
                <AvatarChip trader={trader} />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-1.5'>
                    <span className='truncate text-sm font-bold text-[color:var(--jaroo-ink)]'>{trader.name}</span>
                    <RankDeltaBadge delta={record.rankDelta} />
                  </div>
                  <p className='mt-0.5 truncate text-[11px] text-[color:var(--jaroo-muted)]'>“{trader.philosophy}”</p>
                </div>
                <div className='shrink-0 text-right'>
                  <p className={cn('text-base font-extrabold leading-tight tabular-nums', pctToneClass(record.returnPct))}>
                    {formatPct(record.returnPct)}
                  </p>
                  <p className={cn('text-[10px] tabular-nums', pctToneClass(record.pnl))}>{formatSignedWon(record.pnl)}</p>
                </div>
                <ChevronDown
                  className={cn('size-4 shrink-0 text-[color:var(--jaroo-muted)] transition-transform', expanded && 'rotate-180')}
                  aria-hidden='true'
                />
              </div>
              {expanded ? <TraderDetail trader={trader} trades={RECENT_TRADES} /> : null}
            </button>
          )
        })}
      </section>

      {/* 3. 목표 진척도 */}
      <section className='space-y-2'>
        <SectionHeader icon={Target} title='목표 진척도' hint='시즌 목표까지' />
        <div className='space-y-4 rounded-2xl border border-[color:var(--jaroo-border)] bg-white p-4'>
          {TRADERS.map((trader) => (
            <GoalProgressBar key={trader.id} trader={trader} />
          ))}
        </div>
      </section>

      {/* 4. 이번 주 하이라이트 매매 */}
      <section className='space-y-2'>
        <SectionHeader icon={Zap} title='이번 주 하이라이트 매매' hint='리포트 기반 실제 체결' />
        <div className='space-y-2.5'>
          {HIGHLIGHT_TRADES.map((trade) => (
            <HighlightCard key={trade.id} trade={trade} />
          ))}
        </div>
      </section>

      {/* 5. 최근 체결 통합 피드 */}
      <section className='space-y-2'>
        <SectionHeader icon={ReceiptText} title='최근 체결 피드' hint='4명 통합 · 최신순' />
        <div className='divide-y divide-[color:var(--jaroo-border)] rounded-2xl border border-[color:var(--jaroo-border)] bg-white'>
          {feedTrades.map((trade) => (
            <FeedRow key={trade.id} trade={trade} />
          ))}
        </div>
      </section>

      <p className='px-1 pb-1 text-center text-[10px] leading-relaxed text-[color:var(--jaroo-muted)]'>
        본 페이지는 deepscan 홍보용 목업입니다 · 캐릭터·수익률·리포트는 가상 데이터이며 실제 수익을 보장하지 않습니다
      </p>
    </JarooShell>
  )
}
