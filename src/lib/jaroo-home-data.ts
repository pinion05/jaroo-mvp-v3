export type HomeBadgeTone = 'amber' | 'red' | 'green'
export type HomeCardTone = 'danger' | 'warning' | 'halt' | 'profit' | 'etf'
export type HomeMetricTone = 'danger' | 'warning' | 'positive' | 'locked' | 'neutral'
export type HomeMarketTone = 'kospi' | 'kosdaq' | 'etf' | 'nasdaq'
export type HomeActionTone = 'blue' | 'red' | 'green'
export type MomentumStageTone = 'danger' | 'muted' | 'positive'

export type HomeHolding = {
  id: number
  kind: 'stock' | 'etf'
  name: string
  shortName: string
  donutLabel: string
  shares: string
  averagePrice: string
  market: string
  marketTone: HomeMarketTone
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

export const homeHoldings: HomeHolding[] = [
  {
    id: 0,
    kind: 'stock',
    name: '삼성전자',
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
    opinionLabel: 'AI 간략 의견',
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
    actionSubLabel: 'AI 9인 위원회 분석',
    actionCredits: '300cr',
    actionHref: '/deepscan',
  },
  {
    id: 1,
    kind: 'stock',
    name: '코칩',
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
    opinionLabel: 'AI 간략 의견',
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
    actionSubLabel: 'AI 9인 위원회 분석',
    actionCredits: '300cr',
    actionHref: null,
  },
  {
    id: 2,
    kind: 'stock',
    name: '드래곤플라이',
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
    actionCredits: '300cr',
    actionHref: null,
  },
  {
    id: 3,
    kind: 'stock',
    name: 'SK하이닉스',
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
    actionSubLabel: 'AI 9인 위원회 분석',
    actionCredits: '300cr',
    actionHref: null,
  },
  {
    id: 4,
    kind: 'etf',
    name: 'KODEX 200',
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
    actionCredits: '300cr',
    actionHref: '/etf',
  },
]

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
