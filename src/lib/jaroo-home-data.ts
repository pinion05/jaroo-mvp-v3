import { buildDeepScanTargetSession, createPlaceholderDeepScanHolding, pickDeepScanDefaultHolding, type DeepScanTargetSession } from '@/lib/deepscan-target'
import { buildIdentifierLabel, deriveSnapshotProfitRate, type PortfolioNormalizedItem, type WorkflowAsyncStatus } from '@/lib/workflow-types'
import { isAveragePriceComputedFromEvaluation, normalizeStockName, parseOcrNumber, parseOcrProfitRate, type OcrRow } from '@/lib/screenshot-ocr'

export type HomeBadgeTone = 'amber' | 'red' | 'green'
export type HomeCardTone = 'danger' | 'warning' | 'halt' | 'profit' | 'etf'
export type HomeMetricTone = 'danger' | 'warning' | 'positive' | 'locked' | 'neutral'
export type HomeMarketTone = 'kospi' | 'kosdaq' | 'etf' | 'nasdaq'
export type HomeActionTone = 'blue' | 'red' | 'green'
export type MomentumStageTone = 'danger' | 'muted' | 'positive'
export type AveragePriceCurrency = 'KRW' | 'USD'

export type HomeMarketScoreStatus = 'loading' | 'ready' | 'fallback' | 'error'

export type HomeMarketScoreDetail = {
  label: string
  value: string
  meta?: string
}

export type HomeMarketScore = {
  score: string
  status: HomeMarketScoreStatus
  label: string
  tone: HomeBadgeTone
  description: string
  details: HomeMarketScoreDetail[]
  sourceLabel: string
  updatedLabel: string
}

export type HomeMarketVolatilitySignal = {
  value?: number | null
  changePercent?: number | null
  asOf?: string | null
}

export type HomeMarketAdrSignal = {
  value?: number | null
  change?: number | null
  asOf?: string | null
}

export type HomeUsdKrwSignal = {
  rate?: number | null
  changePercent?: number | null
  timestamp?: string | null
}

export type HomeMarketScoreSignals = {
  usdKrw?: HomeUsdKrwSignal | null
  indicators?: {
    vkospi?: HomeMarketVolatilitySignal | null
    usVix?: HomeMarketVolatilitySignal | null
    adr?: {
      kospi?: HomeMarketAdrSignal | null
      kosdaq?: HomeMarketAdrSignal | null
    } | null
  } | null
}

type HomeMarketAdrSignals = NonNullable<NonNullable<HomeMarketScoreSignals['indicators']>['adr']>

export type BuildHomeMarketScoreOptions = {
  quoteStatus?: WorkflowAsyncStatus
  isAppliedPortfolio?: boolean
  marketSignalStatus?: WorkflowAsyncStatus
  marketSignals?: HomeMarketScoreSignals | null
  updatedLabel?: string
}

export type HomeHolding = {
  id: number
  kind: 'stock' | 'etf'
  name: string
  code?: string
  shortName: string
  donutLabel: string
  shares: string
  averagePrice: string
  averagePriceCurrency?: AveragePriceCurrency
  snapshotProfitRate?: number
  evaluationAmount?: string
  market: string
  marketTone: HomeMarketTone
  identifierTicker?: string
  identifierCode?: string
  identifierLabel?: string
  badge: string
  badgeTone: HomeBadgeTone
  cardTone: HomeCardTone
  change: string
  pnl: string
  signalTone: 'danger' | 'warning' | 'positive' | 'halt' | 'etf'
  centerScore: string
  centerScoreColor: string
  centerBadge: string
  centerBadgeTone: HomeBadgeTone
  centerName: string
  donutColor: string
  donutPercent: number
  heatmapWeight: string
  heatmapBackground: string
  heatmapChange?: string
  heatmapMeta?: string
  heatmapBadge?: string
  heatmapBadgeTone?: HomeBadgeTone
  blink?: boolean
  opinionLabel: string
  opinionText: string
  opinionBackground: string
  opinionBorder: string
  opinionTextColor: string
  metaLine: string
  metrics: Array<{
    label: string
    value: string
    tone: HomeMetricTone
  }>
  actionLabel: string
  actionSubLabel?: string
  actionCredits?: string
  actionHref: string | null
}

export type AppliedHomePortfolioRow = Pick<
  OcrRow,
  | 'name'
  | 'quantity'
  | 'profitRate'
  | 'evaluationAmount'
  | 'averagePrice'
  | 'resolvedName'
  | 'resolvedCode'
  | 'resolvedTicker'
  | 'resolvedMarket'
  | 'resolvedMarketTone'
  | 'resolvedKind'
  | 'code'
  | 'ticker'
> & {
  profitAmount?: string
  averagePriceCurrency?: AveragePriceCurrency
  currentPrice?: number
  currentPriceCurrency?: AveragePriceCurrency
  currentProfitRate?: number
  usdKrwRate?: number
}

export const homeHoldings: HomeHolding[] = [
  {
    id: 0,
    kind: 'stock',
    name: '삼성전자',
    code: '005930',
    shortName: '삼성전자',
    donutLabel: '삼성전자',
    shares: '128주',
    averagePrice: '74,600원',
    market: 'KOSPI',
    marketTone: 'kospi',
    badge: '긴급 점검',
    badgeTone: 'red',
    cardTone: 'danger',
    change: '-23.4%',
    pnl: '-1,701,800원',
    signalTone: 'danger',
    centerScore: '-23.4%',
    centerScoreColor: '#F09595',
    centerBadge: '긴급 점검',
    centerBadgeTone: 'red',
    centerName: '삼성전자',
    donutColor: '#E24B4A',
    donutPercent: 0.4,
    heatmapWeight: '50%',
    heatmapBackground: '#C13030',
    heatmapChange: '-23.4%',
    heatmapBadge: '긴급 점검',
    heatmapBadgeTone: 'red',
    opinionLabel: '간략 의견',
    opinionText: '이중 바닥 반등 시도 중. 외국인 순매도 부담이나 HBM 기대감 존재. 딥스캔으로 회복 시나리오를 확인하세요.',
    opinionBackground: '#f8f8f6',
    opinionBorder: 'transparent',
    opinionTextColor: '#555',
    metaLine: '평단 74,600원 · 평가금액 7,321,600원',
    metrics: [
      { label: '리스크', value: '높음', tone: 'danger' },
      { label: '6개월 회복', value: '잠금', tone: 'locked' },
      { label: '추가 하락', value: '보통', tone: 'warning' },
    ],
    actionLabel: '딥스캔',
    actionSubLabel: '세 팀이 분석해요',
    actionCredits: undefined,
    actionHref: '/deepscan',
  },
  {
    id: 1,
    kind: 'stock',
    name: '코칩',
    code: '094360',
    shortName: '코칩',
    donutLabel: '코칩',
    shares: '350주',
    averagePrice: '18,200원',
    market: 'KOSDAQ',
    marketTone: 'kosdaq',
    badge: '관찰 중',
    badgeTone: 'amber',
    cardTone: 'warning',
    change: '-14.3%',
    pnl: '-910,000원',
    signalTone: 'warning',
    centerScore: '-14.3%',
    centerScoreColor: '#FAC775',
    centerBadge: '관찰 중',
    centerBadgeTone: 'amber',
    centerName: '코칩',
    donutColor: '#EF9F27',
    donutPercent: 0.17,
    heatmapWeight: '17%',
    heatmapBackground: '#BC7010',
    heatmapChange: '-14.3%',
    heatmapBadge: '관찰 중',
    heatmapBadgeTone: 'amber',
    opinionLabel: '간략 의견',
    opinionText: '지지선 근처 횡보 중. 단기 변동성 주의. 회복 확률 확인 후 전략을 세워보세요.',
    opinionBackground: '#f8f8f6',
    opinionBorder: 'transparent',
    opinionTextColor: '#555',
    metaLine: '평단 18,200원 · 평가금액 5,460,000원',
    metrics: [
      { label: '리스크', value: '보통', tone: 'warning' },
      { label: '6개월 회복', value: '잠금', tone: 'locked' },
      { label: '추가 하락', value: '보통', tone: 'warning' },
    ],
    actionLabel: '딥스캔',
    actionSubLabel: '세 팀이 분석해요',
    actionCredits: undefined,
    actionHref: null,
  },
  {
    id: 2,
    kind: 'stock',
    name: '드래곤플라이',
    code: '030350',
    shortName: '드래곤',
    donutLabel: '드래곤',
    shares: '500주',
    averagePrice: '1,840원',
    market: 'KOSDAQ',
    marketTone: 'kosdaq',
    badge: '거래 정지',
    badgeTone: 'red',
    cardTone: 'halt',
    change: '거래 정지',
    pnl: '-433,500원',
    signalTone: 'halt',
    centerScore: '정지',
    centerScoreColor: '#F09595',
    centerBadge: '거래 정지',
    centerBadgeTone: 'red',
    centerName: '드래곤',
    donutColor: '#378ADD',
    donutPercent: 0.09,
    heatmapWeight: '11%',
    heatmapBackground: '#2755A0',
    heatmapMeta: '거래정지',
    blink: true,
    opinionLabel: '긴급 의견',
    opinionText: 'DART 공시를 즉시 확인하고 정리매매 기간 여부를 파악하세요.',
    opinionBackground: '#FFF0F0',
    opinionBorder: '#F7C1C1',
    opinionTextColor: '#791F1F',
    metaLine: '평단 1,840원 · 평가금액 486,500원',
    metrics: [
      { label: '현재 상태', value: '정지', tone: 'danger' },
      { label: 'DART 공시', value: '잠금', tone: 'locked' },
      { label: '상폐 위험', value: '확인필요', tone: 'danger' },
    ],
    actionLabel: 'DART 딥스캔',
    actionCredits: undefined,
    actionHref: null,
  },
  {
    id: 3,
    kind: 'stock',
    name: 'SK하이닉스',
    code: '000660',
    shortName: 'SK하이닉스',
    donutLabel: 'SK하이닉스',
    shares: '40주',
    averagePrice: '146,500원',
    market: 'KOSPI',
    marketTone: 'kospi',
    badge: '수익 중',
    badgeTone: 'green',
    cardTone: 'profit',
    change: '+31.4%',
    pnl: '+1,832,000원',
    signalTone: 'positive',
    centerScore: '+31.4%',
    centerScoreColor: '#9FE1CB',
    centerBadge: '수익 중',
    centerBadgeTone: 'green',
    centerName: 'SK하이닉스',
    donutColor: '#1D9E75',
    donutPercent: 0.14,
    heatmapWeight: '18%',
    heatmapBackground: '#1A7A5E',
    heatmapChange: '+31.4%',
    opinionLabel: 'AI 의견',
    opinionText: '저항선 근접 중. 모멘텀 둔화 시작. 익절 타이밍을 딥스캔으로 확인하세요.',
    opinionBackground: '#F0FAF4',
    opinionBorder: '#C0DD97',
    opinionTextColor: '#27500A',
    metaLine: '평단 146,500원 · 평가금액 7,692,000원',
    metrics: [
      { label: '수익 모멘텀', value: '둔화', tone: 'warning' },
      { label: '저항선까지', value: '+3.2%', tone: 'positive' },
      { label: '매도 전략', value: '잠금', tone: 'locked' },
    ],
    actionLabel: '딥스캔',
    actionSubLabel: '세 팀이 분석해요',
    actionCredits: undefined,
    actionHref: null,
  },
  {
    id: 4,
    kind: 'etf',
    name: 'KODEX 200',
    code: '069500',
    shortName: 'KODEX 200',
    donutLabel: 'KODEX200',
    shares: '100주',
    averagePrice: '101,400원',
    market: 'ETF',
    marketTone: 'etf',
    badge: '손실 중',
    badgeTone: 'red',
    cardTone: 'etf',
    change: '-18.4%',
    pnl: '-1,863,000원',
    signalTone: 'etf',
    centerScore: '-18.4%',
    centerScoreColor: '#93C5FD',
    centerBadge: '손실 중',
    centerBadgeTone: 'red',
    centerName: 'KODEX 200',
    donutColor: '#185FA5',
    donutPercent: 0.2,
    heatmapWeight: '20%',
    heatmapBackground: '#1E4D8C',
    heatmapChange: '-18.4%',
    heatmapMeta: 'ETF',
    opinionLabel: '섹터 분석 요약',
    opinionText: '코스피200 전반적 하락 흐름. 반도체 비중(31%)이 크고 삼성전자 영향이 커요. ETF 분석으로 구성종목과 회복 시나리오를 확인하세요.',
    opinionBackground: '#f0f7ff',
    opinionBorder: '#B5D4F4',
    opinionTextColor: '#0C447C',
    metaLine: '평단 101,400원 · 평가금액 8,277,000원',
    metrics: [
      { label: '섹터 모멘텀', value: '순풍', tone: 'positive' },
      { label: '총보수', value: '연 0.15%', tone: 'neutral' },
      { label: '순자산', value: '12.4조', tone: 'neutral' },
    ],
    actionLabel: 'ETF 분석',
    actionSubLabel: '섹터 구성 + 회복 시나리오',
    actionCredits: undefined,
    actionHref: '/deepscan',
  },
]

const HOME_MARKET_SCORE_BASELINE = 72
const HOME_MARKET_SCORE_MIN = 0
const HOME_MARKET_SCORE_MAX = 99
const HOME_MARKET_SCORE_FAVORABLE_THRESHOLD = 70
const HOME_MARKET_SCORE_NEUTRAL_THRESHOLD = 45
const HOME_MARKET_SCORE_VOLATILITY_CALM = 16
const HOME_MARKET_SCORE_VOLATILITY_ELEVATED = 22
const HOME_MARKET_SCORE_VOLATILITY_STRESSED = 30
const HOME_MARKET_SCORE_VIX_MAX_PENALTY = 18
const HOME_MARKET_SCORE_VKOSPI_MAX_PENALTY = 16
const HOME_MARKET_SCORE_FX_STRONG_KRW_RATE = 1300
const HOME_MARKET_SCORE_FX_ELEVATED_RATE = 1400
const HOME_MARKET_SCORE_FX_STRESSED_RATE = 1450
const HOME_MARKET_SCORE_FX_CHANGE_WEIGHT = 6
const HOME_MARKET_SCORE_FX_CHANGE_MAX_PENALTY = 8
const HOME_MARKET_SCORE_FX_CHANGE_MAX_BONUS = -4
const HOME_MARKET_SCORE_ADR_WEAK = 75
const HOME_MARKET_SCORE_ADR_SOFT = 90
const HOME_MARKET_SCORE_ADR_FIRM = 105
const HOME_MARKET_SCORE_ADR_STRONG = 120

function clampMarketScore(value: number) {
  return Math.min(HOME_MARKET_SCORE_MAX, Math.max(HOME_MARKET_SCORE_MIN, value))
}

function toFiniteNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampPenalty(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function calculateVolatilityPenalty(value: number | null, maxPenalty: number) {
  if (value === null) {
    return 0
  }

  if (value <= HOME_MARKET_SCORE_VOLATILITY_CALM) {
    return -3
  }

  if (value <= HOME_MARKET_SCORE_VOLATILITY_ELEVATED) {
    return (value - HOME_MARKET_SCORE_VOLATILITY_CALM) * 1.2
  }

  if (value <= HOME_MARKET_SCORE_VOLATILITY_STRESSED) {
    return 7.2 + (value - HOME_MARKET_SCORE_VOLATILITY_ELEVATED) * 1.1
  }

  return maxPenalty
}

function calculateUsdKrwPenalty(usdKrw: HomeUsdKrwSignal | null | undefined) {
  const rate = toFiniteNumber(usdKrw?.rate)
  const changePercent = toFiniteNumber(usdKrw?.changePercent)
  let penalty = 0

  if (rate !== null) {
    if (rate >= HOME_MARKET_SCORE_FX_STRESSED_RATE) {
      penalty += 6
    } else if (rate >= HOME_MARKET_SCORE_FX_ELEVATED_RATE) {
      penalty += 3
    } else if (rate <= HOME_MARKET_SCORE_FX_STRONG_KRW_RATE) {
      penalty -= 2
    }
  }

  if (changePercent !== null) {
    penalty += clampPenalty(
      changePercent * HOME_MARKET_SCORE_FX_CHANGE_WEIGHT,
      HOME_MARKET_SCORE_FX_CHANGE_MAX_BONUS,
      HOME_MARKET_SCORE_FX_CHANGE_MAX_PENALTY,
    )
  }

  return penalty
}

function calculateAdrPenalty(adr: HomeMarketAdrSignals | null | undefined) {
  const values = [toFiniteNumber(adr?.kospi?.value), toFiniteNumber(adr?.kosdaq?.value)].filter((value): value is number => value !== null)
  const changes = [toFiniteNumber(adr?.kospi?.change), toFiniteNumber(adr?.kosdaq?.change)].filter((value): value is number => value !== null)

  if (values.length === 0) {
    return 0
  }

  const averageAdr = values.reduce((sum, value) => sum + value, 0) / values.length
  const averageChange = changes.length > 0
    ? changes.reduce((sum, value) => sum + value, 0) / changes.length
    : 0

  let penalty = 0
  if (averageAdr < HOME_MARKET_SCORE_ADR_WEAK) {
    penalty += 8
  } else if (averageAdr < HOME_MARKET_SCORE_ADR_SOFT) {
    penalty += 4
  } else if (averageAdr >= HOME_MARKET_SCORE_ADR_STRONG) {
    penalty -= 4
  } else if (averageAdr >= HOME_MARKET_SCORE_ADR_FIRM) {
    penalty -= 2
  }

  if (averageChange < 0) {
    penalty += 2
  } else if (averageChange > 0) {
    penalty -= 1
  }

  return penalty
}

function hasUsableMarketSignals(signals: HomeMarketScoreSignals | null | undefined) {
  return [
    signals?.usdKrw?.rate,
    signals?.usdKrw?.changePercent,
    signals?.indicators?.usVix?.value,
    signals?.indicators?.vkospi?.value,
    signals?.indicators?.adr?.kospi?.value,
    signals?.indicators?.adr?.kosdaq?.value,
  ].some((value) => toFiniteNumber(value) !== null)
}

function formatSignedPercent(value: number | null) {
  if (value === null) {
    return null
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatMarketNumber(value: number | null, digits = 1) {
  return value === null ? null : value.toFixed(digits)
}

function formatSignedMarketNumber(value: number | null, digits = 2) {
  if (value === null) {
    return null
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

function formatMarketScoreUpdatedLabel(status: WorkflowAsyncStatus | undefined, fallbackLabel?: string) {
  if (fallbackLabel) {
    return fallbackLabel
  }

  if (status === 'loading') {
    return '불러오는 중'
  }

  if (status === 'success') {
    return '방금 갱신'
  }

  if (status === 'error') {
    return '최근 갱신 실패'
  }

  return '시장지표 대기'
}

export function buildHomeMarketScore(_holdings: HomeHolding[], options: BuildHomeMarketScoreOptions = {}): HomeMarketScore {
  const marketSignalStatus = options.marketSignalStatus ?? options.quoteStatus ?? 'idle'
  const updatedLabel = formatMarketScoreUpdatedLabel(marketSignalStatus, options.updatedLabel)
  const marketSignals = options.marketSignals ?? null
  const hasMarketSignals = hasUsableMarketSignals(marketSignals)

  if (marketSignalStatus === 'loading' && !hasMarketSignals) {
    return {
      score: '-',
      status: 'loading',
      label: '계산 중',
      tone: 'amber',
      description: 'VIX, VKOSPI, ADR, USD/KRW 시장지표를 불러와 점수를 계산하고 있어요.',
      details: [],
      sourceLabel: '출처: 시장지표',
      updatedLabel,
    }
  }

  if (!hasMarketSignals) {
    const isError = marketSignalStatus === 'error'
    return {
      score: '-',
      status: isError ? 'error' : 'fallback',
      label: isError ? '대체' : '대기',
      tone: isError ? 'red' : 'amber',
      description: isError
        ? '시장지표를 불러오지 못해 점수를 계산하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
        : 'VIX, VKOSPI, ADR, USD/KRW 시장지표가 준비되면 점수를 보여줘요.',
      details: [],
      sourceLabel: '출처: 시장지표 필요',
      updatedLabel,
    }
  }

  const usdKrw = marketSignals?.usdKrw ?? null
  const usVix = marketSignals?.indicators?.usVix ?? null
  const vkospi = marketSignals?.indicators?.vkospi ?? null
  const adr = marketSignals?.indicators?.adr ?? null
  const usVixValue = toFiniteNumber(usVix?.value)
  const usVixChangePercent = toFiniteNumber(usVix?.changePercent)
  const vkospiValue = toFiniteNumber(vkospi?.value)
  const vkospiChangePercent = toFiniteNumber(vkospi?.changePercent)
  const usdKrwRate = toFiniteNumber(usdKrw?.rate)
  const usdKrwChangePercent = toFiniteNumber(usdKrw?.changePercent)
  const kospiAdrValue = toFiniteNumber(adr?.kospi?.value)
  const kospiAdrChange = toFiniteNumber(adr?.kospi?.change)
  const kosdaqAdrValue = toFiniteNumber(adr?.kosdaq?.value)
  const kosdaqAdrChange = toFiniteNumber(adr?.kosdaq?.change)
  const adrPenalty = calculateAdrPenalty(adr)
  const riskPenalty =
    calculateVolatilityPenalty(usVixValue, HOME_MARKET_SCORE_VIX_MAX_PENALTY)
    + calculateVolatilityPenalty(vkospiValue, HOME_MARKET_SCORE_VKOSPI_MAX_PENALTY)
    + calculateUsdKrwPenalty(usdKrw)
    + adrPenalty
  const scoreNumber = Math.round(clampMarketScore(
    HOME_MARKET_SCORE_BASELINE - riskPenalty,
  ))
  const tone: HomeBadgeTone = scoreNumber >= HOME_MARKET_SCORE_FAVORABLE_THRESHOLD ? 'green' : scoreNumber >= HOME_MARKET_SCORE_NEUTRAL_THRESHOLD ? 'amber' : 'red'
  const label = scoreNumber >= HOME_MARKET_SCORE_FAVORABLE_THRESHOLD
    ? '우호적'
    : scoreNumber >= HOME_MARKET_SCORE_NEUTRAL_THRESHOLD
      ? '중립'
      : '경계'
  const sourceParts = [
    usVixValue !== null ? 'US VIX' : null,
    vkospiValue !== null ? 'VKOSPI' : null,
    adr ? 'ADR' : null,
    usdKrwRate !== null || usdKrwChangePercent !== null ? 'USD/KRW' : null,
  ].filter((part): part is string => Boolean(part))
  const details: HomeMarketScoreDetail[] = []
  if (usVixValue !== null) {
    details.push({
      label: 'US VIX',
      value: formatMarketNumber(usVixValue) ?? '-',
      meta: formatSignedPercent(usVixChangePercent) ?? undefined,
    })
  }
  if (vkospiValue !== null) {
    details.push({
      label: 'VKOSPI',
      value: formatMarketNumber(vkospiValue) ?? '-',
      meta: formatSignedPercent(vkospiChangePercent) ?? undefined,
    })
  }
  if (kospiAdrValue !== null) {
    details.push({
      label: 'KOSPI ADR',
      value: formatMarketNumber(kospiAdrValue, 2) ?? '-',
      meta: formatSignedMarketNumber(kospiAdrChange) ?? undefined,
    })
  }
  if (kosdaqAdrValue !== null) {
    details.push({
      label: 'KOSDAQ ADR',
      value: formatMarketNumber(kosdaqAdrValue, 2) ?? '-',
      meta: formatSignedMarketNumber(kosdaqAdrChange) ?? undefined,
    })
  }
  if (usdKrwRate !== null) {
    details.push({
      label: 'USD/KRW',
      value: `${Math.round(usdKrwRate).toLocaleString()}원`,
      meta: formatSignedPercent(usdKrwChangePercent) ?? undefined,
    })
  }
  const detailParts = [
    usVixValue !== null ? `VIX ${formatMarketNumber(usVixValue)}` : null,
    vkospiValue !== null ? `VKOSPI ${formatMarketNumber(vkospiValue)}` : null,
    usdKrwRate !== null ? `환율 ${Math.round(usdKrwRate).toLocaleString()}원${formatSignedPercent(usdKrwChangePercent) ? `(${formatSignedPercent(usdKrwChangePercent)})` : ''}` : null,
    kospiAdrValue !== null ? `KOSPI ADR ${formatMarketNumber(kospiAdrValue, 0)}` : null,
    kosdaqAdrValue !== null ? `KOSDAQ ADR ${formatMarketNumber(kosdaqAdrValue, 0)}` : null,
  ].filter((part): part is string => Boolean(part))

  const isPartialWithoutVkospi = vkospiValue === null
  const description = isPartialWithoutVkospi
    ? `${detailParts.join(' · ')} 기준 일부 시장지표 점수예요. VKOSPI는 원천 차단으로 제외했어요.`
    : `${detailParts.join(' · ')} 기준 시장 리스크 점수예요.`

  return {
    score: String(scoreNumber),
    status: 'ready',
    label,
    tone,
    description,
    details,
    sourceLabel: `출처: ${sourceParts.join(' + ')}`,
    updatedLabel,
  }
}

export const homeForecast = {
  label: "TODAY'S FORECAST",
  body: '모멘텀이 3주 연속 개선 중. 삼성전자 반등 신호 감지됐지만 외국인 매도가 변수예요. 드래곤플라이 즉시 대응 필요해요.',
  cta: '딥스캔으로 상세 전략 보기 ›',
  href: '/deepscan',
}

export const portfolioScoreBreakdown = [
  {
    label: '분산도',
    score: '18 / 30',
    scoreColor: '#185FA5',
    barWidth: '60%',
    barColor: '#185FA5',
    description: '4개 종목에 나눠 투자 중이에요. 삼성전자 비중이 50%로 높아 한 종목에 집중된 편이에요.',
    stocks: [
      { label: '삼성전자 50%', dot: '#E24B4A' },
      { label: '코칩 21%', dot: '#EF9F27' },
      { label: 'SK하이닉스 18%', dot: '#1D9E75' },
      { label: '드래곤플라이 11%', dot: '#378ADD' },
    ],
  },
  {
    label: '리스크',
    score: '15 / 30',
    scoreColor: '#A32D2D',
    barWidth: '50%',
    barColor: '#E24B4A',
    description: '손실 중인 종목이 2개, 거래 정지 1개예요. 전체 평가액의 71%가 손실 구간에 있어요.',
    stocks: [
      { label: '삼성전자 -23%', dot: '#E24B4A', background: '#FCEBEB', color: '#A32D2D' },
      { label: '코칩 -14%', dot: '#EF9F27', background: '#FAEEDA', color: '#854F0B' },
      { label: '드래곤 정지', dot: '#378ADD', background: '#FCEBEB', color: '#A32D2D' },
    ],
  },
  {
    label: '섹터 균형',
    score: '14 / 20',
    scoreColor: '#3B6D11',
    barWidth: '70%',
    barColor: '#639922',
    description: '반도체 섹터에 집중되어 있어요. 업황이 좋을 땐 유리하지만 섹터 전체가 흔들리면 함께 영향받아요.',
    stocks: [
      { label: '삼성전자 · 반도체', dot: '#E24B4A' },
      { label: '코칩 · 반도체', dot: '#EF9F27' },
      { label: 'SK하이닉스 · 반도체', dot: '#1D9E75' },
      { label: '드래곤플라이 · 게임', dot: '#378ADD' },
    ],
  },
  {
    label: '손실 집중도',
    score: '7 / 20',
    scoreColor: '#854F0B',
    barWidth: '35%',
    barColor: '#EF9F27',
    description: '전체 손실의 84%가 삼성전자 한 종목에서 발생하고 있어요. 이 종목이 회복되면 포트폴리오 전체가 빠르게 개선돼요.',
    stocks: [
      { label: '삼성전자 손실 84%', dot: '#E24B4A', background: '#FCEBEB', color: '#A32D2D' },
      { label: '코칩 손실 16%', dot: '#EF9F27', background: '#FAEEDA', color: '#854F0B' },
    ],
  },
]

export const momentumStages: Array<{
  label: string
  subtitle: string
  tone: MomentumStageTone
  active?: boolean
}> = [
  { label: '역풍', subtitle: '회복 멀어짐', tone: 'danger' },
  { label: '정체', subtitle: '제자리', tone: 'muted' },
  { label: '미풍', subtitle: '천천히', tone: 'muted' },
  { label: '순풍 ◀', subtitle: '나아지는 중', tone: 'positive', active: true },
  { label: '강풍', subtitle: '빠르게', tone: 'muted' },
]

export const momentumSignals = [
  {
    name: '삼성전자',
    dot: '#E24B4A',
    badge: '순풍',
    badgeBackground: '#EAF3DE',
    badgeColor: '#3B6D11',
    description: '이중 바닥 패턴 감지. 외국인 매도 부담이나 반등 신호 있어요.',
  },
  {
    name: '코칩',
    dot: '#EF9F27',
    badge: '미풍',
    badgeBackground: '#f0efe8',
    badgeColor: '#888',
    description: '지지선 근처 횡보 중. 뚜렷한 방향성이 아직 없어요.',
  },
  {
    name: 'SK하이닉스',
    dot: '#1D9E75',
    badge: '순풍',
    badgeBackground: '#EAF3DE',
    badgeColor: '#3B6D11',
    description: '저항선 근접 중. 모멘텀은 있지만 둔화 조짐이 있어요.',
  },
  {
    name: '드래곤플라이',
    dot: '#378ADD',
    badge: '역풍',
    badgeBackground: '#FCEBEB',
    badgeColor: '#A32D2D',
    description: '거래 정지 상태. DART 공시 확인이 필요해요.',
    blink: true,
  },
]

export const APPLIED_HOME_PORTFOLIO_STORAGE_KEY = 'jaroo:applied-home-portfolio'
export const APPLIED_HOME_PORTFOLIO_EVENT = 'jaroo:applied-home-portfolio:updated'
export const DEEPSCAN_TARGET_STORAGE_KEY = 'jaroo:deepscan-target'
export const DEEPSCAN_TARGET_EVENT = 'jaroo:deepscan-target:updated'

const DEEPSCAN_SERVER_SNAPSHOT = buildDeepScanTargetSession(createPlaceholderDeepScanHolding())

let cachedDeepScanSnapshotKey: string | null = null
let cachedDeepScanSnapshot: DeepScanTargetSession | null = null

export type AppliedHomePortfolioSession = {
  broker: string
  rows: AppliedHomePortfolioRow[]
  appliedAt?: string
}

const OCR_HOME_DONUT_COLORS = ['#E24B4A', '#EF9F27', '#1D9E75', '#378ADD', '#185FA5', '#7C3AED', '#0EA5E9', '#F97316']
const HOME_HOLDING_CODE_BY_NAME = new Map(
  homeHoldings
    .filter((item) => item.code)
    .map((item) => [normalizeStockName(item.name), item.code as string]),
)

function readTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined
}

function normalizeAppliedInstrumentCode(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().replace(/\s+/g, '').toUpperCase()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeAveragePriceCurrency(value: unknown): AveragePriceCurrency | undefined {
  return value === 'KRW' || value === 'USD' ? value : undefined
}

function inferCurrencyFromMoneyText(value: unknown): AveragePriceCurrency | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toUpperCase()

  if (!normalized) {
    return undefined
  }

  if (normalized.includes('$') || normalized.includes('USD')) {
    return 'USD'
  }

  if (normalized.includes('₩') || normalized.includes('원') || normalized.includes('KRW')) {
    return 'KRW'
  }

  return undefined
}

function isUsResolvedMarket(resolvedMarketTone: AppliedHomePortfolioRow['resolvedMarketTone'], resolvedMarket: string | undefined) {
  return resolvedMarketTone === 'nasdaq' || /(nasdaq|nyse|amex|us)/i.test(resolvedMarket ?? '')
}

function resolveAppliedAveragePriceCurrency(
  item: Record<string, unknown>,
  resolvedMarketTone: AppliedHomePortfolioRow['resolvedMarketTone'],
  resolvedMarket: string | undefined,
): AveragePriceCurrency | undefined {
  const explicitCurrency = normalizeAveragePriceCurrency(item.averagePriceCurrency)
    ?? inferCurrencyFromMoneyText(item.averagePrice)

  if (explicitCurrency) {
    return explicitCurrency
  }

  const evaluationAmountCurrency = inferCurrencyFromMoneyText(item.evaluationAmount)

  if (isUsResolvedMarket(resolvedMarketTone, resolvedMarket)) {
    const averagePriceLooksComputedFromEvaluation = evaluationAmountCurrency
      && isAveragePriceComputedFromEvaluation(
        readTrimmedString(item.quantity) ?? '',
        readTrimmedString(item.profitRate) ?? '',
        readTrimmedString(item.evaluationAmount) ?? '',
        readTrimmedString(item.averagePrice) ?? '',
        readTrimmedString(item.profitAmount) ?? '',
      )

    return averagePriceLooksComputedFromEvaluation ? evaluationAmountCurrency : undefined
  }

  return evaluationAmountCurrency ?? 'KRW'
}

function sanitizeAppliedHomePortfolioRows(input: unknown): AppliedHomePortfolioRow[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item): AppliedHomePortfolioRow => {
      const resolvedMarketTone: AppliedHomePortfolioRow['resolvedMarketTone'] =
        item.resolvedMarketTone === 'kospi' || item.resolvedMarketTone === 'kosdaq' || item.resolvedMarketTone === 'nasdaq' || item.resolvedMarketTone === 'etf'
          ? item.resolvedMarketTone
          : undefined
      const resolvedKind: AppliedHomePortfolioRow['resolvedKind'] =
        item.resolvedKind === 'stock' || item.resolvedKind === 'etf' ? item.resolvedKind : undefined
      const resolvedMarket = readTrimmedString(item.resolvedMarket)
      const averagePriceCurrency = resolveAppliedAveragePriceCurrency(item, resolvedMarketTone, resolvedMarket)
      const currentPrice = typeof item.currentPrice === 'number' && Number.isFinite(item.currentPrice) ? item.currentPrice : undefined
      const currentProfitRate = typeof item.currentProfitRate === 'number' && Number.isFinite(item.currentProfitRate) ? item.currentProfitRate : undefined
      const currentPriceCurrency = normalizeAveragePriceCurrency(item.currentPriceCurrency)
      const usdKrwRate = typeof item.usdKrwRate === 'number' && Number.isFinite(item.usdKrwRate) && item.usdKrwRate > 0
        ? item.usdKrwRate
        : undefined

      const normalizedRow: AppliedHomePortfolioRow = {
        name: readTrimmedString(item.name) ?? '',
        quantity: readTrimmedString(item.quantity) ?? '',
        profitAmount: readTrimmedString(item.profitAmount),
        profitRate: readTrimmedString(item.profitRate) ?? '',
        evaluationAmount: readTrimmedString(item.evaluationAmount) ?? '',
        averagePrice: readTrimmedString(item.averagePrice) ?? '',
        averagePriceCurrency,
        currentPrice,
        currentPriceCurrency,
        currentProfitRate,
        usdKrwRate,
        code: normalizeAppliedInstrumentCode(item.code),
        ticker: normalizeAppliedInstrumentCode(item.ticker),
        resolvedName: readTrimmedString(item.resolvedName),
        resolvedCode: normalizeAppliedInstrumentCode(item.resolvedCode),
        resolvedTicker: normalizeAppliedInstrumentCode(item.resolvedTicker),
        resolvedMarket,
        resolvedMarketTone,
        resolvedKind,
      }

      return normalizedRow
    })
    .filter((item) => item.name.length > 0 || item.quantity.length > 0 || item.averagePrice.length > 0)
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}

function formatQuantityNumber(value: number) {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  })
}

function formatCurrencyValue(value: string, currency?: AveragePriceCurrency) {
  const parsedValue = parseOcrNumber(value)

  if (parsedValue === null) {
    return value.trim() || '-'
  }

  if (currency === 'USD') {
    return `$${parsedValue.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    })}`
  }

  if (currency === 'KRW') {
    return `${formatNumber(parsedValue, Number.isInteger(parsedValue) ? 0 : 4)}원`
  }

  return parsedValue.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })
}

function formatQuantityValue(value: string) {
  const parsedValue = parseOcrNumber(value)

  if (parsedValue === null) {
    return value.trim() || '-'
  }

  return `${formatQuantityNumber(parsedValue)}주`
}

function formatSignedCurrencyValue(value: number | null, currency: 'KRW' | 'USD' = 'KRW') {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  if (currency === 'USD') {
    return `${value > 0 ? '+' : value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatNumber(Math.abs(value))}원`
}

function hasValidUsdKrwRate(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function convertHomeMoneyAmount(
  value: number | null,
  fromCurrency: AveragePriceCurrency | undefined,
  toCurrency: AveragePriceCurrency,
  usdKrwRate?: number,
) {
  if (value === null || !Number.isFinite(value) || !fromCurrency) {
    return null
  }

  if (fromCurrency === toCurrency) {
    return value
  }

  if (!hasValidUsdKrwRate(usdKrwRate)) {
    return null
  }

  if (fromCurrency === 'KRW' && toCurrency === 'USD') {
    return value / usdKrwRate
  }

  if (fromCurrency === 'USD' && toCurrency === 'KRW') {
    return value * usdKrwRate
  }

  return null
}

function derivePnlFromProfitRate(evaluationAmount: number | null, profitRate: number | null) {
  if (evaluationAmount === null || !Number.isFinite(evaluationAmount) || profitRate === null || !Number.isFinite(profitRate)) {
    return null
  }

  const multiplier = 1 + profitRate / 100

  if (multiplier <= 0) {
    return null
  }

  return evaluationAmount - (evaluationAmount / multiplier)
}

function formatPercentValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  const formattedValue = value.toFixed(1)
  const roundedValue = Number(formattedValue)
  const sign = roundedValue > 0 ? '+' : roundedValue < 0 ? '-' : ''
  return `${sign}${Math.abs(roundedValue).toFixed(1)}%`
}

function computeHoldingBaseAmount(quantity: string, averagePrice: string) {
  const quantityValue = parseOcrNumber(quantity)
  const averagePriceValue = parseOcrNumber(averagePrice)

  if (quantityValue === null || averagePriceValue === null) {
    return null
  }

  const baseAmount = quantityValue * averagePriceValue
  return Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : null
}

function inferHoldingKind(name: string): HomeHolding['kind'] {
  return /(etf|kodex|tiger|koosef|kosef|arirang|ace|sol|kbstar|timefolio)/i.test(name) ? 'etf' : 'stock'
}

function resolveHomeMarketTone(resolvedMarketTone: OcrRow['resolvedMarketTone'], market: string, kind: HomeHolding['kind']): HomeHolding['marketTone'] {
  if (resolvedMarketTone === 'kospi' || resolvedMarketTone === 'kosdaq' || resolvedMarketTone === 'nasdaq' || resolvedMarketTone === 'etf') {
    return resolvedMarketTone
  }

  if (kind === 'etf') {
    return 'etf'
  }

  if (/kosdaq/i.test(market)) {
    return 'kosdaq'
  }

  if (/(nasdaq|nyse|amex|us)/i.test(market)) {
    return 'nasdaq'
  }

  return 'kospi'
}

function buildHoldingIdentifierLabel(ticker?: string, code?: string) {
  const identifiers = [ticker, code].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  return identifiers.length > 0 ? identifiers.join(' · ') : undefined
}

function buildHoldingMetaLine(ticker: string | undefined, code: string | undefined, averagePrice: string, evaluationAmount?: string) {
  const parts: string[] = []

  if (ticker) {
    parts.push(`티커 ${ticker}`)
  }

  if (code) {
    parts.push(`종목코드 ${code}`)
  }

  parts.push(`평단 ${averagePrice}`)

  if (evaluationAmount && evaluationAmount !== '-') {
    parts.push(`평가금액 ${evaluationAmount}`)
  }

  return parts.join(' · ')
}

function deriveHoldingTone(profitRateValue: number | null) {
  if (profitRateValue === null) {
    return {
      badge: '인식 완료',
      badgeTone: 'amber' as HomeBadgeTone,
      cardTone: 'warning' as HomeCardTone,
      signalTone: 'warning' as HomeHolding['signalTone'],
      centerScoreColor: '#FAC775',
      metricTone: 'neutral' as HomeMetricTone,
      heatmapBackground: '#BC7010',
    }
  }

  if (profitRateValue >= 0) {
    return {
      badge: '수익 중',
      badgeTone: 'green' as HomeBadgeTone,
      cardTone: 'profit' as HomeCardTone,
      signalTone: 'positive' as HomeHolding['signalTone'],
      centerScoreColor: '#9FE1CB',
      metricTone: 'positive' as HomeMetricTone,
      heatmapBackground: '#1A7A5E',
    }
  }

  if (profitRateValue <= -20) {
    return {
      badge: '긴급 점검',
      badgeTone: 'red' as HomeBadgeTone,
      cardTone: 'danger' as HomeCardTone,
      signalTone: 'danger' as HomeHolding['signalTone'],
      centerScoreColor: '#F09595',
      metricTone: 'danger' as HomeMetricTone,
      heatmapBackground: '#C13030',
    }
  }

  return {
    badge: '손실 중',
    badgeTone: 'red' as HomeBadgeTone,
    cardTone: 'warning' as HomeCardTone,
    signalTone: 'warning' as HomeHolding['signalTone'],
    centerScoreColor: '#FAC775',
    metricTone: 'warning' as HomeMetricTone,
    heatmapBackground: '#BC7010',
  }
}

function buildOpinionText(name: string, kind: HomeHolding['kind'], profitRateValue: number | null) {
  if (kind === 'etf') {
    return `${name} ETF를 OCR에서 읽어 홈 포트폴리오에 반영했어요. 섹터 구성과 회복 시나리오는 딥스캔에서 더 확인할 수 있어요.`
  }

  if (profitRateValue === null) {
    return `${name} 정보를 OCR에서 읽어 홈에 적용했어요. 세부 전략은 딥스캔으로 이어서 확인할 수 있어요.`
  }

  if (profitRateValue >= 0) {
    return `${name} 수익 구간을 OCR에서 반영했어요. 익절 또는 추가 전략은 딥스캔으로 이어서 검토해보세요.`
  }

  if (profitRateValue <= -20) {
    return `${name} 손실 폭이 크게 인식됐어요. 딥스캔으로 회복 가능성과 대응 전략을 먼저 확인해보세요.`
  }

  return `${name} 손실 구간을 OCR에서 반영했어요. 회복 신호가 있는지 딥스캔으로 추가 확인해보세요.`
}

function cacheDeepScanSnapshot(snapshotKey: string, snapshot: DeepScanTargetSession) {
  cachedDeepScanSnapshotKey = snapshotKey
  cachedDeepScanSnapshot = snapshot
  return snapshot
}

export function persistAppliedHomePortfolio(session: AppliedHomePortfolioSession) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const sanitizedRows = sanitizeAppliedHomePortfolioRows(session.rows)

    window.sessionStorage.setItem(
      APPLIED_HOME_PORTFOLIO_STORAGE_KEY,
      JSON.stringify({
        broker: session.broker,
        rows: sanitizedRows,
        appliedAt: session.appliedAt ?? new Date().toISOString(),
      }),
    )
    window.dispatchEvent(new Event(APPLIED_HOME_PORTFOLIO_EVENT))
    return true
  } catch {
    return false
  }
}

export function readAppliedHomePortfolio(): AppliedHomePortfolioSession | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(APPLIED_HOME_PORTFOLIO_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<AppliedHomePortfolioSession>

    if (typeof parsedValue?.broker !== 'string' || !Array.isArray(parsedValue?.rows)) {
      return null
    }

    const rows = sanitizeAppliedHomePortfolioRows(parsedValue.rows)

    if (rows.length === 0) {
      return null
    }

    return {
      broker: parsedValue.broker,
      rows,
      appliedAt: typeof parsedValue.appliedAt === 'string' ? parsedValue.appliedAt : undefined,
    }
  } catch {
    return null
  }
}

export function persistDeepScanTarget(holding: HomeHolding) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    window.sessionStorage.setItem(DEEPSCAN_TARGET_STORAGE_KEY, JSON.stringify(buildDeepScanTargetSession(holding)))
    window.dispatchEvent(new Event(DEEPSCAN_TARGET_EVENT))
    return true
  } catch {
    return false
  }
}

export function readDeepScanTargetSession(): DeepScanTargetSession | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(DEEPSCAN_TARGET_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<DeepScanTargetSession>
    const holding = parsedValue?.holding

    if (!holding || typeof holding !== 'object' || typeof holding.name !== 'string') {
      return null
    }

    const rebuiltSession = buildDeepScanTargetSession(holding as HomeHolding)

    return {
      ...rebuiltSession,
      selectedAt: typeof parsedValue.selectedAt === 'string' ? parsedValue.selectedAt : rebuiltSession.selectedAt,
    }
  } catch {
    return null
  }
}

export function readDeepScanTarget(): HomeHolding | null {
  return readDeepScanTargetSession()?.holding ?? null
}

export function resolveDeepScanTargetServerSnapshot(): DeepScanTargetSession {
  return DEEPSCAN_SERVER_SNAPSHOT
}

function findAppliedHoldingForStoredTarget(storedTarget: DeepScanTargetSession, appliedHoldings: HomeHolding[]) {
  const storedHolding = storedTarget.holding
  const storedTicker = storedHolding.identifierTicker?.trim().toUpperCase()
  const storedCode = storedHolding.identifierCode?.trim().toUpperCase() || storedHolding.code?.trim().toUpperCase()
  const storedName = normalizeStockName(storedHolding.name)

  return appliedHoldings.find((holding) => {
    const ticker = holding.identifierTicker?.trim().toUpperCase()
    const code = holding.identifierCode?.trim().toUpperCase() || holding.code?.trim().toUpperCase()

    return Boolean(
      (storedTicker && ticker && storedTicker === ticker)
      || (storedCode && code && storedCode === code)
      || (storedName && normalizeStockName(holding.name) === storedName),
    )
  }) ?? null
}

function repairDeepScanTargetFractionalShares(storedTarget: DeepScanTargetSession | null, appliedHoldings: HomeHolding[]) {
  if (!storedTarget || appliedHoldings.length === 0) {
    return storedTarget
  }

  const appliedHolding = findAppliedHoldingForStoredTarget(storedTarget, appliedHoldings)
  if (!appliedHolding) {
    return storedTarget
  }

  const storedQuantity = parseOcrNumber(storedTarget.holding.shares)
  const appliedQuantity = parseOcrNumber(appliedHolding.shares)

  if (
    storedQuantity === null
    || appliedQuantity === null
    || Math.abs(storedQuantity - appliedQuantity) < 1e-9
  ) {
    return storedTarget
  }

  const patchedHolding: HomeHolding = {
    ...storedTarget.holding,
    shares: appliedHolding.shares,
    metrics: storedTarget.holding.metrics.map((metric) =>
      metric.label === '보유 수량' ? { ...metric, value: appliedHolding.shares } : metric,
    ),
  }
  const rebuiltSession = buildDeepScanTargetSession(patchedHolding)

  return {
    ...rebuiltSession,
    selectedAt: storedTarget.selectedAt,
  }
}

export function resolveDeepScanTargetSession() {
  if (typeof window === 'undefined') {
    return DEEPSCAN_SERVER_SNAPSHOT
  }

  const rawStoredTarget = window.sessionStorage.getItem(DEEPSCAN_TARGET_STORAGE_KEY)
  const rawAppliedPortfolio = window.sessionStorage.getItem(APPLIED_HOME_PORTFOLIO_STORAGE_KEY)
  const snapshotKey = `${rawStoredTarget ?? ''}::${rawAppliedPortfolio ?? ''}`

  if (cachedDeepScanSnapshot && cachedDeepScanSnapshotKey === snapshotKey) {
    return cachedDeepScanSnapshot
  }

  const storedTarget = readDeepScanTargetSession()
  const appliedPortfolio = readAppliedHomePortfolio()
  const appliedHoldings = appliedPortfolio?.rows.length ? buildHomeHoldingsFromOcrRows(appliedPortfolio.rows) : []
  const repairedStoredTarget = repairDeepScanTargetFractionalShares(storedTarget, appliedHoldings)
  const appliedHolding = appliedHoldings.length
    ? pickDeepScanDefaultHolding(appliedHoldings)
    : null
  const resolvedSnapshot = repairedStoredTarget
    ?? (appliedHolding ? buildDeepScanTargetSession(appliedHolding) : null)
    ?? DEEPSCAN_SERVER_SNAPSHOT

  return cacheDeepScanSnapshot(snapshotKey, resolvedSnapshot)
}

function formatAveragePriceFromPortfolioItem(item: PortfolioNormalizedItem) {
  if (item.averagePriceCurrency === 'USD') {
    return formatCurrencyValue(String(item.averagePrice), 'USD')
  }

  if (item.averagePriceCurrency === 'KRW') {
    return formatCurrencyValue(String(item.averagePrice), 'KRW')
  }

  if (item.marketTone === 'nasdaq') {
    return item.averagePrice.toFixed(4)
  }

  return formatCurrencyValue(String(item.averagePrice), 'KRW')
}

function buildAppliedRowFromPortfolioItem(item: PortfolioNormalizedItem): AppliedHomePortfolioRow {
  const evaluationAmount = typeof item.evaluationAmount === 'number'
    ? formatCurrencyValue(String(item.evaluationAmount), item.averagePriceCurrency ?? item.currentPriceCurrency ?? (item.marketTone === 'nasdaq' ? 'USD' : 'KRW'))
    : ''

  return {
    name: item.name,
    quantity: `${item.quantity}주`,
    profitRate: typeof item.snapshotProfitRate === 'number' ? `${item.snapshotProfitRate}%` : '',
    evaluationAmount,
    averagePrice: formatAveragePriceFromPortfolioItem(item),
    averagePriceCurrency: item.averagePriceCurrency,
    currentPrice: item.currentPrice,
    currentPriceCurrency: item.currentPriceCurrency,
    currentProfitRate: item.currentProfitRate,
    usdKrwRate: item.usdKrwRate,
    code: item.code,
    ticker: item.ticker,
    resolvedName: item.name,
    resolvedCode: item.code,
    resolvedTicker: item.ticker,
    resolvedMarket: item.market,
    resolvedMarketTone: item.marketTone,
    resolvedKind: item.kind,
  }
}

export function buildHomeHoldingsFromPortfolioItems(items: PortfolioNormalizedItem[]): HomeHolding[] {
  if (items.length === 0) {
    return []
  }

  return buildHomeHoldingsFromOcrRows(items.map((item) => buildAppliedRowFromPortfolioItem(item)))
}

export function buildPortfolioItemsFromAppliedHomePortfolioRows(rows: AppliedHomePortfolioRow[]): PortfolioNormalizedItem[] {
  return sanitizeAppliedHomePortfolioRows(rows)
    .map((row): PortfolioNormalizedItem | null => {
      const name = row.resolvedName?.trim() || row.name.trim()
      const quantity = parseOcrNumber(row.quantity)
      const averagePrice = parseOcrNumber(row.averagePrice)

      if (!name || quantity === null || averagePrice === null) {
        return null
      }

      const kind = row.resolvedKind ?? inferHoldingKind(name)
      const resolvedMarket = row.resolvedMarket?.trim()
      const market = resolvedMarket || (kind === 'etf' ? 'ETF' : 'OCR')
      const marketTone = resolveHomeMarketTone(row.resolvedMarketTone, market, kind)
      const code = row.resolvedCode?.trim() || row.code?.trim() || undefined
      const ticker = row.resolvedTicker?.trim() || row.ticker?.trim() || undefined
      const averagePriceCurrency = row.averagePriceCurrency
        ?? inferCurrencyFromMoneyText(row.averagePrice)
        ?? (marketTone === 'nasdaq' ? undefined : 'KRW')
      const evaluationAmount = parseOcrNumber(row.evaluationAmount ?? '') ?? undefined
      const evaluationAmountCurrency = inferCurrencyFromMoneyText(row.evaluationAmount)
      const canDeriveSnapshotProfitRate = marketTone !== 'nasdaq'
        || averagePriceCurrency === 'KRW'
        || (evaluationAmountCurrency !== undefined && evaluationAmountCurrency === averagePriceCurrency)
      const snapshotProfitRate = parseOcrProfitRate(row.profitRate ?? '')
        ?? (canDeriveSnapshotProfitRate
          ? deriveSnapshotProfitRate({ quantity, averagePrice, evaluationAmount })
          : undefined)

      return {
        code,
        ticker,
        market: resolvedMarket,
        marketTone,
        kind,
        name,
        quantity,
        averagePrice,
        ...(typeof snapshotProfitRate === 'number' ? { snapshotProfitRate } : {}),
        averagePriceCurrency,
        evaluationAmount,
        currentPrice: row.currentPrice,
        currentPriceCurrency: row.currentPriceCurrency,
        currentProfitRate: row.currentProfitRate ?? parseOcrProfitRate(row.profitRate ?? '') ?? undefined,
        ...(row.usdKrwRate ? { usdKrwRate: row.usdKrwRate } : {}),
        identifierLabel: buildIdentifierLabel(ticker, code),
      }
    })
    .filter((item): item is PortfolioNormalizedItem => item !== null)
}

export function buildHomeHoldingsFromOcrRows(rows: AppliedHomePortfolioRow[]): HomeHolding[] {
  const sanitizedRows = sanitizeAppliedHomePortfolioRows(rows)

  if (sanitizedRows.length === 0) {
    return []
  }

  const preparedRows = sanitizedRows.map((row, index) => {
    const kind = row.resolvedKind ?? inferHoldingKind(row.resolvedName || row.name)
    const displayName = row.resolvedName?.trim() || row.name.trim() || `인식 종목 ${index + 1}`
    const market = row.resolvedMarket?.trim() || (kind === 'etf' ? 'ETF' : 'OCR')
    const marketTone = resolveHomeMarketTone(row.resolvedMarketTone, market, kind)
    const displayCurrency: AveragePriceCurrency | undefined = row.averagePriceCurrency
      ?? inferCurrencyFromMoneyText(row.averagePrice)
      ?? (marketTone === 'nasdaq' ? undefined : 'KRW')
    const averagePriceRaw = row.averagePrice
    const evaluationAmountCurrency = inferCurrencyFromMoneyText(row.evaluationAmount)
    const currentPriceCurrency = row.currentPriceCurrency
      ?? evaluationAmountCurrency
      ?? displayCurrency
      ?? (marketTone === 'nasdaq' ? 'USD' : 'KRW')
    const quantityValue = parseOcrNumber(row.quantity)
    const evaluationAmountRawValue = parseOcrNumber(row.evaluationAmount ?? '')
    const inferredCurrentPrice = typeof row.currentPrice === 'number'
      ? row.currentPrice
      : quantityValue !== null && quantityValue > 0 && evaluationAmountRawValue !== null
        ? evaluationAmountRawValue / quantityValue
        : undefined
    const currentPriceText = typeof inferredCurrentPrice === 'number'
      ? formatCurrencyValue(String(inferredCurrentPrice), currentPriceCurrency)
      : undefined
    const canDeriveSnapshotProfitRate = marketTone !== 'nasdaq' || displayCurrency === 'KRW'
    const snapshotProfitRate = parseOcrProfitRate(row.profitRate ?? '')
      ?? (canDeriveSnapshotProfitRate
        ? deriveSnapshotProfitRate({
            quantity: quantityValue ?? undefined,
            averagePrice: parseOcrNumber(averagePriceRaw) ?? undefined,
            evaluationAmount: evaluationAmountRawValue ?? undefined,
          })
        : undefined)
    const hasLiveProfitRate = typeof row.currentProfitRate === 'number' && Number.isFinite(row.currentProfitRate)
    const currentProfitRate = hasLiveProfitRate ? row.currentProfitRate ?? null : snapshotProfitRate ?? null

    return {
      row,
      kind,
      displayName,
      market,
      marketTone,
      averagePriceCurrency: displayCurrency,
      averagePrice: formatCurrencyValue(averagePriceRaw, displayCurrency),
      snapshotProfitRate,
      currentPriceText,
      currentPriceValue: inferredCurrentPrice,
      currentPriceCurrency,
      currentProfitRate,
      hasLiveProfitRate,
      evaluationAmountRawValue,
      baseAmountValue: computeHoldingBaseAmount(row.quantity, averagePriceRaw),
    }
  })

  const weights = preparedRows.map((item) => item.baseAmountValue ?? 1)
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || sanitizedRows.length

  return preparedRows.map(({ row, kind, displayName, market, marketTone, averagePriceCurrency, averagePrice, snapshotProfitRate, currentPriceText, currentPriceValue, currentPriceCurrency, currentProfitRate, hasLiveProfitRate, evaluationAmountRawValue, baseAmountValue }, index) => {
    const tone = deriveHoldingTone(currentProfitRate)
    const shares = formatQuantityValue(row.quantity)
    const change = formatPercentValue(currentProfitRate)
    const placeholderCurrency = averagePriceCurrency ?? (marketTone === 'nasdaq' ? 'USD' : 'KRW')
    const donutPercent = weights[index] / totalWeight
    const identifierTicker = row.resolvedTicker?.trim() || row.ticker || undefined
    const identifierCode = row.resolvedCode?.trim() || row.code || HOME_HOLDING_CODE_BY_NAME.get(normalizeStockName(displayName)) || undefined
    const identifierLabel = buildHoldingIdentifierLabel(identifierTicker, identifierCode)
    const resolvedCode = identifierCode || identifierTicker
    const quantityValue = parseOcrNumber(row.quantity)
    const evaluationAmountValue = typeof currentPriceValue === 'number' && quantityValue !== null
      ? quantityValue * currentPriceValue
      : evaluationAmountRawValue
    const displayAmountCurrency = currentPriceCurrency ?? placeholderCurrency
    const convertedBaseAmountValue = convertHomeMoneyAmount(
      baseAmountValue,
      averagePriceCurrency ?? placeholderCurrency,
      displayAmountCurrency,
      row.usdKrwRate,
    )
    const pnlValue = evaluationAmountValue !== null && convertedBaseAmountValue !== null
      ? evaluationAmountValue - convertedBaseAmountValue
      : hasLiveProfitRate
        ? derivePnlFromProfitRate(evaluationAmountValue, currentProfitRate)
        : null
    const evaluationAmount = evaluationAmountValue !== null && typeof evaluationAmountValue === 'number'
      ? formatCurrencyValue(String(evaluationAmountValue), displayAmountCurrency)
      : undefined
    const pnl = formatSignedCurrencyValue(pnlValue, displayAmountCurrency)

    return {
      id: index,
      kind,
      name: displayName,
      code: resolvedCode,
      shortName: displayName.replace(/\s+/g, '').slice(0, 8) || displayName,
      donutLabel: displayName.replace(/\s+/g, '').slice(0, 10) || displayName,
      shares,
      averagePrice,
      averagePriceCurrency,
      snapshotProfitRate,
      evaluationAmount,
      market,
      marketTone,
      identifierTicker,
      identifierCode,
      identifierLabel,
      badge: tone.badge,
      badgeTone: tone.badgeTone,
      cardTone: tone.cardTone,
      change,
      pnl,
      signalTone: kind === 'etf' ? 'etf' : tone.signalTone,
      centerScore: change,
      centerScoreColor: tone.centerScoreColor,
      centerBadge: tone.badge,
      centerBadgeTone: tone.badgeTone,
      centerName: displayName,
      donutColor: OCR_HOME_DONUT_COLORS[index % OCR_HOME_DONUT_COLORS.length],
      donutPercent,
      heatmapWeight: `${Math.round(donutPercent * 100)}%`,
      heatmapBackground: kind === 'etf' ? '#1E4D8C' : tone.heatmapBackground,
      heatmapChange: undefined,
      heatmapMeta: kind === 'etf' ? 'ETF' : marketTone === 'nasdaq' ? market : undefined,
      heatmapBadge: tone.badge,
      heatmapBadgeTone: tone.badgeTone,
      blink: tone.cardTone === 'danger' && kind !== 'etf',
      opinionLabel: kind === 'etf' ? '보유 요약' : '간략 의견',
      opinionText: buildOpinionText(displayName, kind, null),
      opinionBackground: kind === 'etf' ? '#f0f7ff' : tone.cardTone === 'profit' ? '#F0FAF4' : tone.cardTone === 'danger' ? '#FFF0F0' : '#f8f8f6',
      opinionBorder: kind === 'etf' ? '#B5D4F4' : tone.cardTone === 'danger' ? '#F7C1C1' : 'transparent',
      opinionTextColor: kind === 'etf' ? '#0C447C' : tone.cardTone === 'profit' ? '#27500A' : tone.cardTone === 'danger' ? '#791F1F' : '#555',
      metaLine: [buildHoldingMetaLine(identifierTicker, identifierCode, averagePrice, evaluationAmount), currentPriceText ? `현재가 ${currentPriceText}` : null].filter(Boolean).join(' · '),
      metrics: [
        { label: '보유 수량', value: shares, tone: 'neutral' },
        { label: '수익률', value: change, tone: tone.metricTone },
        { label: '평가 금액', value: evaluationAmount ?? '-', tone: 'neutral' },
        { label: '현재가', value: currentPriceText ?? '-', tone: 'neutral' },
      ],
      actionLabel: kind === 'etf' ? 'ETF 분석' : '딥스캔',
      actionSubLabel: kind === 'etf' ? '섹터 구성 + 회복 시나리오' : '세 팀이 분석해요',
      actionCredits: undefined,
      actionHref: '/deepscan',
    }
  })
}
