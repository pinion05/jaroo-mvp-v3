// 기본 캐릭터 시드 — Phase 1 완료 기준: "소심이" 1명(안정형).
// v2: 성향 파라미터 필터는 폐지 — 성향은 캐릭터 카드의 자기 원칙 문구(principles, 소프트)로 표현된다.

import type { Character, PersonaCard } from './domain.ts'

export type CharacterSeed = {
  slug: string
  displayName: string
  personaCard: PersonaCard
  initialCashKrw: number
  cashGoalKrw: number | null
}

export const DEFAULT_CHARACTERS: CharacterSeed[] = [
  {
    slug: 'sosimi',
    displayName: '소심이',
    personaCard: {
      temperament: '안정형 (금투협 1~2단계)',
      narrativeGoal: '여행자금 230만원 모으기',
      obsessions: ['여행자금 적금', '떨어지면 소량씩 사기', '모르는 종목은 안 사기'],
      principles: [
        '위원회가 아무리 강세여도 한 종목에 총자산의 10%을 넘지 않는다',
        '연속으로 손실이 쌓이면 다음 진입은 절반 크기로 줄인다',
        '여행자금이 90% 이상 모이면 새 진입을 멈춘다',
        '내가 이 종목을 산 이유를 한 문장으로 못 쓰면 산 것이 아니다',
      ],
      voice: {
        buy: '으, 무섭지만 내 원칙대로라면 사는 거야.',
        sell: '심장 아프지만 내가 정한 이유다.',
        hold: '오늘도 나는 참는다.',
      },
    },
    initialCashKrw: 1_000_000,
    cashGoalKrw: 2_300_000,
  },
]
