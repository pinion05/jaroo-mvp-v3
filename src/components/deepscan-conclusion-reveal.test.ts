import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  CONCLUSION_REVEAL_DELAY_AFTER_ARRAY_SECONDS,
  CONCLUSION_REVEAL_DELAY_AFTER_TEAMS_SECONDS,
  TEAM_PRESENTATION_ORDER,
  TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS,
  type NarrativeCard,
  type TeamSummaryState,
  type LoadingStageKey,
} from './deepscan-loading-types'

const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, { get: (_target, property) => property === '__esModule' ? false : String(property) })
}
const { buildOrderedNarrativeCards, hashSummaryInput, areDeepScanCommitteeCardsSettled, isDeepScanConclusionReady } = require('./deepscan-loading-utils') as typeof import('./deepscan-loading-utils')
const { DeepScanLoadingScreen } = require('./deepscan-loading-screen') as typeof import('./deepscan-loading-screen')

const cards: NarrativeCard[] = TEAM_PRESENTATION_ORDER.map((teamKey) => ({
  key: teamKey,
  teamKey,
  analystName: teamKey,
  description: '',
  avatar: '',
  body: `${teamKey} 내용`,
  tags: [],
  statusLabel: '완료',
  statusTone: 'positive',
  complete: true,
  summarizable: true,
  placeholder: false,
}))
const summaries = Object.fromEntries(cards.map((card) => [card.teamKey!, {
  inputKey: hashSummaryInput(card.body), status: 'success', summary: '팀 요약',
}])) as Partial<Record<LoadingStageKey, TeamSummaryState>>

function settled(overrides: Partial<Parameters<typeof areDeepScanCommitteeCardsSettled>[0]> = {}) {
  return areDeepScanCommitteeCardsSettled({ resultsReady: true, cards, teamSummaries: summaries, ...overrides })
}

function conclusion(overrides: Partial<Parameters<typeof isDeepScanConclusionReady>[0]> = {}) {
  return isDeepScanConclusionReady({
    teamsSettledAtSeconds: 20,
    elapsedSeconds: 60,
    arrayCompleteSeconds: TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS,
    ...overrides,
  })
}

test('위원 카드 완성 판정 — 자리표시자·요약 로딩·미완 응답은 미완성', () => {
  assert.equal(settled(), true)
  assert.equal(settled({ resultsReady: false }), false)
  assert.equal(settled({ cards: cards.slice(0, 2) }), false)
  assert.equal(settled({ teamSummaries: {} }), false)
  const loading = { ...summaries, fundamentalTeam: { inputKey: hashSummaryInput(cards[2].body), status: 'loading' as const } }
  assert.equal(settled({ teamSummaries: loading }), false)
  // 위원 응답이 종결돼 일부만 도착한 카드는 결과 준비 뒤 실패 대체 문구로 완성 취급한다
  const incomplete = cards.map((card) => ({ ...card, complete: false, summarizable: false }))
  assert.equal(settled({ cards: buildOrderedNarrativeCards(incomplete, TEAM_PRESENTATION_ORDER), teamSummaries: {} }), true)
})

test('종합 결론은 위원 카드 완성 + 3초(배열 완료 + 2초와 비교해 늦은 쪽)부터 공개', () => {
  assert.equal(conclusion({ teamsSettledAtSeconds: null }), false)
  // 캐시: 위원 카드 20초 완성 → max(23, 38+2) = 40초 공개(배열이 아직 진행 중이면 기다림)
  assert.equal(conclusion({ teamsSettledAtSeconds: 20, elapsedSeconds: 39 }), false)
  assert.equal(conclusion({ teamsSettledAtSeconds: 20, elapsedSeconds: 40 }), true)
  // 신선: 위원 카드 79초 완성 → 82초 공개(81초 절대 게이트와 무관)
  assert.equal(conclusion({ teamsSettledAtSeconds: 79, elapsedSeconds: 81 }), false)
  assert.equal(conclusion({ teamsSettledAtSeconds: 79, elapsedSeconds: 82 }), true)
  assert.ok(TODAY_BRIEFING_ARRAY_COMPLETE_SECONDS + CONCLUSION_REVEAL_DELAY_AFTER_ARRAY_SECONDS > 20 + CONCLUSION_REVEAL_DELAY_AFTER_TEAMS_SECONDS)
})

test('캐시 결과가 준비된 첫 렌더에도 종합 결론을 표시하지 않는다', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanLoadingScreen, {
    resultsReady: true,
    snapshotCacheHit: true,
    inlineResults: createElement('div', null, '세 팀의 의견을 모았어요'),
  }))
  assert.doesNotMatch(markup, /세 팀의 의견을 모았어요/)
})
