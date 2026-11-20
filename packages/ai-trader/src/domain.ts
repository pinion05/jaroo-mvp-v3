// 도메인 타입 — 순수 데이터만 둔다.
//
// v2 (2026-11-19): 룰엔진 결정 로직·정적 reason_code 세트·성향 파라미터는 폐기(D7/D8/D10 개정).
// 이 패키지는 v2 파이프라인의 골격만 소유한다: 계좌 매핑·상태 적재(load)·판단 로그 저장.
// 결정+서사는 ⑤ 매매 결정 턴의 페르소나 LLM이 출력하고(spec §5), 실행 계층이 물리 가드레일만 집행한다.
//
// 돈 표현 규칙 (paper-trade 계승): 금액·가격 = 원 단위 정수(number). 비율 = 소수.

/** 페르소나 카드 — 성향×사연×세계관(2026-11-10 회의) + v2 자기 원칙 문구(§5.2). 서사·판단의 원재료. */
export type PersonaCard = {
  /** 성향 라벨 — 금투협 5단계 기반 (예: '안정형') */
  temperament: string
  /** 세계관 목표 서사 (예: '여행자금 230만원 모으기') */
  narrativeGoal: string
  /** 집착/버릇 키워드 — 기억 컴파일 재료 (Phase 3) */
  obsessions: string[]
  /**
   * 자기 원칙 문구 (v2 §5.2 — 소프트): 성향 파라미터 필터는 폐지됐다.
   * 원칙은 캐릭터 카드의 문장으로 표현되며, 페르소나가 스스로 깰 수도 있다 — 그것도 서사다.
   * 하드 강제는 물리 제약(§5.3)만.
   */
  principles: string[]
  /** 결정 유형별 말투 접두사 — ⑤ 서사·일기 톤 참고용 */
  voice: { buy: string; sell: string; hold: string }
}

/** 캐릭터 = 계좌 1개 (spec D1) — 모든 유저가 동일한 상태를 봄. user_id 없음. */
export type Character = {
  slug: string
  displayName: string
  personaCard: PersonaCard
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
  /** 하루 등락률 (소수). 현재 시세 소스가 제공하지 않으면 null */
  changePct: number | null
}

/** [phase=load] 산출 — 턴의 출발 상태. 판단(⑤)은 이 위에서 LLM이 내린다. */
export type TurnContext = {
  character: { slug: string; displayName: string; accountId: string }
  loadedAt: string
  /** 원장 fact (paper-trade 소유 — 진실 소스) */
  ledger: {
    cashKrw: number
    investedBasisKrw: number
    realizedPnlTotalKrw: number
    feeTotalKrw: number
    orderCount: number
    lastOrderAt: string | null
    positions: Array<{ symbol: string; name: string | null; quantity: number; avgPriceKrw: number }>
  }
  /** 시세 (체결가 전달·평가손익용 — 판단 소스가 아님, D10) */
  quotes: Quote[]
  /** 파생 평가 (fresh 계산, D5) — 원장×시세 */
  valuation: {
    positionsValueKrw: number
    equityKrw: number
    unrealizedPctBySymbol: Record<string, number>
    cashGoalProgressPct: number | null
  }
}

/**
 * 판단 로그 한 줄 — "AI 판단 로그 공개"(회의)의 원재료.
 * v2: 결정은 ⑤ 페르소나 LLM이 내리므로, 이 패키지는 실행 계층이 전달한 판단을 저장만 한다.
 * reasonCode는 자유 태그(정적 라벨 세트 폐지). thesis_id·turn_date 등은 마이그레이션 0002(2.5a)에서 확장.
 */
export type JudgmentInput = {
  decision: 'buy' | 'sell' | 'hold'
  symbol: string | null
  quantity: number | null
  priceKrw: number | null
  reasonCode: string
  fact: Record<string, unknown>
  rationale: string
  order: { orderId: string | null; orderStatus: 'placed' | 'skipped' | 'failed'; errorMessage?: string | null }
}

export type JudgmentEntry = Omit<JudgmentInput, 'order'> & {
  logId: string
  characterSlug: string
  loopAt: string
  orderId: string | null
  orderStatus: 'placed' | 'skipped' | 'failed'
  errorMessage: string | null
  createdAt: string
}
