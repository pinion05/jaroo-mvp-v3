'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type {
  JarooDeepScanPayload,
  JarooDeepScanStrategyScenario,
} from '../../packages/contracts/src/deepscan'
import type { DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import type { DeepScanTargetInput } from '@/lib/workflow-types'

import { cn } from '@/lib/utils'
import { DeepScanRecoveryForecastCard } from '@/components/deepscan-recovery-forecast-card'

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

function isExchangeProductPayload(payload: JarooDeepScanPayload) {
  return /(?:^|\b)(?:ETF|ETN)(?:\b|$)/iu.test(payload.input.instrument.market ?? '') || /^(?:etf|etn)$/iu.test(payload.input.instrument.kind ?? '')
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

function sanitizeExchangeProductCopy(value: string) {
  return value
    .replace(/ETF\s*특성상\s*개별\s*종목\s*분석과\s*목표가가?\s*없어\s*추가\s*상승\s*여력을\s*판단하기\s*어렵다\.?/gu, 'ETF는 NAV 괴리율과 기초지수 흐름 확인이 추가 판단의 핵심입니다.')
    .replace(/(?:개별\s*)?(?:종목\s*)?(?:분석과\s*)?목표가(?:와|가|는|를)?\s*없(?:어|어서|고)?[^.!?。！？]*(?:상승\s*여력|판단)[^.!?。！？]*(?:[.!?。！？]|$)/gu, 'NAV 괴리율과 기초지수 흐름을 추가로 확인해야 합니다. ')
    .replace(/목표가?\s*부재/gu, 'NAV·기초지수 확인 필요')
    .replace(/목표가/gu, 'ETF 기준')
    .replace(/상승\s*여력/gu, '지수·가격 여지')
    .replace(/수익을\s*실현했지만/gu, '평가이익이 있지만')
    .replace(/매도\s*판단/gu, '비중 점검')
    .replace(/매도\s*의사결정/gu, '비중 점검')
    .replace(/애널리스트\s*ETF\s*기준와\s*종목별\s*PER\/PBR\s*데이터는\s*제공되지\s*않습니다\.?/gu, 'NAV·괴리율과 구성종목 정보를 추가로 확인해야 합니다.')
    .replace(/종목별\s*PER\/PBR\s*데이터는\s*제공되지\s*않습니다\.?/gu, 'NAV·괴리율과 구성종목 정보를 추가로 확인해야 합니다.')
    .replace(/PER\/PBR/gu, 'NAV·괴리율')
    .replace(/ETF\s*기준와/gu, 'ETF 기준과')
    .replace(/보유\s*종목/gu, '보유 ETF')
    .replace(/보유\s*ETF은/gu, '보유 ETF는')
    .replace(/지수·가격\s*여지이/gu, '지수·가격 여지가')
    .replace(/보유\s*평가/gu, '현재 구간 평가')
    .replace(/추가\s*매수/gu, '추가 점검')
    .replace(/분할\s*매도/gu, '단계별 점검')
    .replace(/손절/gu, '방어 점검')
}

function buildScenarioViews(payload: JarooDeepScanPayload, exchangeProduct = false): ScenarioView[] {
  if (payload.strategy?.blockState !== 'ok') {
    return [{ label: '관망', probability: '--', condition: payload.strategy?.fallback?.label || payload.strategy?.error?.message || '전략 데이터를 확인하는 중이에요.', tone: 'blue', recommended: true }]
  }

  const primary: ScenarioView = {
    label: exchangeProduct ? sanitizeExchangeProductCopy(payload.strategy?.scenarioLabel || '기준 시나리오') : payload.strategy?.scenarioLabel || '보유 유지',
    probability: payload.strategy?.scenarioProbability || '--',
    condition: exchangeProduct
      ? sanitizeExchangeProductCopy([payload.strategy?.scenarioCondition, payload.strategy?.scenarioPeriod].filter(Boolean).join(' · ') || '조건 확인 중')
      : [payload.strategy?.scenarioCondition, payload.strategy?.scenarioPeriod].filter(Boolean).join(' · ') || '조건 확인 중',
    tone: 'green',
    recommended: true,
  }
  const others = (payload.strategy?.otherScenarios ?? []).slice(0, 2).map((scenario, index): ScenarioView => ({
    label: exchangeProduct ? sanitizeExchangeProductCopy(scenario.label) : scenario.label,
    probability: scenario.probability,
    condition: exchangeProduct ? sanitizeExchangeProductCopy(scenario.condition) : scenario.condition,
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

function findConsensus(payload: JarooDeepScanPayload) {
  const items = payload.insights?.items ?? []
  return items.find((item) => item.consensus && (item.consensus.targetPrice != null || item.consensus.analystCount != null))?.consensus ?? null
}

function formatConsensusPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function axisStatusTone(status: string) {
  if (status.includes('우세')) return 'text-[#1A9D55]'
  if (status.includes('경계')) return 'text-[#E5484D]'
  return 'text-[#5A6473]'
}

type DetailSectionProps = {
  n: string
  title: string
  meta?: string
  children: ReactNode
}

function DetailSection({ n, title, meta, children }: DetailSectionProps) {
  return (
    <section>
      <div className='mb-2.5 flex items-center gap-2'>
        <span className='flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#0F1419] text-[10px] font-bold text-white'>{n}</span>
        <span className='text-[12.5px] font-bold text-[#0F1419]'>{title}</span>
        {meta ? <span className='ml-auto text-[10px] text-[#97A0AE]'>{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}
export function DeepScanInlineResults({ payload, requestSeed, target }: DeepScanInlineResultsProps) {
  const exchangeProduct = isExchangeProductPayload(payload)
  const name = firstNonEmpty(payload.input.instrument.name, target?.name, requestSeed?.holding.name) ?? '선택 종목'
  const strength = buildStrength(payload)
  const scenarios = buildScenarioViews(payload, exchangeProduct)
  const upside = exchangeProduct ? null : deriveUpside(payload.strategy.currentPriceText, payload.strategy.targetPriceText)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const consensus = exchangeProduct ? null : findConsensus(payload)
  const evidenceCount = payload.metadata.sourceRefs.length || payload.insights.items.length
  const rawSummary = payload.hero.blockState === 'ok'
    ? payload.hero.body
    : payload.hero.fallback?.label || payload.hero.error?.message || `${name} 분석 결과를 일부만 표시하고 있어요.`
  const summary = exchangeProduct ? sanitizeExchangeProductCopy(rawSummary) : rawSummary
  const facts = exchangeProduct
    ? [
        ['ETF 기준', payload.strategy.targetPriceText || 'NAV·구성 확인'],
        ['가격 위치', payload.strategy.otherScenarioTags?.[1] ?? '확인 중'],
        ['근거', evidenceCount > 0 ? `${evidenceCount}개` : payload.insights.summaryTags[0] ?? '확인 중'],
      ]
    : [
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
          <div className={cn('text-[28px] font-black leading-none', strength.active <= 1 ? 'text-[#2B6BE6]' : 'text-[#E5484D]')}>{strength.label}</div>
          <div className='mx-auto mt-3 flex w-[122px] gap-1'>{Array.from({ length: 5 }, (_, index) => <span key={index} className={cn('h-[6px] flex-1 rounded-full', index < strength.active ? 'bg-[#E5484D]' : 'bg-[#E8EAEE]')} />)}</div>
          <p className='mt-2 text-[11px] text-[#5A6473]'>{strength.helper}</p>
        </div>
        <p className='border-t border-[#EFF1F4] px-4 py-4 text-[13px] leading-6 text-[#0F1419]'>{summary}</p>
        <div className='grid grid-cols-3 border-t border-[#EFF1F4]'>
          {facts.map(([label, value]) => (
            <div key={label} className='border-r border-[#EFF1F4] px-3 py-3 last:border-r-0'>
              <div className='text-[10px] text-[#97A0AE]'>{label}</div>
              <div className={cn('mt-1 text-[13px] font-bold text-[#0F1419]', label === '상승 여력' && upside !== null && upside > 0 ? 'text-[color:var(--jaroo-profit)]' : undefined)}>{value}</div>
            </div>
          ))}
        </div>
        <div className='border-t border-[#EFF1F4]'>
          <button type='button' aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)} className='flex w-full items-center gap-2 px-4 py-3.5 text-left'>
            <span className='text-[13px] font-bold text-[#0F1419]'>자세히 보기</span>
            <span className='text-[10px] text-[#97A0AE]'>{exchangeProduct ? '가능 시나리오 · 가격 근거 · 세 팀 의견' : '추천 행동 · 목표가 근거 · 세 팀 의견'}</span>
            <svg className={cn('ml-auto size-4 transition-transform duration-200', detailsOpen ? 'rotate-180' : '', 'text-[#5A6473]')} width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='m6 9 6 6 6-6' /></svg>
          </button>
          <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', detailsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            <div className='overflow-hidden'>
              <div className='space-y-4 border-t border-[#EFF1F4] px-4 py-4 pb-5'>
                <DetailSection n='1' title={exchangeProduct ? '가능 시나리오' : '추천 행동'}>
                  <div className='space-y-3'>
                    {scenarios.map((scenario) => {
                      const tone = toneClasses(scenario.tone)
                      return (
                        <div key={`${scenario.label}-${scenario.probability}`}>
                          <div className='mb-1 flex items-center gap-2 text-[13px]'>
                            <span className={cn('size-2 rounded-full', tone.dot)} />
                            <span className={cn('font-bold', scenario.recommended ? 'text-[#0F1419]' : 'text-[#5A6473]')}>{scenario.label}</span>
                            {scenario.recommended ? <span className='rounded-[4px] bg-[#0F1419] px-1.5 py-0.5 text-[9px] font-bold text-white'>{exchangeProduct ? '주요' : '추천'}</span> : null}
                            <span className='ml-auto font-bold text-[#5A6473]'>{scenario.probability || '--'}</span>
                          </div>
                          <div className='h-[5px] overflow-hidden rounded-full bg-[#EFF1F4]'><div className={cn('h-full rounded-full', tone.bar)} style={{ width: scenarioWidth(scenario) }} /></div>
                          <div className={cn('mt-1 text-[10px]', scenario.tone === 'red' ? tone.text : 'text-[#97A0AE]')}>{scenario.condition}</div>
                        </div>
                      )
                    })}
                  </div>
                </DetailSection>
                {!exchangeProduct ? (
                  <DetailSection n='2' title='목표가 근거' meta={consensus?.analystCount ? `증권사 ${consensus.analystCount}개` : undefined}>
                    <div className='overflow-hidden rounded-[12px] border border-[#E8EAEE]'>
                      <div className='grid grid-cols-2 divide-x divide-[#EFF1F4] border-b border-[#EFF1F4]'>
                        <div className='px-3 py-3'><div className='text-[10px] text-[#97A0AE]'>현재가</div><div className='mt-1 text-[13px] font-bold text-[#0F1419]'>{payload.strategy.currentPriceText || '확인 중'}</div></div>
                        <div className='px-3 py-3'><div className='text-[10px] text-[#97A0AE]'>평균 목표가</div><div className={cn('mt-1 text-[13px] font-bold text-[#0F1419]', upside !== null && upside > 0 ? 'text-[color:var(--jaroo-profit)]' : undefined)}>{(formatConsensusPrice(consensus?.targetPrice) ?? payload.strategy.targetPriceText) || '확인 중'}</div></div>
                      </div>
                      {consensus?.highestTargetPrice != null || consensus?.lowestTargetPrice != null ? (
                        <div className='grid grid-cols-2 divide-x divide-[#EFF1F4] border-b border-[#EFF1F4]'>
                          <div className='px-3 py-2.5'><div className='text-[10px] text-[#97A0AE]'>최고 목표가</div><div className='mt-0.5 text-[12px] font-bold text-[#0F1419]'>{formatConsensusPrice(consensus?.highestTargetPrice) ?? '--'}</div></div>
                          <div className='px-3 py-2.5'><div className='text-[10px] text-[#97A0AE]'>최저 목표가</div><div className='mt-0.5 text-[12px] font-bold text-[#0F1419]'>{formatConsensusPrice(consensus?.lowestTargetPrice) ?? '--'}</div></div>
                        </div>
                      ) : null}
                      {consensus?.opinionSummary ? <div className='px-3 py-2.5 text-[11px] leading-5 text-[#5A6473]'>{consensus.opinionSummary}</div> : null}
                    </div>
                  </DetailSection>
                ) : (
                  <DetailSection n='2' title='가격 근거'>
                    <div className='overflow-hidden rounded-[12px] border border-[#E8EAEE]'>
                      <div className='grid grid-cols-2 divide-x divide-[#EFF1F4]'>
                        <div className='px-3 py-3'><div className='text-[10px] text-[#97A0AE]'>현재가</div><div className='mt-1 text-[12px] font-bold text-[#0F1419]'>{payload.strategy.currentPriceText || '확인 중'}</div></div>
                        <div className='px-3 py-3'><div className='text-[10px] text-[#97A0AE]'>ETF 기준</div><div className='mt-1 text-[12px] font-bold text-[#0F1419]'>{payload.strategy.targetPriceText || 'NAV·구성 확인'}</div></div>
                      </div>
                    </div>
                  </DetailSection>
                )}
                {payload.committee.axes.length > 0 ? (
                  <DetailSection n='3' title='세 팀 의견' meta={payload.committee.axes.length > 1 ? `${payload.committee.axes.length}팀` : undefined}>
                    <div className='space-y-2'>
                      {payload.committee.axes.map((axis) => (
                        <div key={axis.label} className='flex items-center gap-2 rounded-[12px] border border-[#E8EAEE] bg-[#F8F9FB] px-3 py-2.5'>
                          <div><div className='text-[12px] font-bold text-[#0F1419]'>{axis.label}</div><div className='mt-0.5 text-[10px] text-[#97A0AE]'>{axis.subtitle}</div></div>
                          <span className={cn('ml-auto shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-bold', axisStatusTone(axis.axisStatusText ?? ''))}>{axis.axisStatusText || '확인 중'}</span>
                        </div>
                      ))}
                    </div>
                  </DetailSection>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </article>
      <DeepScanRecoveryForecastCard payload={payload} />
      <article className='rounded-[16px] bg-[#0F1419] px-4 py-[18px] text-white' aria-label='딥스캔 후속 안내'>
        <div className='mb-2.5 flex items-center gap-2.5'>
          <div className='flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white/10 text-white/85'>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round'><path d='M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z' /><circle cx='12' cy='12' r='3' /></svg>
          </div>
          <h3 className='text-[14.5px] font-bold tracking-[-0.2px]'>이 판단, 계속 지켜봐드릴까요?</h3>
        </div>
        <p className='text-[12px] leading-[1.65] text-white/60'>
          오늘 나온 결론은 <b className='font-semibold text-white'>오늘 기준</b>이에요. 실적이 나오거나 상황이 바뀌면 판단도 달라져요.
          <br />
          매번 확인하지 않으셔도, <b className='font-semibold text-white'>바뀌는 순간에만</b> 알려드릴게요.
        </p>
        {/* 워치 미구현 — 표시 전용 버튼(지시사항 워치 전환 🟡). 기능 연결 전까지 동작 없음. */}
        <button
          type='button'
          className='mt-3 w-full rounded-[11px] bg-white px-3 py-[13px] text-[13.5px] font-bold text-[#0F1419]'
        >
          지켜보기 시작
        </button>
        <p className='mt-[9px] text-center text-[10.5px] text-white/40'>며칠간 무료 · 언제든 그만둘 수 있어요</p>
      </article>
      <p className='px-2 pb-2 text-center text-[10px] leading-4 text-[#97A0AE]'>AI 분석은 데이터 기반 참고 자료예요. 투자 권유나 수익 보장이 아닙니다.</p>
    </section>
  )
}
