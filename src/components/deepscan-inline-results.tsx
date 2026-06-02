'use client'

import type {
  JarooDeepScanCommitteeMember,
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

type TeamDefinition = {
  key: string
  name: string
  description: string
  icon: string
  memberTitles: string[]
}

type ScenarioView = {
  label: string
  probability: string
  condition: string
  tone: 'green' | 'blue' | 'red'
  recommended?: boolean
}

const TEAM_DEFINITIONS: readonly TeamDefinition[] = [
  { key: 'market', name: '시장·차트 팀', description: '차트 마스터 · 거래량 · 상승세 추적', icon: '📈', memberTitles: ['가격 위치', '평단 격차', '트렌드'] },
  { key: 'context', name: '심리·환경 팀', description: '증권사 의견 · 산업 전문가 · 이슈 탐색', icon: '🧠', memberTitles: ['입력 완성도', '상방 버퍼', '컨센서스 모멘텀'] },
  { key: 'fundamental', name: '가치·기본 팀', description: '가치 분석 · 성장 전략 · 재무 점검', icon: '📊', memberTitles: ['밸류에이션', '수익성/기본체력', '지분/안정성'] },
] as const

function firstNonEmpty(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null
}

function compact(value: string | null | undefined, max = 104) {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max - 1).trim()}…` : normalized
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

function flattenMembers(payload: JarooDeepScanPayload) {
  return payload.committee?.axes?.flatMap((axis) => axis.members ?? []) ?? []
}

function resolveTeamMembers(payload: JarooDeepScanPayload, team: TeamDefinition) {
  const members = flattenMembers(payload)
  const matched = team.memberTitles
    .map((title) => members.find((member) => member.title === title))
    .filter((member): member is JarooDeepScanCommitteeMember => Boolean(member))

  if (matched.length > 0) return matched

  const fallbackAxis = payload.committee?.axes?.find((axis) => team.memberTitles.some((title) => axis.label?.includes(title) || axis.subtitle?.includes(title)))
  return fallbackAxis?.members ?? []
}

function buildTeamSummary(payload: JarooDeepScanPayload, team: TeamDefinition) {
  if (payload.committee.blockState !== 'ok') {
    return {
      body: payload.committee.fallback?.label || payload.committee.error?.message || '위원회 분석 원천을 지금 불러오지 못했어요.',
      tags: ['원천 상태 확인', '관망'],
      status: '보류',
      warning: true,
    }
  }

  const members = resolveTeamMembers(payload, team)
  if (members.length === 0) {
    return { body: '이 팀의 실제 위원 응답이 아직 도착하지 않았어요.', tags: ['응답 대기'], status: '대기', warning: false }
  }

  const successful = members.filter((member) => member.status === 'success' && member.reason?.trim())
  const errored = members.filter((member) => member.status === 'error')
  const pending = members.filter((member) => member.status === 'pending')
  const lead = successful[0]
  const body = lead
    ? compact(lead.reason)
    : errored.length > 0
      ? compact(errored[0]?.error?.message) || '일부 위원 응답 실패. 도착한 근거만 먼저 보여드려요.'
      : '응답 대기 중이에요. 도착한 실제 데이터부터 순서대로 붙습니다.'
  const tags = [
    successful.length > 0 ? `${successful.length}개 근거` : null,
    errored.length > 0 ? `${errored.length}개 대기` : null,
    pending.length > 0 ? `${pending.length}개 준비 중` : null,
  ].filter((tag): tag is string => Boolean(tag))

  return { body, tags: tags.length ? tags : ['확인 중'], status: errored.length > 0 ? '일부 실패' : pending.length > 0 ? '분석 중' : '확인', warning: errored.length > 0 }
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
      <div className='px-2 pt-1 text-[11px] font-semibold tracking-[0.08em] text-[#97A0AE]'>AI 팀 브리핑</div>
      <div className='space-y-3'>
        {TEAM_DEFINITIONS.map((team) => {
          const teamSummary = buildTeamSummary(payload, team)
          return (
            <article key={team.key} className='rounded-[16px] border border-[#E8EAEE] bg-white px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,.04)]'>
              <div className='flex items-start gap-3'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F5F6F8] text-[16px]' aria-hidden='true'>{team.icon}</div>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <h3 className='truncate text-[13px] font-bold text-[#0F1419]'>{team.name}</h3>
                      <p className='mt-0.5 truncate text-[10px] text-[#97A0AE]'>{team.description}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-[6px] px-2 py-1 text-[10px] font-bold', teamSummary.warning ? 'bg-[#FCEBEB] text-[#A32D2D]' : 'bg-[#E5F3EB] text-[#1A7340]')}>{teamSummary.status}</span>
                  </div>
                  <p className='mt-3 text-[13px] leading-6 text-[#0F1419]'>{teamSummary.body}</p>
                  <div className='mt-3 flex flex-wrap gap-1.5'>
                    {teamSummary.tags.map((tag) => (
                      <span key={`${team.key}-${tag}`} className={cn('rounded-[6px] px-2 py-1 text-[10px] font-semibold', teamSummary.warning ? 'bg-[#FCEBEB] text-[#A32D2D]' : 'bg-[#E5F3EB] text-[#1A7340]')}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>

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
