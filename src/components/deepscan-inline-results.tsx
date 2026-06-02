'use client'

import type {
  JarooDeepScanPayload,
  JarooDeepScanStrategyScenario,
} from '../../packages/contracts/src/deepscan'
import type { DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import type { DeepScanTargetInput } from '@/lib/workflow-types'

import { cn } from '@/lib/utils'

type DeepScanInlineResultsProps = {
  payload: JarooDeepScanPayload
  requestSeed?: DeepScanCanonicalTargetSession | null
  target?: DeepScanTargetInput | null
}

type ScenarioView = {
  label: string
  probability: string
  condition: string
  tone: 'green' | 'blue' | 'red'
  recommended?: boolean
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null
}

function parsePercent(value: string | null | undefined) {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1).replace(/\.0$/u, '')}%`
}

function parseMoneyNumber(value: string | null | undefined) {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function deriveUpside(currentText: string | null | undefined, targetText: string | null | undefined) {
  const current = parseMoneyNumber(currentText)
  const target = parseMoneyNumber(targetText)
  if (current === null || target === null || current === 0) return null
  return ((target / current) - 1) * 100
}

function buildStrength(payload: JarooDeepScanPayload) {
  const score = payload.hero.score
  if (score >= 67) return { label: '강세', helper: '긍정 우세', active: 4 }
  if (score >= 55) return { label: '중립+', helper: '긍정·중립 혼재', active: 3 }
  if (score >= 45) return { label: '중립', helper: '추가 확인 필요', active: 2 }
  return { label: '주의', helper: '방어 우선', active: 1 }
}

function buildScenarioViews(payload: JarooDeepScanPayload): ScenarioView[] {
  if (payload.strategy?.blockState !== 'ok') {
    return [{ label: '관망', probability: '--', condition: payload.strategy?.fallback?.label || payload.strategy?.error?.message || '전략 데이터를 확인하는 중이에요.', tone: 'blue', recommended: true }]
  }

  const primary: ScenarioView = {
    label: payload.strategy?.scenarioLabel || '보유 유지',
    probability: payload.strategy?.scenarioProbability || '--',
    condition: [payload.strategy?.scenarioCondition, payload.strategy?.scenarioPeriod].filter(Boolean).join(' · ') || '조건 확인 중',
    tone: 'green',
    recommended: true,
  }
  const others = (payload.strategy?.otherScenarios ?? []).slice(0, 2).map((scenario, index): ScenarioView => ({
    label: scenario.label,
    probability: scenario.probability,
    condition: scenario.condition,
    tone: index === 0 ? 'blue' : 'red',
  }))
  return [primary, ...others]
}

function scenarioWidth(scenario: Pick<JarooDeepScanStrategyScenario, 'probability'> | ScenarioView) {
  const pct = parsePercent(scenario.probability)
  return `${Math.max(0, Math.min(100, pct ?? 0))}%`
}

function toneClasses(tone: ScenarioView['tone']) {
  if (tone === 'green') return { dot: 'bg-[#1A9D55]', bar: 'bg-[#1A9D55]', text: 'text-[#1A9D55]' }
  if (tone === 'red') return { dot: 'bg-[#E5484D]', bar: 'bg-[#E5484D]', text: 'text-[#E5484D]' }
  return { dot: 'bg-[#2B6BE6]', bar: 'bg-[#2B6BE6]', text: 'text-[#2B6BE6]' }
}

export function DeepScanInlineResults({ payload, requestSeed, target }: DeepScanInlineResultsProps) {
  const name = firstNonEmpty(payload.input.instrument.name, target?.name, requestSeed?.holding.name) ?? '선택 종목'
  const strength = buildStrength(payload)
  const scenarios = buildScenarioViews(payload)
  const upside = deriveUpside(payload.strategy.currentPriceText, payload.strategy.targetPriceText)
  const evidenceCount = payload.metadata.sourceRefs.length || payload.insights.items.length
  const summary = payload.hero.blockState === 'ok'
    ? payload.hero.body
    : payload.hero.fallback?.label || payload.hero.error?.message || `${name} 분석 결과를 일부만 표시하고 있어요.`
  const facts = [
    ['현재가', payload.strategy.currentPriceText || '확인 중'],
    ['목표가', payload.strategy.targetPriceText || '확인 중'],
    ['상승 여력', upside === null ? '확인 중' : formatPercent(upside)],
    ['근거', evidenceCount > 0 ? `${evidenceCount}개` : payload.insights.summaryTags[0] ?? '확인 중'],
  ]

  return (
    <section className='space-y-3 pb-2' aria-label='딥스캔 v7 실제 결과'>
      <article className='overflow-hidden rounded-[16px] border border-[#E8EAEE] bg-white shadow-[0_1px_3px_rgba(0,0,0,.04)]' aria-label='AI 종합 결론'>
        <div className='flex items-center gap-3 border-b border-[#EFF1F4] px-4 py-4'>
          <div className='flex size-9 items-center justify-center rounded-[10px] bg-[#0F1419] text-[12px] font-black text-white'>AI</div>
          <div><div className='text-[10px] text-[#97A0AE]'>종합 결론</div><h2 className='text-[14px] font-bold text-[#0F1419]'>세 팀의 의견을 모았어요</h2></div>
        </div>
        <div className='px-4 py-5 text-center'>
          <div className={cn('text-[28px] font-black leading-none', strength.active <= 1 ? 'text-[#E5484D]' : 'text-[#1A9D55]')}>{strength.label}</div>
          <div className='mx-auto mt-3 flex w-[122px] gap-1'>{Array.from({ length: 5 }, (_, index) => <span key={index} className={cn('h-[6px] flex-1 rounded-full', index < strength.active ? 'bg-[#1A9D55]' : 'bg-[#E8EAEE]')} />)}</div>
          <p className='mt-2 text-[11px] text-[#5A6473]'>{strength.helper}</p>
        </div>
        <p className='border-t border-[#EFF1F4] px-4 py-4 text-[13px] leading-6 text-[#0F1419]'>{summary}</p>
        <div className='border-t border-[#EFF1F4] px-4 py-4'>
          <div className='mb-3 text-[10px] text-[#97A0AE]'>추천 행동</div>
          <div className='space-y-3'>
            {scenarios.map((scenario) => {
              const tone = toneClasses(scenario.tone)
              return (
                <div key={`${scenario.label}-${scenario.probability}`}>
                  <div className='mb-1 flex items-center gap-2 text-[13px]'>
                    <span className={cn('size-2 rounded-full', tone.dot)} />
                    <span className={cn('font-bold', scenario.recommended ? 'text-[#0F1419]' : 'text-[#5A6473]')}>{scenario.label}</span>
                    {scenario.recommended ? <span className='rounded-[4px] bg-[#0F1419] px-1.5 py-0.5 text-[9px] font-bold text-white'>추천</span> : null}
                    <span className='ml-auto font-bold text-[#5A6473]'>{scenario.probability || '--'}</span>
                  </div>
                  <div className='h-[5px] overflow-hidden rounded-full bg-[#EFF1F4]'><div className={cn('h-full rounded-full', tone.bar)} style={{ width: scenarioWidth(scenario) }} /></div>
                  <div className={cn('mt-1 text-[10px]', scenario.tone === 'red' ? tone.text : 'text-[#97A0AE]')}>{scenario.condition}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div className='grid grid-cols-2 border-t border-[#EFF1F4]'>
          {facts.map(([label, value]) => (
            <div key={label} className='border-b border-r border-[#EFF1F4] px-4 py-3 last:border-r-0 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0'>
              <div className='text-[10px] text-[#97A0AE]'>{label}</div>
              <div className={cn('mt-1 text-[14px] font-bold text-[#0F1419]', label === '상승 여력' && upside !== null && upside > 0 ? 'text-[#1A9D55]' : undefined)}>{value}</div>
            </div>
          ))}
        </div>
      </article>
      <p className='px-2 pb-2 text-center text-[10px] leading-4 text-[#97A0AE]'>AI 분석은 데이터 기반 참고 자료예요. 투자 권유나 수익 보장이 아닙니다.</p>
    </section>
  )
}
