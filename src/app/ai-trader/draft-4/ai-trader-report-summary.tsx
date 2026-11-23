// 초안④ 리포트 요약 헤더 — 선택한 deepscan 리포트를 "정점"에 세우는 카드.
// 모든 캐릭터가 이 카드의 근거(hero score·회복확률·목표가)를 바라보고 각자 다르게 해석한다.
import { BadgeCheck, Target, TrendingUp } from 'lucide-react'
import type { JarooDeepScanPayload } from '../../../../packages/contracts/src/deepscan'
import { cn } from '@/lib/utils'
import { formatKst, scoreBand } from './mock-data'

/** hero score 0-100 도넛 게이지 (SVG) */
function ScoreGauge({ score }: { score: number }) {
  const band = scoreBand(score)
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference
  return (
    <div className='relative size-[84px] shrink-0'>
      <svg viewBox='0 0 72 72' className='size-full -rotate-90' aria-hidden='true'>
        <circle cx='36' cy='36' r={radius} fill='none' stroke='var(--jaroo-neutral-soft)' strokeWidth='7' />
        <circle
          cx='36'
          cy='36'
          r={radius}
          fill='none'
          stroke={band.stroke}
          strokeWidth='7'
          strokeLinecap='round'
          strokeDasharray={`${filled} ${circumference - filled}`}
          className='transition-[stroke-dasharray] duration-500'
        />
      </svg>
      <div className='absolute inset-0 flex flex-col items-center justify-center'>
        <span className={cn('text-[20px] font-black leading-none', band.text)}>{score}</span>
        <span className='mt-0.5 text-[9px] text-[color:var(--jaroo-muted)]'>/ 100</span>
      </div>
    </div>
  )
}

/** 원금회수 확률 3m/6m/1y 미니 바 */
function RecoveryMiniBars({ horizons, headlineText, confidenceLevel, confidenceText }: {
  horizons: { '3m'?: number | null; '6m'?: number | null; '1y'?: number | null }
  headlineText?: string | null
  confidenceLevel?: 'high' | 'medium' | 'low' | null
  confidenceText: string
}) {
  const rows = [
    { key: '3m', label: '3개월', pct: horizons['3m'] },
    { key: '6m', label: '6개월', pct: horizons['6m'] },
    { key: '1y', label: '1년', pct: horizons['1y'] },
  ] as const
  const confidenceChip = {
    high: { text: '신뢰도 높음', cls: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-flat)]' },
    medium: { text: '신뢰도 보통', cls: 'bg-[color:var(--jaroo-secondary)] text-[color:var(--jaroo-muted)]' },
    low: { text: '신뢰도 낮음', cls: 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]' },
  }[confidenceLevel ?? 'medium']
  return (
    <div className='rounded-xl border border-[color:var(--jaroo-border)] p-3'>
      <div className='flex items-center justify-between'>
        <div className='text-[12px] font-bold text-[color:var(--jaroo-ink)]'>원금회수 확률</div>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', confidenceChip.cls)}>{confidenceChip.text}</span>
      </div>
      <div className='mt-2 space-y-1.5'>
        {rows.map((row) => (
          <div key={row.key} className='flex items-center gap-2'>
            <span className='w-9 shrink-0 text-[10px] text-[color:var(--jaroo-muted)]'>{row.label}</span>
            <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--jaroo-neutral-soft)]'>
              <div
                className='h-full rounded-full bg-[color:var(--jaroo-primary)] transition-[width] duration-500'
                style={{ width: `${Math.min(100, Math.max(0, row.pct ?? 0))}%` }}
              />
            </div>
            <span className='w-9 shrink-0 text-right text-[11px] font-bold tabular-nums text-[color:var(--jaroo-ink)]'>
              {row.pct ?? '-'}%
            </span>
          </div>
        ))}
      </div>
      <div className='mt-2 truncate text-[10px] text-[color:var(--jaroo-muted)]' title={confidenceText}>
        {headlineText ?? confidenceText}
      </div>
    </div>
  )
}

export function ReportSummaryCard({ payload }: { payload: JarooDeepScanPayload }) {
  const hero = payload.hero
  const committeeMembers = payload.committee.axes.flatMap((axis) => axis.members)
  const band = scoreBand(hero.score)
  return (
    <section className='overflow-hidden rounded-2xl border border-[color:var(--jaroo-border)] bg-white shadow-sm' aria-label='선택한 딥스캔 리포트 요약'>
      {/* 종목명 + 현재가 + 동일 리포트 배지 */}
      <div className='flex items-start justify-between gap-2 px-4 pt-4'>
        <div className='min-w-0'>
          <div className='truncate text-[15px] font-bold text-[color:var(--jaroo-ink)]'>
            {payload.input.instrument.name}
            <span className='ml-1.5 text-[11px] font-medium text-[color:var(--jaroo-muted)]'>
              {payload.input.instrument.code} · {payload.input.instrument.market}
            </span>
          </div>
          <div className='mt-1.5 flex items-center gap-1.5'>
            <span className='inline-flex items-center gap-1 rounded-full bg-[color:var(--jaroo-accent)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--jaroo-primary)]'>
              <BadgeCheck className='size-3 shrink-0' aria-hidden='true' />
              사용자와 동일한 리포트
            </span>
            <span className='truncate text-[10px] text-[color:var(--jaroo-muted)]' title={payload.metadata.debugId}>
              {payload.metadata.debugId} · {formatKst(payload.metadata.generatedAt)}
            </span>
          </div>
        </div>
        <div className='shrink-0 text-right'>
          <div className='text-[10px] text-[color:var(--jaroo-muted)]'>현재가</div>
          <div className='text-[15px] font-bold tabular-nums text-[color:var(--jaroo-ink)]'>{payload.strategy.currentPriceText}</div>
        </div>
      </div>

      {/* 게이지 + 주간 시그널 + 목표가 */}
      <div className='mx-4 mt-3 flex items-center gap-4 rounded-xl bg-[color:var(--jaroo-secondary)] p-3'>
        <ScoreGauge score={hero.score} />
        <div className='min-w-0 flex-1 space-y-1.5'>
          <div className='flex items-center gap-1.5'>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold', band.text, 'bg-white')}>
              {hero.scoreLabel.split(' ')[0]}
            </span>
            <span className='truncate text-[10px] text-[color:var(--jaroo-muted)]'>{hero.scoreDelta}</span>
          </div>
          <div className='flex items-center gap-1.5'>
            <TrendingUp className='size-3.5 shrink-0 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate text-[11.5px] text-[color:var(--jaroo-ink)]'>
              <span className='font-bold'>{payload.strategy.weekBadgeText}</span>
              <span className='text-[color:var(--jaroo-muted)]'> · {payload.strategy.weekSignal}</span>
            </span>
          </div>
          <div className='flex items-center gap-1.5'>
            <Target className='size-3.5 shrink-0 text-[color:var(--jaroo-primary)]' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate text-[11.5px] text-[color:var(--jaroo-ink)]'>
              <span className='text-[color:var(--jaroo-muted)]'>목표가 </span>
              <span className='font-bold'>{payload.strategy.targetPriceText}</span>
            </span>
          </div>
        </div>
      </div>

      <div className='space-y-3 px-4 pb-4 pt-3'>
        {/* 원금회수 확률 3m/6m/1y */}
        <RecoveryMiniBars
          horizons={payload.recoveryForecast?.recoveryHorizonProbabilities ?? {}}
          headlineText={payload.recoveryForecast?.recoveryProbabilityHeadlineText}
          confidenceLevel={payload.recoveryForecast?.confidenceLevel}
          confidenceText={payload.recoveryForecast?.confidenceText ?? ''}
        />

        {/* 위원회 — 캐릭터들이 함께 본 근거 */}
        <div>
          <div className='text-[12px] font-bold text-[color:var(--jaroo-ink)]'>위원회 점수 <span className='text-[10px] font-medium text-[color:var(--jaroo-muted)]'>· 4명의 트레이더가 함께 본 근거</span></div>
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            {committeeMembers.map((member) => (
              <span
                key={member.shortLabel}
                title={member.reason ?? undefined}
                className='inline-flex items-center gap-1 rounded-full bg-[color:var(--jaroo-secondary)] px-2 py-1 text-[11px] text-[color:var(--jaroo-ink)]'
              >
                <span className={cn(
                  'size-1.5 rounded-full',
                  member.tone === 'positive' ? 'bg-[color:var(--jaroo-profit)]' : member.tone === 'warning' ? 'bg-[color:var(--jaroo-warning)]' : 'bg-[color:var(--jaroo-muted)]',
                )} />
                {member.shortLabel}
                <span className='font-bold tabular-nums'>{member.score}점</span>
              </span>
            ))}
          </div>
        </div>

        {/* 확인한 근거 팩트 */}
        {hero.evidenceFacts?.length ? (
          <div>
            <div className='text-[12px] font-bold text-[color:var(--jaroo-ink)]'>확인한 근거</div>
            <div className='mt-1.5 flex flex-wrap gap-1.5'>
              {hero.evidenceFacts.map((fact) => (
                <span key={fact} className='inline-flex max-w-full items-center gap-1 rounded-full border border-[color:var(--jaroo-border)] bg-[color:var(--jaroo-secondary)] px-2.5 py-1 text-[11px] leading-4 text-[color:var(--jaroo-ink)]'>
                  <BadgeCheck className='size-3 shrink-0 text-[color:var(--jaroo-muted)]' aria-hidden='true' />
                  <span className='truncate'>{fact}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
