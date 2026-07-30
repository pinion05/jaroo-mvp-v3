import type { JarooDeepScanCommitteeAxis } from '../../../packages/contracts/src/deepscan'
import type { LucideIcon } from 'lucide-react'
import { BadgeCheck, LineChart, ShieldCheck } from 'lucide-react'
import type { FindingProgress, LoadingStageKey } from '@/components/deepscan-loading-screen'
import type { DeepScanCanonicalTargetSession } from '@/lib/deepscan-canonical'
import type { LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import type { WorkflowMoneyCurrency } from '@/lib/workflow-types'

export type { LoadingStageKey, FindingProgress }

export type DeepScanLoadingSequenceState = {
  targetKey: string | null
  firstSuccessObserved: boolean
  visibleStageCount: number
  sequenceComplete: boolean
}
export type DeepScanLoadingStageArrivalState = {
  targetKey: string | null
  stageKeys: LoadingStageKey[]
}
export type HomeMarketTone = DeepScanCanonicalTargetSession['holding']['marketTone']

export const DEEPSCAN_STAGE_WAIT_MS = 18_000
export const DEEPSCAN_STAGE_FILL_DELAY_MS = 3_000
export const DEEPSCAN_MEMBER_STAGE_BY_KEY: Record<string, LoadingStageKey> = {
  profitability: 'fundamentalTeam',
  valuation: 'fundamentalTeam',
  ownershipStability: 'fundamentalTeam',
  growth: 'fundamentalTeam',
  'profitability-quality': 'fundamentalTeam',
  trend: 'marketTeam',
  consensusMomentum: 'contextTeam',
  priceLocation: 'marketTeam',
  momentum: 'marketTeam',
  'estimate-revision': 'marketTeam',
  'event-risk': 'marketTeam',
  avgPriceGap: 'contextTeam',
  upsideBuffer: 'contextTeam',
  holdingCompleteness: 'contextTeam',
  'financial-safety': 'contextTeam',
  'ownership-flow': 'contextTeam',
  'portfolio-fit': 'contextTeam',
}
export const DEEPSCAN_MEMBER_STAGE_BY_TITLE: Record<string, LoadingStageKey> = {
  '수익성/기본체력': 'fundamentalTeam',
  밸류에이션: 'fundamentalTeam',
  '지분/안정성': 'fundamentalTeam',
  트렌드: 'marketTeam',
  '컨센서스 모멘텀': 'contextTeam',
  '이벤트 스캐너': 'contextTeam',
  '가격 위치': 'marketTeam',
  '평단 격차': 'contextTeam',
  '상방 버퍼': 'contextTeam',
  '입력 완성도': 'contextTeam',
}

export const emptyDeepScanSteps: ReadonlyArray<{ icon: LucideIcon; label: string; body: string }> = [
  { icon: BadgeCheck, label: '보유 종목 선택', body: '홈에서 분석할 주식 카드를 고릅니다.' },
  { icon: LineChart, label: '시장 데이터 확인', body: '현재가·52주 위치·핵심 근거를 먼저 보여줘요.' },
  { icon: ShieldCheck, label: '세 팀 분석', body: '회복 가능성과 리스크를 순서대로 정리합니다.' },
]

export type LoadingFindingKey = 'quality' | 'timing' | 'position' | 'decision'
export type LoadingFindingProgressMap = Partial<Record<LoadingFindingKey, FindingProgress>>
export type LoadingQuickQuote = {
  targetKey: string
  currentPrice?: number
  currentPriceCurrency?: WorkflowMoneyCurrency
  tradingVolume?: number
  week52High?: number
  week52Low?: number
}
export type TargetLoadingBriefingSnapshot = LoadingBriefingSnapshot & {
  targetKey: string
}
export type QuotesCurrentProxyResponse = {
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
export type TargetLoadingMarketSnapshot = Pick<LoadingBriefingSnapshot, 'market'> & {
  targetKey: string
}
export type UsMarketIndicatorsProxyResponse = {
  ok?: boolean
  data?: {
    sp500?: UsMarketIndicatorItem | null
    nasdaq?: UsMarketIndicatorItem | null
    vix?: UsMarketIndicatorItem | null
  } | null
}
export type UsMarketIndicatorItem = {
  close?: number | null
  value?: number | null
  changePct?: number | null
  timestamp?: number | string | null
}

export const loadingFindingAxisKeys = ['quality', 'timing', 'position'] as const
export const MAX_FINDING_TEXT_LENGTH = 96

export type DeepScanCommitteeStatusResponse = {
  ok?: boolean
  requestId?: string
  status?: 'partial' | 'complete' | 'error' | 'not_found'
  completed?: number
  results?: Record<string, unknown>
  pending?: string[]
  errors?: unknown[]
  softDeadlineMs?: number
  committeeAxes?: JarooDeepScanCommitteeAxis[]
}
