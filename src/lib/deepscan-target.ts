import type { HomeHolding } from './jaroo-home-data'
import { parseOcrNumber } from './screenshot-ocr'

export type DeepScanAxisTone = 'positive' | 'primary' | 'warning'
export type DeepScanMemberTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'
export type DeepScanInsightTone = 'positive' | 'danger' | 'neutral'
export type DeepScanScenarioTone = 'positive' | 'primary' | 'warning'

export type DeepScanAxisMember = {
  shortLabel: string
  title: string
  reason: string
  score: number
  scoreLabel: string
  tone: 'positive' | 'neutral' | 'warning'
  iconTone: DeepScanMemberTone
}

export type DeepScanAxisGroup = {
  label: string
  score: number
  scoreText: string
  status: string
  subtitle: string
  avgLabel: string
  tone: DeepScanAxisTone
  members: DeepScanAxisMember[]
}

export type DeepScanInsightItem = {
  source: string
  date: string
  tone: DeepScanInsightTone
  label: string
  title: string
  body: string
}

export type DeepScanScenario = {
  label: string
  period: string
  condition: string
  probability: string
  tone: DeepScanScenarioTone
}

export type DeepScanSellRow = {
  label: string
  value: string
  tag?: string
  tagTone?: 'positive' | 'danger'
  valueTone?: 'danger'
  emphasis?: boolean
}

export type DeepScanSummaryTag = {
  key: string
  text: string
  tone: DeepScanInsightTone | DeepScanScenarioTone
}

export type DeepScanViewModel = {
  holding: HomeHolding
  title: string
  body: string
  statusText: string
  statusToneClass: string
  score: number
  scoreLabel: string
  scoreDelta: number
  weekSignal: string
  weekSignalTone: string
  weekBadgeClass: string
  weekBadgeText: string
  axisGroups: DeepScanAxisGroup[]
  insightSectionLabel: string
  insightItems: DeepScanInsightItem[]
  insightSummaryTags: DeepScanSummaryTag[]
  scenarioLabel: string
  scenarioProbability: string
  scenarioPeriod: string
  scenarioCondition: string
  currentPriceText: string
  targetPriceText: string
  scenarioDetails: string[]
  otherScenarios: DeepScanScenario[]
  otherScenarioTags: DeepScanSummaryTag[]
  sellRows: DeepScanSellRow[]
  realizedText: string
  portfolioScoreBefore: number
  portfolioScoreAfter: number
}

export type DeepScanTargetSession = {
  holding: HomeHolding
  viewModel: DeepScanViewModel
  selectedAt?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  return `${value > 0 ? '+' : ''}${Number(value.toFixed(1)).toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`
}

function scoreStatus(score: number) {
  if (score >= 7.3) {
    return { status: '양호', tone: 'positive' as const }
  }

  if (score >= 5.8) {
    return { status: '관찰', tone: 'primary' as const }
  }

  return { status: '주의', tone: 'warning' as const }
}

function toScoreLabel(score: number) {
  return `${Math.round(score)}점`
}

function probabilityText(value: number) {
  return `${Math.round(value)}%`
}

function periodText(months: number) {
  return `약 ${Math.max(1, Math.round(months))}개월`
}

function buildAxisMember(
  shortLabel: string,
  title: string,
  reason: string,
  score: number,
  iconTone: DeepScanMemberTone,
): DeepScanAxisMember {
  return {
    shortLabel,
    title,
    reason,
    score,
    scoreLabel: toScoreLabel(score),
    tone: score >= 7 ? 'positive' : score >= 5 ? 'neutral' : 'warning',
    iconTone,
  }
}

export function pickDeepScanDefaultHolding(holdings: HomeHolding[]) {
  const candidates = holdings.filter((holding) => holding.kind === 'stock')

  if (candidates.length === 0) {
    return null
  }

  return [...candidates].sort((left, right) => {
    const leftChange = parseOcrNumber(left.change)
    const rightChange = parseOcrNumber(right.change)

    if (leftChange === null && rightChange === null) {
      return 0
    }

    if (leftChange === null) {
      return 1
    }

    if (rightChange === null) {
      return -1
    }

    return leftChange - rightChange
  })[0]
}

export function createPlaceholderDeepScanHolding(): HomeHolding {
  return {
    id: -1,
    kind: 'stock',
    name: '종목 미선택',
    shortName: '미선택',
    donutLabel: '미선택',
    shares: '-',
    averagePrice: '-',
    evaluationAmount: '-',
    market: '미확인',
    marketTone: 'kospi',
    badge: '확인 필요',
    badgeTone: 'amber',
    cardTone: 'warning',
    change: '-',
    pnl: '-',
    signalTone: 'warning',
    centerScore: '-',
    centerScoreColor: '#FAC775',
    centerBadge: '확인 필요',
    centerBadgeTone: 'amber',
    centerName: '종목 미선택',
    donutColor: '#8C98A8',
    donutPercent: 1,
    heatmapWeight: '-',
    heatmapBackground: '#8C98A8',
    heatmapChange: '-',
    heatmapBadge: '확인 필요',
    heatmapBadgeTone: 'amber',
    opinionLabel: '안내',
    opinionText: '홈에서 실제 종목을 선택한 뒤 딥스캔을 열면 인식한 데이터가 그대로 연결돼요.',
    opinionBackground: '#f8f8f6',
    opinionBorder: 'transparent',
    opinionTextColor: '#555',
    metaLine: '종목 선택 후 다시 시도하세요.',
    metrics: [
      { label: '보유 수량', value: '-', tone: 'neutral' },
      { label: '수익률', value: '-', tone: 'neutral' },
      { label: '평가 금액', value: '-', tone: 'neutral' },
    ],
    actionLabel: '딥스캔',
    actionSubLabel: '실제 종목 선택 필요',
    actionCredits: '300cr',
    actionHref: '/deepscan',
  }
}

export function buildDeepScanViewModel(holding: HomeHolding): DeepScanViewModel {
  const changeValue = parseOcrNumber(holding.change)
  const shareValue = parseOcrNumber(holding.shares)
  const averagePriceValue = parseOcrNumber(holding.averagePrice)
  const evaluationAmountValue = parseOcrNumber(holding.evaluationAmount ?? '')
  const pnlValue = parseOcrNumber(holding.pnl)
  const currentPriceValue = shareValue && evaluationAmountValue !== null ? evaluationAmountValue / shareValue : null
  const recoveryNeedPercent =
    averagePriceValue !== null && currentPriceValue !== null && currentPriceValue > 0
      ? ((averagePriceValue - currentPriceValue) / currentPriceValue) * 100
      : null
  const codeLabel = holding.code ?? '코드 미확인'
  const score = Number((changeValue === null ? 6.1 : clamp(7 + changeValue / 12, 4.2, 8.8)).toFixed(1))
  const scoreLabel = score >= 7.2 ? '양호' : score >= 5.8 ? '관찰' : '주의'
  const scoreDelta = changeValue === null ? 0 : changeValue >= 0 ? 0.4 : 0.2
  const title =
    changeValue === null
      ? '먼저 데이터를 확인해봐요'
      : changeValue >= 5
        ? '수익 구간 전략을 점검해요'
        : changeValue >= -10
          ? '회복 흐름을 조금 더 지켜봐요'
          : changeValue >= -20
            ? '회복 시나리오를 점검해요'
            : '지금은 버티는 게 나아요'
  const body =
    holding.evaluationAmount && holding.averagePrice
      ? `${holding.name} ${holding.change} · ${holding.shares}로 인식됐어요. 코드 ${codeLabel}, 평단 ${holding.averagePrice}, 평가금액 ${holding.evaluationAmount} 기준으로 현재 포지션을 정리했어요.`
      : `${holding.name} ${holding.change} · ${holding.shares} 기준으로 현재 포지션을 정리했어요.`
  const statusText = `${holding.change} · ${holding.shares}`
  const statusToneClass =
    changeValue !== null && changeValue >= 0
      ? 'text-[color:var(--jaroo-success)]'
      : changeValue !== null && changeValue <= -20
        ? 'text-[color:var(--jaroo-danger)]'
        : 'text-[color:var(--jaroo-warning)]'
  const weekSignal =
    changeValue !== null && changeValue >= 0
      ? '이번 주 순풍 — 수익 구간'
      : changeValue !== null && changeValue <= -20
        ? '이번 주 역풍 — 경계 필요'
        : '이번 주 미풍 — 회복 확인 중'
  const weekSignalTone =
    changeValue !== null && changeValue >= 0
      ? 'text-[color:var(--jaroo-success)]'
      : changeValue !== null && changeValue <= -20
        ? 'text-[color:var(--jaroo-danger)]'
        : 'text-[color:var(--jaroo-warning)]'
  const weekBadgeClass =
    changeValue !== null && changeValue >= 0
      ? 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]'
      : changeValue !== null && changeValue <= -20
        ? 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]'
        : 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]'
  const weekBadgeText = changeValue !== null && changeValue >= 0 ? '↑' : changeValue !== null && changeValue <= -20 ? '↓' : '→'
  const scenarioLabel = changeValue !== null && changeValue >= 0 ? '순풍' : changeValue !== null && changeValue <= -20 ? '미풍' : '회복'
  const scenarioProbabilityValue = Math.round(clamp(58 + (changeValue ?? -5), 24, 78))
  const scenarioProbability = probabilityText(scenarioProbabilityValue)
  const scenarioPeriod =
    changeValue !== null && changeValue >= 0 ? '약 3개월' : changeValue !== null && changeValue <= -20 ? '약 8개월' : '약 5개월'
  const scenarioCondition =
    changeValue !== null && changeValue >= 0
      ? `${holding.name} 수익 흐름 유지 시`
      : recoveryNeedPercent !== null
        ? `평단까지 ${formatPercent(recoveryNeedPercent)} 회복 시`
        : `${holding.name} 흐름 안정 시`

  const valuationMembers = [
    buildAxisMember('가치', '가치 분석가', `평단 ${holding.averagePrice} 대비 현재 추정가 ${formatCurrency(currentPriceValue)} 구간을 비교했어요.`, clamp(score + 0.6, 4, 9), 'blue'),
    buildAxisMember('성장', '성장 전략가', `평가금액 ${holding.evaluationAmount ?? '-'}와 보유 수량 ${holding.shares} 기준으로 확장 여력을 봤어요.`, clamp(score + (changeValue !== null && changeValue >= 0 ? 0.3 : -0.2), 4, 9), 'green'),
    buildAxisMember('재무', '재무 감사관', `${holding.name} ${codeLabel} 포지션의 손익 ${holding.pnl}과 자금 회수 난도를 체크했어요.`, clamp(score + (pnlValue !== null && pnlValue >= 0 ? 0.2 : -0.5), 3, 9), 'amber'),
  ]
  const momentumMembers = [
    buildAxisMember('차트', '차트 마스터', `수익률 ${holding.change} 기준으로 현재 구간이 과열인지 반등 초입인지 판단했어요.`, clamp(score + (changeValue !== null && changeValue >= 0 ? 0.4 : -0.3), 3, 9), 'teal'),
    buildAxisMember('수급', '수급 추적기', `보유 수량 ${holding.shares}가 크면 변동성 체감이 커져서 대응 속도를 높여야 해요.`, clamp(score + (shareValue !== null && shareValue >= 100 ? -0.5 : 0.1), 3, 9), 'red'),
    buildAxisMember('모멘', '모멘텀 스카우터', `${holding.name}의 현재 추정가 ${formatCurrency(currentPriceValue)}와 평단 ${holding.averagePrice} 사이 간격을 모멘텀으로 해석했어요.`, clamp(score + (recoveryNeedPercent !== null && recoveryNeedPercent <= 10 ? 0.4 : -0.1), 3, 9), 'purple'),
  ]
  const environmentMembers = [
    buildAxisMember('심리', '심리 분석 AI', `${holding.name} ${holding.change} 구간은 투자 심리가 흔들리기 쉬워서 분할 대응 기준이 필요해요.`, clamp(score + (changeValue !== null && changeValue <= -20 ? -0.8 : 0.1), 3, 9), 'blue'),
    buildAxisMember('산업', '산업 전문가', `${holding.market} · ${codeLabel} 기준으로 동일 섹터 대체 종목 비교가 가능한 상태인지 봤어요.`, clamp(score + (holding.code ? 0.2 : -0.4), 3, 9), 'green'),
    buildAxisMember('이벤트', '이벤트 스캐너', `실현 기준 ${holding.pnl}이라 다음 이벤트 전까지 손절/익절 조건을 명확히 두는 편이 좋아요.`, clamp(score + (pnlValue !== null && pnlValue < 0 ? -0.6 : 0.2), 3, 9), 'amber'),
  ]

  const axisGroups: DeepScanAxisGroup[] = [
    {
      label: '펀더멘털',
      score: Number((valuationMembers.reduce((sum, member) => sum + member.score, 0) / valuationMembers.length).toFixed(1)),
      scoreText: '',
      status: '',
      subtitle: '평단·평가금액·손익',
      avgLabel: '',
      tone: 'positive',
      members: valuationMembers,
    },
    {
      label: '에너지',
      score: Number((momentumMembers.reduce((sum, member) => sum + member.score, 0) / momentumMembers.length).toFixed(1)),
      scoreText: '',
      status: '',
      subtitle: '변동성·수량·모멘텀',
      avgLabel: '',
      tone: 'primary',
      members: momentumMembers,
    },
    {
      label: '환경',
      score: Number((environmentMembers.reduce((sum, member) => sum + member.score, 0) / environmentMembers.length).toFixed(1)),
      scoreText: '',
      status: '',
      subtitle: '심리·시장·이벤트',
      avgLabel: '',
      tone: 'warning',
      members: environmentMembers,
    },
  ].map((axis) => {
    const axisStatus = scoreStatus(axis.score)

    return {
      ...axis,
      scoreText: axis.score.toFixed(1),
      status: axisStatus.status,
      avgLabel: `평균 ${axis.score.toFixed(1)}점`,
      tone: axisStatus.tone,
    }
  })

  const insightItems: DeepScanInsightItem[] = [
    {
      source: 'OCR 결과',
      date: '방금',
      tone: changeValue !== null && changeValue >= 0 ? 'positive' : 'neutral',
      label: changeValue !== null && changeValue >= 0 ? '수익' : '인식',
      title: `${holding.name} ${holding.change} · ${holding.shares}`,
      body: `실제 인식 종목명 ${holding.name}, 코드 ${codeLabel}, 보유 수량 ${holding.shares}가 딥스캔에 연결됐어요.`,
    },
    {
      source: '포트폴리오 적용',
      date: '현재',
      tone: changeValue !== null && changeValue <= -20 ? 'danger' : 'neutral',
      label: changeValue !== null && changeValue <= -20 ? '주의' : '기준',
      title: `평단 ${holding.averagePrice} · 평가금액 ${holding.evaluationAmount ?? '-'}`,
      body: `평단과 평가금액을 기준으로 현재가 ${formatCurrency(currentPriceValue)} 및 회복 간격 ${formatPercent(recoveryNeedPercent)}를 계산했어요.`,
    },
    {
      source: '딥스캔 기준',
      date: '동기화',
      tone: pnlValue !== null && pnlValue < 0 ? 'danger' : 'positive',
      label: pnlValue !== null && pnlValue < 0 ? '손실' : '유지',
      title: `실현 기준 손익 ${holding.pnl}`,
      body: `${holding.name} 포지션은 ${holding.market} 시장 기준으로 현재 전략 카드와 포트폴리오 점수 계산에 그대로 반영돼요.`,
    },
  ]

  const insightToneCounts = insightItems.reduce(
    (counts, item) => ({
      ...counts,
      [item.tone]: counts[item.tone] + 1,
    }),
    { positive: 0, danger: 0, neutral: 0 },
  )

  const alternativePool = Math.max(0, 100 - scenarioProbabilityValue)
  const positiveScenarioValue = clamp(
    Math.round(alternativePool * (changeValue !== null && changeValue >= 0 ? 0.7 : 0.45)),
    10,
    42,
  )
  const warningScenarioValue = clamp(100 - scenarioProbabilityValue - positiveScenarioValue, 8, 28)

  const otherScenarios: DeepScanScenario[] = [
    {
      label: '강풍',
      period: periodText(changeValue !== null && changeValue >= 0 ? 2 : 4),
      condition: `${holding.name} 흐름이 빠르게 회복될 때`,
      probability: probabilityText(positiveScenarioValue),
      tone: 'positive',
    },
    {
      label: scenarioLabel,
      period: scenarioPeriod,
      condition: scenarioCondition,
      probability: scenarioProbability,
      tone: 'primary',
    },
    {
      label: '방어',
      period: periodText(changeValue !== null && changeValue <= -20 ? 10 : 7),
      condition: `${holding.name} 비중 축소나 분할 대응이 필요할 때`,
      probability: probabilityText(warningScenarioValue),
      tone: 'warning',
    },
  ]

  const scenarioDetails = [
    `실제 인식 기준 코드 ${codeLabel}와 종목명 ${holding.name}이 deepscan 전 구간에 연결됐는지 먼저 확인하세요.`,
    `평단 ${holding.averagePrice} 대비 현재 추정가 ${formatCurrency(currentPriceValue)} 간격을 기준으로 분할 대응 계획을 세우세요.`,
    `평가금액 ${holding.evaluationAmount ?? '-'} · 보유 수량 ${holding.shares} 기준으로 포트폴리오 비중을 다시 보세요.`,
  ]

  const sellRows: DeepScanSellRow[] = [
    { label: '종목 코드', value: codeLabel, tag: holding.code ? '확인' : '미확인', tagTone: holding.code ? 'positive' : 'danger' },
    { label: '추정 현재가', value: formatCurrency(currentPriceValue), emphasis: true },
    { label: '평단', value: holding.averagePrice, tag: '기준', tagTone: 'positive' },
    { label: '평가금액', value: holding.evaluationAmount ?? '-' },
    { label: '실현 손익', value: holding.pnl, valueTone: changeValue !== null && changeValue < 0 ? 'danger' : undefined },
    { label: '보유 수량', value: holding.shares },
  ]

  const realizedText =
    holding.pnl === '-'
      ? '실현 손익 재확인 필요'
      : `${holding.pnl} ${changeValue !== null && changeValue >= 0 ? '수익 확정' : '손실 확정'}`
  const portfolioScoreBefore = clamp(Math.round(58 + (changeValue ?? -5)), 20, 92)
  const portfolioScoreAfter = clamp(portfolioScoreBefore + (changeValue !== null && changeValue < 0 ? 10 : 6), 0, 99)

  return {
    holding,
    title,
    body,
    statusText,
    statusToneClass,
    score,
    scoreLabel,
    scoreDelta,
    weekSignal,
    weekSignalTone,
    weekBadgeClass,
    weekBadgeText,
    axisGroups,
    insightSectionLabel: '실제 인식 데이터',
    insightItems,
    insightSummaryTags: [
      { key: 'positive', text: `긍정 ${insightToneCounts.positive}건`, tone: 'positive' },
      { key: 'danger', text: `주의 ${insightToneCounts.danger}건`, tone: 'danger' },
      { key: 'neutral', text: `기준 ${insightToneCounts.neutral}건`, tone: 'neutral' },
    ],
    scenarioLabel,
    scenarioProbability,
    scenarioPeriod,
    scenarioCondition,
    currentPriceText: formatCurrency(currentPriceValue),
    targetPriceText: holding.averagePrice,
    scenarioDetails,
    otherScenarios,
    otherScenarioTags: [
      { key: 'strong', text: `강풍 ${otherScenarios[0].probability}`, tone: 'positive' },
      { key: 'defense', text: `방어 ${otherScenarios[2].probability}`, tone: 'warning' },
    ],
    sellRows,
    realizedText,
    portfolioScoreBefore,
    portfolioScoreAfter,
  }
}

export function buildDeepScanTargetSession(holding: HomeHolding): DeepScanTargetSession {
  return {
    holding,
    viewModel: buildDeepScanViewModel(holding),
    selectedAt: new Date().toISOString(),
  }
}
