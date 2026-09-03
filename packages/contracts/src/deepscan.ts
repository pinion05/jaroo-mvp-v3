export const DEEP_SCAN_BLOCK_STATES = ['ok', 'error', 'blocked'] as const
export type DeepScanBlockState = (typeof DEEP_SCAN_BLOCK_STATES)[number]

export const DEEP_SCAN_SOURCE_TYPES = ['ocr', 'holding', 'report', 'news', 'market', 'system'] as const
export type DeepScanSourceType = (typeof DEEP_SCAN_SOURCE_TYPES)[number]

export type JarooDeepScanCommitteeMemberTone = 'positive' | 'neutral' | 'warning'
export type JarooDeepScanCommitteeMemberIconTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'
export type JarooDeepScanCommitteeMemberStatus = 'success' | 'error' | 'pending'
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
  kind?: import('./instrument').JarooInstrumentKind
}

export type JarooDeepScanInputHolding = {
  shares?: string
  averagePrice?: string
  averagePriceCurrency?: string
  currentPrice?: string
  currentPriceCurrency?: string
  currentProfitRate?: string
  evaluationAmount?: string
  usdKrwRate?: string
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
  memberKey?: string
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

export type JarooDeepScanConsensusStructured = {
  targetPrice?: number | null
  targetGapPct?: number | null
  analystCount?: number | null
  recommendation?: string | null
  recommendationScore?: number | null
  highestTargetPrice?: number | null
  lowestTargetPrice?: number | null
  opinionSummary?: string | null
  currency?: string | null
}

export type JarooDeepScanInsightItem = {
  sourceType: DeepScanSourceType
  sourceLabel: string
  date: string
  label: string
  title: string
  body: string
  sourceBody?: string
  /** Structured consensus fields. Present on the "증권사 의견" insight when the
   *  crawler emits them, so the web client can read values directly instead of
   *  reverse-parsing `body` with regex. */
  consensus?: JarooDeepScanConsensusStructured
}

export type JarooDeepScanStrategyScenario = {
  label: string
  probability: string
  condition: string
}

export type JarooDeepScanRecoveryForecastModelRow = {
  label: string
  recoveryDaysText: string
  probabilityText: string
  sampleText?: string
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
  /** 근거 요약(구조화) — 구형 페이로드에는 없어 화면은 폴백 표시한다 */
  evidenceFacts?: string[]
  /** 주의 문구(구조화, '주의:' 접두 없음) */
  evidenceCautions?: string[]
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

export type JarooDeepScanRecoveryForecastBlock = DeepScanBlockMeta & {
  statusText: string
  summaryText: string
  expectedRecoveryDaysText: string
  recoveryProbabilityText: string
  confidenceText: string
  currentPriceText: string
  targetPriceText: string
  drawdownText: string
  modelRows: JarooDeepScanRecoveryForecastModelRow[]
  disclaimer: string
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
  llmCommittee?: {
    requestId: string
    status: 'disabled' | 'complete' | 'partial' | 'error'
    completed: number
    pending: number
    errors: number
    softDeadlineMs?: number
  }
}

export type JarooDeepScanPayload = {
  input: JarooDeepScanInput
  hero: JarooDeepScanHeroBlock
  committee: JarooDeepScanCommitteeBlock
  insights: JarooDeepScanInsightsBlock
  strategy: JarooDeepScanStrategyBlock
  recoveryForecast?: JarooDeepScanRecoveryForecastBlock
  sellNow: JarooDeepScanSellNowBlock
  portfolioSimulation: JarooDeepScanPortfolioSimulationBlock
  metadata: JarooDeepScanMetadata
}
