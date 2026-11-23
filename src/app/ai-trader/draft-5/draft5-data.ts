import type {
  JarooDeepScanCommitteeAxis,
  JarooDeepScanCommitteeMember,
  JarooDeepScanCommitteeMemberIconTone,
  JarooDeepScanCommitteeMemberTone,
  JarooDeepScanInsightItem,
  JarooDeepScanPayload,
  JarooDeepScanRecoveryForecastBlock,
  JarooDeepScanSellNowRow,
  JarooDeepScanStrategyScenario,
} from '../../../../packages/contracts/src/deepscan'

/**
 * draft-5 (캐릭터 투자 일기·셰어러블형) 목업 데이터 — v1 파이프라인 확정판(#369).
 * 실제 컨트랙트 타입(JarooDeepScanPayload)을 그대로 채워 넣는다 — 외부 API 호출 없음.
 *
 * v1 입증 체인(4단계): 네이버 메인뉴스(공용 수집) → 캐릭터 성향으로 긍정 종목 발굴
 * (candidateSource) → 발굴 종목에 deepscan 리포트 실행 → 리포트가 성향 문턱(minHeroScore)
 * 을 통과해야 매수(A안 게이트). 미달이면 관망(PASS). 통과 시 점수에 따라 큰 비중 /
 * 중간 비중 / 애매하면 반 티켓.
 * 시나리오: 4명의 AI 트레이더가 2026-11-09 ~ 11-13 한 주를 1인칭 일기로 기록한다.
 */

export type Draft5ReportKey = 'samsung' | 'hynix' | 'lge' | 'sktelcom'

// ---------------------------------------------------------------- 공통 헬퍼

function okMeta() {
  return { blockState: 'ok' as const, sourceRefs: [], fallback: null, error: null }
}

function strengthOf(score: number) {
  if (score >= 67) return { label: '강세', tone: 'profit' as const }
  if (score >= 55) return { label: '중립+', tone: 'flat' as const }
  if (score >= 45) return { label: '중립', tone: 'flat' as const }
  return { label: '주의', tone: 'loss' as const }
}

type MemberSpec = {
  shortLabel: string
  title: string
  score: number
  reason: string
  tone: JarooDeepScanCommitteeMemberTone
  iconTone: JarooDeepScanCommitteeMemberIconTone
  confidence: ConfidenceLevel
}

/** 컨트랙트의 confidence 인라인 유니언과 동일하게 유지 */
type ConfidenceLevel = 'low' | 'medium' | 'high'

function mkMember(spec: MemberSpec): JarooDeepScanCommitteeMember {
  return {
    ...spec,
    status: 'success',
    scoreLabel: '위원 점수',
    error: null,
  }
}

type AxisSpec = {
  label: string
  score: number
  subtitle: string
  members: MemberSpec[]
}

function mkAxis(spec: AxisSpec): JarooDeepScanCommitteeAxis {
  const statusText = strengthOf(spec.score).label
  return {
    label: spec.label,
    score: spec.score,
    scoreText: statusText,
    axisStatusText: statusText,
    subtitle: spec.subtitle,
    avgLabel: `팀 평균 ${spec.score}점`,
    members: spec.members.map(mkMember),
  }
}

type InsightSpec = {
  sourceType: 'news' | 'report' | 'market'
  sourceLabel: string
  date: string
  label: string
  title: string
  body: string
}

function mkInsights(items: InsightSpec[]): Pick<JarooDeepScanPayload, 'insights'> {
  const mapped: JarooDeepScanInsightItem[] = items.map((item) => ({ ...item }))
  return {
    insights: {
      ...okMeta(),
      sectionLabel: '주요 인사이트',
      items: mapped,
      summaryTags: items.map((item) => item.label),
    },
  }
}

const HORIZON_DAYS: Array<{ key: '3m' | '6m' | '1y' | '2y' | '3y'; label: string; days: number }> = [
  { key: '3m', label: '3개월', days: 63 },
  { key: '6m', label: '6개월', days: 126 },
  { key: '1y', label: '1년', days: 252 },
  { key: '2y', label: '2년', days: 504 },
  { key: '3y', label: '3년', days: 756 },
]

type Horizons = { '3m': number; '6m': number; '1y': number; '2y': number; '3y': number }

function mkRecoveryForecast(opts: {
  statusText: string
  summaryText: string
  priceText: string
  targetText: string
  drawdownText: string
  priceNumber: number
  targetNumber: number
  horizons: Horizons
  confidenceLevel: ConfidenceLevel
}): Pick<JarooDeepScanPayload, 'recoveryForecast'> {
  const modelRows = HORIZON_DAYS.map((h) => ({
    label: h.label,
    recoveryDaysText: `${h.days}거래일`,
    probabilityText: `${opts.horizons[h.key]}%`,
  }))
  const forecast: JarooDeepScanRecoveryForecastBlock = {
    ...okMeta(),
    statusText: opts.statusText,
    summaryText: opts.summaryText,
    expectedRecoveryDaysText: `약 ${HORIZON_DAYS[1].days}거래일`,
    recoveryProbabilityText: `${opts.horizons['6m']}%`,
    confidenceText:
      opts.confidenceLevel === 'high' ? '높은 신뢰도' : opts.confidenceLevel === 'medium' ? '중간 신뢰도' : '낮은 신뢰도',
    currentPriceText: opts.priceText,
    targetPriceText: opts.targetText,
    drawdownText: opts.drawdownText,
    modelRows,
    disclaimer: '과거 유사 패턴 기반 추정치이며 실제 수익을 보장하지 않습니다.',
    currentPrice: opts.priceNumber,
    targetPrice: opts.targetNumber,
    expectedRecoveryDays: HORIZON_DAYS[1].days,
    recoveryProbabilityPct: opts.horizons['6m'],
    recoveryHorizonProbabilities: opts.horizons,
    recoveryProbabilityHeadlineText: `본전 회복 확률은 3개월 내 ${opts.horizons['3m']}%, 6개월 내 ${opts.horizons['6m']}%, 1년 내 ${opts.horizons['1y']}%입니다`,
    confidenceLevel: opts.confidenceLevel,
  }
  return { recoveryForecast: forecast }
}

// ---------------------------------------------------------------- 네이버 메인뉴스 풀 (공용 수집 — #369 discovery ①단계)
// 캐릭터 전원이 같은 뉴스 풀을 보고, 각자 성향으로 읽어 긍정 종목을 발굴한다.
// url mock: https://n.news.naver.com/article/{oid}/{aid}

export type Draft5NewsItem = {
  key: string
  stockName: string
  stockCode: string
  headline: string
  source: string
  oid: string
  aid: string
  publishedAt: string
}

export function newsUrl(item: Draft5NewsItem) {
  return `https://n.news.naver.com/article/${item.oid}/${item.aid}`
}

export const DRAFT5_NEWS: Record<string, Draft5NewsItem> = {
  'sam-hbm': {
    key: 'sam-hbm',
    stockName: '삼성전자',
    stockCode: '005930',
    headline: '삼성전자, HBM4 양산 준비 일정 유지 — 메모리 회복 기대감',
    source: '매일경제',
    oid: '009',
    aid: '0005372101',
    publishedAt: '2026-11-08 18:12',
  },
  'sam-div': {
    key: 'sam-div',
    stockName: '삼성전자',
    stockCode: '005930',
    headline: '삼성전자 배당 확대 기대에 수급 주목…자사주 소각 재점화',
    source: '한국경제',
    oid: '016',
    aid: '0005372044',
    publishedAt: '2026-11-08 20:41',
  },
  'sam-value': {
    key: 'sam-value',
    stockName: '삼성전자',
    stockCode: '005930',
    headline: '삼성전자 PER 역사적 하단권 진입…밸류 투자자 주목',
    source: '머니투데이',
    oid: '008',
    aid: '0005371888',
    publishedAt: '2026-11-09 07:40',
  },
  'sam-foreign': {
    key: 'sam-foreign',
    stockName: '삼성전자',
    stockCode: '005930',
    headline: '외국인 4일 연속 순매수 삼성전자…수급 개선 조짐',
    source: '매일경제',
    oid: '009',
    aid: '0005372318',
    publishedAt: '2026-11-13 16:20',
  },
  'hynix-hbm': {
    key: 'hynix-hbm',
    stockName: 'SK하이닉스',
    stockCode: '000660',
    headline: '엔비디아 차세대 플랫폼, HBM4 공급 확대 조건 합의 보도',
    source: '뉴시스',
    oid: '003',
    aid: '0002548902',
    publishedAt: '2026-11-08 21:05',
  },
  'hynix-high': {
    key: 'hynix-high',
    stockName: 'SK하이닉스',
    stockCode: '000660',
    headline: 'SK하이닉스 52주 신고가 눈앞…AI 메모리 수요 견조',
    source: '전자신문',
    oid: '011',
    aid: '0002549320',
    publishedAt: '2026-11-13 11:47',
  },
  'lg-ess': {
    key: 'lg-ess',
    stockName: 'LG에너지솔루션',
    stockCode: '373220',
    headline: 'LG에너지솔루션, ESS 수요 회복 기대에 반등 시도',
    source: '파이낸셜뉴스',
    oid: '014',
    aid: '0005369973',
    publishedAt: '2026-11-11 08:52',
  },
  'lg-value': {
    key: 'lg-value',
    stockName: 'LG에너지솔루션',
    stockCode: '373220',
    headline: '고점 대비 -23% LG엔솔…밸류에이션 부각에 저가 매수 눈길',
    source: '전자신문',
    oid: '011',
    aid: '0002549108',
    publishedAt: '2026-11-11 12:30',
  },
  'skt-dc': {
    key: 'skt-dc',
    stockName: 'SK텔레콤',
    stockCode: '017670',
    headline: 'SK텔레콤, AI 데이터센터 투자 확대…통신 3사 클라우드 경쟁 본격화',
    source: '아시아경제',
    oid: '017',
    aid: '0004289955',
    publishedAt: '2026-11-13 09:15',
  },
}

// ---------------------------------------------------------------- 리포트 4종 (발굴 종목에 실행한 deepscan 리포트 — #369 ③단계)

type ReportSpec = {
  key: Draft5ReportKey
  name: string
  code: string
  debugId: string
  generatedAt: string
  score: number
  scoreDelta: string
  headline: string
  heroBody: string
  evidenceFacts: string[]
  evidenceCautions: string[]
  priceNumber: number
  priceText: string
  targetNumber: number
  targetText: string
  drawdownText: string
  weekSignal: string
  weekSignalTone: string
  scenarioLabel: string
  scenarioProbability: string
  scenarioPeriod: string
  scenarioCondition: string
  otherScenarios: JarooDeepScanStrategyScenario[]
  horizons: Horizons
  confidenceLevel: ConfidenceLevel
  axes: AxisSpec[]
  insights: InsightSpec[]
  sellRows: JarooDeepScanSellNowRow[]
  realizedText: string
  simBefore: number
  simAfter: number
  simCaption: string
}

function mkReport(spec: ReportSpec): JarooDeepScanPayload {
  const strength = strengthOf(spec.score)
  return {
    input: {
      instrument: { name: spec.name, code: spec.code, market: 'KOSPI', kind: 'stock' },
      sourceContext: { from: 'holding', appliedAt: spec.generatedAt },
    },
    hero: {
      ...okMeta(),
      headline: spec.headline,
      body: spec.heroBody,
      statusText: strength.label,
      score: spec.score,
      scoreLabel: 'AI 종합 점수',
      scoreDelta: spec.scoreDelta,
      evidenceFacts: spec.evidenceFacts,
      evidenceCautions: spec.evidenceCautions,
    },
    committee: { ...okMeta(), axes: spec.axes.map(mkAxis) },
    ...mkInsights(spec.insights),
    strategy: {
      ...okMeta(),
      weekSignal: spec.weekSignal,
      weekSignalTone: spec.weekSignalTone,
      weekBadgeText: spec.weekSignal,
      scenarioLabel: spec.scenarioLabel,
      scenarioProbability: spec.scenarioProbability,
      scenarioPeriod: spec.scenarioPeriod,
      scenarioCondition: spec.scenarioCondition,
      currentPriceText: spec.priceText,
      targetPriceText: spec.targetText,
      scenarioDetails: [spec.scenarioCondition],
      otherScenarios: spec.otherScenarios,
      otherScenarioTags: spec.otherScenarios.map((s) => s.label),
    },
    ...mkRecoveryForecast({
      statusText: strength.label,
      summaryText: `${spec.name} ${spec.drawdownText} 구간. 6개월 내 본전 회복 확률은 ${spec.horizons['6m']}%입니다.`,
      priceText: spec.priceText,
      targetText: spec.targetText,
      drawdownText: spec.drawdownText,
      priceNumber: spec.priceNumber,
      targetNumber: spec.targetNumber,
      horizons: spec.horizons,
      confidenceLevel: spec.confidenceLevel,
    }),
    sellNow: { ...okMeta(), realizedText: spec.realizedText, rows: spec.sellRows },
    portfolioSimulation: {
      ...okMeta(),
      beforeScore: spec.simBefore,
      afterScore: spec.simAfter,
      deltaLabel: `${spec.simAfter - spec.simBefore >= 0 ? '+' : ''}${spec.simAfter - spec.simBefore}점`,
      caption: spec.simCaption,
    },
    metadata: {
      generatedAt: spec.generatedAt,
      version: 'deepscan-v2.4.1',
      degraded: false,
      debugId: spec.debugId,
      inputValidity: { valid: true },
      sourceRefs: [
        { type: 'holding', id: `hold-${spec.code}`, label: '사용자 보유 포트폴리오' },
        { type: 'market', id: `mkt-${spec.code}`, label: '시세·수급 데이터' },
      ],
      blockStatus: {
        hero: 'ok',
        committee: 'ok',
        insights: 'ok',
        strategy: 'ok',
        sellNow: 'ok',
        portfolioSimulation: 'ok',
      },
      llmCommittee: {
        requestId: `llc-${spec.debugId.toLowerCase()}`,
        status: 'complete',
        completed: 9,
        pending: 0,
        errors: 0,
      },
    },
  }
}

export const DRAFT5_REPORTS: Record<Draft5ReportKey, JarooDeepScanPayload> = {
  samsung: mkReport({
    key: 'samsung',
    name: '삼성전자',
    code: '005930',
    debugId: 'DS-20261113-005930-62F4',
    generatedAt: '2026-11-13T18:42:11+09:00',
    score: 62,
    scoreDelta: '전일 대비 +2',
    headline: '삼성전자 — 메모리 회복 기대와 밸류에이션 부담이 공존하는 중립+ 구간',
    heroBody:
      'HBM4 양산 준비와 3분기 메모리 실적 개선은 긍정적이나, 주가수익비가 5년 평균을 상회해 추가 상승 여력은 제한적입니다.',
    evidenceFacts: ['3분기 메모리 매출 전분기 대비 +12%', 'HBM4 양산 준비 일정 유지 보도', '외국인 4일 연속 순매수'],
    evidenceCautions: ['주가수익비(PER) 5년 평균 대비 +15% 수준'],
    priceNumber: 92150,
    priceText: '92,150원',
    targetNumber: 105000,
    targetText: '105,000원',
    drawdownText: '고점 대비 -8.2%',
    weekSignal: '중립+',
    weekSignalTone: 'flat',
    scenarioLabel: '보유 유지',
    scenarioProbability: '62%',
    scenarioPeriod: '4주',
    scenarioCondition: '92,000원 지지 유지 시 목표가 105,000원 접근',
    otherScenarios: [
      { label: '급반등', probability: '18%', condition: 'HBM4 양산 확정 보도 시' },
      { label: '급조정', probability: '20%', condition: '메모리 가격 인상분 반납 시' },
    ],
    horizons: { '3m': 34, '6m': 52, '1y': 61, '2y': 74, '3y': 81 },
    confidenceLevel: 'medium',
    axes: [
      {
        label: '시장 팀',
        score: 58,
        subtitle: '수급·모멘텀·밸류에이션 관점',
        members: [
          { shortLabel: '수급', title: '수급 분석 위원', score: 55, tone: 'neutral', iconTone: 'teal', confidence: 'medium', reason: '외국인 4일 연속 순매수지만 기관은 관망. 방향 확신은 아직 부족하다.' },
          { shortLabel: '밸류', title: '밸류에이션 위원', score: 48, tone: 'warning', iconTone: 'amber', confidence: 'high', reason: 'PER가 5년 평균을 15% 상회. 좋은 회사, 다소 비싼 가격 구간이다.' },
          { shortLabel: '모멘텀', title: '모멘텀 위원', score: 71, tone: 'positive', iconTone: 'red', confidence: 'medium', reason: '단기 이동평균선 위에서 거래량 동반 상승 중. 추세는 우호적.' },
        ],
      },
      {
        label: '맥락 팀',
        score: 60,
        subtitle: '뉴스·공시·업황 관점',
        members: [
          { shortLabel: '뉴스', title: '뉴스 분석 위원', score: 63, tone: 'neutral', iconTone: 'blue', confidence: 'medium', reason: 'HBM4 양산 일정 유지 보도가 긍정적. 정확한 검증은 대기 중.' },
          { shortLabel: '공시', title: '공시 분석 위원', score: 58, tone: 'neutral', iconTone: 'purple', confidence: 'high', reason: '최근 공시에 위험 문구 없음. 정기 공시 일정만 남았다.' },
          { shortLabel: '시황', title: '업황 분석 위원', score: 59, tone: 'neutral', iconTone: 'teal', confidence: 'medium', reason: '반도체 업황 지표는 중립. 메모리 가격 인상분 지속 여부가 관건.' },
        ],
      },
      {
        label: '펀더멘털 팀',
        score: 66,
        subtitle: '실적·재무·전망 관점',
        members: [
          { shortLabel: '실적', title: '실적 분석 위원', score: 72, tone: 'positive', iconTone: 'green', confidence: 'high', reason: '3분기 메모리 매출 전분기 대비 +12%. 마진 개선 흐름이 뚜렷하다.' },
          { shortLabel: '재무', title: '재무 분석 위원', score: 70, tone: 'positive', iconTone: 'green', confidence: 'high', reason: '부채비율 안정적, 영업현금흐름 양호. 재무 디스카운트 요인 없음.' },
          { shortLabel: '전망', title: '전망 분석 위원', score: 56, tone: 'neutral', iconTone: 'blue', confidence: 'medium', reason: '목표가 상향 띠지는 시작 단계. 본격 확인은 4분기 실적 이후.' },
        ],
      },
    ],
    insights: [
      {
        sourceType: 'news',
        sourceLabel: '언론 보도',
        date: '2026-11-13',
        label: 'HBM4',
        title: 'HBM4 양산 준비 일정 유지 — 4분기 초 여건 확인',
        body: '주요 언론사 보도 기준 HBM4 양산 준비가 예정대로 진행 중이며, 본격 매출 반영은 4분기부터로 분석됩니다.',
      },
      {
        sourceType: 'market',
        sourceLabel: '수급 동향',
        date: '2026-11-13',
        label: '외국인',
        title: '외국인 4일 연속 순매수, 기관은 관망세',
        body: '최근 4거래일 외국인 누적 순매수가 이어지며 수급 주체가 외국인 중심으로 재편되는 양상입니다.',
      },
    ],
    sellRows: [
      { label: '단기 손절 기준선', value: '86,400원 (-6.2%)' },
      { label: '수익 실현 구간', value: '102,000원 (+10.7%)' },
      { label: '포트폴리오 과열 경고', value: '해당 없음' },
    ],
    realizedText: '보유분 실현 우선순위: 중간',
    simBefore: 58,
    simAfter: 64,
    simCaption: '본 종목 비중 15% → 25% 조정 시 포트폴리오 점수 변화',
  }),

  hynix: mkReport({
    key: 'hynix',
    name: 'SK하이닉스',
    code: '000660',
    debugId: 'DS-20261109-000660-78A1',
    generatedAt: '2026-11-09T19:03:47+09:00',
    score: 78,
    scoreDelta: '전일 대비 +5',
    headline: 'SK하이닉스 — AI 메모리 수요 견조, 추세와 실적이 함께 우호적인 강세 구간',
    heroBody:
      '분기 매출 사상 최대, HBM4 공급 확대 보도, 외국인·기관 동반 순매수까지. 다만 단기 급등에 따른 변동성 확대는 감안해야 합니다.',
    evidenceFacts: ['분기 매출 사상 최대 갱신', 'HBM4 공급 확대 보도', '외국인·기관 동반 순매수'],
    evidenceCautions: ['단기 급등에 따른 일간 변동성 확대 가능'],
    priceNumber: 598000,
    priceText: '598,000원',
    targetNumber: 680000,
    targetText: '680,000원',
    drawdownText: '고점 대비 -5.1%',
    weekSignal: '강세',
    weekSignalTone: 'profit',
    scenarioLabel: '추세 순응',
    scenarioProbability: '54%',
    scenarioPeriod: '3주',
    scenarioCondition: '52주 최고가 돌파 유지 시 680,000원 시도',
    otherScenarios: [
      { label: '눌림목', probability: '31%', condition: '590,000원 지지 확인 시' },
      { label: '추세 이탈', probability: '15%', condition: '570,000원 하회 시' },
    ],
    horizons: { '3m': 62, '6m': 78, '1y': 85, '2y': 92, '3y': 95 },
    confidenceLevel: 'high',
    axes: [
      {
        label: '시장 팀',
        score: 76,
        subtitle: '수급·모멘텀·밸류에이션 관점',
        members: [
          { shortLabel: '수급', title: '수급 분석 위원', score: 80, tone: 'positive', iconTone: 'red', confidence: 'high', reason: '외국인·기관 동반 순매수. 수급 주체가 무게중심을 잡고 있다.' },
          { shortLabel: '밸류', title: '밸류에이션 위원', score: 66, tone: 'neutral', iconTone: 'amber', confidence: 'medium', reason: '기준 PER로는 비싸 보이나 성장률이 고평가분을 흡수 중.' },
          { shortLabel: '모멘텀', title: '모멘텀 위원', score: 82, tone: 'positive', iconTone: 'red', confidence: 'high', reason: '52주 신고가 근접, 거래량 급증 동반. 추세 강하다.' },
        ],
      },
      {
        label: '맥락 팀',
        score: 74,
        subtitle: '뉴스·공시·업황 관점',
        members: [
          { shortLabel: '뉴스', title: '뉴스 분석 위원', score: 78, tone: 'positive', iconTone: 'blue', confidence: 'high', reason: 'HBM4 공급 확대 관련 보도가 지속 유의미하게 쌓이는 중.' },
          { shortLabel: '공시', title: '공시 분석 위원', score: 71, tone: 'neutral', iconTone: 'purple', confidence: 'high', reason: '유상증자 등 이벤트성 공시 없음. 공시 리스크 낮다.' },
          { shortLabel: '시황', title: '업황 분석 위원', score: 73, tone: 'positive', iconTone: 'teal', confidence: 'medium', reason: 'AI 메모리 수요 전망이 업계 잇따라 상향 조정됨.' },
        ],
      },
      {
        label: '펀더멘털 팀',
        score: 81,
        subtitle: '실적·재무·전망 관점',
        members: [
          { shortLabel: '실적', title: '실적 분석 위원', score: 84, tone: 'positive', iconTone: 'green', confidence: 'high', reason: '분기 매출 사상 최대, DRAM 위주 마진 급증. 실적 모멘텀 강력.' },
          { shortLabel: '재무', title: '재무 분석 위원', score: 79, tone: 'positive', iconTone: 'green', confidence: 'high', reason: '순부채 감소와 자본잉여 확대로 재무 체력이 개선됐다.' },
          { shortLabel: '전망', title: '전망 분석 위원', score: 80, tone: 'positive', iconTone: 'blue', confidence: 'medium', reason: '다음 분기 가이던스 상향 가능성. 컨센서스 상방 수정 여지.' },
        ],
      },
    ],
    insights: [
      {
        sourceType: 'news',
        sourceLabel: '언론 보도',
        date: '2026-11-09',
        label: 'HBM4',
        title: 'HBM4 공급 확대 — 차세대 AI 가속기와 함께 물량 확정 보도',
        body: 'AI 가속기 차세대 플랫폼에 HBM4 공급이 확대되는 방향으로 공급 계약 물량 확정 보도가 이어지고 있습니다.',
      },
      {
        sourceType: 'report',
        sourceLabel: '증권사 리포트',
        date: '2026-11-09',
        label: '목표가',
        title: '주요 증권사 목표가 상향 조정 지속',
        body: '최근 일주일 세 증권사가 목표가를 660,000~690,000원으로 상향, 컨센서스 상방 수정이 진행 중입니다.',
      },
    ],
    sellRows: [
      { label: '단기 손절 기준선', value: '554,000원 (-7.4%)' },
      { label: '수익 실현 구간', value: '666,000원 (+11.4%)' },
      { label: '포트폴리오 과열 경고', value: '단일 종목 비중 30% 초과 시' },
    ],
    realizedText: '보유분 실현 우선순위: 낮음 (추세 유지)',
    simBefore: 61,
    simAfter: 69,
    simCaption: '본 종목 비중 10% → 20% 조정 시 포트폴리오 점수 변화',
  }),

  lge: mkReport({
    key: 'lge',
    name: 'LG에너지솔루션',
    code: '373220',
    debugId: 'DS-20261111-373220-41B7',
    generatedAt: '2026-11-11T18:55:02+09:00',
    score: 41,
    scoreDelta: '전일 대비 -3',
    headline: 'LG에너지솔루션 — ESS 수요 둔화와 실적 하향 리스크가 부과하는 주의 구간',
    heroBody:
      '고점 대비 -23.4% 조정에도 불구하고 실적 가이던스 하향과 수급 부담이 남아 있습니다. 반등 신호 확인 전 관망이 우선입니다.',
    evidenceFacts: ['외국인 9일 연속 순매도', 'ESS 수요 둔화 보도', '3분기 영업이익 컨센서스 하향'],
    evidenceCautions: ['고점 대비 -23.4% 하락 추세 지속 중'],
    priceNumber: 412500,
    priceText: '412,500원',
    targetNumber: 465000,
    targetText: '465,000원',
    drawdownText: '고점 대비 -23.4%',
    weekSignal: '주의',
    weekSignalTone: 'loss',
    scenarioLabel: '관망 후 분할 접근',
    scenarioProbability: '41%',
    scenarioPeriod: '6주',
    scenarioCondition: '400,000원 지지 확인 후 반등 신호 출현 시 분할 매수',
    otherScenarios: [
      { label: '추가 하락', probability: '38%', condition: '380,000원 하회 시' },
      { label: 'V자 반등', probability: '21%', condition: 'IRA 후원 확정 호재 방송 시' },
    ],
    horizons: { '3m': 18, '6m': 29, '1y': 37, '2y': 52, '3y': 58 },
    confidenceLevel: 'low',
    axes: [
      {
        label: '시장 팀',
        score: 44,
        subtitle: '수급·모멘텀·밸류에이션 관점',
        members: [
          { shortLabel: '수급', title: '수급 분석 위원', score: 38, tone: 'warning', iconTone: 'amber', confidence: 'high', reason: '외국인 9일 연속 순매도. 수급 부담이 아직 풀리지 않았다.' },
          { shortLabel: '밸류', title: '밸류에이션 위원', score: 52, tone: 'neutral', iconTone: 'teal', confidence: 'medium', reason: '고평가 해소가 진행 중이나 여전히 역사적 평균 상단이다.' },
          { shortLabel: '모멘텀', title: '모멘텀 위원', score: 42, tone: 'warning', iconTone: 'amber', confidence: 'medium', reason: '하락 추세 유지 중. 반등 신호는 아직 미약하다.' },
        ],
      },
      {
        label: '맥락 팀',
        score: 40,
        subtitle: '뉴스·공시·업황 관점',
        members: [
          { shortLabel: '뉴스', title: '뉴스 분석 위원', score: 44, tone: 'warning', iconTone: 'blue', confidence: 'medium', reason: '미국 정책 관련 불확실성 보도가 지속되고 있다.' },
          { shortLabel: '공시', title: '공시 분석 위원', score: 39, tone: 'warning', iconTone: 'purple', confidence: 'high', reason: '주요사항보고 공시가 다수 접수돼 내용 확인이 필요하다.' },
          { shortLabel: '시황', title: '업황 분석 위원', score: 37, tone: 'warning', iconTone: 'teal', confidence: 'medium', reason: 'ESS 수요 둔화와 배터리 캐즘 논의가 업황을 누르고 있다.' },
        ],
      },
      {
        label: '펀더멘털 팀',
        score: 39,
        subtitle: '실적·재무·전망 관점',
        members: [
          { shortLabel: '실적', title: '실적 분석 위원', score: 41, tone: 'warning', iconTone: 'amber', confidence: 'medium', reason: '운송용·ESS 수요 감소로 이익 추정치가 하향 조정됐다.' },
          { shortLabel: '재무', title: '재무 분석 위원', score: 45, tone: 'neutral', iconTone: 'green', confidence: 'high', reason: '현금성 자산이 풍부해 단기 유동성 리스크는 낮다.' },
          { shortLabel: '전망', title: '전망 분석 위원', score: 31, tone: 'warning', iconTone: 'amber', confidence: 'low', reason: '내년 가이던스 하향 리스크가 상존한다. 확인 전 신중함이 필요.' },
        ],
      },
    ],
    insights: [
      {
        sourceType: 'news',
        sourceLabel: '언론 보도',
        date: '2026-11-11',
        label: '수급',
        title: '외국인 9일 연속 순매도 — 수급 부담 지속',
        body: '외국인 투자자의 순매도가 9거래일 연속 이어지며 주가 회복의 발목을 잡고 있습니다.',
      },
      {
        sourceType: 'report',
        sourceLabel: '증권사 리포트',
        date: '2026-11-11',
        label: '실적',
        title: '3분기 영업이익 컨센서스 하향 조정',
        body: 'ESS 수요 둔화 영향으로 주요 증권사의 3분기 영업이익 추정치가 평균 -12% 하향 조정됐습니다.',
      },
    ],
    sellRows: [
      { label: '단기 손절 기준선', value: '383,000원 (-7.2%)', tag: '주의', tagTone: 'danger', valueTone: 'danger' },
      { label: '수익 실현 구간', value: '465,000원 (+12.7%)' },
      { label: '포트폴리오 과열 경고', value: '해당 없음' },
    ],
    realizedText: '보유분 실현 우선순위: 높음 (하락 추세 지속)',
    simBefore: 63,
    simAfter: 66,
    simCaption: '본 종목 비중 20% → 8% 축소 시 포트폴리오 점수 변화',
  }),

  // 발굴됐지만 성향 문턱 미달로 관망(PASS)한 종목 — deepscan 보수성 입증용 시나리오
  sktelcom: mkReport({
    key: 'sktelcom',
    name: 'SK텔레콤',
    code: '017670',
    debugId: 'DS-20261113-017670-38C2',
    generatedAt: '2026-11-13T09:31:26+09:00',
    score: 38,
    scoreDelta: '전일 대비 +1',
    headline: 'SK텔레콤 — AI 데이터센터 기대에도 실적 성장성 제약이 남는 주의 구간',
    heroBody:
      'AI 데이터센터·클라우드 확대 소식은 긍정적이나 본업 통신 실적은 정체, 투자 확대에 따른 현금흐름 부담이 함께 관찰됩니다.',
    evidenceFacts: ['AI 데이터센터 투자 확대 보도', '5G 본업 매출 성장률 1%대 정체', '통신 3사 클라우드 경쟁 심화'],
    evidenceCautions: ['대규모 투자에 따른 현금흐름 부담'],
    priceNumber: 58400,
    priceText: '58,400원',
    targetNumber: 72000,
    targetText: '72,000원',
    drawdownText: '고점 대비 -9.1%',
    weekSignal: '주의',
    weekSignalTone: 'loss',
    scenarioLabel: '관망 후 조건 확인',
    scenarioProbability: '39%',
    scenarioPeriod: '6주',
    scenarioCondition: 'AI 투자 성과 가시화 + 62,000원 회복 확인 시 재검토',
    otherScenarios: [
      { label: '반등', probability: '26%', condition: 'AI 투자 성과 가시화 시' },
      { label: '추가 조정', probability: '35%', condition: '본업 마진 축소 시' },
    ],
    horizons: { '3m': 21, '6m': 33, '1y': 41, '2y': 55, '3y': 63 },
    confidenceLevel: 'low',
    axes: [
      {
        label: '시장 팀',
        score: 41,
        subtitle: '수급·모멘텀·밸류에이션 관점',
        members: [
          { shortLabel: '수급', title: '수급 분석 위원', score: 39, tone: 'warning', iconTone: 'amber', confidence: 'medium', reason: '기관·외국인 모두 중립. 뚜렷한 수급 주체가 부재하다.' },
          { shortLabel: '밸류', title: '밸류에이션 위원', score: 47, tone: 'neutral', iconTone: 'teal', confidence: 'medium', reason: 'PER는 낮지만 성장성 부재로 리레이팅 재료가 약하다.' },
          { shortLabel: '모멘텀', title: '모멘텀 위원', score: 37, tone: 'warning', iconTone: 'amber', confidence: 'medium', reason: '횡보 박스권 지속. 추세 신호가 없다.' },
        ],
      },
      {
        label: '맥락 팀',
        score: 36,
        subtitle: '뉴스·공시·업황 관점',
        members: [
          { shortLabel: '뉴스', title: '뉴스 분석 위원', score: 44, tone: 'neutral', iconTone: 'blue', confidence: 'medium', reason: 'AI 데이터센터 투자 확대 보도는 긍정적. 성과 가시화는 시간이 필요하다.' },
          { shortLabel: '공시', title: '공시 분석 위원', score: 33, tone: 'warning', iconTone: 'purple', confidence: 'high', reason: '대규모 투자 결정 공시 접수 — 자본재 확인이 필요한 구간이다.' },
          { shortLabel: '시황', title: '업황 분석 위원', score: 31, tone: 'warning', iconTone: 'teal', confidence: 'medium', reason: '통신 3사 클라우드 경쟁 심화로 마진 압박이 지속된다.' },
        ],
      },
      {
        label: '펀더멘털 팀',
        score: 37,
        subtitle: '실적·재무·전망 관점',
        members: [
          { shortLabel: '실적', title: '실적 분석 위원', score: 39, tone: 'warning', iconTone: 'amber', confidence: 'medium', reason: '본업 매출은 미세 성장에 그치고 마진이 정체 중이다.' },
          { shortLabel: '재무', title: '재무 분석 위원', score: 52, tone: 'neutral', iconTone: 'green', confidence: 'high', reason: '현금성 자산이 풍부하고 배당 여력은 유지 중이다.' },
          { shortLabel: '전망', title: '전망 분석 위원', score: 20, tone: 'warning', iconTone: 'amber', confidence: 'low', reason: 'AI 투자 회수 시점이 불확실하다. 가이던스 하방 리스크.' },
        ],
      },
    ],
    insights: [
      {
        sourceType: 'news',
        sourceLabel: '언론 보도',
        date: '2026-11-13',
        label: 'AI 데이터센터',
        title: 'SK텔레콤 AI 데이터센터 투자 확대 — 성과 가시화는 2027년 이후 전망',
        body: 'AI 데이터센터 투자 확대 발표는 긍정적이나, 본업 통신 실적 정체 속에서 실제 이익 기여는 2027년 이후로 분석됩니다.',
      },
      {
        sourceType: 'market',
        sourceLabel: '수급 동향',
        date: '2026-11-13',
        label: '중립 수급',
        title: '기관·외국인 모두 중립적 수급',
        body: '투자 확대 보도에도 수급 주체가 뚜렷하게 기울지 않아 단기 모멘텀은 약한 상황입니다.',
      },
    ],
    sellRows: [
      { label: '단기 손절 기준선', value: '54,200원 (-7.2%)' },
      { label: '수익 실현 구간', value: '65,000원 (+11.3%)' },
      { label: '포트폴리오 과열 경고', value: '해당 없음' },
    ],
    realizedText: '신규 진입 우선순위: 낮음 (문턱 미달 관망 권고)',
    simBefore: 60,
    simAfter: 62,
    simCaption: '본 종목 신규 편입 5% 시 포트폴리오 점수 변화',
  }),
}

// ---------------------------------------------------------------- 판단 로그 / 체결 / 일기 타입

export type Draft5Execution = {
  /** KST 체결 시각 */
  at: string
  side: 'BUY' | 'SELL'
  name: string
  code: string
  qty: number
  price: number
  amount: number
  fee: number
  orderId: string
}

export type Draft5AccountSnapshot = {
  cash: number
  principal: number
  evaluation: number
  returnRatePct: number
}

/** #369: 판단 로그 fact — 발굴 근거(candidateSource) + 리포트 근거가 한 세트 */
export type Draft5JudgmentLog = {
  reportKey: Draft5ReportKey
  debugId: string
  generatedAt: string
  heroScore: number
  recoveryPct: number | null
  targetPrice: number | null
  reasonCode: string
  /** 발굴 출발점 — 어떤 뉴스로 이 종목을 봤는지 (DRAFT5_NEWS 키) */
  candidateSource: { type: 'news'; newsKey: string }
}

/** A안 게이트 — 리포트가 성향 문턱(minHeroScore)을 통과해야 매수 */
export type Draft5Gate = {
  minHeroScore: number
}

/** 점수 기반 sizing 힌트 — 통과 시 점수가 높을수록 큰 비중, 애매하면 반 티켓 */
export type Draft5Sizing = {
  label: '큰 비중' | '중간 비중' | '반 티켓' | '일부 실현'
  note: string
}

export type Draft5DiaryEntry = {
  id: string
  dateLabel: string
  weekday: string
  mood: string
  paragraphs: string[]
  executions: Draft5Execution[]
  skipped: boolean
  skipReason: string
  account: Draft5AccountSnapshot
  judgment: Draft5JudgmentLog
  gate: Draft5Gate
  sizing: Draft5Sizing | null
}

export type Draft5Weekly = {
  returnPct: number
  startAsset: number
  endAsset: number
  tradeCount: number
  totalFee: number
  quote: string
  goal: {
    label: string
    current: number
    target: number
    unit: 'krw' | 'pct'
    caption: string
  }
}

export type Draft5Character = {
  key: string
  name: string
  emoji: string
  avatarBg: string
  roleLabel: string
  /** A안 게이트 — 성향 문턱 (예: 소심이 minHeroScore 55) */
  minHeroScore: number
  philosophy: string
  weekly: Draft5Weekly
  entries: Draft5DiaryEntry[]
}

function mkJudgment(reportKey: Draft5ReportKey, generatedAt: string, reasonCode: string, newsKey: string, horizon: '3m' | '6m' | '1y' = '6m'): Draft5JudgmentLog {
  const report = DRAFT5_REPORTS[reportKey]
  return {
    reportKey,
    debugId: report.metadata.debugId,
    generatedAt,
    heroScore: report.hero.score,
    recoveryPct: report.recoveryForecast?.recoveryHorizonProbabilities?.[horizon] ?? null,
    targetPrice: report.recoveryForecast?.targetPrice ?? null,
    reasonCode,
    candidateSource: { type: 'news', newsKey },
  }
}

// ---------------------------------------------------------------- 캐릭터 4명 (성향 문턱 확정 — A안 게이트)

export const DRAFT5_WEEK_RANGE_LABEL = '11/9–11/13'

export const DRAFT5_CHARACTERS: Draft5Character[] = [
  {
    key: 'sosim',
    name: '소심이',
    emoji: '🐰',
    avatarBg: 'bg-[#fde7ef]',
    roleLabel: '안정형 · 제주도 여행자금 모으는 중',
    minHeroScore: 55,
    philosophy: '잃는 게 제일 무서워. 반만 사도 심장은 뛰어.',
    weekly: {
      returnPct: 1.4,
      startAsset: 2077000,
      endAsset: 2106109,
      tradeCount: 2,
      totalFee: 41,
      quote: '겁 때문에 반만 샀는데, 반도 내 계좌에서는 용감한 일이었어.',
      goal: { label: '제주도 여행자금', current: 2106109, target: 2300000, unit: 'krw', caption: '목표 230만원' },
    },
    entries: [
      {
        id: 'sosim-1109',
        dateLabel: '11월 9일',
        weekday: '월',
        mood: '😰',
        paragraphs: [
          '월요일 아침, 뉴스에서 "삼성전자 HBM4 양산 준비 일정 유지" 기사를 봤어. 큰 회사 얘기라 그나마 안전할 것 같아서 바로 deepscan 돌렸더니 62점! 내 기준 55점은 넘었어. 근데 위원회 한 분은 48점을 주셨어.',
          '62점이면 사도 되는 점수 맞지? 무서워서 점수 낮게 판단한 반 티켓, 딱 2주만 샀어. 여행자금인데 잃으면 진짜 어떡해. 18만원이면 제주 비행기 왕복 두 장인데. 눈 감고 떨어지지 말아주세요.',
        ],
        executions: [
          { at: '2026-11-09 10:32', side: 'BUY', name: '삼성전자', code: '005930', qty: 2, price: 91200, amount: 182400, fee: 27, orderId: 'ORD-20261109-85271-01' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 1917573, principal: 182400, evaluation: 183000, returnRatePct: 0.33 },
        judgment: mkJudgment('samsung', '2026-11-09T10:31:58+09:00', 'RC-005930-S62-B55-BUY-HALF', 'sam-hbm'),
        gate: { minHeroScore: 55 },
        sizing: { label: '반 티켓', note: '62점 — 문턱은 넘었지만 애매 구간이라 절반만' },
      },
      {
        id: 'sosim-1111',
        dateLabel: '11월 11일',
        weekday: '수',
        mood: '😥',
        paragraphs: [
          '오늘 뉴스에서 "LG엔솔 ESS 수요 회복 기대" 기사가 좋아 보였어. 좋아 보이니까 바로 deepscan… 했는데 41점. 내 기준 55점에 14점이나 모자라.',
          '고점 대비 -23%라는 숫자도 무섭고… 뉴스가 아무리 좋아 보여도 리포트가 문턱을 못 넘으면 못 사는 거야. 안 사서 수수료 0원 아꼈어. 여행자금은 소중하니까. 역시 못 사겠어 😰',
        ],
        executions: [],
        skipped: true,
        skipReason: '뉴스에서 좋았는데 hero 41 < 내 기준 55 — 문턱 미달 관망',
        account: { cash: 1917573, principal: 182400, evaluation: 180600, returnRatePct: -0.99 },
        judgment: mkJudgment('lge', '2026-11-11T09:47:03+09:00', 'RC-373220-S41-B55-SKIP-GATE', 'lg-ess'),
        gate: { minHeroScore: 55 },
        sizing: null,
      },
      {
        id: 'sosim-1113',
        dateLabel: '11월 13일',
        weekday: '금',
        mood: '🥹',
        paragraphs: [
          '금요일 뉴스에서 "외국인 4일 연속 순매수 삼성전자"라길래 좋아서 deepscan 다시 돌렸어. 62점 유지! 문턱 통과 재확인.',
          '이번엔 조금 자신 있게 1주 더 샀어. 반 티켓에서 아주 조금 키운 거지? 나 성장한 거야. 이제 여행자금이 210만원 — 230만원까지 아주 조금 남았어. 제주도 비행기 티켓, 사고 싶어.',
        ],
        executions: [
          { at: '2026-11-13 15:05', side: 'BUY', name: '삼성전자', code: '005930', qty: 1, price: 93750, amount: 93750, fee: 14, orderId: 'ORD-20261113-41205-01' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 1823809, principal: 276150, evaluation: 282300, returnRatePct: 2.23 },
        judgment: mkJudgment('samsung', '2026-11-13T15:04:40+09:00', 'RC-005930-S62-B55-BUY-ADD1', 'sam-foreign'),
        gate: { minHeroScore: 55 },
        sizing: { label: '반 티켓', note: '재통과 확인 후 소폭 추매 — 원래 겁 많음' },
      },
    ],
  },
  {
    key: 'doljin',
    name: '돌진이',
    emoji: '🐂',
    avatarBg: 'bg-[#fdeed8]',
    roleLabel: '공격형 · 21살 대학생',
    minHeroScore: 35,
    philosophy: '계좌는 젊을 때 흔들어야 실력 난다.',
    weekly: {
      returnPct: 3.0,
      startAsset: 2390000,
      endAsset: 2461197,
      tradeCount: 3,
      totalFee: 303,
      quote: '떨어지는 건 주가지, 내 계절이 아니야.',
      goal: { label: '봄 시동금', current: 2461197, target: 3000000, unit: 'krw', caption: '목표 300만원' },
    },
    entries: [
      {
        id: 'doljin-1109',
        dateLabel: '11월 9일',
        weekday: '월',
        mood: '🔥',
        paragraphs: [
          '아침부터 뉴스 터짐: 엔비디아 차세대 플랫폼 HBM4 공급 확대 조건 합의?! 바로 SK하이닉스 deepscan → 78점!! 내 문턱 35점 압도적 통과. 점수 높으면 큰 비중이라고 배웠다.',
          '알바비 58만 5천원, 1주에 전부 투입. 교수님은 분산투자 하래… 나랑 SK하이닉스 둘이면 분산 아님? 78점짜리 리포트가 내 편이다. 다음 주까지 안 오르면 내가 굶는다.',
        ],
        executions: [
          { at: '2026-11-09 09:57', side: 'BUY', name: 'SK하이닉스', code: '000660', qty: 1, price: 585000, amount: 585000, fee: 88, orderId: 'ORD-20261109-90244-01' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 1864912, principal: 585000, evaluation: 588000, returnRatePct: 0.51 },
        judgment: mkJudgment('hynix', '2026-11-09T09:55:31+09:00', 'RC-000660-S78-B35-BUY-BIG', 'hynix-hbm'),
        gate: { minHeroScore: 35 },
        sizing: { label: '큰 비중', note: '78점 — 문턱 35 대비 +43, 규칙상 최대 비중' },
      },
      {
        id: 'doljin-1111',
        dateLabel: '11월 11일',
        weekday: '수',
        mood: '😤',
        paragraphs: [
          'LG엔솔 ESS 회복 기사 봄. 발굴해서 deepscan 돌려보니 41점 — 내 문턱 35는 넘는데 딱 애매한 점수야.',
          '규칙은 규칙: 애매하면 반 티켓. 2주만 담았다. 방금 등록금 고지서도 봤는데 어차피 떨어질 건 학비였다. 이건 인생 역전 구간. 남들은 겁먹을 때 사라고 선생님들이 그랬잖아.',
        ],
        executions: [
          { at: '2026-11-11 14:22', side: 'BUY', name: 'LG에너지솔루션', code: '373220', qty: 2, price: 418000, amount: 836000, fee: 125, orderId: 'ORD-20261111-77310-02' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 1028787, principal: 1421000, evaluation: 1416000, returnRatePct: -0.35 },
        judgment: mkJudgment('lge', '2026-11-11T14:20:44+09:00', 'RC-373220-S41-B35-BUY-HALF', 'lg-ess'),
        gate: { minHeroScore: 35 },
        sizing: { label: '반 티켓', note: '41점 — 통과했지만 애매 구간, 절반만' },
      },
      {
        id: 'doljin-1113',
        dateLabel: '11월 13일',
        weekday: '금',
        mood: '😎',
        paragraphs: [
          'SK하이닉스 52주 신고가 눈앞 기사. 리포트 재확인 — 78점, 여전히 문턱 통과 상태다.',
          '58만 5천원에 산 게 60만 1,500원. +16,500원… 치킨 두 마리다. 일부 실현 각: 1주 팔고 반은 계속 달린다. 미래의 나, 미안하지만 지금의 나부터 좀 자자.',
        ],
        executions: [
          { at: '2026-11-13 10:41', side: 'SELL', name: 'SK하이닉스', code: '000660', qty: 1, price: 601500, amount: 601500, fee: 90, orderId: 'ORD-20261113-50188-01' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 1630197, principal: 836000, evaluation: 831000, returnRatePct: -0.6 },
        judgment: mkJudgment('hynix', '2026-11-13T10:40:12+09:00', 'RC-000660-S78-B35-SELL-HALF', 'hynix-high'),
        gate: { minHeroScore: 35 },
        sizing: { label: '일부 실현', note: '문턱 통과 유지 — 절반만 익절' },
      },
    ],
  },
  {
    key: 'baedang',
    name: '배당콕',
    emoji: '🐔',
    avatarBg: 'bg-[#e2f3ee]',
    roleLabel: '배당 선호형 · 퇴직 준비 4년 전',
    minHeroScore: 50,
    philosophy: '주가는 날씨고, 배당은 계절이다.',
    weekly: {
      returnPct: 0.9,
      startAsset: 3798000,
      endAsset: 3832822,
      tradeCount: 2,
      totalFee: 178,
      quote: '주식은 오래 갖는 것, 배당은 매달 오는 것이다.',
      goal: { label: '연 배당금', current: 410000, target: 600000, unit: 'krw', caption: '목표 연 60만원' },
    },
    entries: [
      {
        id: 'baedang-1109',
        dateLabel: '11월 9일',
        weekday: '월',
        mood: '🙂',
        paragraphs: [
          '아침 뉴스에서 삼성전자 배당 확대 기대 기사. 성향대로 바로 deepscan → 62점, 내 기준 50점 통과. 배당 있는 종목이 문턱까지 넘으면 사는 것이다.',
          '중간 비중 10주 매수. 연 2만원쯤 배당이 들어오겠지. 젊을 땐 90점 아니면 안 사던 내가, 퇴직 4년 전엔 62점도 90점으로 보인다. 인간은 환경의 동물이다.',
        ],
        executions: [
          { at: '2026-11-09 10:08', side: 'BUY', name: '삼성전자', code: '005930', qty: 10, price: 90800, amount: 908000, fee: 136, orderId: 'ORD-20261109-31207-01' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 2891864, principal: 908000, evaluation: 912000, returnRatePct: 0.44 },
        judgment: mkJudgment('samsung', '2026-11-09T10:06:52+09:00', 'RC-005930-S62-B50-BUY-DIV10', 'sam-div'),
        gate: { minHeroScore: 50 },
        sizing: { label: '중간 비중', note: '62점 통과 — 배당 재무 근거로 중간 비중' },
      },
      {
        id: 'baedang-1111',
        dateLabel: '11월 11일',
        weekday: '수',
        mood: '☕',
        paragraphs: [
          'LG엔솔 ESS 기사가 나름 좋아 보여 deepscan. 41점 — 내 문턱 50에 미달. 게다가 배당 없는 종목은 내 계좌의 실직자다.',
          '뉴스가 아무리 좋아도 리포트가 안 넘어가면 못 산다. 오늘 한 일: 커피 한 잔, 리포트 세 개 읽기. 거래 내역: 없음. 만족스럽다. 퇴직 준비는 속도전이 아니라 숨고르기다.',
        ],
        executions: [],
        skipped: true,
        skipReason: 'hero 41 < 내 기준 50 — 문턱 미달 + 무배당 이중 관망',
        account: { cash: 2891864, principal: 908000, evaluation: 903000, returnRatePct: -0.55 },
        judgment: mkJudgment('lge', '2026-11-11T10:21:07+09:00', 'RC-373220-S41-B50-SKIP-GATE', 'lg-ess'),
        gate: { minHeroScore: 50 },
        sizing: null,
      },
      {
        id: 'baedang-1113',
        dateLabel: '11월 13일',
        weekday: '금',
        mood: '🧘',
        paragraphs: [
          '외국인 삼성전자 순매수 뉴스. 62점, 문턱 통과 유지라 보유는 계속 간다.',
          '3주 부분 실현으로 28만원대 현금을 확보했다. 이 돈은 다음 배당 주기 때 다시 투입할 예비역이다. 연배당 60만원까지 41만원 — 절반을 넘었다. 젊은 트레이더들은 이런 걸 왜 안 하는지 모르겠다. 기다림이 돈이 되는 일이 흔치 않다.',
        ],
        executions: [
          { at: '2026-11-13 14:48', side: 'SELL', name: '삼성전자', code: '005930', qty: 3, price: 94100, amount: 282300, fee: 42, orderId: 'ORD-20261113-66031-01' },
        ],
        skipped: false,
        skipReason: '',
        account: { cash: 3174122, principal: 635600, evaluation: 658700, returnRatePct: 3.63 },
        judgment: mkJudgment('samsung', '2026-11-13T14:46:38+09:00', 'RC-005930-S62-B50-SELL-TRIM3', 'sam-foreign'),
        gate: { minHeroScore: 50 },
        sizing: { label: '일부 실현', note: '통과 유지 — 배당 재투자 대기 물량만 확보' },
      },
    ],
  },
]

// ---------------------------------------------------------------- 표시용 포맷터

export function fmtKrw(n: number) {
  return `${n.toLocaleString('ko-KR')}원`
}

export function fmtSigned(n: number, digits = 2) {
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`
}

export function fmtManwon(n: number) {
  return `${Math.round(n / 10000).toLocaleString('ko-KR')}만원`
}

/** 데이터 색 규율(#266): 강세=profit(빨강), 중립=flat(녹색), 주의=loss(파랑) */
export function scoreToneClass(score: number) {
  if (score >= 67) return 'text-[color:var(--jaroo-profit)]'
  if (score >= 45) return 'text-[color:var(--jaroo-flat)]'
  return 'text-[color:var(--jaroo-loss)]'
}

export function sideLabelClass(side: Draft5Execution['side']) {
  return side === 'BUY'
    ? 'text-[color:var(--jaroo-profit)]'
    : 'text-[color:var(--jaroo-loss)]'
}

/** A안 게이트 판정 — 리포트 점수가 성향 문턱을 통과했는지 */
export function gatePassed(entry: Draft5DiaryEntry) {
  return entry.judgment.heroScore >= entry.gate.minHeroScore
}
