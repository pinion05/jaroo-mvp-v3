// 도메인 타입 — 순수 데이터만 둔다.
//
// 책임 분해 (spec 2026-11-16 §3):
//   - 시세: quotes provider (web API = deepscan/crawler 소유) — 이 워커가 조회해서 주문에 실어 보낸다
//   - 원장·체결 사실: paper-trade 소유 (quote ZERO, egress 0 불변)
//   - 판단·서사: 이 워커 소유 (전략 규칙은 결정론적 코드, 서사는 템플릿 → Phase 2 LLM)
//
// 돈 표현 규칙 (paper-trade 계승): 금액·가격 = 원 단위 정수(number).
// 비율(returnPct·changePct·maxPositionPct) = 소수(-0.06 = -6%).

/** 페르소나 카드 — 성향×사연×세계관(2026-11-10 회의)의 구조화. 서사 원재료. */
export type PersonaCard = {
  /** 성향 라벨 — 금투협 5단계 기반 (예: '안정형') */
  temperament: string
  /** 세계관 목표 서사 (예: '여행자금 230만원 모으기') */
  narrativeGoal: string
  /** 집착/버릇 키워드 — 기억 컴파일 재료 (Phase 2) */
  obsessions: string[]
  /** 결정 유형별 말투 접두사 — Phase 1 템플릿 서사에 적용 */
  voice: { buy: string; sell: string; hold: string }
}

/** 성향 파라미터 — 규칙 엔진의 전부. LLM은 매매를 결정하지 않는다(spec D7). */
export type StrategyParams = {
  /** 종목당 최대 비중 (총자산 대비) */
  maxPositionPct: number
  /** 손절 기준 (평단 대비 하락률, 양수로 표기: 0.05 = -5%) */
  maxDrawdownPct: number
  /** 익절 기준 (평단 대비 상승률, 0.08 = +8%) */
  takeProfitPct: number
  /** 보유 종목 수 상한 */
  maxSymbols: number
  /** 매매 빈도 상한 — 매수만 제한, 손절은 항상 허용(리스크 관리 대기 없음) */
  tradeFrequency: 'daily' | 'weekly'
  /** 하루 등락률이 이 값 이하일 때만 매수 (-0.03 = -3% 이하). 시세 소스에 등락률이 없으면 게이트 생략 */
  buyDipPct: number
}

export type WatchItem = { symbol: string; name: string }

/** 캐릭터 = 계좌 1개 (spec D1) — 모든 유저가 동일한 상태를 봄. user_id 없음. */
export type Character = {
  slug: string
  displayName: string
  personaCard: PersonaCard
  strategyParams: StrategyParams
  watchlist: WatchItem[]
  initialCashKrw: number
  cashGoalKrw: number | null
  paperTradeAccountId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type Quote = {
  symbol: string
  priceKrw: number
  /** 하루 등락률 (소수). 현재 시세 소스가 제공하지 않으면 null — dip 게이트 생략 */
  changePct: number | null
}

export type PositionView = {
  symbol: string
  name: string | null
  quantity: number
  avgPriceKrw: number
}

export type PortfolioSnapshot = {
  cashKrw: number
  positions: PositionView[]
  /** 원장 orders 의 마지막 체결 시각 (KST ISO) — 빈도 게이트의 사실 소스 */
  lastOrderAt: string | null
}

export type ReasonCode =
  | 'stop_loss'
  | 'take_profit'
  | 'dip_buy'
  | 'allocation_buy'
  | 'frequency_gate'
  | 'position_cap'
  | 'cap_below_minimum'
  | 'insufficient_cash'
  | 'no_signal'
  | 'quote_missing'

/** 판단의 근거 숫자 — LLM/서사는 이 값만 참조할 수 있다(spec D2: 원장=사실, 메모리=서사). */
export type DecisionFact = {
  avgPriceKrw?: number
  currentPriceKrw?: number
  returnPct?: number
  thresholdPct?: number
  changePct?: number | null
  equityKrw?: number
  targetAmountKrw?: number
  cashKrw?: number
  positionCount?: number
  maxSymbols?: number
  windowHours?: number
  hoursSinceLastOrder?: number | null
}

export type Decision = {
  kind: 'buy' | 'sell' | 'hold'
  symbol: string | null
  quantity: number
  priceKrw: number
  reasonCode: ReasonCode
  fact: DecisionFact
}

/** 판단 로그 한 줄 — "AI 판단 로그 공개"(회의)의 원재료. 매수/매도/관망 전부 기록. */
export type JudgmentEntry = {
  logId: string
  characterSlug: string
  loopAt: string
  decision: 'buy' | 'sell' | 'hold'
  symbol: string | null
  quantity: number | null
  priceKrw: number | null
  reasonCode: ReasonCode
  fact: DecisionFact
  rationale: string
  orderId: string | null
  orderStatus: 'placed' | 'skipped' | 'failed'
  errorMessage: string | null
  createdAt: string
}
