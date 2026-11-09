import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  TEAM_BRIDGE_DONE_SECONDS,
  TEAM_BRIDGE_REVEAL_SECONDS,
} from './deepscan-loading-types'

// CSS 모듈 임포트를 node 테스트 러너에서 흡수한다(deepscan-conclusion-reveal.test.ts 패턴).
const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, { get: (_target, property) => property === '__esModule' ? false : String(property) })
}
const { buildTeamBridgeState } = require('./deepscan-loading-utils') as typeof import('./deepscan-loading-utils')

// TC-BBSC-005 회귀(종결 후 "세 팀이 의견을 정리하는 중…" 로딩 라벨 잔존).
// 팀 브리지 상태는 종결(ready)·브리지 종료 시각 이후에는 반드시 null이어야 하고,
// 컴포넌트는 null일 때 카드를 DOM에서 소거한다(렌더 계약은 tests/deepscan-refresh-wedge-regression.test.mjs).
test('팀 브리지: 종결(ready)이면 언제나 null — 잔여 로딩 문구가 남지 않는다', () => {
  for (const elapsedSeconds of [0, 10, TEAM_BRIDGE_REVEAL_SECONDS, 50, TEAM_BRIDGE_DONE_SECONDS - 1, TEAM_BRIDGE_DONE_SECONDS, 999]) {
    assert.equal(buildTeamBridgeState(elapsedSeconds, true), null, `elapsed=${elapsedSeconds}`)
  }
})

test('팀 브리지: 공개 구간(reveal~done)에만 상태를 제공한다', () => {
  assert.equal(buildTeamBridgeState(TEAM_BRIDGE_REVEAL_SECONDS - 1, false), null)
  assert.notEqual(buildTeamBridgeState(TEAM_BRIDGE_REVEAL_SECONDS, false), null)
  assert.notEqual(buildTeamBridgeState(TEAM_BRIDGE_DONE_SECONDS - 1, false), null)
  assert.equal(buildTeamBridgeState(TEAM_BRIDGE_DONE_SECONDS, false), null)
})

test('팀 브리지: 상태 문자열은 회전 메시지(또는 마무리 문구)만 제공한다 — 폴백 상수 노출 없음', () => {
  const state = buildTeamBridgeState(TEAM_BRIDGE_REVEAL_SECONDS + 1, false)
  assert.ok(state, '공개 구간에서는 상태가 있다')
  assert.equal(typeof state.statusText, 'string')
  assert.ok(state.statusText.length > 0)
  assert.equal(typeof state.remainingText, 'string')
})
