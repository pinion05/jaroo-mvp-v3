import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TEAM_PRESENTATION_ORDER, TEAM_SEQUENCE_COMPLETE_SECONDS, type NarrativeCard, type TeamSummaryState, type LoadingStageKey } from './deepscan-loading-types'

const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, { get: (_target, property) => property === '__esModule' ? false : String(property) })
}
const { buildOrderedNarrativeCards, buildSequentialNarrativeCards, hashSummaryInput, isDeepScanConclusionReady } = require('./deepscan-loading-utils') as typeof import('./deepscan-loading-utils')
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

function ready(overrides: Partial<Parameters<typeof isDeepScanConclusionReady>[0]> = {}) {
  return isDeepScanConclusionReady({
    resultsReady: true,
    elapsedSeconds: TEAM_SEQUENCE_COMPLETE_SECONDS,
    sequenceCompleteSeconds: TEAM_SEQUENCE_COMPLETE_SECONDS,
    cards,
    teamSummaries: summaries,
    ...overrides,
  })
}

test('캐시 결과가 준비된 첫 렌더에도 종합 결론을 표시하지 않는다', () => {
  const markup = renderToStaticMarkup(createElement(DeepScanLoadingScreen, {
    resultsReady: true,
    snapshotCacheHit: true,
    inlineResults: createElement('div', null, '세 팀의 의견을 모았어요'),
  }))
  assert.doesNotMatch(markup, /세 팀의 의견을 모았어요/)
})

test('캐시 결과가 빨리 와도 브리핑 목록과 팀 카드가 끝나기 전 종합 결론은 숨긴다', () => {
  assert.equal(ready({ elapsedSeconds: 0 }), false)
  assert.equal(ready({ elapsedSeconds: TEAM_SEQUENCE_COMPLETE_SECONDS - 1 }), false)
  assert.equal(ready({ resultsReady: false }), false)
  assert.equal(ready({ cards: cards.slice(0, 2) }), false)
  assert.equal(ready(), true)
})

test('팀 요약 스켈레톤이 남아 있으면 마지막 카드까지 완성될 때까지 기다린다', () => {
  const pending = { ...summaries, fundamentalTeam: { inputKey: hashSummaryInput(cards[2].body), status: 'loading' as const } }
  const visible = buildSequentialNarrativeCards(cards, pending, true)
  assert.equal(ready({ cards: visible, teamSummaries: pending }), false)
  assert.equal(ready({ teamSummaries: { ...pending, fundamentalTeam: { inputKey: hashSummaryInput(cards[2].body), status: 'error' } } }), true)
  assert.equal(ready({ teamSummaries: { ...summaries, fundamentalTeam: { inputKey: 'stale', status: 'success', summary: '오래된 요약' } } }), false)
})

test('도착 이벤트가 빠진 종결 결과는 최종 팀 카드와 실패 대체 문구로 표시할 수 있다', () => {
  const incomplete = cards.map((card) => ({ ...card, complete: false, summarizable: false }))
  const withMissingArrival = buildOrderedNarrativeCards(incomplete, ['marketTeam'])
  assert.equal(ready({ cards: withMissingArrival, teamSummaries: {} }), false)
  const terminalCards = buildOrderedNarrativeCards(incomplete, TEAM_PRESENTATION_ORDER)
  assert.equal(ready({ cards: terminalCards, teamSummaries: {} }), true)
})
