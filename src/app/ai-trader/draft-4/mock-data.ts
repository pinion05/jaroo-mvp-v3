// 초안④ "같은 리포트·다른 결정 비교형" 목업 데이터.
// 실제 API 호출 없이 페이지 내 정의. 리포트 페이로드는 deepscan 실제 컨트랙트 타입을
// 그대로 재사용해, 나중에 실제 스냅샷으로 갈아끼우기 쉽게 만든다.
// 리포트·체결·계좌·수익률은 모두 가상 데이터다(쇼케이스 목업).
import type { JarooDeepScanPayload } from '../../../../packages/contracts/src/deepscan'

/** 실험 프레이밍: 4개 캐릭터 계좌는 동일 시드로 시작해 선택한 리포트의 결정만 실행했다. */
export const EXPERIMENT_SEED_KRW = 3_000_000
export const EXPERIMENT_ASOF_TEXT = '2026-11-16 14:00 KST 기준'

export type CharacterId = 'sosim' | 'doljin' | 'baedang' | 'gachi'
export type DecisionKind = 'buy' | 'sell' | 'hold' | 'wait'

export type AiTraderCharacter = {
  id: CharacterId
  name: string
  emoji: string
  /** 아바타 배경(장식용 틴트 — 데이터 색 아님) */
  avatarClass: string
  personaLabel: string
  philosophy: string
}

export const AI_TRADER_CHARACTERS: AiTraderCharacter[] = [
  {
    id: 'sosim',
    name: '소심이',
    emoji: '🐰',
    avatarClass: 'bg-rose-100',
    personaLabel: '안정형 · 제주도 여행 자금 230만 원 모으는 중',
    philosophy: '안 잃는 게 최고의 수익…이라고 믿고 있어요',
  },
  {
    id: 'doljin',
    name: '돌진이',
    emoji: '🚀',
    avatarClass: 'bg-amber-100',
    personaLabel: '공격형 · 21세 대학생 (등록금은 남의 일)',
    philosophy: '젊어서 안 물면, 늙어서 뭘 사?',
  },
  {
    id: 'baedang',
    name: '배당콕',
    emoji: '☕',
    avatarClass: 'bg-stone-100',
    personaLabel: '배당형 · 58세 퇴직 준비 아저씨',
    philosophy: '주가는 남의 말, 배당은 내 월급',
  },
  {
    id: 'gachi',
    name: '가치누나',
    emoji: '📊',
    avatarClass: 'bg-violet-100',
    personaLabel: '밸류형 · 34세 재무분석 8년차 직장인',
    philosophy: '감은 버리고, 계산은 남긴다',
  },
]

export type TradeFill = {
  /** 체결 KST 시각 (표시용, 'YYYY-MM-DD HH:mm:ss KST') */
  kstAt: string
  side: 'BUY' | 'SELL'
  name: string
  code: string
  qty: number
  price: number
  amount: number
  fee: number
  orderId: string
}

export type CharacterDecision = {
  characterId: CharacterId
  decision: DecisionKind
  /** 배지 옆 결정 한 줄 (예: "반 티켓 매수") */
  decisionLabel: string
  /** 캐릭터 말투 서사 1~2문장 */
  quote: string
  /** 같은 근거(heroScore·recoveryPct·목표가)를 다르게 해석한 문장 */
  sharedFactSpin: string
  reasonCode: string
  judgmentLog: {
    debugId: string
    generatedAt: string
    heroScore: number
    /** 6개월 원금회복 확률(%) — 모든 캐릭터가 같은 값을 바라본다 */
    recoveryPct: number
    targetPrice: number
  }
  fills: TradeFill[]
  account: {
    cash: number
    purchaseTotal: number
    evaluation: number
    profitAmount: number
    profitRatePct: number
  }
}

type ReportSeed = {
  code: string
  name: string
  market: string
  debugId: string
  generatedAt: string
  hero: {
    score: number
    scoreLabel: string
    scoreDelta: string
    headline: string
    body: string
    evidenceFacts: string[]
  }
  committee: Array<{
    shortLabel: string
    title: string
    score: number
    reason: string
    tone: 'positive' | 'neutral' | 'warning'
    iconTone: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal'
    confidence: 'low' | 'medium' | 'high'
  }>
  strategy: {
    weekSignal: string
    weekSignalTone: string
    weekBadgeText: string
    scenarioLabel: string
    scenarioProbability: string
    scenarioPeriod: string
    scenarioCondition: string
    currentPriceText: string
    targetPriceText: string
  }
  recovery: {
    drawdownText: string
    currentPrice: number
    targetPrice: number
    horizons: { '3m': number; '6m': number; '1y': number; '2y': number; '3y': number }
    headlineText: string
    confidenceLevel: 'high' | 'medium' | 'low'
    confidenceText: string
    expectedRecoveryDays: number
  }
}

function blockMeta() {
  return { blockState: 'ok' as const, sourceRefs: [], fallback: null, error: null }
}

function buildPayload(seed: ReportSeed): JarooDeepScanPayload {
  const committeeScore = Math.round(
    seed.committee.reduce((sum, m) => sum + m.score, 0) / seed.committee.length,
  )
  return {
    input: {
      instrument: { name: seed.name, code: seed.code, market: seed.market },
      sourceContext: { from: 'holding' },
    },
    hero: {
      ...blockMeta(),
      headline: seed.hero.headline,
      body: seed.hero.body,
      statusText: '분석 완료',
      score: seed.hero.score,
      scoreLabel: seed.hero.scoreLabel,
      scoreDelta: seed.hero.scoreDelta,
      evidenceFacts: seed.hero.evidenceFacts,
    },
    committee: {
      ...blockMeta(),
      axes: [
        {
          label: '종합 위원회',
          score: committeeScore,
          scoreText: `${committeeScore}점`,
          axisStatusText: '위원회 합의 도출',
          subtitle: '차트 · 시장 · 펀더멘털 3축',
          avgLabel: '평균',
          members: seed.committee.map((m) => ({
            shortLabel: m.shortLabel,
            title: m.title,
            status: 'success' as const,
            reason: m.reason,
            score: m.score,
            scoreLabel: m.tone === 'positive' ? '긍정' : m.tone === 'warning' ? '주의' : '중립',
            tone: m.tone,
            iconTone: m.iconTone,
            confidence: m.confidence,
          })),
        },
      ],
    },
    insights: { ...blockMeta(), sectionLabel: '확인한 소스', items: [], summaryTags: [] },
    strategy: {
      ...blockMeta(),
      weekSignal: seed.strategy.weekSignal,
      weekSignalTone: seed.strategy.weekSignalTone,
      weekBadgeText: seed.strategy.weekBadgeText,
      scenarioLabel: seed.strategy.scenarioLabel,
      scenarioProbability: seed.strategy.scenarioProbability,
      scenarioPeriod: seed.strategy.scenarioPeriod,
      scenarioCondition: seed.strategy.scenarioCondition,
      currentPriceText: seed.strategy.currentPriceText,
      targetPriceText: seed.strategy.targetPriceText,
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    recoveryForecast: {
      ...blockMeta(),
      statusText: '예측 완료',
      summaryText: seed.recovery.headlineText,
      expectedRecoveryDaysText: `약 ${seed.recovery.expectedRecoveryDays}거래일`,
      recoveryProbabilityText: `${seed.recovery.horizons['6m']}%`,
      confidenceText: seed.recovery.confidenceText,
      currentPriceText: seed.strategy.currentPriceText,
      targetPriceText: seed.strategy.targetPriceText,
      drawdownText: seed.recovery.drawdownText,
      modelRows: [
        { label: '단기 반등', recoveryDaysText: `약 ${Math.round(seed.recovery.expectedRecoveryDays * 0.4)}거래일`, probabilityText: `${seed.recovery.horizons['3m']}%` },
        { label: '기저 시나리오', recoveryDaysText: `약 ${seed.recovery.expectedRecoveryDays}거래일`, probabilityText: `${seed.recovery.horizons['6m']}%` },
        { label: '지연 회복', recoveryDaysText: `약 ${Math.round(seed.recovery.expectedRecoveryDays * 1.8)}거래일`, probabilityText: `${seed.recovery.horizons['2y']}%` },
      ],
      disclaimer: '과거 유사 패턴 기반 예측으로 실제 수익을 보장하지 않습니다.',
      currentPrice: seed.recovery.currentPrice,
      targetPrice: seed.recovery.targetPrice,
      expectedRecoveryDays: seed.recovery.expectedRecoveryDays,
      recoveryProbabilityPct: seed.recovery.horizons['6m'],
      recoveryHorizonProbabilities: {
        '3m': seed.recovery.horizons['3m'],
        '6m': seed.recovery.horizons['6m'],
        '1y': seed.recovery.horizons['1y'],
        '2y': seed.recovery.horizons['2y'],
        '3y': seed.recovery.horizons['3y'],
      },
      recoveryProbabilityHeadlineText: seed.recovery.headlineText,
      confidenceLevel: seed.recovery.confidenceLevel,
    },
    sellNow: {
      ...blockMeta(),
      realizedText: `${seed.name} 보유분 즉시 매도 기준 진단`,
      rows: [
        { label: '당일 체결 여건', value: '호가 3회 내 체결 가능' },
        { label: '권고', value: seed.hero.score >= 67 ? '보유 유지 우위' : seed.hero.score >= 45 ? '비중 점검 권고' : '방어 우선' },
      ],
    },
    portfolioSimulation: {
      ...blockMeta(),
      beforeScore: Math.max(20, seed.hero.score - 8),
      afterScore: Math.min(95, seed.hero.score + 6),
      deltaLabel: '+6점',
      caption: '리포트 권고를 반영하면 예상 포트폴리오 점수가 이렇게 바뀝니다',
    },
    metadata: {
      generatedAt: seed.generatedAt,
      version: 'deepscan-v7.2.0',
      degraded: false,
      debugId: seed.debugId,
      inputValidity: { valid: true },
      sourceRefs: [],
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
}

export type AiTraderReport = {
  code: string
  payload: JarooDeepScanPayload
  decisions: CharacterDecision[]
}

// ---------------------------------------------------------------------------
// 리포트 1 — 삼성전자(005930): hero 62 "중립+"
// ---------------------------------------------------------------------------
const SAMSUNG: AiTraderReport = {
  code: '005930',
  payload: buildPayload({
    code: '005930',
    name: '삼성전자',
    market: 'KOSPI',
    debugId: 'ds-4f2a9c81',
    generatedAt: '2026-11-13T09:04:11+09:00',
    hero: {
      score: 62,
      scoreLabel: '중립+ : 긍정·중립 혼재',
      scoreDelta: '전주 대비 +3',
      headline: '세 팀 의견이 중립+에 수렴했습니다',
      body: '차트 팀은 20일선 지지를, 시장 팀은 외국인 순매수 지속을, 펀더멘털 팀은 반도체 업황 개선을 근거로 봤습니다. 다만 밸류에이션 부담이 남아 점수가 상한에 못 미쳤습니다.',
      evidenceFacts: [
        '외국인 5일 연속 순매수',
        '20일 이동평균선 지지 확인',
        '3분기 영업이익 전년 동기비 +12%',
        '목표가 대비 상방 +23.7%',
      ],
    },
    committee: [
      { shortLabel: '차트', title: '차트 위원', score: 66, reason: '20일선 지지와 골든크로스 초입 확인', tone: 'positive', iconTone: 'green', confidence: 'high' },
      { shortLabel: '시장', title: '수급 위원', score: 71, reason: '외국인·기관 동반 순매수 흐름 지속', tone: 'positive', iconTone: 'green', confidence: 'high' },
      { shortLabel: '펀더', title: '펀더멘털 위원', score: 49, reason: '업황 개선이지만 PER 13.2배 밸류에이션 부담', tone: 'neutral', iconTone: 'blue', confidence: 'medium' },
    ],
    strategy: {
      weekSignal: '단기 조정을 지나 반등 시도 중',
      weekSignalTone: 'neutral',
      weekBadgeText: '중립',
      scenarioLabel: '보유 유지',
      scenarioProbability: '55%',
      scenarioPeriod: '1~2주',
      scenarioCondition: '58,000원 지지 유지 시 60,000~62,000원 박스 상승',
      currentPriceText: '58,200원',
      targetPriceText: '72,000원',
    },
    recovery: {
      drawdownText: '-18.6% (고점 71,500원 대비)',
      currentPrice: 58_200,
      targetPrice: 72_000,
      horizons: { '3m': 34, '6m': 52, '1y': 56, '2y': 61, '3y': 63 },
      headlineText: '본전 회복 확률은 3개월 내 34%, 6개월 내 52%, 1년 내 56%입니다',
      confidenceLevel: 'medium',
      confidenceText: '신뢰도 보통 (유사 패턴 42건)',
      expectedRecoveryDays: 214,
    },
  }),
  decisions: [
    {
      characterId: 'sosim',
      decision: 'buy',
      decisionLabel: '반 티켓 매수',
      quote: '62점… 60점 넘으면 괜찮은 거라며? 조, 조금만 살게요. 반 티켓이요. 여행 통장에서 옮긴 돈이라 여기서 손절하면 제주도가 사라져요…',
      sharedFactSpin: '같은 62점도 저한텐 "반만"이에요. 6개월 회복 52%도 동전 뒤집기 같아서 전량은 못 베팅해요…',
      reasonCode: 'RC-SOSIM-HERO62-HALF-CAUTIOUS',
      judgmentLog: { debugId: 'ds-4f2a9c81', generatedAt: '2026-11-13T09:06:41+09:00', heroScore: 62, recoveryPct: 52, targetPrice: 72_000 },
      fills: [
        { kstAt: '2026-11-13 10:31:07 KST', side: 'BUY', name: '삼성전자', code: '005930', qty: 5, price: 57_850, amount: 289_250, fee: 43, orderId: 'ORD-20261113-551032' },
      ],
      account: { cash: 2_710_707, purchaseTotal: 289_250, evaluation: 291_000, profitAmount: 1_750, profitRatePct: 0.61 },
    },
    {
      characterId: 'doljin',
      decision: 'buy',
      decisionLabel: '70% 집중 매수',
      quote: '62점이면 사라는 신호 아니야? 전체 자산 70% 갈아타고, 남은 30%는 다음 주 콜라 마시며 대기다. 고고!',
      sharedFactSpin: '62점이면 갭 상승 준비 완료지. 6개월 52%면 "반 이상 확률로 본전 넘는다"는 뜻이라구!',
      reasonCode: 'RC-DOLJIN-HERO62-AGGRESSIVE-70PCT',
      judgmentLog: { debugId: 'ds-4f2a9c81', generatedAt: '2026-11-13T09:06:58+09:00', heroScore: 62, recoveryPct: 52, targetPrice: 72_000 },
      fills: [
        { kstAt: '2026-11-13 10:32:15 KST', side: 'BUY', name: '삼성전자', code: '005930', qty: 35, price: 57_850, amount: 2_024_750, fee: 304, orderId: 'ORD-20261113-551077' },
      ],
      account: { cash: 974_946, purchaseTotal: 2_024_750, evaluation: 2_037_000, profitAmount: 12_250, profitRatePct: 0.6 },
    },
    {
      characterId: 'baedang',
      decision: 'hold',
      decisionLabel: '보유 유지',
      quote: '배당 1.8%에 바닥 다지는 중이라… 자네, 지금은 파는 시간이 아니라 모으는 시간이게. 보유분은 그대로 두고 배당금이나 받아 마시게나.',
      sharedFactSpin: '62점이면 사자·팔자 논쟁 반반이지. 배당 투자자에겐 그 답이 "유지"야.',
      reasonCode: 'RC-BAEDANG-HERO62-HOLD-DIV',
      judgmentLog: { debugId: 'ds-4f2a9c81', generatedAt: '2026-11-13T09:07:12+09:00', heroScore: 62, recoveryPct: 52, targetPrice: 72_000 },
      fills: [],
      account: { cash: 1_892_000, purchaseTotal: 1_108_000, evaluation: 1_164_000, profitAmount: 56_000, profitRatePct: 5.05 },
    },
    {
      characterId: 'gachi',
      decision: 'wait',
      decisionLabel: '매수 보류',
      quote: '62점은 "중립+"이에요. 위원회 점수가 49~71로 흩어져 있으면 확신이 없죠. 상방 23%는 매력적이지만, 컨센서스가 모일 때까지 기다릴게요.',
      sharedFactSpin: '같은 62점이라도 펀더멘털팀 49점이 걸려요. 점수 분산 = 불확실 → 관망이 원칙.',
      reasonCode: 'RC-GACHI-HERO62-WAIT-SPREAD',
      judgmentLog: { debugId: 'ds-4f2a9c81', generatedAt: '2026-11-13T09:07:30+09:00', heroScore: 62, recoveryPct: 52, targetPrice: 72_000 },
      fills: [],
      account: { cash: 3_000_000, purchaseTotal: 0, evaluation: 0, profitAmount: 0, profitRatePct: 0 },
    },
  ],
}

// ---------------------------------------------------------------------------
// 리포트 2 — SK하이닉스(000660): hero 78 "강세"
// ---------------------------------------------------------------------------
const SK_HYNIX: AiTraderReport = {
  code: '000660',
  payload: buildPayload({
    code: '000660',
    name: 'SK하이닉스',
    market: 'KOSPI',
    debugId: 'ds-8b3e17c5',
    generatedAt: '2026-11-13T09:04:26+09:00',
    hero: {
      score: 78,
      scoreLabel: '강세 : 긍정 우세',
      scoreDelta: '전주 대비 +11',
      headline: '세 팀 모두 강세에 동렬했습니다',
      body: 'HBM 수주 확대로 차트·시장·펀더멘털 세 팀이 모두 긍정입니다. 52주 신고가 갱신 구간에서 거래대금이 함께 확대된 점이 특징입니다.',
      evidenceFacts: [
        'HBM4 양산 계약 확대 보도',
        '52주 신고가 + 거래대금 동반 확대',
        '외국인 10일 연속 순매수',
        '2027년까지 메모리 초과수요 전망',
      ],
    },
    committee: [
      { shortLabel: '차트', title: '차트 위원', score: 82, reason: '신고가 돌파 후 눌림목이 얕음', tone: 'positive', iconTone: 'green', confidence: 'high' },
      { shortLabel: '시장', title: '수급 위원', score: 85, reason: '외국인·기관·개인 수급 동반 유입', tone: 'positive', iconTone: 'green', confidence: 'high' },
      { shortLabel: '펀더', title: '펀더멘털 위원', score: 74, reason: 'HBM 매출 비중 상승, 단 환율·경기 민감', tone: 'positive', iconTone: 'teal', confidence: 'medium' },
    ],
    strategy: {
      weekSignal: '모멘텀 강하고 되돌림 얕음',
      weekSignalTone: 'positive',
      weekBadgeText: '강세',
      scenarioLabel: '추세 추종',
      scenarioProbability: '65%',
      scenarioPeriod: '2~3주',
      scenarioCondition: '500,000원 지지 유지 시 550,000원 상향 시도',
      currentPriceText: '512,000원',
      targetPriceText: '650,000원',
    },
    recovery: {
      drawdownText: '-8.4% (고점 559,000원 대비)',
      currentPrice: 512_000,
      targetPrice: 650_000,
      horizons: { '3m': 71, '6m': 84, '1y': 88, '2y': 90, '3y': 91 },
      headlineText: '본전 회복 확률은 3개월 내 71%, 6개월 내 84%, 1년 내 88%입니다',
      confidenceLevel: 'high',
      confidenceText: '신뢰도 높음 (유사 패턴 67건)',
      expectedRecoveryDays: 63,
    },
  }),
  decisions: [
    {
      characterId: 'sosim',
      decision: 'buy',
      decisionLabel: '1주 소액 매수',
      quote: '78점이라니, 너무 높아서 오히려 무서워요. 근데 이걸 안 사면 더 오르고… 딱, 딱 1주만 사 둘게요. 이건 진짜 최후통첩이에요.',
      sharedFactSpin: '78점이라도 저한테는 100점이 아니에요… 1주만이야, 진짜예요.',
      reasonCode: 'RC-SOSIM-HERO78-ONE-SHARE',
      judgmentLog: { debugId: 'ds-8b3e17c5', generatedAt: '2026-11-13T09:05:48+09:00', heroScore: 78, recoveryPct: 84, targetPrice: 650_000 },
      fills: [
        { kstAt: '2026-11-13 10:35:41 KST', side: 'BUY', name: 'SK하이닉스', code: '000660', qty: 1, price: 505_000, amount: 505_000, fee: 76, orderId: 'ORD-20261113-660118' },
      ],
      account: { cash: 2_494_924, purchaseTotal: 505_000, evaluation: 512_000, profitAmount: 7_000, profitRatePct: 1.39 },
    },
    {
      characterId: 'doljin',
      decision: 'buy',
      decisionLabel: '올인 매수',
      quote: '78점에 신고가? 신고가는 또 신고가를 부르는 법이지. 4주 풀매수 간다! 남은 현금은 라면값으로 아껴둔다. 이건 인생 상승장 1라운드!',
      sharedFactSpin: '6개월 회복 84%면 그냥 공짜에 가까운 거잖아. 고점? 고점은 위에서만 본다고!',
      reasonCode: 'RC-DOLJIN-HERO78-ALLIN',
      judgmentLog: { debugId: 'ds-8b3e17c5', generatedAt: '2026-11-13T09:06:02+09:00', heroScore: 78, recoveryPct: 84, targetPrice: 650_000 },
      fills: [
        { kstAt: '2026-11-13 10:36:02 KST', side: 'BUY', name: 'SK하이닉스', code: '000660', qty: 4, price: 505_000, amount: 2_020_000, fee: 303, orderId: 'ORD-20261113-660124' },
      ],
      account: { cash: 979_697, purchaseTotal: 2_020_000, evaluation: 2_048_000, profitAmount: 28_000, profitRatePct: 1.39 },
    },
    {
      characterId: 'baedang',
      decision: 'sell',
      decisionLabel: '전량 익절',
      quote: '배당이 0.2%라게, 자네. 목표대까지 왔으니 2주 익절하겠네. 같은 78점도 퇴직 자금에겐 "출구 신호"로 읽는 법이야.',
      sharedFactSpin: '6개월 회복 84%보다 지금 확정 수익이 내 스타일이야. 반도체 경기변동주는 잠도 못 자게.',
      reasonCode: 'RC-BAEDANG-HERO78-EXIT-DIVMISS',
      judgmentLog: { debugId: 'ds-8b3e17c5', generatedAt: '2026-11-13T09:06:20+09:00', heroScore: 78, recoveryPct: 84, targetPrice: 650_000 },
      fills: [
        { kstAt: '2026-11-13 13:02:55 KST', side: 'SELL', name: 'SK하이닉스', code: '000660', qty: 2, price: 512_000, amount: 1_024_000, fee: 154, orderId: 'ORD-20261113-660201' },
      ],
      account: { cash: 3_067_703, purchaseTotal: 0, evaluation: 0, profitAmount: 67_703, profitRatePct: 7.08 },
    },
    {
      characterId: 'gachi',
      decision: 'hold',
      decisionLabel: '보유 유지',
      quote: '78점은 "더 사라"가 아니라 "팔지 마라"예요. 12개월 선행 PER 28배라 추가 매수는 안 하고, 트레일링 스탑 -8%만 걸어둘게요.',
      sharedFactSpin: '강세 78점을 "추가 베팅"이 아니라 "모멘텀 유지"로 읽었어요. 신규 리스크는 안 늘려요.',
      reasonCode: 'RC-GACHI-HERO78-HOLD-TRAIL8',
      judgmentLog: { debugId: 'ds-8b3e17c5', generatedAt: '2026-11-13T09:06:37+09:00', heroScore: 78, recoveryPct: 84, targetPrice: 650_000 },
      fills: [],
      account: { cash: 2_003_000, purchaseTotal: 997_000, evaluation: 1_024_000, profitAmount: 27_000, profitRatePct: 2.71 },
    },
  ],
}

// ---------------------------------------------------------------------------
// 리포트 3 — LG에너지솔루션(373220): hero 41 "주의"
// ---------------------------------------------------------------------------
const LG_ENSOL: AiTraderReport = {
  code: '373220',
  payload: buildPayload({
    code: '373220',
    name: 'LG에너지솔루션',
    market: 'KOSPI',
    debugId: 'ds-2c7f60d3',
    generatedAt: '2026-11-13T09:04:39+09:00',
    hero: {
      score: 41,
      scoreLabel: '주의 : 방어 우선',
      scoreDelta: '전주 대비 -7',
      headline: '세 팀 의견이 방어 쪽으로 기울었습니다',
      body: '전기차 수요 둔화와 북미 정책 불확실성으로 시장·펀더멘털 팀이 부정적입니다. 차트 팀도 주요 지지선 이탈을 확인했습니다.',
      evidenceFacts: [
        'EV 판매 전망 하향 (업계 3곳)',
        '20일·60일 이동평균선 동반 이탈',
        '북미 IRA 세액공제 불확실 지속',
        '2분기 연속 영업이익 감소',
      ],
    },
    committee: [
      { shortLabel: '차트', title: '차트 위원', score: 36, reason: '지지선 이탈 후 되돌림 없는 반락', tone: 'warning', iconTone: 'red', confidence: 'high' },
      { shortLabel: '시장', title: '수급 위원', score: 33, reason: '기관·외국인 동반 매도 지속', tone: 'warning', iconTone: 'red', confidence: 'high' },
      { shortLabel: '펀더', title: '펀더멘털 위원', score: 45, reason: '2분기 연속 영업이익 감소, 단 PBR 1.2배로 저평가 통과', tone: 'warning', iconTone: 'amber', confidence: 'medium' },
    ],
    strategy: {
      weekSignal: '지지선 이탈, 방어 자세 필요',
      weekSignalTone: 'negative',
      weekBadgeText: '약세',
      scenarioLabel: '방어 우선',
      scenarioProbability: '60%',
      scenarioPeriod: '1~2주',
      scenarioCondition: '380,000원 이탈 시 360,000원 하향 리스크',
      currentPriceText: '386,500원',
      targetPriceText: '340,000원',
    },
    recovery: {
      drawdownText: '-28.3% (고점 539,000원 대비)',
      currentPrice: 386_500,
      targetPrice: 340_000,
      horizons: { '3m': 18, '6m': 31, '1y': 44, '2y': 57, '3y': 66 },
      headlineText: '본전 회복 확률은 3개월 내 18%, 6개월 내 31%, 1년 내 44%입니다',
      confidenceLevel: 'low',
      confidenceText: '신뢰도 낮음 (유사 패턴 19건)',
      expectedRecoveryDays: 372,
    },
  }),
  decisions: [
    {
      characterId: 'sosim',
      decision: 'wait',
      decisionLabel: '매수 보류',
      quote: '41점… 40점대는 그냥 문 닫는 점수라며? 6개월 본전 확률 31%라니, 동전 던지기보다 낮잖아요. 안 사는 게 최고의 매수예요, 진짜.',
      sharedFactSpin: '6개월 31%는 "10번 중 3번만 본전"이라는 뜻… 저 몫은 패스할게요.',
      reasonCode: 'RC-SOSIM-HERO41-WAIT-FEAR',
      judgmentLog: { debugId: 'ds-2c7f60d3', generatedAt: '2026-11-13T09:05:52+09:00', heroScore: 41, recoveryPct: 31, targetPrice: 340_000 },
      fills: [],
      account: { cash: 3_000_000, purchaseTotal: 0, evaluation: 0, profitAmount: 0, profitRatePct: 0 },
    },
    {
      characterId: 'doljin',
      decision: 'buy',
      decisionLabel: '물타기 매수',
      quote: '41점? 남들 겁날 때 들어가는 거지! 6주 물타기 간다. 3년 뒤 66%면 시간이 내 편이야. 나중에 다들 "저때 왜 안 샀어" 하고 물어볼 거라구!',
      sharedFactSpin: '3개월 18%는 무섭지만, 3년 66%면 "기다리면 유리"라는 거잖아. 내 전략은 시간 벌리기!',
      reasonCode: 'RC-DOLJIN-HERO41-BTFD',
      judgmentLog: { debugId: 'ds-2c7f60d3', generatedAt: '2026-11-13T09:06:11+09:00', heroScore: 41, recoveryPct: 31, targetPrice: 340_000 },
      fills: [
        { kstAt: '2026-11-13 11:08:33 KST', side: 'BUY', name: 'LG에너지솔루션', code: '373220', qty: 6, price: 389_000, amount: 2_334_000, fee: 350, orderId: 'ORD-20261113-373209' },
      ],
      account: { cash: 665_650, purchaseTotal: 2_334_000, evaluation: 2_319_000, profitAmount: -15_000, profitRatePct: -0.64 },
    },
    {
      characterId: 'baedang',
      decision: 'sell',
      decisionLabel: '전량 손절',
      quote: '2분기 연속 영업이익 감소에 배당 여력도 없다니… 피 눈물 나지만 -3.9%에서 정리하겠네. 손실은 미확정일 때 제일 아프다게.',
      sharedFactSpin: '같은 6개월 31%를 "기다리면 더 잃는다"로 읽었어. 확정 손실이 미확정 손실보다 작은 게 배당 아저씨의 수학이야.',
      reasonCode: 'RC-BAEDANG-HERO41-STOPLIT',
      judgmentLog: { debugId: 'ds-2c7f60d3', generatedAt: '2026-11-13T09:06:25+09:00', heroScore: 41, recoveryPct: 31, targetPrice: 340_000 },
      fills: [
        { kstAt: '2026-11-13 13:11:20 KST', side: 'SELL', name: 'LG에너지솔루션', code: '373220', qty: 5, price: 386_500, amount: 1_932_500, fee: 290, orderId: 'ORD-20261113-373220' },
      ],
      account: { cash: 2_921_908, purchaseTotal: 0, evaluation: 0, profitAmount: -78_092, profitRatePct: -3.88 },
    },
    {
      characterId: 'gachi',
      decision: 'hold',
      decisionLabel: '보유 유지',
      quote: 'PBR 1.2배면 싸긴 한데, 제 룰은 "-15% 손절 또는 반등 확인"이에요. 둘 다 아니라서 신규 진입 금지, 기존 3주만 유지합니다.',
      sharedFactSpin: '41점을 "즉시 탈출"이 아니라 "신규 진입 금지 + 기존 포지션 관리"로 해석했어요.',
      reasonCode: 'RC-GACHI-HERO41-HOLD-RULEWAIT',
      judgmentLog: { debugId: 'ds-2c7f60d3', generatedAt: '2026-11-13T09:06:44+09:00', heroScore: 41, recoveryPct: 31, targetPrice: 340_000 },
      fills: [],
      account: { cash: 1_884_000, purchaseTotal: 1_116_000, evaluation: 1_159_500, profitAmount: 43_500, profitRatePct: 3.9 },
    },
  ],
}

export const AI_TRADER_REPORTS: AiTraderReport[] = [SAMSUNG, SK_HYNIX, LG_ENSOL]

// ---------------------------------------------------------------------------
// 표시 헬퍼
// ---------------------------------------------------------------------------

export function won(n: number) {
  return `${n.toLocaleString('ko-KR')}원`
}

export function signedWon(n: number) {
  return `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR')}원`
}

export function signedPct(n: number) {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** ISO(+09:00) → '2026-11-13 09:04 KST' 표시용 */
export function formatKst(iso: string) {
  return `${iso.slice(0, 16).replace('T', ' ')} KST`
}

/** deepscan 관례 색 밴드 — 강세=빨강, 중립=녹색(보합 관례), 주의=파랑 (토큰만 사용) */
export function scoreBand(score: number) {
  if (score >= 67) return { label: '강세', text: 'text-[color:var(--jaroo-profit)]', stroke: 'var(--jaroo-profit)' }
  if (score >= 45) return { label: '중립', text: 'text-[color:var(--jaroo-flat)]', stroke: 'var(--jaroo-flat)' }
  return { label: '주의', text: 'text-[color:var(--jaroo-loss)]', stroke: 'var(--jaroo-loss)' }
}
