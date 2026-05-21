'use client'

import type { DeepScanBlockState, JarooDeepScanPayload } from '../../packages/contracts/src/deepscan'
import type { DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import type { DeepScanTargetInput } from '@/lib/workflow-types'

import { AlertTriangle, BarChart3, CheckCircle2, FileText, Gauge, Target, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type DeepScanInlineResultsProps = {
  payload: JarooDeepScanPayload
  requestSeed?: DeepScanCanonicalTargetSession | null
  target?: DeepScanTargetInput | null
}

function blockLabel(state: DeepScanBlockState) {
  if (state === 'ok') {
    return '확인됨'
  }
  if (state === 'blocked') {
    return '원천 차단'
  }
  return '조회 실패'
}

function blockNotice(state: DeepScanBlockState, fallbackLabel?: string, errorMessage?: string | null) {
  if (state === 'ok') {
    return null
  }

  return fallbackLabel || errorMessage || (state === 'blocked' ? '원천에서 이 영역을 제공하지 않아 제외했습니다.' : '이 영역은 응답 오류로 일부만 표시합니다.')
}

function formatGeneratedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null
}

export function DeepScanInlineResults({ payload, requestSeed, target }: DeepScanInlineResultsProps) {
  const name = firstNonEmpty(payload.input.instrument.name, target?.name, requestSeed?.holding.name) ?? '선택 종목'
  const identifier = firstNonEmpty(payload.input.instrument.code, payload.input.instrument.ticker, target?.code, target?.ticker)
  const heroNotice = blockNotice(payload.hero.blockState, payload.hero.fallback?.label, payload.hero.error?.message)
  const strategyNotice = blockNotice(payload.strategy.blockState, payload.strategy.fallback?.label, payload.strategy.error?.message)
  const committeeNotice = blockNotice(payload.committee.blockState, payload.committee.fallback?.label, payload.committee.error?.message)
  const sellNotice = blockNotice(payload.sellNow.blockState, payload.sellNow.fallback?.label, payload.sellNow.error?.message)
  const portfolioNotice = blockNotice(payload.portfolioSimulation.blockState, payload.portfolioSimulation.fallback?.label, payload.portfolioSimulation.error?.message)
  const insightsNotice = blockNotice(payload.insights.blockState, payload.insights.fallback?.label, payload.insights.error?.message)
  const topAxis = payload.committee.axes.find((axis) => typeof axis.score === 'number') ?? payload.committee.axes[0]
  const topInsights = payload.insights.items.slice(0, 4)
  const generatedAt = formatGeneratedAt(payload.metadata.generatedAt)

  return (
    <section className='space-y-3 pb-2' aria-label='딥스캔 인라인 결과'>
      <article className='overflow-hidden rounded-[30px] border border-[#d9e9f7] bg-white shadow-[0_18px_40px_rgba(24,95,165,0.12)]'>
        <div className='bg-[linear-gradient(135deg,#10304f,#185fa5)] px-4 py-4 text-white'>
          <div className='flex items-center justify-between gap-3'>
            <span className='inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-[11px] font-black text-[#d7edff]'>
              <CheckCircle2 className='size-3.5' aria-hidden />
              실제 결과 도착
            </span>
            <span className='text-[10px] font-bold text-[#bdd9f4]'>{generatedAt}</span>
          </div>
          <h2 className='mt-4 text-[24px] font-black leading-tight tracking-[-0.05em]'>{payload.hero.headline}</h2>
          <p className='mt-2 text-[13px] leading-6 text-[#d9e9f8]'>{payload.hero.body}</p>
        </div>
        <div className='grid grid-cols-[104px_1fr] gap-3 p-4'>
          <div className='grid place-items-center rounded-[26px] bg-[#edf6ff] p-3 text-center'>
            <span className='text-[11px] font-black text-[#185fa5]'>{payload.hero.scoreLabel}</span>
            <strong className='mt-1 text-[34px] font-black leading-none tracking-[-0.06em] text-[#102f4e]'>{payload.hero.score}</strong>
            <span className='mt-1 text-[10px] font-bold text-[#7b8a98]'>{payload.hero.scoreDelta}</span>
          </div>
          <div className='min-w-0 rounded-[24px] border border-[#edf1f5] bg-[#fbfdff] p-3'>
            <p className='text-[11px] font-black text-[#7b8a98]'>{name}{identifier ? ` · ${identifier}` : ''}</p>
            <p className='mt-2 text-sm font-black leading-5 text-[#17202a]'>{payload.hero.statusText}</p>
            {heroNotice ? <p className='mt-2 text-xs leading-5 text-[#b66a00]'>{heroNotice}</p> : null}
          </div>
        </div>
      </article>

      <article className='rounded-[28px] border border-white bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.10)]' aria-label='핵심 지표'>
        <div className='flex items-center justify-between'>
          <h3 className='text-[15px] font-black tracking-[-0.03em] text-[#17202a]'>결과 핵심 지표</h3>
          <span className='rounded-full bg-[#eef6ff] px-2.5 py-1 text-[10px] font-black text-[#185fa5]'>{blockLabel(payload.strategy.blockState)}</span>
        </div>
        <div className='mt-3 grid grid-cols-2 gap-2'>
          {[
            ['현재가', payload.strategy.currentPriceText],
            ['목표가', payload.strategy.targetPriceText],
            ['주간 신호', payload.strategy.weekSignal],
            ['시나리오 확률', payload.strategy.scenarioProbability],
          ].map(([label, value]) => (
            <div key={label} className='rounded-[20px] border border-[#edf1f5] bg-[#fbfdff] p-3'>
              <p className='text-[10px] font-black text-[#8793a0]'>{label}</p>
              <p className='mt-1 text-[14px] font-black leading-5 text-[#17202a]'>{value || '표시할 데이터 없음'}</p>
            </div>
          ))}
        </div>
        {strategyNotice ? <Notice>{strategyNotice}</Notice> : null}
      </article>

      <article className='rounded-[28px] border border-white bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.10)]' aria-label='판단 시나리오'>
        <SectionTitle icon={Target} label='판단 시나리오' />
        <div className='mt-3 rounded-[24px] bg-[#f3f8fd] p-3'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-[16px] font-black tracking-[-0.03em] text-[#17202a]'>{payload.strategy.scenarioLabel}</p>
              <p className='mt-1 text-xs leading-5 text-[#657484]'>{payload.strategy.scenarioCondition}</p>
            </div>
            <strong className='rounded-2xl bg-white px-3 py-2 text-[15px] font-black text-[#185fa5]'>{payload.strategy.scenarioProbability}</strong>
          </div>
          {payload.strategy.scenarioPeriod ? <p className='mt-2 text-[11px] font-bold text-[#7b8a98]'>관찰 기간: {payload.strategy.scenarioPeriod}</p> : null}
        </div>
        {payload.strategy.scenarioDetails.length ? (
          <ul className='mt-3 space-y-2'>
            {payload.strategy.scenarioDetails.map((detail) => <li key={detail} className='rounded-2xl border border-[#edf1f5] bg-white px-3 py-2 text-xs leading-5 text-[#344150]'>{detail}</li>)}
          </ul>
        ) : null}
        {payload.strategy.otherScenarios.length ? (
          <div className='mt-3 grid gap-2'>
            {payload.strategy.otherScenarios.map((scenario) => (
              <div key={`${scenario.label}-${scenario.probability}`} className='flex items-start justify-between gap-3 rounded-2xl bg-[#fbfdff] px-3 py-2 text-xs'>
                <div>
                  <p className='font-black text-[#17202a]'>{scenario.label}</p>
                  <p className='mt-1 leading-5 text-[#657484]'>{scenario.condition}</p>
                </div>
                <span className='shrink-0 font-black text-[#185fa5]'>{scenario.probability}</span>
              </div>
            ))}
          </div>
        ) : null}
      </article>

      <article className='rounded-[28px] border border-white bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.10)]' aria-label='위원회 요약'>
        <SectionTitle icon={Gauge} label='AI 위원회 요약' trailing={payload.metadata.llmCommittee ? `${payload.metadata.llmCommittee.completed}명 완료` : undefined} />
        {committeeNotice ? <Notice>{committeeNotice}</Notice> : null}
        {topAxis ? (
          <div className='mt-3 rounded-[24px] border border-[#edf1f5] bg-[#fbfdff] p-3'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <p className='text-[15px] font-black text-[#17202a]'>{topAxis.label}</p>
                <p className='mt-1 text-xs text-[#657484]'>{topAxis.subtitle}</p>
              </div>
              <strong className='text-[22px] font-black text-[#185fa5]'>{topAxis.scoreText}</strong>
            </div>
            <p className='mt-2 text-xs font-bold text-[#7b8a98]'>{topAxis.axisStatusText}</p>
          </div>
        ) : null}
        <div className='mt-3 grid gap-2'>
          {payload.committee.axes.slice(0, 3).map((axis) => (
            <div key={axis.label} className='rounded-2xl bg-[#f7fafc] px-3 py-2'>
              <div className='flex justify-between gap-3 text-xs font-black text-[#17202a]'>
                <span>{axis.label}</span>
                <span>{axis.scoreText}</span>
              </div>
              <p className='mt-1 text-[11px] leading-4 text-[#657484]'>{axis.avgLabel}</p>
            </div>
          ))}
        </div>
      </article>

      <article className='rounded-[28px] border border-white bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.10)]' aria-label='매도 및 포트폴리오 참고'>
        <SectionTitle icon={BarChart3} label='행동 참고' />
        {sellNotice ? <Notice>{sellNotice}</Notice> : null}
        {portfolioNotice ? <Notice>{portfolioNotice}</Notice> : null}
        <p className='mt-3 rounded-[24px] bg-[#fff8ed] p-3 text-sm font-black leading-6 text-[#8a5400]'>{payload.sellNow.realizedText || '즉시 매도 참고 데이터가 제공되지 않았습니다.'}</p>
        {payload.sellNow.rows.length ? (
          <div className='mt-3 grid gap-2'>
            {payload.sellNow.rows.map((row) => (
              <div key={`${row.label}-${row.value}`} className='flex items-center justify-between gap-3 rounded-2xl border border-[#edf1f5] bg-white px-3 py-2'>
                <span className='text-xs font-bold text-[#657484]'>{row.label}</span>
                <span className={cn('text-sm font-black', row.valueTone === 'danger' ? 'text-[#d64141]' : 'text-[#17202a]')}>{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className='mt-3 grid grid-cols-3 gap-2 rounded-[24px] bg-[#f3f8fd] p-3 text-center'>
          <Metric label='현재' value={String(payload.portfolioSimulation.beforeScore)} />
          <Metric label='조정 후' value={String(payload.portfolioSimulation.afterScore)} />
          <Metric label='변화' value={payload.portfolioSimulation.deltaLabel} />
        </div>
        {payload.portfolioSimulation.caption ? <p className='mt-2 text-[11px] leading-5 text-[#657484]'>{payload.portfolioSimulation.caption}</p> : null}
      </article>

      <article className='rounded-[28px] border border-white bg-white/95 p-4 shadow-[0_14px_34px_rgba(24,95,165,0.10)]' aria-label='근거와 출처'>
        <SectionTitle icon={FileText} label={payload.insights.sectionLabel || '근거와 출처'} trailing={payload.insights.summaryTags.join(' · ')} />
        {insightsNotice ? <Notice>{insightsNotice}</Notice> : null}
        <div className='mt-3 space-y-2'>
          {topInsights.length ? topInsights.map((item) => (
            <details key={`${item.sourceLabel}-${item.title}`} className='rounded-2xl border border-[#edf1f5] bg-[#fbfdff] px-3 py-2'>
              <summary className='cursor-pointer text-xs font-black text-[#17202a]'>{item.label} · {item.title}</summary>
              <p className='mt-2 text-xs leading-5 text-[#657484]'>{item.body}</p>
              <p className='mt-2 text-[10px] font-bold text-[#8a96a3]'>{item.sourceLabel} · {item.date}</p>
            </details>
          )) : <p className='rounded-2xl bg-[#f7fafc] px-3 py-3 text-xs text-[#657484]'>표시할 근거 항목이 없습니다.</p>}
        </div>
      </article>

      <p className='px-2 pb-2 text-center text-[10px] leading-4 text-[#8a96a3]'>DeepScan은 데이터 분석 기반 참고 자료이며, 투자 권유나 수익 보장이 아닙니다.</p>
    </section>
  )
}

function SectionTitle({ icon: Icon, label, trailing }: { icon: LucideIcon; label: string; trailing?: string }) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex items-center gap-2'>
        <span className='grid size-8 place-items-center rounded-2xl bg-[#eef6ff] text-[#185fa5]'><Icon className='size-4' aria-hidden /></span>
        <h3 className='text-[15px] font-black tracking-[-0.03em] text-[#17202a]'>{label}</h3>
      </div>
      {trailing ? <span className='max-w-[42%] truncate rounded-full bg-[#f3f6f9] px-2.5 py-1 text-[10px] font-black text-[#657484]'>{trailing}</span> : null}
    </div>
  )
}

function Notice({ children }: { children: string }) {
  return (
    <p className='mt-3 flex gap-2 rounded-2xl bg-[#fff8ed] px-3 py-2 text-xs leading-5 text-[#8a5400]'>
      <AlertTriangle className='mt-0.5 size-3.5 shrink-0' aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className='text-[10px] font-black text-[#7b8a98]'>{label}</p>
      <p className='mt-1 text-sm font-black text-[#17202a]'>{value}</p>
    </div>
  )
}
