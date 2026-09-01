import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { JarooDeepScanCommitteeAxis } from '../../packages/contracts/src/deepscan'
import {
  Activity,
  BadgeDollarSign,
  Brain,
  ChartCandlestick,
  Factory,
  Landmark,
  Radar,
  Scale,
  TrendingUp,
} from 'lucide-react'
import type { LoadingBriefingDailyRow, LoadingBriefingSnapshot, MoneyCurrency } from '@/lib/deepscan-briefing-snapshot'

export type { LoadingBriefingDailyRow, LoadingBriefingSnapshot, MoneyCurrency, JarooDeepScanCommitteeAxis }

export type DeepScanLoadingScreenProps = {
  name?: string
  /** 스펙 spec_v7 §4 손익 인트로 멘트(예: "삼성전자, 거의 본전이네요"). 없으면 기존 안내 문구. */
  introMention?: string | null
  identifier?: string
  market?: string
  instrumentKind?: string
  shares?: string | number
  averagePrice?: string | number
  averagePriceCurrency?: MoneyCurrency
  currentPrice?: string | number
  currentPriceCurrency?: MoneyCurrency
  usdKrwRate?: number | null
  tradingVolume?: string | number
  currentProfitRate?: string | number
  snapshotProfitRate?: string | number
  briefingSnapshot?: LoadingBriefingSnapshot | null
  findingProgress?: Partial<Record<FindingKey, FindingProgress>>
  committeeAxes?: JarooDeepScanCommitteeAxis[]
  quickFacts?: LoadingQuickFact[]
  performanceComment?: LoadingPerformanceComment
  evidenceCollected?: boolean
  visibleStageCount?: number
  arrivedStageKeys?: LoadingStageKey[]
  resultsReady?: boolean
  className?: string
  onBack?: () => void
  backHref?: string
  inlineResults?: ReactNode
  errorNotice?: { title: string; body: string } | null
  onRetry?: () => void
}

export type CommitteeMemberState = 'done' | 'active' | 'wait'
export type CommitteeMemberIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
export type FindingKey = 'quality' | 'timing' | 'position' | 'decision'
export type FindingProgressTone = 'active' | 'done' | 'warning'
export type FindingProgress = {
  badge: string
  body: string
  tone: FindingProgressTone
}

export type LoadingPerformanceComment = {
  asOf?: string
  body: string
  fullBody?: string
  lines?: string[]
}

export type LoadingQuickFact = {
  key: string
  category: string
  badge: string
  tone: 'info' | 'positive' | 'warning'
  body: string
  detail?: string
  indicator?: {
    positionPct: number
    markerLabel?: string
    deltaLabels?: string[]
    leftLabel: string
    rightLabel: string
  }
  consensus?: {
    targetPriceLabel: string
    currentPriceLabel?: string
    analystCountLabel?: string
    highTargetLabel?: string
    lowTargetLabel?: string
    summary?: string
    upsideLabel?: string
    upsidePct?: number
    opinionLabel?: string
    opinionScore?: number
    targetPriceValue?: number
    currentPriceValue?: number
    highTargetValue?: number
    lowTargetValue?: number
  }
}

export type LoadingStageKey = 'fundamentalTeam' | 'marketTeam' | 'contextTeam'
export type PlaceholderStageKey = `pendingStage${number}`
export type NarrativeCardKey = LoadingStageKey | PlaceholderStageKey
export type NarrativeTone = 'positive' | 'warning' | 'neutral' | 'info'
export type CommitteeTeamMemberDefinition = {
  sourceMemberKey?: string | string[]
  sourceTitle: string | string[]
  alias: string
}
export type CommitteeTeamDefinition = {
  key: LoadingStageKey
  analystName: string
  description: string
  avatar: LucideIcon
  members: CommitteeTeamMemberDefinition[]
}
export type NarrativeCard = {
  key: NarrativeCardKey
  teamKey?: LoadingStageKey
  analystName: string
  description: string
  avatar: string | LucideIcon
  body: string
  tags: Array<{ text: string; tone: NarrativeTone }>
  statusLabel: string
  statusTone: NarrativeTone
  complete: boolean
  summarizable: boolean
  placeholder: boolean
}

export type TeamSummaryState = {
  inputKey: string
  status: 'loading' | 'success' | 'error'
  summary?: string
}

export type CompletionState = {
  ready: boolean
  eyebrow: string
  title: string
  body: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const TODAY_BRIEFING_FIRST_REVEAL_SECONDS = 5
export const TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS = 5
export const TODAY_BRIEFING_SKELETON_SECONDS = 3
export const TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS = 0.9
export const COMPLETION_SOON_REVEAL_SECONDS = 43
export const TODAY_BRIEFING_ITEM_COUNT = 6
export const TODAY_BRIEFING_ITEM_SELECTOR = '[data-today-briefing-item="true"]'
export const DEEPSCAN_MOBILE_AUTO_SCROLL_QUERY = '(max-width: 640px)'
export const DEEPSCAN_AUTO_SCROLL_BOTTOM_GAP_PX = 16
export const TEAM_BRIDGE_REVEAL_SECONDS = 38
export const TEAM_BRIDGE_FINAL_MESSAGE_MIN_SECONDS = 30
export const TEAM_BRIDGE_DONE_SECONDS = COMPLETION_SOON_REVEAL_SECONDS + TEAM_BRIDGE_FINAL_MESSAGE_MIN_SECONDS
export const TEAM_SEQUENCE_COMPLETE_SECONDS = TEAM_BRIDGE_DONE_SECONDS + 8
export const TEAM_PRESENTATION_ORDER: LoadingStageKey[] = ['marketTeam', 'contextTeam', 'fundamentalTeam']
export const TEAM_REVEAL_SECONDS: Record<LoadingStageKey, number> = {
  marketTeam: TEAM_BRIDGE_DONE_SECONDS,
  contextTeam: TEAM_BRIDGE_DONE_SECONDS + 2.5,
  fundamentalTeam: TEAM_BRIDGE_DONE_SECONDS + 5,
}
export const TEAM_BRIDGE_STATUS_MESSAGES = [
  '증권사 리포트를 읽는 중…',
  '시장 흐름과 평단을 맞춰보는 중…',
  '세 팀이 의견을 정리하는 중…',
] as const

// ─── Committee Members & Teams ───────────────────────────────────────────────

export const committeeMembers: ReadonlyArray<{ key: string; Icon: CommitteeMemberIcon; label: string; state: CommitteeMemberState }> = [
  { key: 'valuation', Icon: Scale, label: '가치\n분석가', state: 'active' },
  { key: 'growth', Icon: TrendingUp, label: '성장\n전략가', state: 'active' },
  { key: 'finance', Icon: Landmark, label: '재무\n감사관', state: 'active' },
  { key: 'chart', Icon: ChartCandlestick, label: '차트\n마스터', state: 'active' },
  { key: 'flow', Icon: Activity, label: '수급\n추적기', state: 'active' },
  { key: 'momentum', Icon: Radar, label: '모멘텀\n스카우터', state: 'active' },
  { key: 'sentiment', Icon: Brain, label: '심리\n분석AI', state: 'active' },
  { key: 'industry', Icon: Factory, label: '산업\n전문가', state: 'active' },
  { key: 'event', Icon: BadgeDollarSign, label: '이벤트\n스캐너', state: 'active' },
] as const

export const committeeTeams: readonly CommitteeTeamDefinition[] = [
  {
    key: 'fundamentalTeam',
    analystName: '가치·기본 팀',
    description: '가치 분석가 · 성장 전략가 · 재무 감사관',
    avatar: Landmark,
    members: [
      { sourceMemberKey: ['valuation', 'valuation'], sourceTitle: ['밸류에이션', '가격/NAV 단서', 'Valuation'], alias: '가치 분석가' },
      { sourceMemberKey: ['profitability', 'growth'], sourceTitle: ['수익성/기본체력', '상품 구조/운용 품질', 'Growth'], alias: '성장 전략가' },
      { sourceMemberKey: ['ownershipStability', 'profitability-quality'], sourceTitle: ['지분/안정성', '구성/분산 안정성', 'Profitability'], alias: '재무 감사관' },
    ],
  },
  {
    key: 'marketTeam',
    analystName: '시장·차트 팀',
    description: '차트 마스터 · 수급 추적기 · 모멘텀 스카우터',
    avatar: TrendingUp,
    members: [
      { sourceMemberKey: ['priceLocation', 'momentum'], sourceTitle: ['가격 위치', 'Momentum'], alias: '차트 마스터' },
      { sourceMemberKey: ['avgPriceGap', 'estimate-revision'], sourceTitle: ['평단 격차', 'Revision'], alias: '수급 추적기' },
      { sourceMemberKey: ['trend', 'event-risk'], sourceTitle: ['트렌드', '지수/가격 흐름', 'Event Risk'], alias: '모멘텀 스카우터' },
    ],
  },
  {
    key: 'contextTeam',
    analystName: '심리·환경 팀',
    description: '심리 분석AI · 산업 전문가 · 이벤트 스캐너',
    avatar: Brain,
    members: [
      { sourceMemberKey: ['holdingCompleteness', 'financial-safety'], sourceTitle: ['입력 완성도', 'Safety'], alias: '심리 분석AI' },
      { sourceMemberKey: ['upsideBuffer', 'ownership-flow'], sourceTitle: ['상방 버퍼', '상하방 여지', 'Ownership'], alias: '산업 전문가' },
      { sourceMemberKey: ['consensusMomentum', 'portfolio-fit'], sourceTitle: ['이벤트 스캐너', '컨센서스 모멘텀', '시장 신호/정보 밀도', '포지션 적합도'], alias: '이벤트 스캐너' },
    ],
  },
] as const

export const pendingCommitteeMemberCount = committeeMembers.length
export const COMMENT_LINE_MAX_LENGTH = 74
export const COMMENT_BODY_MAX_LENGTH = 168
