export const DEEP_SCAN_BLOCK_STATES = ['ok', 'error', 'blocked'] as const
export type DeepScanBlockState = (typeof DEEP_SCAN_BLOCK_STATES)[number]

export const DEEP_SCAN_SOURCE_TYPES = ['ocr', 'holding', 'report', 'news', 'market', 'system'] as const
export type DeepScanSourceType = (typeof DEEP_SCAN_SOURCE_TYPES)[number]

export type JarooDeepScanCommitteeMemberTone = 'positive' | 'neutral' | 'warning'
export type JarooDeepScanCommitteeMemberIconTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'
export type JarooDeepScanCommitteeMemberStatus = 'success' | 'error'
export type JarooDeepScanCommitteeMemberErrorKind =
  | 'llm-empty-content'
  | 'llm-null-content'
  | 'llm-invalid-json'
  | 'llm-invalid-schema'
  | 'llm-upstream-error'
  | 'llm-timeout-or-network'
  | 'runtime-missing-dump'
  | 'llm-unknown'
export type JarooDeepScanSellNowTagTone = 'positive' | 'danger'
export type JarooDeepScanSellNowValueTone = 'danger'

export const JAROO_DEEP_SCAN_TOP_LEVEL_KEYS = [
  'input',
  'hero',
  'committee',
  'insights',
  'strategy',
  'sellNow',
  'portfolioSimulation',
  'metadata',
] as const
export type JarooDeepScanTopLevelKey = (typeof JAROO_DEEP_SCAN_TOP_LEVEL_KEYS)[number]

export type DeepScanSourceRef = {
  type: DeepScanSourceType
  id: string
  label?: string
  at?: string
  note?: string
}

export type DeepScanBlockFallback = {
  used: boolean
  reason?: string
  label?: string
}

export type DeepScanBlockError = {
  code: string
  message: string
  retryable?: boolean
}

export type DeepScanBlockMeta = {
  blockState: DeepScanBlockState
  sourceRefs: DeepScanSourceRef[]
  fallback: DeepScanBlockFallback | null
  error: DeepScanBlockError | null
}

export type JarooDeepScanInputInstrument = {
  name: string
  code?: string
  ticker?: string
  market?: string
  kind?: import('./index').JarooInstrumentKind
}

export type JarooDeepScanInputHolding = {
  shares?: string
  averagePrice?: string
  evaluationAmount?: string
}

export type JarooDeepScanInputSourceContext = {
  from: DeepScanSourceType
  sessionKey?: string
  appliedAt?: string
}

export type JarooDeepScanInput = {
  instrument: JarooDeepScanInputInstrument
  holding?: JarooDeepScanInputHolding
  selectedAt?: string
  sourceContext: JarooDeepScanInputSourceContext
}

export type JarooDeepScanCommitteeMember = {
  shortLabel: string
  title: string
  status: JarooDeepScanCommitteeMemberStatus
  reason: string | null
  score: number | null
  scoreLabel: string
  tone: JarooDeepScanCommitteeMemberTone
  iconTone: JarooDeepScanCommitteeMemberIconTone
  confidence?: 'low' | 'medium' | 'high'
  error?: {
    kind: JarooDeepScanCommitteeMemberErrorKind
    message: string
    attempts: number
    retryable?: boolean
  } | null
}

export type JarooDeepScanCommitteeAxis = {
  label: string
  score: number | null
  scoreText: string
  axisStatusText: string
  subtitle: string
  avgLabel: string
  members: JarooDeepScanCommitteeMember[]
}

export type JarooDeepScanInsightItem = {
  sourceType: DeepScanSourceType
  sourceLabel: string
  date: string
  label: string
  title: string
  body: string
}

export type JarooDeepScanStrategyScenario = {
  label: string
  probability: string
  condition: string
}

export type JarooDeepScanSellNowRow = {
  label: string
  value: string
  tag?: string
  tagTone?: JarooDeepScanSellNowTagTone
  valueTone?: JarooDeepScanSellNowValueTone
  emphasis?: boolean
}

export type JarooDeepScanHeroBlock = DeepScanBlockMeta & {
  headline: string
  body: string
  statusText: string
  score: number
  scoreLabel: string
  scoreDelta: string
}

export type JarooDeepScanCommitteeBlock = DeepScanBlockMeta & {
  axes: JarooDeepScanCommitteeAxis[]
}

export type JarooDeepScanInsightsBlock = DeepScanBlockMeta & {
  sectionLabel: string
  items: JarooDeepScanInsightItem[]
  summaryTags: string[]
}

export type JarooDeepScanStrategyBlock = DeepScanBlockMeta & {
  weekSignal: string
  weekSignalTone: string
  weekBadgeText: string
  scenarioLabel: string
  scenarioProbability: string
  scenarioPeriod: string
  scenarioCondition: string
  currentPriceText: string
  targetPriceText: string
  scenarioDetails: string[]
  otherScenarios: JarooDeepScanStrategyScenario[]
  otherScenarioTags: string[]
}

export type JarooDeepScanSellNowBlock = DeepScanBlockMeta & {
  realizedText: string
  rows: JarooDeepScanSellNowRow[]
}

export type JarooDeepScanPortfolioSimulationBlock = DeepScanBlockMeta & {
  beforeScore: number
  afterScore: number
  deltaLabel: string
  caption: string
}

export type JarooDeepScanInputValidity =
  | {
      valid: true
      raw?: unknown
      reason?: never
      missing?: never
    }
  | {
      valid: false
      reason: string
      missing?: string[]
      raw?: unknown
    }

export type JarooDeepScanContextConfidence = 'low' | 'medium' | 'high'

export type JarooDeepScanSourceIssue = {
  sourceId: string
  message: string
}

export type JarooDeepScanSourceLimitation = {
  fact: string
  reasonCode: string
  message: string
}

export type JarooDeepScanContextQuality = {
  confidence: JarooDeepScanContextConfidence
  score: number
  summary: string
  pageCoverage: {
    availableCount: number
    totalKnownPages: number
    availablePageIds: string[]
    missingPageIds: string[]
  }
  missingSources: string[]
  sourceIssues: JarooDeepScanSourceIssue[]
  sourceLimitations: JarooDeepScanSourceLimitation[]
  llmMemberErrors: Array<{
    memberKey: string
    kind: JarooDeepScanCommitteeMemberErrorKind | 'llm-unknown'
    message: string
    attempts: number
    retryable?: boolean
  }>
  nextCheckPoints: string[]
}

export type JarooDeepScanBlockStatus = {
  hero: DeepScanBlockState
  committee: DeepScanBlockState
  insights: DeepScanBlockState
  strategy: DeepScanBlockState
  sellNow: DeepScanBlockState
  portfolioSimulation: DeepScanBlockState
}

export type JarooDeepScanMetadata = {
  generatedAt: string
  version: string
  degraded: boolean
  errorCode?: string
  debugId: string
  inputValidity: JarooDeepScanInputValidity
  sourceRefs: DeepScanSourceRef[]
  blockStatus: JarooDeepScanBlockStatus
  contextQuality: JarooDeepScanContextQuality
}

export type JarooDeepScanPayload = {
  input: JarooDeepScanInput
  hero: JarooDeepScanHeroBlock
  committee: JarooDeepScanCommitteeBlock
  insights: JarooDeepScanInsightsBlock
  strategy: JarooDeepScanStrategyBlock
  sellNow: JarooDeepScanSellNowBlock
  portfolioSimulation: JarooDeepScanPortfolioSimulationBlock
  metadata: JarooDeepScanMetadata
}
