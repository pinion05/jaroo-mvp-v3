/**
 * 초안③ (증거 체인 타임라인형) 목업 데이터 — 시연용이며 외부 API 호출은 없다.
 * 리포트 페이로드는 실제 컨트랙트 타입(JarooDeepScanPayload)을 그대로 채워
 * "판단 로그 × 매매 원장 = deepscan 성능의 공개 입증 체인" 구조를 시뮬레이션한다.
 */
import type {
  DeepScanBlockMeta,
  JarooDeepScanCommitteeAxis,
  JarooDeepScanCommitteeMember,
  JarooDeepScanCommitteeMemberIconTone,
  JarooDeepScanCommitteeMemberTone,
  JarooDeepScanPayload,
} from '../../../../packages/contracts/src/deepscan'

export type CharacterId = 'sosimi' | 'jun' | 'park' | 'jung'

export type AiTrader = {
  id: CharacterId
  name: string
  emoji: string
  /** 한 줄 소개 (연령·성향) */
  persona: string
  /** 한 줄 철학 */
  philosophy: string
  /** 색은 디자인 토큰 변수 이름으로만 지정 (#266 규율) */
  colorVar: string
  colorSoftVar: string
}

export const AI_TRADERS: AiTrader[] = [
  {
    id: 'sosimi',
    name: '소심이',
    emoji: '🐹',
    persona: '안정형 · 여행 자금 230만원 모으는 중',
    philosophy: '잃으면 안 돼요… 잃지 않는 게 제일이에요.',
    colorVar: 'var(--jaroo-warning)',
    colorSoftVar: 'var(--jaroo-warning-soft)',
  },
  {
    id: 'jun',
    name: '풀매수 준',
    emoji: '🐯',
    persona: '공격형 · 22살 대학생, 등록금+용돈으로 투자',
    philosophy: '계좌는 용기의 크기로 읽힌다. 다만 위험은 분산.',
    colorVar: 'var(--jaroo-profit)',
    colorSoftVar: 'var(--jaroo-profit-soft)',
  },
  {
    id: 'park',
    name: '배당사냥 박사장',
    emoji: '🎩',
    persona: '배당 중심 · 53살 퇴직 준비, 월배당 설계',
    philosophy: '퇴직금 계좌에서 비명은 허락되지 않는다.',
    colorVar: 'var(--jaroo-primary)',
    colorSoftVar: 'var(--jaroo-accent)',
  },
  {
    id: 'jung',
    name: '밸류정 누나',
    emoji: '🦉',
    persona: '밸류에이션 · 33살 직장인, 커트라인 투자',
    philosophy: '공부한 만큼만 번다. 근거는 리포트로 공부한다.',
    colorVar: 'var(--jaroo-flat)',
    colorSoftVar: 'var(--jaroo-neutral-soft)',
  },
]

export const TRADER_BY_ID: Record<CharacterId, AiTrader> = Object.fromEntries(
  AI_TRADERS.map((trader) => [trader.id, trader]),
) as Record<CharacterId, AiTrader>

/* ------------------------------------------------------------------ */
/* 판단 로그 / 매매 원장 타입                                           */
/* ------------------------------------------------------------------ */

export type JudgmentAction = 'BUY' | 'SELL' | 'WAIT'

export type JudgmentLog = {
  /** 근거가 된 deepscan 리포트 스냅샷 — 체인의 핵심 연결고리 */
  debugId: string
  generatedAt: string
  heroScore: number
  /** 회수확률(%) — horizon은 어떤 버킷을 인용했는지 명시 */
  recoveryPct: number
  recoveryHorizon: '3m' | '6m' | '1y' | '2y' | '3y'
  targetPrice: number
  reasonCode: string
  action: JudgmentAction
  /** 캐릭터 말투의 판단 서사 1~2문장 */
  narrative: string
}

export type ExecutionRecord = {
  orderId: string
  at: string
  side: 'BUY' | 'SELL'
  instrument: string
  code: string
  quantity: number
  price: number
  amount: number
  fee: number
  /** 보유 중이면 평가손익, SELL이면 실현손익 */
  pnl: { realized: boolean; value: number; pct: number }
}

export type JudgmentEntry = {
  id: string
  characterId: CharacterId
  at: string
  log: JudgmentLog
  execution: ExecutionRecord | null
}

export type ReportSaga = {
  id: string
  reportDateKey: string
  dateLabel: string
  weekday: string
  reportAt: string
  report: JarooDeepScanPayload
  judgments: JudgmentEntry[]
}

/* ------------------------------------------------------------------ */
/* 리포트 페이로드 빌더                                                 */
/* ------------------------------------------------------------------ */

type MockMemberSpec = {
  shortLabel: string
  title: string
  score: number
  reason: string
  confidence: 'low' | 'medium' | 'high'
}

type MockAxisSpec = {
  label: string
  score: number
  subtitle: string
  statusText: string
  members: MockMemberSpec[]
}

function scoreBand(score: number): { scoreLabel: string; tone: JarooDeepScanCommitteeMemberTone; iconTone: JarooDeepScanCommitteeMemberIconTone } {
  if (score >= 67) return { scoreLabel: '긍정', tone: 'positive', iconTone: 'blue' }
  if (score >= 45) return { scoreLabel: '중립', tone: 'neutral', iconTone: 'teal' }
  return { scoreLabel: '주의', tone: 'warning', iconTone: 'amber' }
}

function member(spec: MockMemberSpec): JarooDeepScanCommitteeMember {
  const band = scoreBand(spec.score)
  return {
    memberKey: spec.shortLabel,
    shortLabel: spec.shortLabel,
    title: spec.title,
    status: 'success',
    reason: spec.reason,
    score: spec.score,
    scoreLabel: band.scoreLabel,
    tone: band.tone,
    iconTone: band.iconTone,
    confidence: spec.confidence,
    error: null,
  }
}

function axis(spec: MockAxisSpec): JarooDeepScanCommitteeAxis {
  return {
    label: spec.label,
    score: spec.score,
    scoreText: `${spec.score}점`,
    axisStatusText: spec.statusText,
    subtitle: spec.subtitle,
    avgLabel: '팀 평균',
    members: spec.members.map(member),
  }
}

const okBlock = (): DeepScanBlockMeta => ({
  blockState: 'ok',
  sourceRefs: [],
  fallback: null,
  error: null,
})

type MockReportSpec = {
  instrumentName: string
  code: string
  debugId: string
  generatedAt: string
  score: number
  scoreDelta: string
  statusLabel: string
  headline: string
  body: string
  currentPrice: number
  targetPrice: number
  weekSignal: string
  weekSignalTone: string
  weekBadgeText: string
  scenarioLabel: string
  scenarioProbability: string
  scenarioPeriod: string
  scenarioCondition: string
  otherScenarios: { label: string; probability: string; condition: string }[]
  horizons: { '3m': number; '6m': number; '1y': number; '2y': number; '3y': number }
  confidence: 'high' | 'medium' | 'low'
  confidenceText: string
  evidenceFacts: string[]
  evidenceCautions: string[]
  axes: MockAxisSpec[]
  realizedText: string
}

function makePayload(spec: MockReportSpec): JarooDeepScanPayload {
  const priceText = (value: number) => `${value.toLocaleString('ko-KR')}원`
  return {
    input: {
      instrument: { name: spec.instrumentName, code: spec.code, market: 'KOSPI', kind: 'stock' },
      sourceContext: { from: 'holding', appliedAt: spec.generatedAt },
    },
    hero: {
      ...okBlock(),
      headline: spec.headline,
      body: spec.body,
      statusText: spec.statusLabel,
      score: spec.score,
      scoreLabel: spec.statusLabel,
      scoreDelta: spec.scoreDelta,
      evidenceFacts: spec.evidenceFacts,
      evidenceCautions: spec.evidenceCautions,
    },
    committee: {
      ...okBlock(),
      axes: spec.axes.map(axis),
    },
    insights: {
      ...okBlock(),
      sectionLabel: '주변 해석',
      items: [],
      summaryTags: [],
    },
    strategy: {
      ...okBlock(),
      weekSignal: spec.weekSignal,
      weekSignalTone: spec.weekSignalTone,
      weekBadgeText: spec.weekBadgeText,
      scenarioLabel: spec.scenarioLabel,
      scenarioProbability: spec.scenarioProbability,
      scenarioPeriod: spec.scenarioPeriod,
      scenarioCondition: spec.scenarioCondition,
      currentPriceText: priceText(spec.currentPrice),
      targetPriceText: priceText(spec.targetPrice),
      scenarioDetails: [],
      otherScenarios: spec.otherScenarios,
      otherScenarioTags: [],
    },
    recoveryForecast: {
      ...okBlock(),
      statusText: '회복 예측',
      summaryText: '과거 유사 하락 패턴 대비 본전 회복 확률을 기간별로 추정했어요.',
      expectedRecoveryDaysText: '중앙값 126거래일',
      recoveryProbabilityText: `6개월 내 ${spec.horizons['6m']}%`,
      confidenceText: spec.confidenceText,
      currentPriceText: priceText(spec.currentPrice),
      targetPriceText: priceText(spec.targetPrice),
      drawdownText: '직전 고점 대비 -5.8%',
      modelRows: [],
      disclaimer: '과거 유사 패턴 기반 추정 확률이며 실제 수익을 보장하지 않습니다.',
      currentPrice: spec.currentPrice,
      targetPrice: spec.targetPrice,
      recoveryProbabilityPct: spec.horizons['6m'],
      recoveryHorizonProbabilities: spec.horizons,
      recoveryProbabilityHeadlineText: `본전 회복 확률은 3개월 내 ${spec.horizons['3m']}%, 6개월 내 ${spec.horizons['6m']}%, 1년 내 ${spec.horizons['1y']}%입니다`,
      confidenceLevel: spec.confidence,
    },
    sellNow: {
      ...okBlock(),
      realizedText: spec.realizedText,
      rows: [],
    },
    portfolioSimulation: {
      ...okBlock(),
      beforeScore: Math.max(20, spec.score - 4),
      afterScore: Math.min(96, spec.score + 4),
      deltaLabel: '+4',
      caption: '해당 종목 비중 12% 보유 기준 시뮬레이션',
    },
    metadata: {
      generatedAt: spec.generatedAt,
      version: '4.2.1',
      degraded: false,
      debugId: spec.debugId,
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

/* ------------------------------------------------------------------ */
/* 사가 — 리포트 → 판단 → 체결                                          */
/* ------------------------------------------------------------------ */

const samSungA = makePayload({
  instrumentName: '삼성전자',
  code: '005930',
  debugId: 'ds_20261109_71e4',
  generatedAt: '2026-11-09T21:14:36+09:00',
  score: 48,
  scoreDelta: '-6 vs 전주',
  statusLabel: '주의',
  headline: '주의 — 방어 우위 구간',
  body: '외인 순매수 이탈로 수급이 흔들리고, 반도체 마진 회복 속도도 늦어지는 구간입니다. 다만 밸류에이션은 역사적 하단권입니다.',
  currentPrice: 71200,
  targetPrice: 74000,
  weekSignal: '방어 우위',
  weekSignalTone: 'caution',
  weekBadgeText: '주의',
  scenarioLabel: '보유 유지',
  scenarioProbability: '42%',
  scenarioPeriod: '4주 내',
  scenarioCondition: '70,000원 지지 캔들 없으면 관망 연장',
  otherScenarios: [
    { label: '지지 확인', probability: '35%', condition: '70,000원 이탈 후 3일 내 회복 시 점진 회복' },
    { label: '추가 이탈', probability: '23%', condition: '거래대금 확대 하락 시 박스 하단 테스트' },
  ],
  horizons: { '3m': 18, '6m': 31, '1y': 40, '2y': 47, '3y': 51 },
  confidence: 'low',
  confidenceText: '신뢰도: 낮음 (유사 패턴 21개)',
  evidenceFacts: [
    '외국인 4일 연속 순매도 — 누적 -2,140억원',
    '3Q 반도체 마진 개선 지연 (OPM 12.9%)',
    'PBR 1.1배 — 역사적 밴드 하단권',
    '거래대금 20일 평균 대비 -38% 관망세',
  ],
  evidenceCautions: ['갤럭시 S26 양산 일정 지연 이슈', '시스템반 수주는 4Q부터 실적 반영'],
  axes: [
    {
      label: '시장 · 수급',
      score: 42,
      subtitle: '외인 이탈, 기관 관망',
      statusText: '방어 우세',
      members: [
        { shortLabel: '외인수급 김', title: '외국인 수급 애널리스트', score: 31, reason: '외인 4일 연속 순매도, 수급 주도권이 매도측에 있습니다.', confidence: 'high' },
        { shortLabel: '기관흐름 박', title: '기관 수급 분석가', score: 47, reason: '기관 소극적 매수. 방향 신뢰도는 낮은 수준입니다.', confidence: 'medium' },
        { shortLabel: '개인수급 최', title: '개인 수급 분석가', score: 52, reason: '개인 순매수가 하락을 일부 완충하고 있습니다.', confidence: 'medium' },
      ],
    },
    {
      label: '펀더멘털 · 밸류',
      score: 54,
      subtitle: '실적 지연, 밸류 유효',
      statusText: '혼조',
      members: [
        { shortLabel: '실적 판', title: '재무·실적 애널리스트', score: 58, reason: '반도체 마진 개선 지연 — 본격 회복은 4Q 이후 전망입니다.', confidence: 'medium' },
        { shortLabel: '밸류 한', title: '밸류에이션 분석가', score: 61, reason: 'PBR 1.1배 하단권으로 저평가 매력은 존재합니다.', confidence: 'high' },
        { shortLabel: '배당 리', title: '배당 정책 분석가', score: 44, reason: '이번 분기 배당 확대 기대는 제한적입니다.', confidence: 'low' },
      ],
    },
  ],
  realizedText: '미실현 — 보유 포지션 없음',
})

const lgEnergy = makePayload({
  instrumentName: 'LG에너지솔루션',
  code: '373220',
  debugId: 'ds_20261111_9b33',
  generatedAt: '2026-11-11T08:47:20+09:00',
  score: 38,
  scoreDelta: '-9 vs 전주',
  statusLabel: '주의',
  headline: '주의 — 이탈 경계 구간',
  body: '2분기 연속 실적 부진과 EV 수요 전망 하향이 겹치며 공급과잉 캐즘이 지속되고 있습니다. 반등 근거는 아직 뚜렷하지 않습니다.',
  currentPrice: 428500,
  targetPrice: 405000,
  weekSignal: '이탈 경계',
  weekSignalTone: 'danger',
  weekBadgeText: '주의',
  scenarioLabel: '비중 축소',
  scenarioProbability: '39%',
  scenarioPeriod: '2주 내',
  scenarioCondition: '재고지수 개선 신호 없으면 목표가 하회 가능',
  otherScenarios: [
    { label: '박스권 유지', probability: '34%', condition: '리튬 가격 반등 시 원가 개선으로 횡보' },
    { label: '추가 하락', probability: '27%', condition: '수요 하향 재차 반영 시 전저점 테스트' },
  ],
  horizons: { '3m': 12, '6m': 22, '1y': 30, '2y': 36, '3y': 41 },
  confidence: 'low',
  confidenceText: '신뢰도: 낮음 (유사 패턴 14개)',
  evidenceFacts: [
    '2·3분기 연속 영업이익 YoY -41%',
    '유럽 EV 보조금 축소로 수요 전망 하향',
    '업계 재고일수 78일 — 공급과잉 지속',
    '미국 IRA 세액공제 불확실성 상존',
  ],
  evidenceCautions: ['리튬 가격 반등 시 원가 개선 가능성', '캐즘 국면 특성상 주가 변동성 확대'],
  axes: [
    {
      label: '시장 · 수급',
      score: 34,
      subtitle: '외인·기관 동반 이탈',
      statusText: '방어 우세',
      members: [
        { shortLabel: '외인수급 김', title: '외국인 수급 애널리스트', score: 26, reason: '외인·기관 동반 순매도로 이탈 흐름이 뚜렷합니다.', confidence: 'high' },
        { shortLabel: '기관흐름 박', title: '기관 수급 분석가', score: 39, reason: '기관 물량 정리가 아직 진행 중입니다.', confidence: 'medium' },
        { shortLabel: '개인수급 최', title: '개인 수급 분석가', score: 41, reason: '개인 저가 매수가 있으나 추격력은 약합니다.', confidence: 'low' },
      ],
    },
    {
      label: '펀더멘털 · 밸류',
      score: 41,
      subtitle: '실적 부진 지속',
      statusText: '방어 우세',
      members: [
        { shortLabel: '실적 판', title: '재무·실적 애널리스트', score: 33, reason: '2연속 실적 YoY -41%. 반등 근거가 부재합니다.', confidence: 'high' },
        { shortLabel: '밸류 한', title: '밸류에이션 분석가', score: 47, reason: 'PBR 2.1배 — 캐즘 감안 시 중립적 수준입니다.', confidence: 'medium' },
        { shortLabel: '배당 리', title: '배당 정책 분석가', score: 28, reason: '무배당 성장주로 배당 관점에서는 부적합합니다.', confidence: 'high' },
      ],
    },
  ],
  realizedText: '보유 중 — 평가손익 -7.5% (방어 검토 대상)',
})

const skHynix = makePayload({
  instrumentName: 'SK하이닉스',
  code: '000660',
  debugId: 'ds_20261113_2ae9',
  generatedAt: '2026-11-13T09:03:02+09:00',
  score: 78,
  scoreDelta: '+11 vs 전주',
  statusLabel: '강세',
  headline: '강세 — 긍정 우세 구간',
  body: 'HBM4 양산 계약과 사상 최대 실적이 겹치며 수급과 펀더멘털이 동반 강세입니다. 다만 밸류에이션 부담은 상존합니다.',
  currentPrice: 512000,
  targetPrice: 620000,
  weekSignal: '순매수 확대',
  weekSignalTone: 'positive',
  weekBadgeText: '강세',
  scenarioLabel: '추가 상승',
  scenarioProbability: '47%',
  scenarioPeriod: '4주 내',
  scenarioCondition: 'HBM4 물량 확정 뉴스 시 목표가 상향 여지',
  otherScenarios: [
    { label: '횡보 소화', probability: '31%', condition: '단기 과열 후 거래대금 감소 시 조정' },
    { label: '고점 경계', probability: '22%', condition: 'PER 18배대 확장 지속 시 되돌림' },
  ],
  horizons: { '3m': 61, '6m': 74, '1y': 79, '2y': 82, '3y': 84 },
  confidence: 'high',
  confidenceText: '신뢰도: 높음 (유사 패턴 41개)',
  evidenceFacts: [
    'HBM4 양산 계약 체결 — 엔비디아 공급 확대',
    '외국인 5일 연속 순매수 — 누적 +1.9조원',
    '3Q 영업이익 12.8조 — 사상 최대',
    'DDR5 가격 3개월 연속 상승',
  ],
  evidenceCautions: ['메모리 사이클 고점 논쟁 존재', 'PER 18.2배 — 밸류에이션 부담'],
  axes: [
    {
      label: '시장 · 수급',
      score: 81,
      subtitle: '외인 주도 순매수',
      statusText: '긍정 우세',
      members: [
        { shortLabel: '외인수급 김', title: '외국인 수급 애널리스트', score: 84, reason: '외인 5일 연속 +1.9조 순매수, 주도권 뚜렷합니다.', confidence: 'high' },
        { shortLabel: '기관흐름 박', title: '기관 수급 분석가', score: 76, reason: '기관 선매수 후 익절물 일부 — 흐름은 유지 중입니다.', confidence: 'medium' },
        { shortLabel: '개인수급 최', title: '개인 수급 분석가', score: 69, reason: '개인 추격 매수 유입 — 단기 과열 주의 신호입니다.', confidence: 'medium' },
      ],
    },
    {
      label: '펀더멘털 · 밸류',
      score: 75,
      subtitle: '실적 최대, 밸류 부담',
      statusText: '긍정 우세',
      members: [
        { shortLabel: '실적 판', title: '재무·실적 애널리스트', score: 82, reason: '사상 최대 실적에 HBM4 계약까지 체결됐습니다.', confidence: 'high' },
        { shortLabel: '밸류 한', title: '밸류에이션 분석가', score: 61, reason: 'PER 18.2배 — 사이클 고점 논쟁이 존재합니다.', confidence: 'medium' },
        { shortLabel: '배당 리', title: '배당 정책 분석가', score: 58, reason: '무배당 — 배당이 아닌 성장 프리미엄 종목입니다.', confidence: 'low' },
      ],
    },
  ],
  realizedText: '미실현 — 보유 포지션 없음',
})

const samSungB = makePayload({
  instrumentName: '삼성전자',
  code: '005930',
  debugId: 'ds_20261116_8f21',
  generatedAt: '2026-11-16T09:31:47+09:00',
  score: 62,
  scoreDelta: '+14 vs 전주',
  statusLabel: '중립+',
  headline: '중립+ — 되돌림 시도 중',
  body: '외인 수급이 순매수로 전환되고 120일 이동평균선을 회복했습니다. 실적 회복 기대가 살아나는 중이지만 돌파 확인은 필요합니다.',
  currentPrice: 70150,
  targetPrice: 89000,
  weekSignal: '되돌림 시도',
  weekSignalTone: 'neutral',
  weekBadgeText: '중립+',
  scenarioLabel: '보유 유지',
  scenarioProbability: '52%',
  scenarioPeriod: '4주 내',
  scenarioCondition: '74,500원 고점 돌파 실패 시 박스권 재진입',
  otherScenarios: [
    { label: '추가 상승', probability: '27%', condition: 'HBM 재계약 확정 시 목표가 상향' },
    { label: '조정', probability: '21%', condition: '외인 수급 반전 시 120일선 재테스트' },
  ],
  horizons: { '3m': 34, '6m': 52, '1y': 58, '2y': 63, '3y': 66 },
  confidence: 'medium',
  confidenceText: '신뢰도: 중간 (유사 패턴 34개)',
  evidenceFacts: [
    '외국인 3일 연속 순매수 — 누적 +4,820억원',
    'HBM4 재계약 기대로 메모리 섹터 수급 개선',
    '3Q 실적: 매출 84.2조 · 영업이익 12.1조 (YoY +18.4%)',
    '120일 이동평균선 회복 — 단기 이평 정배열 전환',
  ],
  evidenceCautions: ['주당배당 2,600원 유지 여부는 12월 이사회 변수', '9월 고점 74,500원 돌파 실패 시 박스권 재진입'],
  axes: [
    {
      label: '시장 · 수급',
      score: 66,
      subtitle: '외인 전환, 기관 관심',
      statusText: '긍정 우세',
      members: [
        { shortLabel: '외인수급 김', title: '외국인 수급 애널리스트', score: 71, reason: '외인 3일 연속 순매수로 수급 주도권이 우세합니다.', confidence: 'high' },
        { shortLabel: '기관흐름 박', title: '기관 수급 분석가', score: 63, reason: '연말 실적주 선호로 기관이 순매수로 전환했습니다.', confidence: 'medium' },
        { shortLabel: '개인수급 최', title: '개인 수급 분석가', score: 58, reason: '개인 물량이 분산되어 조정 소화력은 보통입니다.', confidence: 'medium' },
      ],
    },
    {
      label: '펀더멘털 · 밸류',
      score: 58,
      subtitle: '실적 회복, 밸류 축소',
      statusText: '혼조',
      members: [
        { shortLabel: '실적 판', title: '재무·실적 애널리스트', score: 62, reason: '3Q 영업이익 YoY +18.4% — 반도체 마진이 회복 중입니다.', confidence: 'high' },
        { shortLabel: '밸류 한', title: '밸류에이션 분석가', score: 49, reason: 'PBR 1.4배로 섹터 평균 대비 +0.2배 — 저평가 여력이 축소됐습니다.', confidence: 'medium' },
        { shortLabel: '배당 리', title: '배당 정책 분석가', score: 56, reason: '연 배당 2,600원 유지, 배당수익률 3.7%입니다.', confidence: 'low' },
      ],
    },
  ],
  realizedText: '미실현 — 보유 포지션 없음',
})

export const REPORT_SAGAS: ReportSaga[] = [
  {
    id: 'saga-20261109',
    reportDateKey: '2026-11-09',
    dateLabel: '11-09',
    weekday: '월',
    reportAt: '2026-11-09T21:14:36+09:00',
    report: samSungA,
    judgments: [
      {
        id: 'j-sosimi-1',
        characterId: 'sosimi',
        at: '2026-11-10T14:31:05+09:00',
        log: {
          debugId: 'ds_20261109_71e4',
          generatedAt: '2026-11-09T21:14:36+09:00',
          heroScore: 48,
          recoveryPct: 31,
          recoveryHorizon: '6m',
          targetPrice: 74000,
          reasonCode: 'LOW_SCORE_HALF_TICKET',
          action: 'BUY',
          narrative:
            '48점이면 "주의"라잖아요… 진짜로는 못 사는데, 여행 일정이 코앞이라 못 참겠어요. 반 티켓만… 정말 반만이요. 더는 절대 안 돼요.',
        },
        execution: {
          orderId: 'PT-20261110-8801',
          at: '2026-11-10T14:32:11+09:00',
          side: 'BUY',
          instrument: '삼성전자',
          code: '005930',
          quantity: 2,
          price: 71200,
          amount: 142400,
          fee: 21,
          pnl: { realized: false, value: -2100, pct: -1.47 },
        },
      },
      {
        id: 'j-jun-1',
        characterId: 'jun',
        at: '2026-11-10T14:33:40+09:00',
        log: {
          debugId: 'ds_20261109_71e4',
          generatedAt: '2026-11-09T21:14:36+09:00',
          heroScore: 48,
          recoveryPct: 31,
          recoveryHorizon: '6m',
          targetPrice: 74000,
          reasonCode: 'WAIT_FOR_BETTER_SETUP',
          action: 'WAIT',
          narrative:
            '48점? 컨디션 조져놓은 종목이 제일 맛있다는 건 알지만, 지금은 하이닉스 빅게임 준비 중이야. 실패 없는 승률은 패스에서도 나온다.',
        },
        execution: null,
      },
      {
        id: 'j-park-1',
        characterId: 'park',
        at: '2026-11-10T15:02:18+09:00',
        log: {
          debugId: 'ds_20261109_71e4',
          generatedAt: '2026-11-09T21:14:36+09:00',
          heroScore: 48,
          recoveryPct: 31,
          recoveryHorizon: '6m',
          targetPrice: 74000,
          reasonCode: 'NO_DIVIDEND_EDGE',
          action: 'WAIT',
          narrative: '배당 얘기 없는 리포트는 내 계좌와 무관하다. 점수가 70 넘고 배당 뉴스가 붙을 때 다시 불러라.',
        },
        execution: null,
      },
    ],
  },
  {
    id: 'saga-20261111',
    reportDateKey: '2026-11-11',
    dateLabel: '11-11',
    weekday: '수',
    reportAt: '2026-11-11T08:47:20+09:00',
    report: lgEnergy,
    judgments: [
      {
        id: 'j-park-2',
        characterId: 'park',
        at: '2026-11-11T09:58:44+09:00',
        log: {
          debugId: 'ds_20261111_9b33',
          generatedAt: '2026-11-11T08:47:20+09:00',
          heroScore: 38,
          recoveryPct: 22,
          recoveryHorizon: '6m',
          targetPrice: 405000,
          reasonCode: 'SCORE_DANGER_EXIT',
          action: 'SELL',
          narrative: '38점. 이건 관망이 아니라 비상구다. 퇴직금 계좌에서 비명은 허락되지 않는다 — 보유 물량 정리 들어간다.',
        },
        execution: {
          orderId: 'PT-20261111-3352',
          at: '2026-11-11T10:05:33+09:00',
          side: 'SELL',
          instrument: 'LG에너지솔루션',
          code: '373220',
          quantity: 3,
          price: 418200,
          amount: 1254600,
          fee: 188,
          pnl: { realized: true, value: -101400, pct: -7.48 },
        },
      },
      {
        id: 'j-sosimi-2',
        characterId: 'sosimi',
        at: '2026-11-11T10:11:52+09:00',
        log: {
          debugId: 'ds_20261111_9b33',
          generatedAt: '2026-11-11T08:47:20+09:00',
          heroScore: 38,
          recoveryPct: 22,
          recoveryHorizon: '6m',
          targetPrice: 405000,
          reasonCode: 'SCORE_DANGER_SKIP',
          action: 'WAIT',
          narrative: '38점…? 절. 대. 안 사요. 이런 점수 보고 들어갔다가는 여행이 아니라 집에서 라면 먹게 돼요.',
        },
        execution: null,
      },
      {
        id: 'j-jung-1',
        characterId: 'jung',
        at: '2026-11-11T10:24:09+09:00',
        log: {
          debugId: 'ds_20261111_9b33',
          generatedAt: '2026-11-11T08:47:20+09:00',
          heroScore: 38,
          recoveryPct: 22,
          recoveryHorizon: '6m',
          targetPrice: 405000,
          reasonCode: 'BELOW_VALUE_CUTLINE',
          action: 'WAIT',
          narrative: '38점은 제 커트라인(45) 미달이에요. 반등 나이프 잡기는 밸류에이션 투자자가 할 일이 아닙니다. 기록만 남겨요.',
        },
        execution: null,
      },
    ],
  },
  {
    id: 'saga-20261113',
    reportDateKey: '2026-11-13',
    dateLabel: '11-13',
    weekday: '금',
    reportAt: '2026-11-13T09:03:02+09:00',
    report: skHynix,
    judgments: [
      {
        id: 'j-jun-2',
        characterId: 'jun',
        at: '2026-11-13T10:36:15+09:00',
        log: {
          debugId: 'ds_20261113_2ae9',
          generatedAt: '2026-11-13T09:03:02+09:00',
          heroScore: 78,
          recoveryPct: 74,
          recoveryHorizon: '6m',
          targetPrice: 620000,
          reasonCode: 'HIGH_SCORE_PARTIAL_IN',
          action: 'BUY',
          narrative: '78?! 이건 신의 점수야. 풀매수는 아니고… 60% 진입 간다. 위험은 분산하되, 확신은 풀파워.',
        },
        execution: {
          orderId: 'PT-20261113-4417',
          at: '2026-11-13T10:41:07+09:00',
          side: 'BUY',
          instrument: 'SK하이닉스',
          code: '000660',
          quantity: 2,
          price: 512000,
          amount: 1024000,
          fee: 154,
          pnl: { realized: false, value: 45000, pct: 4.4 },
        },
      },
      {
        id: 'j-sosimi-3',
        characterId: 'sosimi',
        at: '2026-11-13T10:48:33+09:00',
        log: {
          debugId: 'ds_20261113_2ae9',
          generatedAt: '2026-11-13T09:03:02+09:00',
          heroScore: 78,
          recoveryPct: 74,
          recoveryHorizon: '6m',
          targetPrice: 620000,
          reasonCode: 'CHASE_BUY_AVOID',
          action: 'WAIT',
          narrative: '78점이면 이미 다 뛴 거잖아요… 저는 늘 꼭대기에서 사나 봐요. 이건 진짜 못 사요, 무서워요.',
        },
        execution: null,
      },
      {
        id: 'j-jung-2',
        characterId: 'jung',
        at: '2026-11-13T11:02:47+09:00',
        log: {
          debugId: 'ds_20261113_2ae9',
          generatedAt: '2026-11-13T09:03:02+09:00',
          heroScore: 78,
          recoveryPct: 74,
          recoveryHorizon: '6m',
          targetPrice: 620000,
          reasonCode: 'TARGET_GAP_HALF_TICKET',
          action: 'BUY',
          narrative: '78점이면 호재가 다 나온 뒤예요. 다만 목표가 620,000원까지 갭이 21%라 반 티켓은 계산이 돼요. 세일 끝나기 전에.',
        },
        execution: {
          orderId: 'PT-20261113-4492',
          at: '2026-11-13T11:09:26+09:00',
          side: 'BUY',
          instrument: 'SK하이닉스',
          code: '000660',
          quantity: 1,
          price: 513500,
          amount: 513500,
          fee: 77,
          pnl: { realized: false, value: 21000, pct: 4.09 },
        },
      },
    ],
  },
  {
    id: 'saga-20261116',
    reportDateKey: '2026-11-16',
    dateLabel: '11-16',
    weekday: '월',
    reportAt: '2026-11-16T09:31:47+09:00',
    report: samSungB,
    judgments: [
      {
        id: 'j-sosimi-4',
        characterId: 'sosimi',
        at: '2026-11-16T10:08:12+09:00',
        log: {
          debugId: 'ds_20261116_8f21',
          generatedAt: '2026-11-16T09:31:47+09:00',
          heroScore: 62,
          recoveryPct: 52,
          recoveryHorizon: '6m',
          targetPrice: 89000,
          reasonCode: 'SCORE_RECOVERY_ADD_HALF',
          action: 'BUY',
          narrative:
            '62점… 48점 때보단 많이 나아졌네요. 6개월 회수확률이 52%나 되면 반 티켓은 해볼래요. 여행 자금 230만원, D-day가 3주 남았거든요.',
        },
        execution: {
          orderId: 'PT-20261116-9014',
          at: '2026-11-16T10:12:41+09:00',
          side: 'BUY',
          instrument: '삼성전자',
          code: '005930',
          quantity: 2,
          price: 68400,
          amount: 136800,
          fee: 21,
          pnl: { realized: false, value: 3500, pct: 2.56 },
        },
      },
      {
        id: 'j-jun-3',
        characterId: 'jun',
        at: '2026-11-16T10:15:58+09:00',
        log: {
          debugId: 'ds_20261116_8f21',
          generatedAt: '2026-11-16T09:31:47+09:00',
          heroScore: 62,
          recoveryPct: 52,
          recoveryHorizon: '6m',
          targetPrice: 89000,
          reasonCode: 'DIP_ZONE_ADD',
          action: 'BUY',
          narrative: '62면 아직 바닥 다듬는 구간이잖아 ㅋㅋ 48점 때 왜 사 말라 그랬어. 이번엔 5주 들어간다. 다음 신호엔 진짜 풀매수.',
        },
        execution: {
          orderId: 'PT-20261116-9038',
          at: '2026-11-16T10:21:04+09:00',
          side: 'BUY',
          instrument: '삼성전자',
          code: '005930',
          quantity: 5,
          price: 68600,
          amount: 343000,
          fee: 52,
          pnl: { realized: false, value: 7750, pct: 2.26 },
        },
      },
      {
        id: 'j-park-3',
        characterId: 'park',
        at: '2026-11-16T10:31:20+09:00',
        log: {
          debugId: 'ds_20261116_8f21',
          generatedAt: '2026-11-16T09:31:47+09:00',
          heroScore: 62,
          recoveryPct: 52,
          recoveryHorizon: '6m',
          targetPrice: 89000,
          reasonCode: 'WAIT_PRINCIPLE_RULE',
          action: 'WAIT',
          narrative: '62점이면 애매하지. 배당 3.7%는 곱긴 한데, 내 원칙은 70점 + 배당 확대 뉴스다. 현금은 무기다.',
        },
        execution: null,
      },
      {
        id: 'j-jung-3',
        characterId: 'jung',
        at: '2026-11-16T10:44:51+09:00',
        log: {
          debugId: 'ds_20261116_8f21',
          generatedAt: '2026-11-16T09:31:47+09:00',
          heroScore: 62,
          recoveryPct: 52,
          recoveryHorizon: '6m',
          targetPrice: 89000,
          reasonCode: 'AWAIT_QUARTERLY_FUNDAMENTAL',
          action: 'WAIT',
          narrative: '62점 + 목표가 갭 27%면 매력적이에요. 그런데 PBR이 섹터 평균을 넘어서, 분기 실적 확인 후 진입하겠어요.',
        },
        execution: null,
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/* 계좌 원장 요약                                                       */
/* ------------------------------------------------------------------ */

export type AccountSummary = {
  characterId: CharacterId
  seed: number
  cash: number
  costBasis: number
  evaluation: number
  totalReturnPct: number
  goal?: { label: string; target: number; progressPct: number }
}

export const ACCOUNT_SUMMARIES: AccountSummary[] = [
  {
    characterId: 'sosimi',
    seed: 2000000,
    cash: 1720758,
    costBasis: 279200,
    evaluation: 280600,
    totalReturnPct: 0.07,
    goal: { label: '여행 자금', target: 2300000, progressPct: 87 },
  },
  {
    characterId: 'jun',
    seed: 1500000,
    cash: 132794,
    costBasis: 1367000,
    evaluation: 1419750,
    totalReturnPct: 3.5,
  },
  {
    characterId: 'park',
    seed: 72000000,
    cash: 13480113,
    costBasis: 58960000,
    evaluation: 65270300,
    totalReturnPct: 9.38,
  },
  {
    characterId: 'jung',
    seed: 48500000,
    cash: 29486423,
    costBasis: 18753500,
    evaluation: 20005300,
    totalReturnPct: 2.05,
  },
]

/* ------------------------------------------------------------------ */
/* 통계 헬퍼                                                            */
/* ------------------------------------------------------------------ */

export type SagaStats = {
  reportCount: number
  judgmentCount: number
  executionCount: number
  winCount: number
  lossCount: number
  hitRatePct: number
}

export function buildSagaStats(sagas: ReportSaga[]): SagaStats {
  const judgments = sagas.flatMap((saga) => saga.judgments)
  const executions = judgments.map((judgment) => judgment.execution).filter((entry): entry is ExecutionRecord => entry !== null)
  const winCount = executions.filter((entry) => entry.pnl.value > 0).length
  const lossCount = executions.length - winCount
  return {
    reportCount: sagas.length,
    judgmentCount: judgments.length,
    executionCount: executions.length,
    winCount,
    lossCount,
    hitRatePct: executions.length > 0 ? Math.round((winCount / executions.length) * 1000) / 10 : 0,
  }
}
