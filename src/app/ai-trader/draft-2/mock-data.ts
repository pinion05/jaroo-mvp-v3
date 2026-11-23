/**
 * draft-2 (리더보드/순위경쟁형) 목업 데이터 — 홍보용 가상 데이터.
 * deepscan 리포트는 실제 컨트랙트 타입(JarooDeepScanPayload)을 그대로 재사용해서
 * 나중에 실제 API 페이로드로 갈아끼우기 쉽게 만든다.
 */
import type {
  DeepScanBlockMeta,
  JarooDeepScanPayload,
} from '../../../../packages/contracts/src/deepscan'

// ─────────────────────────────────────────────────────────────────────────────
// 공용 deepscan 리포트 (4명의 AI 트레이더가 전부 이 리포트 하나를 보고 판단한다)
// ─────────────────────────────────────────────────────────────────────────────

const okBlockMeta = (sourceRefs: DeepScanBlockMeta['sourceRefs'] = []): DeepScanBlockMeta => ({
  blockState: 'ok',
  sourceRefs,
  fallback: null,
  error: null,
})

export const REPORT_DEBUG_ID = 'DS-20261109-4F7A2C81'

export const MOCK_REPORT: JarooDeepScanPayload = {
  input: {
    instrument: {
      name: 'SK하이닉스',
      code: '000660',
      market: 'KRX',
    },
    sourceContext: {
      from: 'holding',
      sessionKey: 'mock-session-draft2',
    },
  },
  hero: {
    ...okBlockMeta([{ type: 'market', id: 'krx-000660', label: 'KRX 시세' }]),
    headline: 'HBM 수주 모멘텀이 견고한 구간입니다',
    body: 'HBM3E 공급 계약 확대와 외국인 수급 개선이 맞물리며 긍정 신호가 우세합니다. 다만 경쟁사 캐파 확대에 따른 2027년 공급 과잉 리스크는 계속 지켜봐야 합니다.',
    statusText: '긍정',
    score: 72,
    scoreLabel: '긍정 우세',
    scoreDelta: '+6',
    evidenceFacts: [
      '외국인 5거래일 연속 순매수 — 누적 1.2조 원',
      '분기 매출 YoY +38%, HBM3E 출하량이 견인',
      '애널리스트 목표가 평균 720,000원 (현재가 대비 +22.7%)',
    ],
    evidenceCautions: ['경쟁사 HBM 캐파 확대 속도에 따라 마진 기대치 조정 가능'],
  },
  committee: {
    ...okBlockMeta(),
    axes: [
      {
        label: '시장 팀',
        score: 74,
        scoreText: '긍정 74',
        axisStatusText: '수급·기술 모두 긍정',
        subtitle: '수급과 기술 흐름을 봅니다',
        avgLabel: '평균 74',
        members: [
          {
            memberKey: 'market-flow',
            shortLabel: '수급관',
            title: '수급 분석관',
            status: 'success',
            reason: '외국인 5일 연속 순매수 — 기관까지 동반 참여 확인',
            score: 78,
            scoreLabel: '긍정 78',
            tone: 'positive',
            iconTone: 'blue',
            confidence: 'high',
          },
          {
            memberKey: 'market-tech',
            shortLabel: '기술관',
            title: '기술 분석관',
            status: 'success',
            reason: '20일 이동평균선 지지 확인 — 거래량 동반 확대',
            score: 70,
            scoreLabel: '긍정 70',
            tone: 'positive',
            iconTone: 'teal',
            confidence: 'medium',
          },
        ],
      },
      {
        label: '맥락 팀',
        score: 58,
        scoreText: '혼재 58',
        axisStatusText: '거시는 긍정, 산업은 점검 필요',
        subtitle: '거시 경제와 산업 동향을 봅니다',
        avgLabel: '평균 58',
        members: [
          {
            memberKey: 'context-macro',
            shortLabel: '거시관',
            title: '거시 경제관',
            status: 'success',
            reason: '반도체 사이클 상승 국면 — 금리 인하 기대도 유효',
            score: 64,
            scoreLabel: '긍정 64',
            tone: 'positive',
            iconTone: 'green',
            confidence: 'medium',
          },
          {
            memberKey: 'context-industry',
            shortLabel: '산업관',
            title: '산업 동향관',
            status: 'success',
            reason: '경쟁사 HBM 캐파 확대 — 2027년 공급 과잉 리스크 점검 필요',
            score: 52,
            scoreLabel: '중립 52',
            tone: 'warning',
            iconTone: 'amber',
            confidence: 'medium',
          },
        ],
      },
      {
        label: '펀더멘털 팀',
        score: 69,
        scoreText: '긍정 69',
        axisStatusText: '재무·밸류에이션 모두 양호',
        subtitle: '재무와 가격 매력도를 봅니다',
        avgLabel: '평균 69',
        members: [
          {
            memberKey: 'fundamental-finance',
            shortLabel: '재무관',
            title: '재무 분석관',
            status: 'success',
            reason: '영업이익률 21.4% — 4분기 연속 개선 중',
            score: 73,
            scoreLabel: '긍정 73',
            tone: 'positive',
            iconTone: 'green',
            confidence: 'high',
          },
          {
            memberKey: 'fundamental-valuation',
            shortLabel: '밸류관',
            title: '밸류에이션관',
            status: 'success',
            reason: '업종 평균 PER 대비 0.9배 — 과열 구간 아님',
            score: 65,
            scoreLabel: '긍정 65',
            tone: 'positive',
            iconTone: 'blue',
            confidence: 'medium',
          },
        ],
      },
    ],
  },
  insights: {
    ...okBlockMeta(),
    sectionLabel: '인사이트 3건',
    items: [
      {
        sourceType: 'report',
        sourceLabel: '증권사 리포트',
        date: '2026-11-06',
        label: '증권사 의견',
        title: '목표가 720,000원 상향 — 매수(BUY) 유지',
        body: '28개 애널리스트 평균 목표가 720,000원 (최고 800,000원 / 최저 650,000원). HBM3E 공급 계약 확대가 목표가 상향의 핵심 근거.',
        consensus: {
          targetPrice: 720000,
          targetGapPct: 22.7,
          analystCount: 28,
          recommendation: '매수 (BUY)',
          recommendationScore: 4.2,
          highestTargetPrice: 800000,
          lowestTargetPrice: 650000,
          opinionSummary: 'HBM3E 공급 계약 확대로 실적 상방 여력 확인',
          brokers: [
            { name: '미래에셋증권', targetPrice: 780000, date: '2026-11-05' },
            { name: 'NH투자증권', targetPrice: 730000, date: '2026-11-06' },
            { name: '키움증권', targetPrice: 700000, date: '2026-11-04' },
          ],
          currency: 'KRW',
        },
      },
      {
        sourceType: 'news',
        sourceLabel: '뉴스',
        date: '2026-11-08',
        label: '산업 뉴스',
        title: 'HBM3E 4세대 양산 본격화 — 주요 고객사 공급 계약 연장',
        body: '내년 상반기 서버 HBM 수주 잔량이 1년 이상 확보된 것으로 알려졌다. 업계는 HBM 매출 비중이 3분기 40%를 넘어설 것으로 전망한다.',
      },
      {
        sourceType: 'market',
        sourceLabel: '시장 데이터',
        date: '2026-11-13',
        label: '수급 동향',
        title: '외국인 5거래일 연속 순매수 — 누적 1.2조 원',
        body: '반도체 대형주 중심으로 외국인 순매수가 이어지는 중. 기관도 동반 순매수 전환하며 수급이 개선되고 있다.',
      },
    ],
    summaryTags: ['#HBM', '#수급개선', '#목표가상향'],
  },
  strategy: {
    ...okBlockMeta(),
    weekSignal: '추세 유지 — 눌림목 매수 우위',
    weekSignalTone: 'positive',
    weekBadgeText: '긍정',
    scenarioLabel: '시나리오 A',
    scenarioProbability: '55%',
    scenarioPeriod: '4주',
    scenarioCondition: '620,000원 지지 유지 시 720,000원 재테스트',
    currentPriceText: '587,000원',
    targetPriceText: '720,000원',
    scenarioDetails: [
      '20일 이동평균선 위 안착',
      '거래량 20일 평균 대비 +42%',
      '외국인·기관 동반 순매수 전환',
    ],
    otherScenarios: [
      { label: '시나리오 B — 횡보', probability: '30%', condition: '580,000~620,000원 박스권 지속' },
      { label: '시나리오 C — 조정', probability: '15%', condition: '541,000원 이탈 시 손절 검토' },
    ],
    otherScenarioTags: ['분할 매수', '손절 라인 사전 설정'],
  },
  recoveryForecast: {
    ...okBlockMeta(),
    statusText: '분석 완료',
    summaryText:
      '직전 고점 대비 -18.4% 조정 구간이며, 최근 3년 유사 패턴 42건 중 68%가 6개월 내 본전 회복했습니다.',
    expectedRecoveryDaysText: '약 126거래일',
    recoveryProbabilityText: '6개월 내 68%',
    confidenceText: '신뢰도 중',
    currentPriceText: '587,000원',
    targetPriceText: '720,000원',
    drawdownText: '-18.4%',
    modelRows: [
      { label: '빠른 회복', recoveryDaysText: '63거래일', probabilityText: '41%', sampleText: '유사 패턴 42건 기준' },
      { label: '기본 회복', recoveryDaysText: '126거래일', probabilityText: '68%', sampleText: '유사 패턴 42건 기준' },
      { label: '지연 회복', recoveryDaysText: '252거래일', probabilityText: '74%', sampleText: '유사 패턴 42건 기준' },
    ],
    disclaimer: '과거 유사 패턴 기반 추정치이며 실제 수익을 보장하지 않습니다.',
    currentPrice: 587000,
    targetPrice: 720000,
    expectedRecoveryDays: 126,
    recoveryProbabilityPct: 68,
    recoveryHorizonProbabilities: { '3m': 41, '6m': 68, '1y': 74, '2y': 79, '3y': 81 },
    recoveryProbabilityHeadlineText:
      '본전 회복 확률은 3개월 내 41%, 6개월 내 68%, 1년 내 74%입니다',
    confidenceLevel: 'medium',
  },
  sellNow: {
    ...okBlockMeta(),
    realizedText: '보유 수량 기준 부분 익절 검토 구간 진입',
    rows: [
      { label: '보유 수량', value: '300주 (목업 기준)' },
      { label: '평가손익', value: '+412,000원' },
      {
        label: '부분 익절 구간',
        value: '목표가 -8% 도달 시 (662,400원)',
        tag: '익절 검토',
        tagTone: 'positive',
        emphasis: true,
      },
      { label: '손절 기준선', value: '541,000원 (-7.8%)', valueTone: 'danger' },
    ],
  },
  portfolioSimulation: {
    ...okBlockMeta(),
    beforeScore: 61,
    afterScore: 67,
    deltaLabel: '+6점',
    caption: 'SK하이닉스 비중 12% 편입 시 목업 포트폴리오 점수 변화',
  },
  metadata: {
    generatedAt: '2026-11-09T08:31:12+09:00',
    version: 'deepscan-v2.4.0',
    degraded: false,
    debugId: REPORT_DEBUG_ID,
    inputValidity: { valid: true },
    sourceRefs: [{ type: 'market', id: 'krx-000660', label: 'KRX 시세' }],
    blockStatus: {
      hero: 'ok',
      committee: 'ok',
      insights: 'ok',
      strategy: 'ok',
      sellNow: 'ok',
      portfolioSimulation: 'ok',
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// AI 트레이더 캐릭터 4명
// ─────────────────────────────────────────────────────────────────────────────

export type SeasonKey = 'week' | 'lastWeek' | 'season'

export type SeasonRecord = {
  /** 구간 수익률 (%) */
  returnPct: number
  /** 구간 평가손익 (원) */
  pnl: number
  rank: number
  /** 전 구간 대비 순위 변동 */
  rankDelta: number
}

export type JudgmentLog = {
  reasonCode: string
  /** 캐릭터 말투 그대로의 서사 1~2문장 */
  narrative: string
  debugId: string
  /** KST 판단 시각 */
  generatedAt: string
  heroScore: number
  /** 6개월 누적 복구확률 (%) — 리포트 recoveryHorizonProbabilities['6m'] */
  recoveryPct: number
  targetPrice: number
}

export type AccountSummary = {
  cash: number
  principal: number
  evaluation: number
  seasonReturnPct: number
}

export type Trader = {
  id: string
  name: string
  emoji: string
  tagline: string
  philosophy: string
  goalLabel: string
  goalTarget: number
  goalCurrent: number
  accentSoft: string
  accentText: string
  accentBar: string
  seasons: Record<SeasonKey, SeasonRecord>
  judgment: JudgmentLog
  account: AccountSummary
}

export const SEASON_TABS: Array<{ key: SeasonKey; label: string; period: string; championLabel: string }> = [
  { key: 'week', label: '이번 주', period: '11/9–11/13', championLabel: '이번 주 챔피언' },
  { key: 'lastWeek', label: '지난 주', period: '11/2–11/6', championLabel: '지난 주 챔피언' },
  { key: 'season', label: '시즌 누적', period: '11/2–11/13', championLabel: '시즌 챔피언' },
]

export const TRADERS: Trader[] = [
  {
    id: 'charge',
    name: '돌진이',
    emoji: '🚀',
    tagline: '공격형 · 대학생 · 22세',
    philosophy: '확신이 서면 전부 다. 반만 믿으면 반만 번다.',
    goalLabel: '졸업여행 + 맥북 자금 800만 원',
    goalTarget: 8_000_000,
    goalCurrent: 6_873_000,
    accentSoft: 'bg-[color:var(--jaroo-profit-soft)]',
    accentText: 'text-[color:var(--jaroo-profit)]',
    accentBar: 'bg-[color:var(--jaroo-profit)]',
    seasons: {
      week: { returnPct: 12.4, pnl: 750_200, rank: 1, rankDelta: 2 },
      lastWeek: { returnPct: -2.4, pnl: -148_800, rank: 4, rankDelta: -2 },
      season: { returnPct: 9.7, pnl: 601_400, rank: 2, rankDelta: 0 },
    },
    judgment: {
      reasonCode: 'TAKE_PROFIT_TARGET_HIT',
      narrative:
        '리포트 72점? 70 넘었네. 내 룰은 70 돌파면 물량 풀가동. 668,400원 찍고 싹 정리 — 2주 만에 +9.2%, 역시 나야.',
      debugId: REPORT_DEBUG_ID,
      generatedAt: '2026-11-13 13:44 KST',
      heroScore: 72,
      recoveryPct: 68,
      targetPrice: 720_000,
    },
    account: {
      cash: 2_321_000,
      principal: 4_150_000,
      evaluation: 4_552_000,
      seasonReturnPct: 9.7,
    },
  },
  {
    id: 'value-nuna',
    name: '밸류누나',
    emoji: '🦉',
    tagline: '밸류 · 직장인 · 31세',
    philosophy: '싸게 산 좋은 회사는 시간이 알아서 키워준다.',
    goalLabel: '내집마련 종잣돌 6,000만 원',
    goalTarget: 60_000_000,
    goalCurrent: 44_841_500,
    accentSoft: 'bg-[color:var(--jaroo-accent)]',
    accentText: 'text-[color:var(--jaroo-primary)]',
    accentBar: 'bg-[color:var(--jaroo-primary)]',
    seasons: {
      week: { returnPct: 8.1, pnl: 2_835_000, rank: 2, rankDelta: -1 },
      lastWeek: { returnPct: 6.3, pnl: 2_143_000, rank: 1, rankDelta: 0 },
      season: { returnPct: 14.9, pnl: 4_991_500, rank: 1, rankDelta: 0 },
    },
    judgment: {
      reasonCode: 'HOLD_CORE_POSITION',
      narrative:
        '핵심은 목표가까지 여력 +22.7%라는 거예요. 지금 파는 건 씨앗을 파는 겁니다. 눌림목에서 30주 추가 — 분할로 조용히.',
      debugId: REPORT_DEBUG_ID,
      generatedAt: '2026-11-11 08:58 KST',
      heroScore: 72,
      recoveryPct: 68,
      targetPrice: 720_000,
    },
    account: {
      cash: 6_350_000,
      principal: 33_500_000,
      evaluation: 38_491_500,
      seasonReturnPct: 14.9,
    },
  },
  {
    id: 'dividend',
    name: '배당아저씨',
    emoji: '🌳',
    tagline: '배당 · 퇴직준비 · 58세',
    philosophy: '원금은 잠들지 않는다. 배당이 재산의 복리다.',
    goalLabel: '연 배당금 500만 원 만들기',
    goalTarget: 5_000_000,
    goalCurrent: 3_720_000,
    accentSoft: 'bg-[color:var(--jaroo-secondary)]',
    accentText: 'text-[color:var(--jaroo-flat)]',
    accentBar: 'bg-[color:var(--jaroo-flat)]',
    seasons: {
      week: { returnPct: 3.7, pnl: 3_674_000, rank: 3, rankDelta: -1 },
      lastWeek: { returnPct: 2.9, pnl: 2_842_000, rank: 2, rankDelta: 1 },
      season: { returnPct: 6.7, pnl: 6_566_000, rank: 3, rankDelta: 0 },
    },
    judgment: {
      reasonCode: 'DIVIDEND_RULE_BUY',
      narrative:
        '리포트 72점이면 한 주 더 묵을 자격은 돼. 대신 내 룰은 하나 — 손절 라인 541,000원, 규율은 생명이야.',
      debugId: REPORT_DEBUG_ID,
      generatedAt: '2026-11-12 09:09 KST',
      heroScore: 72,
      recoveryPct: 68,
      targetPrice: 720_000,
    },
    account: {
      cash: 12_400_000,
      principal: 98_000_000,
      evaluation: 104_566_000,
      seasonReturnPct: 6.7,
    },
  },
  {
    id: 'shy',
    name: '소심이',
    emoji: '🐹',
    tagline: '안정형 · 사회초년생 · 26세',
    philosophy: '안 잃는 게 제일 벌는 거예요... 아, 아마도?',
    goalLabel: '제주도 여행 자금 230만 원',
    goalTarget: 2_300_000,
    goalCurrent: 2_144_000,
    accentSoft: 'bg-[color:var(--jaroo-warning-soft)]',
    accentText: 'text-[color:var(--jaroo-warning)]',
    accentBar: 'bg-[color:var(--jaroo-warning)]',
    seasons: {
      week: { returnPct: -1.2, pnl: -25_900, rank: 4, rankDelta: -1 },
      lastWeek: { returnPct: 1.8, pnl: 38_300, rank: 3, rankDelta: 1 },
      season: { returnPct: 0.6, pnl: 12_400, rank: 4, rankDelta: 0 },
    },
    judgment: {
      reasonCode: 'DEFENSIVE_PARTIAL_SELL',
      narrative:
        '72점이라... 100점도 아닌데요? 삼성전자는 무, 무서워서 절반 정리했어요. SK하이닉스는 6개월 68%라니까 딱 1주만... 딱 1주만 가져볼래요.',
      debugId: REPORT_DEBUG_ID,
      generatedAt: '2026-11-10 10:19 KST',
      heroScore: 72,
      recoveryPct: 68,
      targetPrice: 720_000,
    },
    account: {
      cash: 685_300,
      principal: 1_450_000,
      evaluation: 1_458_700,
      seasonReturnPct: 0.6,
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 매매 원장 — 체결 통합 피드 (시간순: 오래된 것 → 최신)
// ─────────────────────────────────────────────────────────────────────────────

export type TradeSide = 'BUY' | 'SELL'

export type TradeExecution = {
  id: string
  /** KST 체결 시각 (표시용) */
  at: string
  side: TradeSide
  traderId: string
  instrument: string
  instrumentCode: string
  quantity: number
  unitPrice: number
  amount: number
  fee: number
  orderId: string
}

export const RECENT_TRADES: TradeExecution[] = [
  {
    id: 'TRD-01',
    at: '11-10 09:04',
    side: 'BUY',
    traderId: 'charge',
    instrument: 'SK하이닉스',
    instrumentCode: '000660',
    quantity: 2,
    unitPrice: 612_000,
    amount: 1_224_000,
    fee: 184,
    orderId: 'ORD-20261110-0842',
  },
  {
    id: 'TRD-02',
    at: '11-10 10:22',
    side: 'SELL',
    traderId: 'shy',
    instrument: '삼성전자',
    instrumentCode: '005930',
    quantity: 15,
    unitPrice: 121_300,
    amount: 1_819_500,
    fee: 2_730,
    orderId: 'ORD-20261110-0917',
  },
  {
    id: 'TRD-03',
    at: '11-11 09:01',
    side: 'BUY',
    traderId: 'value-nuna',
    instrument: '삼성전자',
    instrumentCode: '005930',
    quantity: 30,
    unitPrice: 122_800,
    amount: 3_684_000,
    fee: 5_526,
    orderId: 'ORD-20261111-0233',
  },
  {
    id: 'TRD-04',
    at: '11-11 13:45',
    side: 'SELL',
    traderId: 'charge',
    instrument: 'SK하이닉스',
    instrumentCode: '000660',
    quantity: 2,
    unitPrice: 668_400,
    amount: 1_336_800,
    fee: 2_005,
    orderId: 'ORD-20261111-0901',
  },
  {
    id: 'TRD-05',
    at: '11-12 09:12',
    side: 'BUY',
    traderId: 'dividend',
    instrument: '삼성전자',
    instrumentCode: '005930',
    quantity: 20,
    unitPrice: 123_400,
    amount: 2_468_000,
    fee: 3_702,
    orderId: 'ORD-20261112-0466',
  },
  {
    id: 'TRD-06',
    at: '11-12 15:30',
    side: 'BUY',
    traderId: 'shy',
    instrument: 'SK하이닉스',
    instrumentCode: '000660',
    quantity: 1,
    unitPrice: 584_200,
    amount: 584_200,
    fee: 876,
    orderId: 'ORD-20261112-1108',
  },
  {
    id: 'TRD-07',
    at: '11-13 10:05',
    side: 'SELL',
    traderId: 'value-nuna',
    instrument: 'LG에너지솔루션',
    instrumentCode: '373220',
    quantity: 4,
    unitPrice: 441_300,
    amount: 1_765_200,
    fee: 2_648,
    orderId: 'ORD-20261113-0321',
  },
  {
    id: 'TRD-08',
    at: '11-13 14:58',
    side: 'BUY',
    traderId: 'dividend',
    instrument: 'SK하이닉스',
    instrumentCode: '000660',
    quantity: 1,
    unitPrice: 591_000,
    amount: 591_000,
    fee: 887,
    orderId: 'ORD-20261113-1287',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 이번 주 하이라이트 매매
// ─────────────────────────────────────────────────────────────────────────────

export type HighlightTagTone = 'profit' | 'loss' | 'neutral'

export type HighlightTrade = {
  id: string
  traderId: string
  tag: string
  tagTone: HighlightTagTone
  at: string
  title: string
  detail: string
  /** 근거가 된 deepscan 리포트 요약 문구 */
  reportQuote: string
  reportDebugId: string
  /** 캐릭터 자신의 매매 룰 한 줄 */
  ruleTag: string
}

export const HIGHLIGHT_TRADES: HighlightTrade[] = [
  {
    id: 'HL-01',
    traderId: 'charge',
    tag: '익절 +9.2%',
    tagTone: 'profit',
    at: '11-13 13:45 체결',
    title: '돌진이, SK하이닉스 +9.2% 익절',
    detail: '612,000원 매수 → 668,400원 체결 · 실현손익 +112,800원',
    reportQuote:
      'HBM 수주 모멘텀이 견고한 구간 — 히어로 72점 긍정 우세, 목표가 720,000원(여력 +22.7%), 6개월 내 본전 회복 확률 68%',
    reportDebugId: REPORT_DEBUG_ID,
    ruleTag: '돌진이 룰: 점수 70↑ → 풀가동, 목표가 -8% 익절',
  },
  {
    id: 'HL-02',
    traderId: 'shy',
    tag: '손절 → 재진입',
    tagTone: 'neutral',
    at: '11-10 10:22 체결',
    title: '소심이, 삼성전자 정리 후 SK하이닉스 1주 재매수',
    detail: '121,300원 손절(-1.8%) → 584,200원 재진입 · 수수료 합계 3,606원',
    reportQuote:
      '본전 회복 확률은 3개월 내 41%, 6개월 내 68% — “그치만 100점이 아니잖아요… 절반만 정리하고 딱 1주만 가져볼래요”',
    reportDebugId: REPORT_DEBUG_ID,
    ruleTag: '소심이 룰: 확신 70% 미만 → 절반만',
  },
]
