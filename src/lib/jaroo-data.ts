export type HoldingTone = 'danger' | 'warning' | 'positive' | 'neutral'

export type Holding = {
  name: string
  code: string
  shares: string
  averagePrice: string
  pnl: string
  change: string
  tone: HoldingTone
  market: string
  wind: string
  href: string
  note: string
  credits?: string
}

export const holdings: Holding[] = [
  {
    name: '삼성전자',
    code: '005930',
    shares: '128주',
    averagePrice: '74,600원',
    pnl: '-1,701,800원',
    change: '-23.4%',
    tone: 'danger',
    market: 'KOSPI',
    wind: '점검 필요',
    href: '/deepscan',
    note: '외국인 매도 부담이 있지만 52,100원 지지선 유지 시 회복 시나리오가 보여.',
    credits: '300cr',
  },
  {
    name: '코칩',
    code: '094360',
    shares: '350주',
    averagePrice: '18,200원',
    pnl: '-910,000원',
    change: '-14.3%',
    tone: 'warning',
    market: 'KOSDAQ',
    wind: '관찰 중',
    href: '/deepscan',
    note: '아직 악재 소화 구간이지만 추가 하락 속도는 둔화되는 중이야.',
    credits: '300cr',
  },
  {
    name: '드래곤플라이',
    code: '030350',
    shares: '500주',
    averagePrice: '1,840원',
    pnl: '거래 정지',
    change: '보류',
    tone: 'neutral',
    market: 'KOSDAQ',
    wind: '거래정지',
    href: '/sharecard',
    note: '실거래 재개 전까지는 비중 노출과 리스크 커뮤니케이션이 중요해.',
  },
  {
    name: 'SK하이닉스',
    code: '000660',
    shares: '40주',
    averagePrice: '146,500원',
    pnl: '+1,840,000원',
    change: '+31.4%',
    tone: 'positive',
    market: 'KOSPI',
    wind: '순풍',
    href: '/sharecard',
    note: 'HBM 모멘텀이 살아 있어서 포트폴리오의 버팀목 역할을 해.',
  },
  {
    name: 'KODEX 200',
    code: '069500',
    shares: '100주',
    averagePrice: '101,400원',
    pnl: '-1,863,000원',
    change: '-18.4%',
    tone: 'warning',
    market: 'ETF',
    wind: '순풍 전환',
    href: '/etf',
    note: '시장 대표 ETF라서 방향성 확인용 허브 카드로 두기 좋아.',
  },
]

export const brokerOptions = ['키움증권', '삼성증권', '미래에셋', 'NH투자', '토스증권', '기타']

export type OcrStockStatus = 'default' | 'editing' | 'warning'

export type OcrStock = {
  id: string
  name: string
  shares: string
  price: string
  average: string
  status: OcrStockStatus
  editValues: {
    shares: string
    average: string
  }
  defaultEditing?: boolean
}

export const ocrStocks: OcrStock[] = [
  {
    id: 'solid',
    name: '쏠리드',
    shares: '35주',
    price: '15,640원',
    average: '536,308원',
    status: 'default',
    editValues: {
      shares: '35',
      average: '536308',
    },
  },
  {
    id: 'snt-energy',
    name: 'SNT에너지',
    shares: '4주',
    price: '54,900원',
    average: '208,800원',
    status: 'editing',
    defaultEditing: true,
    editValues: {
      shares: '4',
      average: '208800',
    },
  },
  {
    id: 'sk-oceanplant',
    name: 'SK오션플랜트 ?',
    shares: '6주',
    price: '28,650원',
    average: '178,500원',
    status: 'warning',
    editValues: {
      shares: '6',
      average: '178500',
    },
  },
]

export type MergeChoiceId = 'update' | 'keep'

export type MergeOption = {
  id: MergeChoiceId
  label: string
  lines: string[]
}

export type MergeStock = {
  id: string
  name: string
  badge: string
  defaultChoice: MergeChoiceId
  options: [MergeOption, MergeOption]
}

export const mergeStocks: MergeStock[] = [
  {
    id: 'samsung-electronics',
    name: '삼성전자',
    badge: '중복',
    defaultChoice: 'update',
    options: [
      {
        id: 'update',
        label: '새 정보로 업데이트',
        lines: ['128주 → 140주', '평단 74,600원 유지'],
      },
      {
        id: 'keep',
        label: '기존 유지',
        lines: ['128주', '평단 74,600원'],
      },
    ],
  },
  {
    id: 'cochip',
    name: '코칩',
    badge: '중복',
    defaultChoice: 'update',
    options: [
      {
        id: 'update',
        label: '새 정보로 업데이트',
        lines: ['350주 동일', '평단 변동 없음'],
      },
      {
        id: 'keep',
        label: '기존 유지',
        lines: ['350주', '평단 18,200원'],
      },
    ],
  },
]

export type NewStock = {
  name: string
  detail: string
  badge: string
}

export const newStocks: NewStock[] = [
  { name: '카카오', detail: '20주 · 평단 48,200원', badge: '신규 추가' },
  { name: 'LG에너지솔루션', detail: '5주 · 평단 420,000원', badge: '신규 추가' },
]

export type DeepScanAxisTone = 'positive' | 'primary' | 'warning'
export type DeepScanMemberTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'

export type DeepScanAxisMember = {
  shortLabel: string
  title: string
  reason: string
  score: number
  scoreLabel: string
  tone: HoldingTone
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

export const deepScanAxisGroups: DeepScanAxisGroup[] = [
  {
    label: '펀더멘털',
    score: 7.2,
    scoreText: '7.2',
    status: '양호',
    subtitle: '가치·성장·재무',
    avgLabel: '평균 7.2점',
    tone: 'positive',
    members: [
      {
        shortLabel: '가치',
        title: '가치 분석가',
        reason: 'PBR 0.9 저평가, 목표가 28% 괴리',
        score: 8,
        scoreLabel: '8점',
        tone: 'positive',
        iconTone: 'blue',
      },
      {
        shortLabel: '성장',
        title: '성장 전략가',
        reason: 'HBM 수주 가시화, 이익 기울기 개선',
        score: 7,
        scoreLabel: '7점',
        tone: 'positive',
        iconTone: 'green',
      },
      {
        shortLabel: '재무',
        title: '재무 감사관',
        reason: '부채 안정, FCF 양전환',
        score: 7,
        scoreLabel: '7점',
        tone: 'positive',
        iconTone: 'amber',
      },
    ],
  },
  {
    label: '에너지',
    score: 6.8,
    scoreText: '6.8',
    status: '양호',
    subtitle: '차트·수급·모멘텀',
    avgLabel: '평균 6.8점',
    tone: 'primary',
    members: [
      {
        shortLabel: '차트',
        title: '차트 마스터',
        reason: '이중 바닥 패턴, 반등 신호',
        score: 7,
        scoreLabel: '7점',
        tone: 'positive',
        iconTone: 'teal',
      },
      {
        shortLabel: '수급',
        title: '수급 추적기',
        reason: '외국인 12일 순매도 — 주의',
        score: 4,
        scoreLabel: '4점',
        tone: 'warning',
        iconTone: 'red',
      },
      {
        shortLabel: '모멘',
        title: '모멘텀 스카우터',
        reason: '거래량 회복, RSI 38 과매도',
        score: 7,
        scoreLabel: '7점',
        tone: 'positive',
        iconTone: 'purple',
      },
    ],
  },
  {
    label: '환경',
    score: 5.4,
    scoreText: '5.4',
    status: '중립',
    subtitle: '심리·산업·이벤트',
    avgLabel: '평균 5.4점',
    tone: 'warning',
    members: [
      {
        shortLabel: '심리',
        title: '심리 분석 AI',
        reason: '공포 구간, 역발상 고려',
        score: 7,
        scoreLabel: '7점',
        tone: 'positive',
        iconTone: 'blue',
      },
      {
        shortLabel: '산업',
        title: '산업 전문가',
        reason: '반도체 업황 회복 초입',
        score: 6,
        scoreLabel: '6점',
        tone: 'neutral',
        iconTone: 'green',
      },
      {
        shortLabel: '이벤트',
        title: '이벤트 스캐너',
        reason: '외인 매도 뉴스 3일 내',
        score: 3,
        scoreLabel: '3점',
        tone: 'warning',
        iconTone: 'amber',
      },
    ],
  },
]

export const committeeMembers = deepScanAxisGroups.flatMap((axis) =>
  axis.members.map((member) => ({
    name: member.title,
    reason: member.reason,
    score: member.scoreLabel,
    tone: member.tone,
  })),
)

export const deepScanNewsItems = [
  {
    source: '한국경제',
    date: '2일 전',
    tone: 'positive' as const,
    label: '긍정',
    title: '삼성전자, 엔비디아 HBM4 공급 협상 본격화',
    body: 'AI 반도체 수요 확대에 따른 수주 기대감이 높아지고 있어요.',
  },
  {
    source: '연합뉴스',
    date: '3일 전',
    tone: 'danger' as const,
    label: '부정',
    title: '외국인 12일 연속 순매도… 3조 이탈',
    body: '달러 강세와 반도체 업황 우려로 외국인 매도세가 지속되고 있어요.',
  },
  {
    source: 'DART 공시',
    date: '5일 전',
    tone: 'neutral' as const,
    label: '중립',
    title: '2025년 1분기 실적 — 영업이익 6.7조',
    body: '시장 예상치에 부합하는 실적으로 큰 영향은 없을 것으로 보여요.',
  },
]

export const deepScanScenarioDetails = [
  '지지선 52,100원 유지 여부를 매주 확인하세요',
  '외국인 순매도가 멈추는 시점이 반등 신호예요',
  'HBM4 수주 확정 시 강풍 시나리오로 전환돼요',
]

export const deepScanOtherScenarios = [
  {
    label: '강풍',
    period: '약 4개월',
    condition: 'HBM 수주 확정 시',
    probability: '28%',
    tone: 'positive' as const,
  },
  {
    label: '순풍',
    period: '약 7개월',
    condition: '현재 흐름 유지 시',
    probability: '62%',
    tone: 'primary' as const,
  },
  {
    label: '미풍',
    period: '약 14개월',
    condition: '외인 매도 지속 시',
    probability: '10%',
    tone: 'warning' as const,
  },
]

export const deepScanSellRows = [
  {
    label: '52주 고점',
    value: '82,400원',
    tag: '저항',
    tagTone: 'danger' as const,
  },
  {
    label: '현재가',
    value: '57,200원',
    emphasis: true,
  },
  {
    label: '52주 저점',
    value: '52,100원',
    tag: '지지',
    tagTone: 'positive' as const,
  },
  {
    label: '실현 손익',
    value: '-4,820,000원',
    valueTone: 'danger' as const,
  },
  {
    label: '실수령액',
    value: '7,321,600원',
  },
]

export type ShareCardPerformanceTone = 'danger' | 'positive' | 'neutral'
export type ShareCardWind = '순풍' | '미풍' | '역풍'

export type ShareCardStock = {
  name: string
  market: string
  quantity: string
  averagePrice: string
  rate: string
  amount: string
  status: string
  performanceTone: ShareCardPerformanceTone
  wind: ShareCardWind
  dot: string
}

export const uploadHistory = [
  { title: '키움증권 보유종목 1차', subtitle: '오늘 14:10 · 4개 종목 반영', badge: '완료' },
  { title: '토스증권 ETF 캡처', subtitle: '어제 23:42 · ETF 분석으로 이동', badge: '분석됨' },
  { title: '삼성증권 보완 스크린샷', subtitle: '어제 21:05 · 병합 대기', badge: '대기' },
]

export function toneClass(tone: HoldingTone) {
  switch (tone) {
    case 'danger':
      return {
        badge: 'bg-[color:var(--jaroo-danger-soft)] text-[color:var(--jaroo-danger)]',
        dot: 'bg-[color:var(--jaroo-danger)]',
        text: 'text-[color:var(--jaroo-danger)]',
      }
    case 'warning':
      return {
        badge: 'bg-[color:var(--jaroo-warning-soft)] text-[color:var(--jaroo-warning)]',
        dot: 'bg-[color:var(--jaroo-warning)]',
        text: 'text-[color:var(--jaroo-warning)]',
      }
    case 'positive':
      return {
        badge: 'bg-[color:var(--jaroo-success-soft)] text-[color:var(--jaroo-success)]',
        dot: 'bg-[color:var(--jaroo-success)]',
        text: 'text-[color:var(--jaroo-success)]',
      }
    default:
      return {
        badge: 'bg-[color:var(--jaroo-neutral-soft)] text-[color:var(--jaroo-muted)]',
        dot: 'bg-[color:var(--jaroo-muted)]',
        text: 'text-[color:var(--jaroo-muted)]',
      }
  }
}
