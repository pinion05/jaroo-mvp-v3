// 홈 보유 종목 카드의 기본 타입들.
// jaroo-home-data(홈 데이터 파이프라인)와 deepscan-target(딥스캔 타깃) 양쪽이 참조하는
// 순수 타입 전용 모듈이다. 두 도메인 사이의 순환 의존
// (jaroo-home-data → deepscan-target 값 임포트 ↔ deepscan-target → jaroo-home-data 타입 임포트)를
// 끊기 위해 제3의 중립 지점으로 분리했다. 여기에는 런타임 값을 두지 않는다.

export type HomeBadgeTone = 'amber' | 'red' | 'green'
export type HomeCardTone = 'danger' | 'warning' | 'halt' | 'profit' | 'etf'
export type HomeMetricTone = 'danger' | 'warning' | 'positive' | 'locked' | 'neutral'
export type HomeMarketTone = 'kospi' | 'kosdaq' | 'etf' | 'nasdaq'
export type AveragePriceCurrency = 'KRW' | 'USD'

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
