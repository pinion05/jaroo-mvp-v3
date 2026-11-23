/**
 * AI 트레이더 쇼케이스 — 초안①(캐릭터 디테일형) 목업 데이터.
 *
 * deepscan 리포트는 실제 컨트랙트 타입(JarooDeepScanPayload)을 그대로 채워서
 * 쇼케이스 UI가 운영 화면과 동일한 문법으로 리포트를 읽을 수 있게 한다.
 * 옵셔널 필드는 생략 가능하나, 화면에서 참조하는 hero / committee / strategy /
 * recoveryForecast / metadata.debugId 는 실제 스키마 대로 채웠다.
 *
 * ⚠️ 전부 하드코딩 목업 — 외부 API 호출 없음. (페이지 UI 초안 단계)
 */
import type {
  JarooDeepScanPayload,
  JarooDeepScanCommitteeAxis,
  DeepScanBlockMeta,
} from '../../../../packages/contracts/src/deepscan'

// ---------------------------------------------------------------------------
// deepscan 리포트 목업 (실제 컨트랙트 타입 재사용)
// ---------------------------------------------------------------------------

const OK_META: DeepScanBlockMeta = {
  blockState: 'ok',
  sourceRefs: [],
  fallback: null,
  error: null,
}

function axis(
  label: string,
  score: number,
  scoreText: string,
  axisStatusText: string,
  subtitle: string,
  members: JarooDeepScanCommitteeAxis['members'],
): JarooDeepScanCommitteeAxis {
  return { label, score, scoreText, axisStatusText, subtitle, avgLabel: scoreText, members }
}

function member(
  shortLabel: string,
  title: string,
  score: number,
  reason: string,
  confidence: 'low' | 'medium' | 'high',
  iconTone: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal',
): JarooDeepScanCommitteeAxis['members'][number] {
  return {
    shortLabel,
    title,
    status: 'success',
    reason,
    score,
    scoreLabel: `${score}점`,
    tone: score >= 60 ? 'positive' : score >= 45 ? 'neutral' : 'warning',
    iconTone,
    confidence,
  }
}

type ReportSeed = {
  reportId: string
  instrumentName: string
  instrumentCode: string
  debugId: string
  generatedAt: string
  heroScore: number
  headline: string
  body: string
  evidenceFacts: string[]
  weekSignal: string
  scenarioLabel: string
  scenarioProbability: string
  scenarioCondition: string
  currentPrice: number
  targetPrice: number
  recoveryHeadlineText: string
  recoveryHorizons: { '3m': number; '6m': number; '1y': number; '2y': number | null; '3y': number | null }
  recoveryConfidence: 'high' | 'medium' | 'low'
  drawdownText: string
  summaryTags: string[]
  insight: { label: string; title: string; body: string; sourceLabel: string; date: string }
}

function buildPayload(seed: ReportSeed): JarooDeepScanPayload {
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  const gapPct = Math.round(((seed.targetPrice - seed.currentPrice) / seed.currentPrice) * 1000) / 10
  const marketTone = seed.heroScore >= 60 ? '긍정' : seed.heroScore >= 45 ? '중립' : '부정'

  return {
    input: {
      instrument: { name: seed.instrumentName, code: seed.instrumentCode, market: 'KRX' },
      sourceContext: { from: 'report' },
    },
    hero: {
      ...OK_META,
      headline: seed.headline,
      body: seed.body,
      statusText: '분석 완료',
      score: seed.heroScore,
      scoreLabel: `${seed.heroScore}점 · ${marketTone} 우세`,
      scoreDelta: '+3',
      evidenceFacts: seed.evidenceFacts,
    },
    committee: {
      ...OK_META,
      axes: [
        axis('시장·수급 팀', Math.min(100, seed.heroScore + 4), `${Math.min(100, seed.heroScore + 4)}점`, '의견 수렴', '차트와 수급을 본 팀', [
          member('차트', '기술적 분석관', seed.heroScore >= 55 ? 72 : 38, `${seed.instrumentName} 주가 흐름과 거래량을 함께 봤을 때 ${seed.heroScore >= 55 ? '상승 모멘텀이 유효하다' : '반등 근거가 아직 약하다'}고 판단.`, seed.heroScore >= 55 ? 'medium' : 'high', seed.heroScore >= 55 ? 'green' : 'amber'),
          member('수급', '수급 분석관', seed.heroScore >= 60 ? 68 : 47, `외국인·기관 순매수 흐름이 ${seed.heroScore >= 60 ? '연속으로 유지되고 있어 수급이 바닥을 지지한다' : '엇갈려 추가 이탈 여부를 지켜봐야 한다'}고 판단.`, 'medium', 'blue'),
        ]),
        axis('기업·가치 팀', Math.max(0, seed.heroScore - 3), `${Math.max(0, seed.heroScore - 3)}점`, '의견 수렴', '실적과 가치를 본 팀', [
          member('실적', '펀더멘털 분석관', seed.heroScore, `${seed.instrumentName}의 최근 실적과 가이던스를 종합하면 ${seed.heroScore >= 60 ? '컨센서스 상회 가능성이 있다' : '회복 속도가 시장 기대보다 느리다'}고 판단.`, 'medium', 'teal'),
          member('가치', '밸류에이션 분석관', seed.heroScore >= 60 ? 65 : 44, `목표가 대비 ${Math.abs(gapPct)}% ${gapPct > 0 ? '상승 여력이 계산된다' : '하락 리스크가 남는다'}고 판단.`, 'low', 'purple'),
          member('리스크', '리스크 관리관', seed.heroScore >= 60 ? 58 : 39, `환율·경쟁 구도 변화를 감안해 ${seed.heroScore >= 60 ? '손절선만 명확히 하면 비중 유지가 가능하다' : '현 시점 신규 진입은 방어적으로 접근해야 한다'}고 판단.`, 'high', 'red'),
        ]),
      ],
    },
    insights: {
      ...OK_META,
      sectionLabel: '근거 브리핑',
      summaryTags: seed.summaryTags,
      items: [
        {
          sourceType: 'news',
          sourceLabel: seed.insight.sourceLabel,
          date: seed.insight.date,
          label: seed.insight.label,
          title: seed.insight.title,
          body: seed.insight.body,
        },
      ],
    },
    strategy: {
      ...OK_META,
      weekSignal: seed.weekSignal,
      weekSignalTone: seed.heroScore >= 60 ? 'positive' : 'neutral',
      weekBadgeText: `이번 주 시그널 · ${seed.weekSignal}`,
      scenarioLabel: seed.scenarioLabel,
      scenarioProbability: seed.scenarioProbability,
      scenarioPeriod: '4주 내',
      scenarioCondition: seed.scenarioCondition,
      currentPriceText: won(seed.currentPrice),
      targetPriceText: `${won(seed.targetPrice)} (+${gapPct}%)`,
      scenarioDetails: [
        `현재가 ${won(seed.currentPrice)} → 목표가 ${won(seed.targetPrice)}`,
        seed.scenarioCondition,
      ],
      otherScenarios: [
        { label: '횡보 대기', probability: '28%', condition: '거래량 위축과 함께 현 수준에서 박스권 유지 시' },
        { label: '조정', probability: '18%', condition: '시장 전반 위험선호 후퇴 시 단기 이동평균 하회' },
      ],
      otherScenarioTags: ['박스권', '조정'],
    },
    recoveryForecast: {
      ...OK_META,
      statusText: '회복 예측 완료',
      summaryText: seed.recoveryHeadlineText,
      expectedRecoveryDaysText: seed.heroScore >= 60 ? '약 128거래일' : '약 252거래일',
      recoveryProbabilityText: `1년 내 ${seed.recoveryHorizons['1y']}%`,
      confidenceText: seed.recoveryConfidence === 'high' ? '신뢰도 높음' : seed.recoveryConfidence === 'medium' ? '신뢰도 중간' : '신뢰도 낮음',
      currentPriceText: won(seed.currentPrice),
      targetPriceText: won(seed.targetPrice),
      drawdownText: seed.drawdownText,
      modelRows: [
        { label: '3개월', recoveryDaysText: '63거래일', probabilityText: `${seed.recoveryHorizons['3m']}%` },
        { label: '6개월', recoveryDaysText: '126거래일', probabilityText: `${seed.recoveryHorizons['6m']}%` },
        { label: '1년', recoveryDaysText: '252거래일', probabilityText: `${seed.recoveryHorizons['1y']}%` },
      ],
      disclaimer: '과거 데이터 기반 예측으로 실제 수익을 보장하지 않습니다.',
      currentPrice: seed.currentPrice,
      targetPrice: seed.targetPrice,
      recoveryHorizonProbabilities: seed.recoveryHorizons,
      recoveryProbabilityHeadlineText: seed.recoveryHeadlineText,
      confidenceLevel: seed.recoveryConfidence,
    },
    sellNow: {
      ...OK_META,
      realizedText: '보유 이력 기준 실현손익 +8.4%',
      rows: [
        { label: '보유 수량', value: '보유 이력 참고' },
        { label: '권장', value: seed.heroScore >= 60 ? '비중 유지' : '비중 축소', tagTone: seed.heroScore >= 60 ? 'positive' : 'danger', valueTone: seed.heroScore >= 60 ? undefined : 'danger', emphasis: true },
      ],
    },
    portfolioSimulation: {
      ...OK_META,
      beforeScore: 55,
      afterScore: Math.max(20, Math.min(95, seed.heroScore)),
      deltaLabel: `${seed.heroScore - 55 >= 0 ? '+' : ''}${seed.heroScore - 55}`,
      caption: '이 리포트를 반영했을 때 포트폴리오 진단 점수 변화(목업)',
    },
    metadata: {
      generatedAt: seed.generatedAt,
      version: 'v3-mock',
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

/** 리포트 id → deepscan 페이로드(목업) */
export const DEEPSCAN_REPORTS: Record<string, JarooDeepScanPayload> = {
  samsung: buildPayload({
    reportId: 'samsung',
    instrumentName: '삼성전자',
    instrumentCode: '005930',
    debugId: 'ds-20261114-a41f7c02',
    generatedAt: '2026-11-14T08:32:11+09:00',
    heroScore: 78,
    headline: 'HBM 수급 개선과 실적 반등 기대가 겹친 구간',
    body: '메모리 업황 회복 기대와 자사주 매입이 맞물려 긍정 신호가 우세하다. 다만 환율 변동성은 계속 지켜봐야 한다.',
    evidenceFacts: [
      '최근 분기 영업이익이 전년 동기 대비 2자릿수 증가',
      '자사주 10조 원 매입 프로그램 진행 중',
      'HBM 수주 잔량이 가동률을 상회해 2027년 가시성 확보',
    ],
    weekSignal: '매수',
    scenarioLabel: '목표가 접근',
    scenarioProbability: '54%',
    scenarioCondition: '외국인 순매수가 유지되고 20일 이동평균이 지지될 때',
    currentPrice: 74500,
    targetPrice: 92000,
    recoveryHeadlineText: '본전 회복 확률은 3개월 내 41%, 6개월 내 55%, 1년 내 62%입니다',
    recoveryHorizons: { '3m': 41, '6m': 55, '1y': 62, '2y': 68, '3y': 71 },
    recoveryConfidence: 'high',
    drawdownText: '고점 대비 -8.2%',
    summaryTags: ['실적 반등', '자사주', 'HBM'],
    insight: {
      label: '핵심 뉴스',
      sourceLabel: '뉴스',
      date: '2026-11-13',
      title: '삼성전자, 4분기 메모리 가격 인상 합의 조정',
      body: '공급사와의 4분기 계약가 협상에서 인상폭이 예상보다 크게 확정됐다는 관측이 나오며 실적 기대감이 강화됐다.',
    },
  }),
  hynix: buildPayload({
    reportId: 'hynix',
    instrumentName: 'SK하이닉스',
    instrumentCode: '000660',
    debugId: 'ds-20261115-b9d24e10',
    generatedAt: '2026-11-15T08:31:47+09:00',
    heroScore: 86,
    headline: 'HBM4 주도권과 실적 가시성이 가장 진한 종목',
    body: 'HBM4 양산 일정이 앞당겨지면서 경쟁사 대비 수주 우위가 뚜렷하다. 다만 주가 상승분이 커서 단기 변동성은 크다.',
    evidenceFacts: [
      'HBM4 양산 일정이 경쟁사보다 1분기 빠른 것으로 추정',
      '3분기 영업이익 마진이 사상 최고 수준 기록',
      '주요 고객사 2027년 물량 계약 사전 확정 보도',
    ],
    weekSignal: '강세 유지',
    scenarioLabel: '신고가 갱신',
    scenarioProbability: '58%',
    scenarioCondition: 'HBM4 관련 호재 공시와 함께 기관 순매수가 이어질 때',
    currentPrice: 412000,
    targetPrice: 520000,
    recoveryHeadlineText: '본전 회복 확률은 3개월 내 52%, 6개월 내 64%, 1년 내 71%입니다',
    recoveryHorizons: { '3m': 52, '6m': 64, '1y': 71, '2y': 76, '3y': null },
    recoveryConfidence: 'high',
    drawdownText: '고점 대비 -3.1%',
    summaryTags: ['HBM4', '마진 사상최고', '사전계약'],
    insight: {
      label: '핵심 뉴스',
      sourceLabel: '뉴스',
      date: '2026-11-15',
      title: 'SK하이닉스, HBM4 고객사 사전계약 물량 확대',
      body: '2027년 상반기 물량까지 계약이 선행 확정됐다는 분석이 나오며 공급망 내 지위가 강화됐다.',
    },
  }),
  lgenergy: buildPayload({
    reportId: 'lgenergy',
    instrumentName: 'LG에너지솔루션',
    instrumentCode: '373220',
    debugId: 'ds-20261113-c5580a9e',
    generatedAt: '2026-11-13T08:33:05+09:00',
    heroScore: 41,
    headline: 'ESS 호재는 있지만 수요 회복 속도가 늦는 구간',
    body: '미국 ESS 물량은 늘지만 EV 수요 회복이 지연돼 부정 신호가 우세하다. 반등은 단기적으로 제한적이다.',
    evidenceFacts: [
      '북미 ESS 수주 잔량이 전季 대비 40% 증가',
      'EV 판매 목표 대비 실적이 컨센서스 하회',
      '아이오닉 라인업 가동률이 70% 수준에 머묾',
    ],
    weekSignal: '관망',
    scenarioLabel: '저점 반복',
    scenarioProbability: '46%',
    scenarioCondition: '수요 회복 지연이 이어지며 박스권 하단에서 부진할 때',
    currentPrice: 368000,
    targetPrice: 395000,
    recoveryHeadlineText: '본전 회복 확률은 3개월 내 34%, 6개월 내 52%, 1년 내 61%입니다',
    recoveryHorizons: { '3m': 34, '6m': 52, '1y': 61, '2y': 66, '3y': null },
    recoveryConfidence: 'low',
    drawdownText: '고점 대비 -28.4%',
    summaryTags: ['ESS 성장', 'EV 지연', '가동률 부진'],
    insight: {
      label: '핵심 뉴스',
      sourceLabel: '뉴스',
      date: '2026-11-12',
      title: 'LG에너지솔루션, 북미 ESS 신규 수주 확대 보도',
      body: 'ESS 매출 비중 확대 기대가 있지만, EV 중심 손익 구조는 당분간 유지될 것으로 분석됐다.',
    },
  }),
  kia: buildPayload({
    reportId: 'kia',
    instrumentName: '기아',
    instrumentCode: '000270',
    debugId: 'ds-20261115-d7e63b44',
    generatedAt: '2026-11-15T08:34:22+09:00',
    heroScore: 69,
    headline: '낮은 밸류에이션과 배당이 받쳐주는 방어형 가치',
    body: 'PBR 0.4대에 배당수익률 5%대로 하락 방어력이 높다. 신차 사이클이 실적을 지지하는 구간이다.',
    evidenceFacts: [
      'PBR 0.42로 장기 평균 대비 크게 할인된 수준',
      '배당성향 40% 정책 유지, 배당수익률 5.1%',
      'SUV 라인업 중심 출시가 판매 단가를 끌어올림',
    ],
    weekSignal: '매수',
    scenarioLabel: '밸류에이션 재평가',
    scenarioProbability: '51%',
    scenarioCondition: '환율 안정과 신차 수요 유지가 겹칠 때',
    currentPrice: 112900,
    targetPrice: 138000,
    recoveryHeadlineText: '본전 회복 확률은 3개월 내 47%, 6개월 내 59%, 1년 내 65%입니다',
    recoveryHorizons: { '3m': 47, '6m': 59, '1y': 65, '2y': 70, '3y': 73 },
    recoveryConfidence: 'high',
    drawdownText: '고점 대비 -4.6%',
    summaryTags: ['저밸류', '배당 5%', '신차 사이클'],
    insight: {
      label: '핵심 뉴스',
      sourceLabel: '뉴스',
      date: '2026-11-14',
      title: '기아, 3분기 실적 컨센서스 소폭 상회',
      body: '수출 물량과 판매 단가 개선으로 이익이 기대치를 소폭 넘어섰다는 분석이 나왔다.',
    },
  }),
  naver: buildPayload({
    reportId: 'naver',
    instrumentName: 'NAVER',
    instrumentCode: '035420',
    debugId: 'ds-20261114-e1f9075d',
    generatedAt: '2026-11-14T08:35:40+09:00',
    heroScore: 63,
    headline: '광고 회복과 AI 투자 부담이 팽팽한 균형점',
    body: '검색·커머스 광고가 회복세지만 AI 인프라 투자 비용이 이익을 누른다. 중립적 판단이 우세하다.',
    evidenceFacts: [
      '검색 광고 매출이 전분기 대비 두 자릿수 증가',
      'AI 데이터센터 투자로 비용이 컨센서스 상회',
      '중국·일본 커머스 거래액이 성장세 유지',
    ],
    weekSignal: '중립',
    scenarioLabel: '실적 확인 대기',
    scenarioProbability: '49%',
    scenarioCondition: '4분기 광고 실적 발표 전까지 방향성 관망이 이어질 때',
    currentPrice: 214500,
    targetPrice: 240000,
    recoveryHeadlineText: '본전 회복 확률은 3개월 내 38%, 6개월 내 53%, 1년 내 58%입니다',
    recoveryHorizons: { '3m': 38, '6m': 53, '1y': 58, '2y': 64, '3y': null },
    recoveryConfidence: 'medium',
    drawdownText: '고점 대비 -11.7%',
    summaryTags: ['광고 회복', 'AI 투자', '커머스'],
    insight: {
      label: '핵심 뉴스',
      sourceLabel: '뉴스',
      date: '2026-11-13',
      title: 'NAVER, 4분기 광고 시장 회복 기대 보도',
      body: '업계 전반의 광고 예산 증액 기조가 검색 광고 매출 성장으로 이어질 것이라는 전망이 제시됐다.',
    },
  }),
}

// ---------------------------------------------------------------------------
// AI 트레이더 캐릭터 · 판단 로그 · 매매 원장 (쇼케이스 전용 목업 타입)
// ---------------------------------------------------------------------------

export type JudgmentDecisionCode = 'BUY_FIRST' | 'BUY_ADD' | 'SELL_PROFIT' | 'SELL_STOP' | 'HOLD_WATCH'

/** 캐릭터별 판단 로그 — deepscan 리포트(debugId)를 근거로 내린 결정 기록 */
export type AiTraderJudgment = {
  debugId: string
  generatedAt: string
  reportId: string
  instrumentName: string
  instrumentCode: string
  heroScore: number
  decisionCode: JudgmentDecisionCode
  decisionLabel: string
  /** 원장 방향 — HOLD면 null */
  side: 'BUY' | 'SELL' | null
  /** 판단 시점 참조한 본전 회복 확률(%) — horizon 라벨 포함 표기 */
  recoveryPct: number | null
  recoveryHorizon: '3m' | '6m' | '1y' | null
  targetPrice: number | null
  reasonCode: string
  /** 캐릭터 말투 서사 1~2문장 */
  narrative: string
}

/** 체결 기록 — KST 시각 기준 원장 한 줄 */
export type AiTraderExecution = {
  orderId: string
  /** ISO 8601 KST — 표시는 문자열 slice로 포맷해 하이드레이션 불일치를 피한다 */
  at: string
  side: 'BUY' | 'SELL'
  instrumentName: string
  instrumentCode: string
  qty: number
  price: number
  fee: number
  amount: number
}

export type AiTraderPosition = {
  instrumentName: string
  instrumentCode: string
  qty: number
  avgPrice: number
  currentPrice: number
}

export type AiTraderAccount = {
  cash: number
  principal: number
  evaluation: number
}

export type AiTraderCharacter = {
  id: string
  name: string
  emoji: string
  /** 아바타 원형 배경 클래스 (캐릭터별 톤) */
  avatarClass: string
  traitTags: string[]
  profileLine: string
  philosophy: string
  /** 말투 샘플 말풍선 */
  toneSample: string
  goal: {
    label: string
    /** 진척도(%) */
    pct: number
    currentText: string
    targetText: string
  }
  account: AiTraderAccount
  judgments: AiTraderJudgment[]
  executions: AiTraderExecution[]
  positions: AiTraderPosition[]
}

export const AI_TRADER_CHARACTERS: AiTraderCharacter[] = [
  {
    id: 'sosimi',
    name: '소심이',
    emoji: '🐰',
    avatarClass: 'bg-[color:var(--jaroo-accent)]',
    traitTags: ['안정 추구형', '분할 매수', '현금 비중 높음'],
    profileLine: '25세 · 사회인 1년차',
    philosophy: '잃지 않는 게 이기는 거예요… 조금씩, 아주 조금씩만요.',
    toneSample:
      '78점이라니… 좋긴 한데 너무 좋아서 무서워요. 일단 반 주문만 넣어보고, 떨어지면 그때도 반만 더 살래요. 남은 현금은 비상금이라고요!',
    goal: {
      label: '여행 자금',
      pct: 68,
      currentText: '156만원',
      targetText: '230만원',
    },
    account: { cash: 842_000, principal: 1_456_000, evaluation: 1_518_400 },
    judgments: [
      {
        debugId: 'ds-20261115-b9d24e10',
        generatedAt: '2026-11-15T09:02:31+09:00',
        reportId: 'hynix',
        instrumentName: 'SK하이닉스',
        instrumentCode: '000660',
        heroScore: 86,
        decisionCode: 'HOLD_WATCH',
        decisionLabel: '관망 유지',
        side: null,
        recoveryPct: 52,
        recoveryHorizon: '3m',
        targetPrice: 520000,
        reasonCode: 'VOLATILITY-FEAR',
        narrative:
          '86점… 저한테는 100점짜리 롤러코스터라는 뜻이에요. 주당 41만원이면 하루에 2만원씩 출렁여요, 그거 못 버텨요. 좋은 종목은 남들이 다 가지고 있다는 얘기 아닌가요…?',
      },
      {
        debugId: 'ds-20261114-a41f7c02',
        generatedAt: '2026-11-14T09:41:08+09:00',
        reportId: 'samsung',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        heroScore: 78,
        decisionCode: 'BUY_ADD',
        decisionLabel: '반 주문 추가 매수',
        side: 'BUY',
        recoveryPct: 41,
        recoveryHorizon: '3m',
        targetPrice: 92000,
        reasonCode: 'SCALE-IN-HALF',
        narrative:
          '평생 쓰는 폰 회사니까 그래도 제일 덜 무서워요. 근데 전재산 걸 순 없으니까… 반 주문만요. 오르면 좋고, 내려도 반만 더 살 체력은 남겨둘래요.',
      },
      {
        debugId: 'ds-20261113-c5580a9e',
        generatedAt: '2026-11-13T10:15:44+09:00',
        reportId: 'lgenergy',
        instrumentName: 'LG에너지솔루션',
        instrumentCode: '373220',
        heroScore: 41,
        decisionCode: 'HOLD_WATCH',
        decisionLabel: '진입 보류',
        side: null,
        recoveryPct: 34,
        recoveryHorizon: '3m',
        targetPrice: 395000,
        reasonCode: 'RECOVERY-TOO-SLOW',
        narrative:
          '41점에 회복 확률 34%라니, 제 심장에 66% 확률로 무섭다는 뜻이잖아요. 다들 반등한다던데… 저는 끝까지 다 오른 걸 보는 걸로 할게요.',
      },
    ],
    executions: [
      {
        orderId: 'ORD-20261114-88412031',
        at: '2026-11-14T10:31:22+09:00',
        side: 'BUY',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        qty: 1,
        price: 74800,
        fee: 20,
        amount: 74800,
      },
      {
        orderId: 'ORD-20261113-88390417',
        at: '2026-11-13T15:29:05+09:00',
        side: 'BUY',
        instrumentName: '기아',
        instrumentCode: '000270',
        qty: 2,
        price: 112500,
        fee: 34,
        amount: 225000,
      },
      {
        orderId: 'ORD-20261111-88321054',
        at: '2026-11-11T09:59:47+09:00',
        side: 'BUY',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        qty: 1,
        price: 73100,
        fee: 20,
        amount: 73100,
      },
      {
        orderId: 'ORD-20261107-88256740',
        at: '2026-11-07T14:12:36+09:00',
        side: 'SELL',
        instrumentName: 'SK하이닉스',
        instrumentCode: '000660',
        qty: 1,
        price: 498000,
        fee: 75,
        amount: 498000,
      },
      {
        orderId: 'ORD-20261105-88211309',
        at: '2026-11-05T10:05:18+09:00',
        side: 'BUY',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        qty: 1,
        price: 71900,
        fee: 20,
        amount: 71900,
      },
    ],
    positions: [
      { instrumentName: '삼성전자', instrumentCode: '005930', qty: 3, avgPrice: 73267, currentPrice: 74500 },
      { instrumentName: '기아', instrumentCode: '000270', qty: 2, avgPrice: 112500, currentPrice: 112900 },
    ],
  },
  {
    id: 'molppang-jun',
    name: '몰빵준',
    emoji: '🚀',
    avatarClass: 'bg-[color:var(--jaroo-profit-soft)]',
    traitTags: ['공격 투자형', '집중 투자', '단타·모멘텀'],
    profileLine: '22세 · 대학생 (공대)',
    philosophy: '분산은 겁쟁이의 변명. 남는 건 집중, 남는 이익은 복리.',
    toneSample:
      '하이닉스 86점이면 신이 나를 부르는 소리지. 목표가까지 26% 남았잖아, 이걸 왜 반만 사냐고요. 물리면 그때 생각하는 거야, 원래 몰빵이 그런 거.',
    goal: {
      label: '등록금 · 용돈 굴리기',
      pct: 50,
      currentText: '310만원',
      targetText: '620만원',
    },
    account: { cash: 187_000, principal: 2_410_000, evaluation: 2_864_000 },
    judgments: [
      {
        debugId: 'ds-20261115-b9d24e10',
        generatedAt: '2026-11-15T09:05:12+09:00',
        reportId: 'hynix',
        instrumentName: 'SK하이닉스',
        instrumentCode: '000660',
        heroScore: 86,
        decisionCode: 'BUY_ADD',
        decisionLabel: '가용 현금 전량 매수',
        side: 'BUY',
        recoveryPct: 52,
        recoveryHorizon: '3m',
        targetPrice: 520000,
        reasonCode: 'ALL-IN-MOMENTUM',
        narrative:
          '86점에 목표가 52만원, 지금 41만원. HBM4 사전계약까지 나왔는데 이걸 안 사면 인생에 두 번 못 와요. 현금 다 갈아넣습니다, 안녕 비상금.',
      },
      {
        debugId: 'ds-20261114-a41f7c02',
        generatedAt: '2026-11-14T11:20:37+09:00',
        reportId: 'samsung',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        heroScore: 78,
        decisionCode: 'SELL_PROFIT',
        decisionLabel: '차익 실현 후 회전',
        side: 'SELL',
        recoveryPct: 41,
        recoveryHorizon: '3m',
        targetPrice: 92000,
        reasonCode: 'ROTATE-TO-BET',
        narrative:
          '78점이면 대단한데… 근데 86점 옆에 있으면 그냥 보험료 내는 셈이지. 삼전 팔아서 하이닉스로 갈아타는 게 수학적으로 맞아요. 수학은 못 하지만 이건 알아요.',
      },
      {
        debugId: 'ds-20261113-c5580a9e',
        generatedAt: '2026-11-13T10:52:19+09:00',
        reportId: 'lgenergy',
        instrumentName: 'LG에너지솔루션',
        instrumentCode: '373220',
        heroScore: 41,
        decisionCode: 'BUY_FIRST',
        decisionLabel: '역발산 소량 매수',
        side: 'BUY',
        recoveryPct: 34,
        recoveryHorizon: '3m',
        targetPrice: 395000,
        reasonCode: 'CONTRA-DIP-BET',
        narrative:
          '사람들이 제일 겁먹고 던질 때가 싸게 사는 타이밍… 근데 34%는 좀 낮네. 일단 반만. (사실 겁이 조금 있음)',
      },
    ],
    executions: [
      {
        orderId: 'ORD-20261115-88507712',
        at: '2026-11-15T09:06:40+09:00',
        side: 'BUY',
        instrumentName: 'SK하이닉스',
        instrumentCode: '000660',
        qty: 1,
        price: 412500,
        fee: 62,
        amount: 412500,
      },
      {
        orderId: 'ORD-20261114-88423088',
        at: '2026-11-14T11:21:55+09:00',
        side: 'SELL',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        qty: 2,
        price: 74200,
        fee: 23,
        amount: 148400,
      },
      {
        orderId: 'ORD-20261113-88396450',
        at: '2026-11-13T10:53:02+09:00',
        side: 'BUY',
        instrumentName: 'LG에너지솔루션',
        instrumentCode: '373220',
        qty: 1,
        price: 369500,
        fee: 56,
        amount: 369500,
      },
      {
        orderId: 'ORD-20261110-88314776',
        at: '2026-11-10T10:02:31+09:00',
        side: 'BUY',
        instrumentName: 'SK하이닉스',
        instrumentCode: '000660',
        qty: 2,
        price: 405000,
        fee: 122,
        amount: 810000,
      },
    ],
    positions: [
      { instrumentName: 'SK하이닉스', instrumentCode: '000660', qty: 3, avgPrice: 406833, currentPrice: 412000 },
      { instrumentName: 'LG에너지솔루션', instrumentCode: '373220', qty: 1, avgPrice: 369500, currentPrice: 368000 },
    ],
  },
  {
    id: 'baedang-gom',
    name: '배당곰',
    emoji: '🐻',
    avatarClass: 'bg-[color:var(--jaroo-warning-soft)]',
    traitTags: ['배당 선호', '장기 보유', '현금흐름 중시'],
    profileLine: '58세 · 퇴직 준비 중',
    philosophy: '주식은 이자 농사다. 배당이 내 노후 월급이다, 알겠나이까.',
    toneSample:
      '실적이 아무리 좋아도 배당이 없으면 내 밥값이 안 되지. 배당수익률 4% 넘는 종목만 내 세상에 들어온다. 86점? 좋은데… 밤에 잠 안 오는 종목은 못 가져간다이.',
    goal: {
      label: '연간 배당금 모으기',
      pct: 72,
      currentText: '연 218만원',
      targetText: '연 300만원',
    },
    account: { cash: 1_204_000, principal: 8_930_000, evaluation: 9_412_000 },
    judgments: [
      {
        debugId: 'ds-20261115-d7e63b44',
        generatedAt: '2026-11-15T09:31:26+09:00',
        reportId: 'kia',
        instrumentName: '기아',
        instrumentCode: '000270',
        heroScore: 69,
        decisionCode: 'BUY_ADD',
        decisionLabel: '월 정액 배당 매수',
        side: 'BUY',
        recoveryPct: 47,
        recoveryHorizon: '3m',
        targetPrice: 138000,
        reasonCode: 'DIVIDEND-YIELD',
        narrative:
          'PBR 0.4에 배당 5%… 이건 그냥 시장 금리 두 배짜리 월세집이네. 한 달에 다섯 주씩만 사서, 은퇴하면 배당으로 커피값부터 벌게요.',
      },
      {
        debugId: 'ds-20261114-a41f7c02',
        generatedAt: '2026-11-14T13:08:03+09:00',
        reportId: 'samsung',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        heroScore: 78,
        decisionCode: 'BUY_ADD',
        decisionLabel: '배당 확대 대비 매수',
        side: 'BUY',
        recoveryPct: 41,
        recoveryHorizon: '3m',
        targetPrice: 92000,
        reasonCode: 'DIVIDEND-GROWTH',
        narrative:
          '78점에 자사주까지 산다고? 배당 늘린다는 얘기도 있고… 근데 전체 퍼센트의 15%만, 그 이상은 골방이라이. 골방에 살면 배당도 못 받아요.',
      },
      {
        debugId: 'ds-20261115-b9d24e10',
        generatedAt: '2026-11-15T09:33:48+09:00',
        reportId: 'hynix',
        instrumentName: 'SK하이닉스',
        instrumentCode: '000660',
        heroScore: 86,
        decisionCode: 'HOLD_WATCH',
        decisionLabel: '배당 부족 관망',
        side: null,
        recoveryPct: 52,
        recoveryHorizon: '3m',
        targetPrice: 520000,
        reasonCode: 'NO-DIVIDEND',
        narrative:
          '86점이 대단하긴 한데 배당수익률이 0.5%라이… 41만원짜리 주식이 밤새 2만원씩 흔들리면 심장만 배 아파요. 젊은 애들한테 남겨두겠다이.',
      },
    ],
    executions: [
      {
        orderId: 'ORD-20261115-88508193',
        at: '2026-11-15T09:32:15+09:00',
        side: 'BUY',
        instrumentName: '기아',
        instrumentCode: '000270',
        qty: 5,
        price: 112800,
        fee: 85,
        amount: 564000,
      },
      {
        orderId: 'ORD-20261114-88424901',
        at: '2026-11-14T13:09:22+09:00',
        side: 'BUY',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        qty: 3,
        price: 74300,
        fee: 34,
        amount: 222900,
      },
      {
        orderId: 'ORD-20261106-88233520',
        at: '2026-11-06T09:41:07+09:00',
        side: 'BUY',
        instrumentName: '기아',
        instrumentCode: '000270',
        qty: 8,
        price: 110500,
        fee: 88,
        amount: 884000,
      },
      {
        orderId: 'ORD-20261030-88129067',
        at: '2026-10-30T10:18:44+09:00',
        side: 'BUY',
        instrumentName: '삼성전자',
        instrumentCode: '005930',
        qty: 5,
        price: 70800,
        fee: 53,
        amount: 354000,
      },
    ],
    positions: [
      { instrumentName: '기아', instrumentCode: '000270', qty: 15, avgPrice: 111500, currentPrice: 112900 },
      { instrumentName: '삼성전자', instrumentCode: '005930', qty: 40, avgPrice: 71250, currentPrice: 74500 },
    ],
  },
  {
    id: 'value-noona',
    name: '가치누나',
    emoji: '🦉',
    avatarClass: 'bg-[color:var(--jaroo-neutral-soft)]',
    traitTags: ['밸류에이션', '중기 보유', '규율형 매도'],
    profileLine: '34세 · 직장인 (재무 7년)',
    philosophy: '싸게 사서 오래 묵힌다. 가격이 아니라 가치를 산다.',
    toneSample:
      'PBR 0.42에 배당 5%면 시장이 아직 숫자를 안 읽은 거예요. 저는 3년 치 실적을 읽고도 싸 보일 때만 사요. 대신 규율은 도로 짓지 않아요. 물리면, 사연이 있어도 정리합니다.',
    goal: {
      label: '내집마련 청약 자금',
      pct: 34,
      currentText: '1,720만원',
      targetText: '5,000만원',
    },
    account: { cash: 2_310_000, principal: 6_845_000, evaluation: 7_392_000 },
    judgments: [
      {
        debugId: 'ds-20261115-d7e63b44',
        generatedAt: '2026-11-15T10:04:55+09:00',
        reportId: 'kia',
        instrumentName: '기아',
        instrumentCode: '000270',
        heroScore: 69,
        decisionCode: 'BUY_FIRST',
        decisionLabel: '목표 비중 1차 진입',
        side: 'BUY',
        recoveryPct: 47,
        recoveryHorizon: '3m',
        targetPrice: 138000,
        reasonCode: 'VALUE-DISCOUNT',
        narrative:
          'PBR 0.42, 배당 5.1%, 목표가까지 22%. 리포트는 69점을 줬지만 저 기준으로는 85점이에요. 정가 참고서를 반 값에 사는 건데 왜 사람들이 안 사는지 모르겠네요.',
      },
      {
        debugId: 'ds-20261114-e1f9075d',
        generatedAt: '2026-11-14T10:47:29+09:00',
        reportId: 'naver',
        instrumentName: 'NAVER',
        instrumentCode: '035420',
        heroScore: 63,
        decisionCode: 'HOLD_WATCH',
        decisionLabel: '보유 유지·추가 대기',
        side: null,
        recoveryPct: 38,
        recoveryHorizon: '3m',
        targetPrice: 240000,
        reasonCode: 'HOLD-DISCIPLINE',
        narrative:
          '63점은 애매하지. 밸류에이션 투자는 단기 점수가 아니라 3년 뒤 복리로 승부해요. 대신 손절선은 이미 그어뒀고요, 여기 아래로 가면 다시 계산합니다.',
      },
      {
        debugId: 'ds-20261113-c5580a9e',
        generatedAt: '2026-11-13T11:36:14+09:00',
        reportId: 'lgenergy',
        instrumentName: 'LG에너지솔루션',
        instrumentCode: '373220',
        heroScore: 41,
        decisionCode: 'SELL_STOP',
        decisionLabel: '규율 손절',
        side: 'SELL',
        recoveryPct: 34,
        recoveryHorizon: '3m',
        targetPrice: 395000,
        reasonCode: 'SCORE-BREAK-RULE',
        narrative:
          '40점 밑으로 떨어진 종목은 사연이 있어도 정리하는 게 제 규칙이에요. ESS 성장 얘기는 좋지만, 아깝다 마시고 규율 먼저… 이게 진짜 어렵긴 하네요.',
      },
    ],
    executions: [
      {
        orderId: 'ORD-20261115-88508647',
        at: '2026-11-15T10:05:38+09:00',
        side: 'BUY',
        instrumentName: '기아',
        instrumentCode: '000270',
        qty: 6,
        price: 112700,
        fee: 85,
        amount: 676200,
      },
      {
        orderId: 'ORD-20261113-88399132',
        at: '2026-11-13T11:37:50+09:00',
        side: 'SELL',
        instrumentName: 'LG에너지솔루션',
        instrumentCode: '373220',
        qty: 3,
        price: 341000,
        fee: 154,
        amount: 1023000,
      },
      {
        orderId: 'ORD-20261108-88271455',
        at: '2026-11-08T15:58:12+09:00',
        side: 'BUY',
        instrumentName: 'NAVER',
        instrumentCode: '035420',
        qty: 2,
        price: 213000,
        fee: 64,
        amount: 426000,
      },
    ],
    positions: [
      { instrumentName: '기아', instrumentCode: '000270', qty: 6, avgPrice: 112700, currentPrice: 112900 },
      { instrumentName: 'NAVER', instrumentCode: '035420', qty: 4, avgPrice: 211500, currentPrice: 214500 },
      { instrumentName: '삼성전자', instrumentCode: '005930', qty: 20, avgPrice: 70400, currentPrice: 74500 },
    ],
  },
]
