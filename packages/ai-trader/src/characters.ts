// 기본 캐릭터 시드 — Phase 1 완료 기준: "소심이" 1명(안정형).
// 2026-11-10 회의: 성향×사연×세계관, 금투협 5단계 기반 3~4명 시작 — Phase 2+ 에서 확장.
// 캐릭터 = paper-trade 계좌 1개 (spec D1). 설정 변경은 Phase 2 Supabase 이관 후 관리형으로.

import type { Character, StrategyParams, WatchItem } from './domain.ts'

export type CharacterSeed = {
  slug: string
  displayName: string
  personaCard: Character['personaCard']
  strategyParams: StrategyParams
  watchlist: WatchItem[]
  initialCashKrw: number
  cashGoalKrw: number | null
}

const SOSIMI_PARAMS: StrategyParams = {
  maxPositionPct: 0.1,
  maxDrawdownPct: 0.05,
  takeProfitPct: 0.08,
  maxSymbols: 5,
  tradeFrequency: 'weekly',
  buyDipPct: -0.03,
}

const SOSIMI_WATCHLIST: WatchItem[] = [
  { symbol: '005930', name: '삼성전자' },
  { symbol: '000660', name: 'SK하이닉스' },
  { symbol: '035420', name: 'NAVER' },
  { symbol: '005380', name: '현대차' },
  { symbol: '068270', name: '셀트리온' },
]

export const DEFAULT_CHARACTERS: CharacterSeed[] = [
  {
    slug: 'sosimi',
    displayName: '소심이',
    personaCard: {
      temperament: '안정형 (금투협 1~2단계)',
      narrativeGoal: '여행자금 230만원 모으기',
      obsessions: ['여행자금 적금', '떨어지면 소량씩 사기', '모르는 종목은 안 사기'],
      voice: {
        buy: '으, 무섭지만 규칙이 하래서 사는 거야.',
        sell: '심장 아프지만 정한 규칙이야.',
        hold: '오늘도 나는 참는다.',
      },
    },
    strategyParams: SOSIMI_PARAMS,
    watchlist: SOSIMI_WATCHLIST,
    initialCashKrw: 1_000_000,
    cashGoalKrw: 2_300_000,
  },
]
