import type {
  DeepScanBlockError,
  DeepScanBlockFallback,
  DeepScanBlockState,
  DeepScanSourceRef,
  JarooDeepScanCommitteeAxis,
  JarooDeepScanCommitteeMember,
  JarooDeepScanInsightItem,
  JarooDeepScanPayload,
  JarooDeepScanPortfolioSimulationBlock,
  JarooDeepScanSellNowBlock,
  JarooDeepScanStrategyBlock,
} from '../../../packages/contracts/src/deepscan'
import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'
import { scoreUsCommitteeFromGeneratedDump, type UsMemberKey } from './llm-committee'
import { decodeUsConsensusObservation } from './us-consensus'
import { buildJarooDeepScanPayload as buildCrawlerDeepScanPayload } from '../../../packages/crawler/src/services/deepscan-payload.js'

type UnknownRecord = Record<string, unknown>

type CanonicalSourceFrom = JarooDeepScanPayload['input']['sourceContext']['from']
type DeepScanRawSourceFrom = CanonicalSourceFrom | 'home-handoff'

type DeepScanRawInput = {
  instrument: {
    name?: string
    code?: string
    ticker?: string
    market?: string
    kind?: 'stock' | 'etf'
  }
  holding?: {
    shares?: string
    averagePrice?: string
    evaluationAmount?: string
  }
  selectedAt?: string
  sourceContext: {
    from?: DeepScanRawSourceFrom
  }
}

type DeepScanAgentResult = {
  key:
    | 'valuation'
    | 'growth'
    | 'profitability-quality'
    | 'financial-safety'
    | 'momentum'
    | 'estimate-revision'
    | 'ownership-flow'
    | 'event-risk'
    | 'portfolio-fit'
  label: string
  shortLabel: string
  score: number
  reason: string
  confidence: 'low' | 'medium' | 'high'
  verdict: 'positive' | 'neutral' | 'warning' | 'negative'
  iconTone: JarooDeepScanCommitteeMember['iconTone']
}

type SourceIssue = {
  id: string
  message: string
  retryable?: boolean
}

type UsDeepScanFacts = {
  companyName: string
  ticker?: string
  market?: string
  currency?: string
  currentPrice?: number
  marketCap?: number
  per?: number
  pbr?: number
  roe?: number
  eps?: number
  epsGrowth?: number
  revenue?: number
  operatingIncome?: number
  totalAssets?: number
  totalEquity?: number
  returns1w?: number
  returns3m?: number
  returns1y?: number
  news: Array<{ title: string; publishedAt?: string }>
  consensus?: ReturnType<typeof decodeUsConsensusObservation>
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseNumberish(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().replace(/[−–—]/g, '-')
  if (!normalized) {
    return null
  }

  const cleaned = normalized.replaceAll(',', '').replace(/[₩$€¥£%원주]/g, '')
  if (!cleaned || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null
  }

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function signedPercent(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatNumber(value?: number | null, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatCurrency(value?: number | null, currency = 'USD') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  if (currency === 'USD') {
    return `$${value.toFixed(2)}`
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function createSourceRef(type: DeepScanSourceRef['type'], id: string, label: string, note?: string): DeepScanSourceRef {
  return {
    type,
    id,
    label,
    note,
  }
}

function createFallback(reason: string, label?: string): DeepScanBlockFallback {
  return {
    used: true,
    reason,
    label,
  }
}

function createError(code: string, message: string, retryable = false): DeepScanBlockError {
  return {
    code,
    message,
    retryable,
  }
}

function createBlockMeta(blockState: DeepScanBlockState, sourceRefs: DeepScanSourceRef[], options: { fallback?: DeepScanBlockFallback | null; error?: DeepScanBlockError | null } = {}) {
  return {
    blockState,
    sourceRefs,
    fallback: options.fallback ?? null,
    error: options.error ?? null,
  }
}


const SOURCE_FROM_VALUES = new Set<DeepScanRawSourceFrom>(['home-handoff', 'ocr', 'holding', 'report', 'news', 'market', 'system'])

function parseSourceFrom(value?: string): DeepScanRawSourceFrom {
  if (value && SOURCE_FROM_VALUES.has(value as DeepScanRawSourceFrom)) {
    return value as DeepScanRawSourceFrom
  }

  return 'system'
}

function normalizeSourceFrom(value?: string): CanonicalSourceFrom {
  if (value === 'home-handoff') {
    return 'holding'
  }

  if (value && SOURCE_FROM_VALUES.has(value as DeepScanRawSourceFrom)) {
    return value as CanonicalSourceFrom
  }

  return 'system'
}

function buildRawInputFromSearchParams(searchParams: URLSearchParams): DeepScanRawInput {
  const code = normalizeText(searchParams.get('code'))
  const ticker = normalizeText(searchParams.get('ticker'))?.toUpperCase()
  const market = normalizeText(searchParams.get('market'))?.toUpperCase()
  const name = normalizeText(searchParams.get('name'))
  const shares = normalizeText(searchParams.get('shares'))
  const averagePrice = normalizeText(searchParams.get('averagePrice'))
  const evaluationAmount = normalizeText(searchParams.get('evaluationAmount'))
  const selectedAt = normalizeText(searchParams.get('selectedAt'))
  const from = normalizeText(searchParams.get('from'))

  return {
    instrument: {
      name,
      code,
      ticker,
      market,
      kind: 'stock',
    },
    holding: shares || averagePrice || evaluationAmount
      ? {
          shares: shares ?? undefined,
          averagePrice: averagePrice ?? undefined,
          evaluationAmount: evaluationAmount ?? undefined,
        }
      : undefined,
    selectedAt: selectedAt ?? undefined,
    sourceContext: {
      from: parseSourceFrom(from),
    },
  }
}

function buildInputValidityRaw(rawInput: DeepScanRawInput) {
  return structuredClone(rawInput)
}

function createInvalidInputPayload(rawInput: DeepScanRawInput): JarooDeepScanPayload {
  const generatedAt = rawInput.selectedAt ?? new Date().toISOString()
  const sourceRefs = [createSourceRef('system', 'deepscan-input-invalid', 'deepscan invalid input')]
  const fallback = createFallback('input-invalid', '입력 확인 필요')
  const error = createError('input-invalid', 'instrument code or ticker is required')

  const payload = {
    input: {
      instrument: {
        name: rawInput.instrument.name?.trim() || '알 수 없는 종목',
        code: rawInput.instrument.code,
        ticker: rawInput.instrument.ticker,
        market: rawInput.instrument.market,
        kind: rawInput.instrument.kind,
      },
      holding: rawInput.holding,
      selectedAt: rawInput.selectedAt,
      sourceContext: {
        from: normalizeSourceFrom(rawInput.sourceContext.from),
      },
    },
    hero: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      headline: 'DeepScan 입력이 부족합니다',
      body: '종목 코드 또는 티커가 필요합니다.',
      statusText: '입력 확인 필요',
      score: 0,
      scoreLabel: 'Blocked · 0 / 100',
      scoreDelta: '+0',
    },
    committee: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      axes: [],
    },
    insights: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      sectionLabel: '인사이트',
      items: [],
      summaryTags: [],
    },
    strategy: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      weekSignal: '입력 필요',
      weekSignalTone: 'warning',
      weekBadgeText: '입력 필요',
      scenarioLabel: '종목 식별 정보 확인',
      scenarioProbability: '0%',
      scenarioPeriod: '대기',
      scenarioCondition: '코드 또는 티커 입력 후 다시 시도하세요.',
      currentPriceText: 'N/A',
      targetPriceText: 'N/A',
      scenarioDetails: ['입력값 부족으로 분석을 시작하지 않았어요.'],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      realizedText: '입력값 부족으로 즉시 매도 판단을 계산할 수 없어요.',
      rows: [],
    },
    portfolioSimulation: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      beforeScore: 0,
      afterScore: 0,
      deltaLabel: 'blocked:+0',
      caption: '입력값 부족으로 포트폴리오 시뮬레이션을 계산하지 않았어요.',
    },
    metadata: {
      generatedAt,
      version: 'deepscan-runtime-v1',
      degraded: true,
      errorCode: error.code,
      debugId: `deepscan:${rawInput.instrument.market ?? 'NA'}:${rawInput.instrument.code ?? rawInput.instrument.ticker ?? 'missing'}`,
      inputValidity: {
        valid: false,
        reason: error.message,
        missing: ['instrument.code|instrument.ticker'],
        raw: buildInputValidityRaw(rawInput),
      },
      sourceRefs,
      blockStatus: {
        hero: 'blocked',
        committee: 'blocked',
        insights: 'blocked',
        strategy: 'blocked',
        sellNow: 'blocked',
        portfolioSimulation: 'blocked',
      },
    },
  } satisfies JarooDeepScanPayload

  return payload
}

function resolveLatestCellValue(cells: unknown) {
  const record = asRecord(cells)
  if (!record) {
    return null
  }

  const latestKey = Object.keys(record).at(-1)
  return latestKey ? asFiniteNumber(record[latestKey]) : null
}

function findFinancialSummaryRow(rows: unknown[], label: string) {
  return asArray(rows)
    .map((row) => asRecord(row))
    .find((row) => row?.label === label) ?? null
}

function findUsFacts(payload: unknown, ticker: string): UsDeepScanFacts {
  const record = asRecord(payload)
  const company = asRecord(record?.company)
  const pages = asRecord(record?.pages)
  const analysis = asRecord(pages?.analysis)
  const snap = asRecord(pages?.snap)
  const finance = asRecord(pages?.finance)
  const consensus = asRecord(pages?.consensus)
  const analysisMetric = asRecord(asArray(analysis?.metrics).find((item) => asRecord(item)?.ticker?.toString().startsWith(ticker)) ?? asArray(analysis?.metrics)[0])
  const returnRecord = asRecord(asArray(analysis?.returns).find((item) => asRecord(item)?.ticker?.toString().startsWith(ticker)) ?? asArray(analysis?.returns)[0])
  const financialRows = asArray(asRecord(snap?.financialSummary)?.rows)
  const latestPriceRow = asRecord(asArray(asRecord(snap?.priceVolume)?.rows).at(-1))
  const latestConsensus = asArray(consensus?.observations).at(-1)
  const decodedConsensus = latestConsensus ? decodeUsConsensusObservation(latestConsensus) : undefined
  const statements = asRecord(finance?.statements)
  const balanceRows = asArray(asRecord(statements?.balanceSheet)?.rows)
  const totalAssets = resolveLatestCellValue(findFinancialSummaryRow(financialRows, '자산총계')?.cells)
    ?? resolveLatestCellValue(findFinancialSummaryRow(balanceRows, '자산총계')?.cells)
  const totalEquity = resolveLatestCellValue(findFinancialSummaryRow(financialRows, '자본총계')?.cells)
    ?? resolveLatestCellValue(findFinancialSummaryRow(balanceRows, '자본총계')?.cells)
  const revenue = decodedConsensus?.forecastRevenue
    ?? resolveLatestCellValue(findFinancialSummaryRow(financialRows, '매출액')?.cells)
  const operatingIncome = resolveLatestCellValue(findFinancialSummaryRow(financialRows, '영업이익')?.cells)
  const news = asArray(snap?.news)
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => Boolean(item))
    .map((item) => {
      const titles = asRecord(item.titles)
      return {
        title: normalizeText(titles?.ko) ?? normalizeText(titles?.en) ?? '제목 미확인',
        publishedAt: normalizeText(item.publishedAt),
      }
    })
    .filter((item) => item.title)

  return {
    companyName: normalizeText(company?.name) ?? ticker,
    ticker: normalizeText(company?.ticker) ?? ticker,
    market: normalizeText(company?.market) ?? 'US',
    currency: normalizeText(company?.currency) ?? normalizeText(consensus?.currency) ?? 'USD',
    currentPrice: asFiniteNumber(latestPriceRow?.close) ?? decodedConsensus?.spotPrice ?? undefined,
    marketCap: resolveLatestCellValue(findFinancialSummaryRow(financialRows, '시가총액')?.cells) ?? undefined,
    per: asFiniteNumber(analysisMetric?.per) ?? decodedConsensus?.forwardPer ?? undefined,
    pbr: asFiniteNumber(analysisMetric?.pbr) ?? decodedConsensus?.forwardPbr ?? undefined,
    roe: asFiniteNumber(analysisMetric?.roe) ?? undefined,
    eps: asFiniteNumber(analysisMetric?.eps) ?? decodedConsensus?.forecastEps ?? undefined,
    epsGrowth: asFiniteNumber(analysisMetric?.epsGw) ?? undefined,
    revenue: revenue ?? undefined,
    operatingIncome: operatingIncome ?? undefined,
    totalAssets: totalAssets ?? undefined,
    totalEquity: totalEquity ?? undefined,
    returns1w: asFiniteNumber(returnRecord?.['1w']) ?? undefined,
    returns3m: asFiniteNumber(returnRecord?.['3m']) ?? undefined,
    returns1y: asFiniteNumber(returnRecord?.['1y']) ?? undefined,
    news,
    consensus: decodedConsensus,
  }
}

function verdictForScore(score: number): DeepScanAgentResult['verdict'] {
  if (score >= 70) {
    return 'positive'
  }

  if (score >= 55) {
    return 'neutral'
  }

  if (score >= 40) {
    return 'warning'
  }

  return 'negative'
}

const US_AGENT_META: Record<UsMemberKey, Pick<DeepScanAgentResult, 'label' | 'shortLabel' | 'iconTone'>> = {
  valuation: { label: 'Valuation', shortLabel: 'VAL', iconTone: 'blue' },
  growth: { label: 'Growth', shortLabel: 'GRW', iconTone: 'green' },
  'profitability-quality': { label: 'Profitability', shortLabel: 'PQL', iconTone: 'teal' },
  momentum: { label: 'Momentum', shortLabel: 'MOM', iconTone: 'amber' },
  'estimate-revision': { label: 'Revision', shortLabel: 'REV', iconTone: 'purple' },
  'event-risk': { label: 'Event Risk', shortLabel: 'EVT', iconTone: 'red' },
  'financial-safety': { label: 'Safety', shortLabel: 'SAFE', iconTone: 'purple' },
  'ownership-flow': { label: 'Ownership', shortLabel: 'OWN', iconTone: 'amber' },
  'portfolio-fit': { label: 'Position Fit', shortLabel: 'FIT', iconTone: 'teal' },
}

function buildUsAgentResultsFromLlm(results: Partial<Record<UsMemberKey, { score: number; reason: string; confidence: 'low' | 'medium' | 'high' }>>): DeepScanAgentResult[] {
  return (Object.entries(results) as Array<[UsMemberKey, { score: number; reason: string; confidence: 'low' | 'medium' | 'high' }]>)
    .map(([key, result]) => ({
      key,
      ...US_AGENT_META[key],
      score: clamp(result.score),
      reason: result.reason,
      confidence: result.confidence,
      verdict: verdictForScore(clamp(result.score)),
    }))
}

function memberTone(agent: DeepScanAgentResult): JarooDeepScanCommitteeMember['tone'] {
  if (agent.score >= 70) {
    return 'positive'
  }
  if (agent.score >= 50) {
    return 'neutral'
  }
  return 'warning'
}

function scoreText(score: number) {
  return `${score} / 100`
}

function axisStatus(score: number) {
  if (score >= 70) {
    return '우세'
  }
  if (score >= 55) {
    return '보통'
  }
  return '경계'
}

function toMember(agent: DeepScanAgentResult): JarooDeepScanCommitteeMember {
  return {
    shortLabel: agent.shortLabel,
    title: agent.label,
    reason: agent.reason,
    score: agent.score,
    scoreLabel: `${agent.score}점`,
    tone: memberTone(agent),
    iconTone: agent.iconTone,
  }
}

function buildAxes(agentResults: DeepScanAgentResult[]): JarooDeepScanCommitteeAxis[] {
  const groups = [
    {
      label: 'Business Quality',
      subtitle: '성장성과 수익성, 밸류에이션을 함께 봅니다.',
      agents: ['growth', 'profitability-quality', 'valuation'] as const,
    },
    {
      label: 'Market Timing',
      subtitle: '모멘텀과 추정치 변화, 이벤트 리스크를 묶어 봅니다.',
      agents: ['momentum', 'estimate-revision', 'event-risk'] as const,
    },
    {
      label: 'Position Fit',
      subtitle: '재무안정성과 소유구조, 내 포지션 적합도를 봅니다.',
      agents: ['financial-safety', 'ownership-flow', 'portfolio-fit'] as const,
    },
  ]

  return groups.map((group) => {
    const members = group.agents
      .map((key) => agentResults.find((agent) => agent.key === key))
      .filter((agent): agent is DeepScanAgentResult => Boolean(agent))
    const score = clamp(members.reduce((sum, agent) => sum + agent.score, 0) / (members.length || 1))

    return {
      label: group.label,
      score,
      scoreText: scoreText(score),
      axisStatusText: axisStatus(score),
      subtitle: group.subtitle,
      avgLabel: `위원 평균 ${score}`,
      members: members.map(toMember),
    }
  })
}

function buildHeroScore(agentResults: DeepScanAgentResult[]) {
  const weights: Record<DeepScanAgentResult['key'], number> = {
    valuation: 14,
    growth: 12,
    'profitability-quality': 12,
    'financial-safety': 12,
    momentum: 10,
    'estimate-revision': 10,
    'ownership-flow': 8,
    'event-risk': 10,
    'portfolio-fit': 12,
  }

  const weightedTotal = agentResults.reduce((sum, agent) => sum + (weights[agent.key] * agent.score), 0)
  return clamp(weightedTotal / 100)
}

function buildUsInsights(facts: UsDeepScanFacts, agentResults: DeepScanAgentResult[]): { sectionLabel: string; items: JarooDeepScanInsightItem[]; summaryTags: string[] } {
  const items = facts.news.slice(0, 3).map((item) => ({
    sourceType: 'news' as const,
    sourceLabel: 'US News',
    date: item.publishedAt ?? '발행시각 미확인',
    label: '뉴스',
    title: item.title,
    body: `${facts.companyName} 관련 최근 헤드라인입니다.`,
  }))

  const tags = agentResults
    .filter((agent) => agent.score >= 70 || agent.score <= 40)
    .slice(0, 3)
    .map((agent) => `${agent.label}:${agent.score}`)

  return {
    sectionLabel: '이번 주 체크포인트',
    items,
    summaryTags: tags,
  }
}

function buildUsStrategy(heroScore: number, facts: UsDeepScanFacts, rawInput: DeepScanRawInput): JarooDeepScanStrategyBlock {
  const averagePrice = parseNumberish(rawInput.holding?.averagePrice)
  const shares = parseNumberish(rawInput.holding?.shares)
  const currentPrice = facts.currentPrice
  const gapPct = typeof currentPrice === 'number' && typeof averagePrice === 'number' && averagePrice > 0
    ? ((currentPrice - averagePrice) / averagePrice) * 100
    : null
  const targetPrice = facts.consensus?.forecastEps && facts.consensus?.forwardPer
    ? facts.consensus.forecastEps * facts.consensus.forwardPer
    : currentPrice
  const tone = heroScore >= 70 ? 'positive' : heroScore >= 55 ? 'primary' : 'warning'
  const weekSignal = heroScore >= 70 ? '보유 유지' : heroScore >= 55 ? '관찰 지속' : '리스크 점검'

  return {
    ...createBlockMeta('ok', [createSourceRef('system', 'deepscan-us-strategy', 'US strategy synthesis')]),
    weekSignal,
    weekSignalTone: tone,
    weekBadgeText: `위원회 ${heroScore}점`,
    scenarioLabel: heroScore >= 70 ? '기본 시나리오' : '주의 시나리오',
    scenarioProbability: `${Math.max(10, heroScore)}%`,
    scenarioPeriod: '약 3개월',
    scenarioCondition: typeof gapPct === 'number' ? `평단 대비 ${signedPercent(gapPct)} 구간 유지` : '보유 포지션 기준치 재확인',
    currentPriceText: formatCurrency(currentPrice, facts.currency),
    targetPriceText: formatCurrency(targetPrice, facts.currency),
    scenarioDetails: [
      `보유 수량 ${formatNumber(shares)}주 기준`,
      `추정 EPS ${formatNumber(facts.consensus?.forecastEps, 2)} · forward PER ${formatNumber(facts.consensus?.forwardPer, 1)}`,
    ],
    otherScenarios: [
      {
        label: '상방',
        probability: `${Math.max(5, 100 - heroScore)}%`,
        condition: '추정치 상향 지속',
      },
      {
        label: '하방',
        probability: `${Math.max(5, 65 - Math.floor(heroScore / 2))}%`,
        condition: '모멘텀 둔화 + 뉴스 리스크 확대',
      },
    ],
    otherScenarioTags: [facts.market ?? 'US', facts.currency ?? 'USD'],
  }
}

function buildUsSellNow(heroScore: number, facts: UsDeepScanFacts, rawInput: DeepScanRawInput): JarooDeepScanSellNowBlock {
  const shares = parseNumberish(rawInput.holding?.shares)
  const averagePrice = parseNumberish(rawInput.holding?.averagePrice)
  const currentPrice = facts.currentPrice

  if (typeof shares !== 'number' || typeof averagePrice !== 'number' || typeof currentPrice !== 'number') {
    return {
      ...createBlockMeta('blocked', [createSourceRef('holding', 'deepscan-us-sell-now', 'US sell-now missing holding')], {
        fallback: createFallback('holding-context-incomplete', '보유 데이터 부족'),
        error: createError('holding-context-incomplete', '보유 수량/평단/현재가가 부족해 즉시 매도 판단을 계산할 수 없어요.'),
      }),
      realizedText: '보유 수량, 평단가, 현재가가 모두 있어야 즉시 매도 판단을 계산할 수 있어요.',
      rows: [],
    }
  }

  const pnl = (currentPrice - averagePrice) * shares
  const pnlPct = averagePrice === 0 ? null : ((currentPrice - averagePrice) / averagePrice) * 100
  const decisionBand = heroScore >= 70 ? 'hold' : heroScore >= 55 ? 'trim' : 'exit-watch'

  return {
    ...createBlockMeta('ok', [createSourceRef('holding', 'deepscan-us-sell-now', 'US sell-now decision')]),
    realizedText: `현재가 기준 평가손익 ${formatCurrency(pnl, facts.currency)} (${signedPercent(pnlPct)}). 즉시 매도 판단은 ${decisionBand} 입니다.`,
    rows: [
      { label: '판단', value: decisionBand, emphasis: true },
      { label: '현재가', value: formatCurrency(currentPrice, facts.currency) },
      { label: '평단가', value: formatCurrency(averagePrice, facts.currency) },
      { label: '평가손익', value: `${formatCurrency(pnl, facts.currency)} / ${signedPercent(pnlPct)}`, tag: pnl >= 0 ? '수익' : '손실', tagTone: pnl >= 0 ? 'positive' : 'danger', valueTone: pnl >= 0 ? undefined : 'danger' },
    ],
  }
}

function buildUsPortfolioSimulation(heroScore: number, sellNow: JarooDeepScanSellNowBlock): JarooDeepScanPortfolioSimulationBlock {
  if (sellNow.blockState !== 'ok') {
    return {
      ...createBlockMeta('blocked', [createSourceRef('system', 'deepscan-us-portfolio-sim', 'US portfolio simulation blocked')], {
        fallback: createFallback('sell-now-blocked', '시뮬레이션 보류'),
        error: createError('sell-now-blocked', '즉시 매도 판단이 없어 포트폴리오 점수 변화를 계산하지 않았어요.'),
      }),
      beforeScore: heroScore,
      afterScore: heroScore,
      deltaLabel: 'blocked:+0',
      caption: '즉시 매도 판단이 준비되면 포트폴리오 점수 변화를 계산할 수 있어요.',
    }
  }

  const decisionBand = sellNow.rows.find((row) => row.label === '판단')?.value ?? 'hold'
  const delta = decisionBand === 'hold' ? 2 : decisionBand === 'trim' ? 6 : 9
  const beforeScore = clamp(heroScore)
  const afterScore = clamp(heroScore + delta)

  return {
    ...createBlockMeta('ok', [createSourceRef('system', 'deepscan-us-portfolio-sim', 'US portfolio simulation')]),
    beforeScore,
    afterScore,
    deltaLabel: `${decisionBand}:+${delta}`,
    caption: `${decisionBand} 판단 기준 포지션 제거 시 포트폴리오 점수 ${beforeScore} → ${afterScore}.`,
  }
}

function createUsRuntimeFailurePayload(rawInput: DeepScanRawInput, ticker: string, name: string, generatedAt: string, sourceRefs: DeepScanSourceRef[], code: string, message: string): JarooDeepScanPayload {
  const sourceContextFrom = normalizeSourceFrom(rawInput.sourceContext.from)
  const fallback = createFallback(code, 'US LLM runtime 실패')
  const error = createError(code, message, true)

  return {
    input: {
      instrument: {
        name,
        ticker,
        market: 'US',
        kind: rawInput.instrument.kind,
      },
      holding: rawInput.holding,
      selectedAt: rawInput.selectedAt,
      sourceContext: { from: sourceContextFrom },
    },
    hero: {
      ...createBlockMeta('error', sourceRefs, { fallback, error }),
      headline: `${name} US DeepScan LLM 분석에 실패했어요`,
      body: 'US LLM committee runtime을 완료하지 못해 DeepScan canonical payload 생성을 중단했어요.',
      statusText: '요청 실패',
      score: 0,
      scoreLabel: 'Error · 0 / 100',
      scoreDelta: '+0',
    },
    committee: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), axes: [] },
    insights: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), sectionLabel: '이번 주 체크포인트', items: [], summaryTags: [] },
    strategy: {
      ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
      weekSignal: '대기',
      weekSignalTone: 'warning',
      weekBadgeText: 'LLM 실패',
      scenarioLabel: '데이터 재요청 필요',
      scenarioProbability: '0%',
      scenarioPeriod: '대기',
      scenarioCondition: '잠시 후 다시 시도해주세요.',
      currentPriceText: 'N/A',
      targetPriceText: 'N/A',
      scenarioDetails: ['US LLM committee runtime 재요청이 필요해요.'],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), realizedText: '데이터가 없어 즉시 매도 판단을 계산하지 않았어요.', rows: [] },
    portfolioSimulation: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), beforeScore: 0, afterScore: 0, deltaLabel: 'blocked:+0', caption: '데이터가 없어 포트폴리오 점수 변화를 계산하지 않았어요.' },
    metadata: {
      generatedAt,
      version: 'deepscan-runtime-v1',
      degraded: true,
      errorCode: error.code,
      debugId: `deepscan:US:${ticker}:llm`,
      inputValidity: {
        valid: true,
        raw: buildInputValidityRaw(rawInput),
      },
      sourceRefs,
      blockStatus: {
        hero: 'error',
        committee: 'blocked',
        insights: 'blocked',
        strategy: 'blocked',
        sellNow: 'blocked',
        portfolioSimulation: 'blocked',
      },
    },
  } satisfies JarooDeepScanPayload
}

async function fetchUsSlimPayload(ticker: string) {
  const upstreamUrl = buildCrawlerUrl(getCrawlerBaseUrl(), `/api/major/wisereport-global/us/companies/${encodeURIComponent(ticker)}/slim/v1.1`)
  const response = await fetch(upstreamUrl, { cache: 'no-store' })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`US slim fetch failed (${response.status}): ${body.slice(0, 200)}`)
  }

  return response.json()
}

async function buildUsPayload(rawInput: DeepScanRawInput): Promise<JarooDeepScanPayload> {
  const ticker = normalizeText(rawInput.instrument.ticker)?.toUpperCase()
  const name = normalizeText(rawInput.instrument.name) ?? ticker ?? '미국 종목'

  if (!ticker) {
    return createInvalidInputPayload(rawInput)
  }

  const generatedAt = rawInput.selectedAt ?? new Date().toISOString()
  const sourceRefs = [
    createSourceRef('holding', `input:${ticker}`, 'deepscan input'),
    createSourceRef('system', 'deepscan-runtime-us', 'deepscan runtime us baseline'),
  ]

  const issues: SourceIssue[] = []
  let slimPayload: unknown = null

  try {
    slimPayload = await fetchUsSlimPayload(ticker)
  } catch (error) {
    issues.push({
      id: 'us-slim',
      message: error instanceof Error ? error.message : 'US slim fetch failed',
      retryable: true,
    })
  }

  if (!slimPayload) {
    const fallback = createFallback('us-slim-fetch-failed', 'US slim fetch 실패')
    const error = createError('us-slim-fetch-failed', issues[0]?.message ?? 'US slim fetch failed', true)
    const sourceContextFrom = normalizeSourceFrom(rawInput.sourceContext.from)

    const payload = {
      input: {
        instrument: {
          name,
          ticker,
          market: 'US',
          kind: rawInput.instrument.kind,
        },
        holding: rawInput.holding,
        selectedAt: rawInput.selectedAt,
        sourceContext: { from: sourceContextFrom },
      },
      hero: {
        ...createBlockMeta('error', sourceRefs, { fallback, error }),
        headline: `${name} US DeepScan을 불러오지 못했어요`,
        body: 'US slim payload를 가져오지 못해서 DeepScan canonical payload 생성을 중단했어요.',
        statusText: '요청 실패',
        score: 0,
        scoreLabel: 'Error · 0 / 100',
        scoreDelta: '+0',
      },
      committee: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), axes: [] },
      insights: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), sectionLabel: '이번 주 체크포인트', items: [], summaryTags: [] },
      strategy: {
        ...createBlockMeta('blocked', sourceRefs, { fallback, error }),
        weekSignal: '대기',
        weekSignalTone: 'warning',
        weekBadgeText: 'fetch 실패',
        scenarioLabel: '데이터 재요청 필요',
        scenarioProbability: '0%',
        scenarioPeriod: '대기',
        scenarioCondition: '잠시 후 다시 시도해주세요.',
        currentPriceText: 'N/A',
        targetPriceText: 'N/A',
        scenarioDetails: ['US slim payload 재요청이 필요해요.'],
        otherScenarios: [],
        otherScenarioTags: [],
      },
      sellNow: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), realizedText: '데이터가 없어 즉시 매도 판단을 계산하지 않았어요.', rows: [] },
      portfolioSimulation: { ...createBlockMeta('blocked', sourceRefs, { fallback, error }), beforeScore: 0, afterScore: 0, deltaLabel: 'blocked:+0', caption: '데이터가 없어 포트폴리오 점수 변화를 계산하지 않았어요.' },
      metadata: {
        generatedAt,
        version: 'deepscan-runtime-v1',
        degraded: true,
        errorCode: error.code,
        debugId: `deepscan:US:${ticker}`,
        inputValidity: {
          valid: true,
          raw: buildInputValidityRaw(rawInput),
        },
        sourceRefs,
        blockStatus: {
          hero: 'error',
          committee: 'blocked',
          insights: 'blocked',
          strategy: 'blocked',
          sellNow: 'blocked',
          portfolioSimulation: 'blocked',
        },
      },
    } satisfies JarooDeepScanPayload

    return payload
  }

  const facts = findUsFacts(slimPayload, ticker)
  let agentResults: DeepScanAgentResult[]
  let llmDebugId: string | undefined

  let llmErrors: Array<{ member: string; error: string }> = []

  try {
    const llm = await scoreUsCommitteeFromGeneratedDump(rawInput, ticker)
    agentResults = buildUsAgentResultsFromLlm(llm.results)
    llmDebugId = llm.artifacts.manifest.requestId
    llmErrors = llm.errors

    if (agentResults.length === 0) {
      throw new Error(llm.errors.map((entry) => `${entry.member}: ${entry.error}`).join(' | ') || 'US LLM runtime returned no successful members')
    }
  } catch (error) {
    return createUsRuntimeFailurePayload(
      rawInput,
      ticker,
      name,
      generatedAt,
      [...sourceRefs, createSourceRef('system', 'deepscan-runtime-us-llm', 'US LLM committee runtime')],
      'us-llm-runtime-failed',
      error instanceof Error ? error.message : 'US LLM runtime failed',
    )
  }

  const heroScore = buildHeroScore(agentResults)
  const axes = buildAxes(agentResults)
  const insights = buildUsInsights(facts, agentResults)
  const strategy = buildUsStrategy(heroScore, facts, rawInput)
  const sellNow = buildUsSellNow(heroScore, facts, rawInput)
  const portfolioSimulation = buildUsPortfolioSimulation(heroScore, sellNow)
  const degraded = agentResults.some((agent) => agent.confidence === 'low') || llmErrors.length > 0
  const sourceContextFrom = normalizeSourceFrom(rawInput.sourceContext.from)
  const sourceRefsWithPayload = [
    ...sourceRefs,
    createSourceRef('report', `us-slim:${ticker}`, 'WiseReport Global slim v1.1', facts.consensus?.asOfDate),
    createSourceRef('market', `us-price:${ticker}`, 'latest price from slim snapshot'),
    createSourceRef('system', `us-llm:${ticker}`, 'OpenRouter US committee runtime', llmDebugId ?? (llmErrors.length > 0 ? `${llmErrors.length} member failures` : undefined)),
  ]

  const payload = {
    input: {
      instrument: {
        name,
        ticker,
        market: facts.market ?? 'US',
        kind: rawInput.instrument.kind,
      },
      holding: rawInput.holding,
      selectedAt: rawInput.selectedAt,
      sourceContext: { from: sourceContextFrom },
    },
    hero: {
      ...createBlockMeta('ok', sourceRefsWithPayload, degraded ? { fallback: createFallback('weak-data-degradation', llmErrors.length > 0 ? `일부 위원 실패 ${llmErrors.length}건` : '일부 근거 부족') } : undefined),
      headline: `${name} US DeepScan ${heroScore}점`,
      body: [
        `현재가 ${formatCurrency(facts.currentPrice, facts.currency)} 확인`,
        `forward PER ${formatNumber(facts.consensus?.forwardPer ?? facts.per, 1)} / PBR ${formatNumber(facts.consensus?.forwardPbr ?? facts.pbr, 1)}`,
        `최근 뉴스 ${facts.news.length}건 반영`,
      ].join(' · '),
      statusText: axisStatus(heroScore),
      score: heroScore,
      scoreLabel: `${heroScore >= 70 ? 'strong' : heroScore >= 55 ? 'moderate' : 'caution'} · ${heroScore} / 100`,
      scoreDelta: degraded ? '-1' : '+0',
    },
    committee: {
      ...createBlockMeta('ok', sourceRefsWithPayload, degraded ? { fallback: createFallback('weak-data-degradation', llmErrors.length > 0 ? `일부 위원 실패 ${llmErrors.length}건` : '일부 위원은 low-confidence') } : undefined),
      axes,
    },
    insights: {
      ...createBlockMeta(insights.items.length > 0 ? 'ok' : 'blocked', sourceRefsWithPayload, insights.items.length > 0 ? undefined : { fallback: createFallback('news-missing', '뉴스 데이터 부족') }),
      ...insights,
    },
    strategy,
    sellNow,
    portfolioSimulation,
    metadata: {
      generatedAt,
      version: 'deepscan-runtime-v1',
      degraded,
      debugId: llmDebugId ?? `deepscan:US:${ticker}:llm`,
      inputValidity: {
        valid: true,
        raw: buildInputValidityRaw(rawInput),
      },
      sourceRefs: sourceRefsWithPayload,
      blockStatus: {
        hero: 'ok',
        committee: 'ok',
        insights: insights.items.length > 0 ? 'ok' : 'blocked',
        strategy: strategy.blockState,
        sellNow: sellNow.blockState,
        portfolioSimulation: portfolioSimulation.blockState,
      },
    },
  } satisfies JarooDeepScanPayload

  return payload
}

export async function buildDeepScanPayloadFromSearchParams(searchParams: URLSearchParams) {
  const rawInput = buildRawInputFromSearchParams(searchParams)
  const market = rawInput.instrument.market?.toUpperCase()

  if (market === 'US' || (!rawInput.instrument.code && rawInput.instrument.ticker)) {
    return buildUsPayload(rawInput)
  }

  if (!rawInput.instrument.code && !rawInput.instrument.ticker) {
    return createInvalidInputPayload(rawInput)
  }

  return buildCrawlerDeepScanPayload(rawInput)
}

export { buildRawInputFromSearchParams }
