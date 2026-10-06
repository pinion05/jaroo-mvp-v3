import test from 'node:test'
import assert from 'node:assert/strict'

import { createTeamSummaryFetchCoordinator } from './deepscan-team-summary-fetch'

test('coordinator는 같은 requestKey를 한 번만 발사한다', () => {
  const coordinator = createTeamSummaryFetchCoordinator()
  const request = { teamKey: 'contextTeam', requestKey: 'kr:stock:contextTeam:abc' }

  const firstClaim = coordinator.claimPendingRequests([request])
  const secondClaim = coordinator.claimPendingRequests([request])

  assert.equal(firstClaim.length, 1)
  assert.equal(secondClaim.length, 0)
})

test('coordinator는 같은 팀의 새 requestKey가 등록되면 이전 요청의 결과 적용을 막는다', () => {
  const coordinator = createTeamSummaryFetchCoordinator()
  const first = { teamKey: 'contextTeam', requestKey: 'kr:stock:contextTeam:v1' }
  const second = { teamKey: 'contextTeam', requestKey: 'kr:stock:contextTeam:v2' }

  coordinator.claimPendingRequests([first])
  assert.equal(coordinator.isLatestRequest('contextTeam', first.requestKey), true)

  // 스테이지 갱신으로 요청 목록이 바뀌어 effect가 재실행된 상황 — 새 본문(v2)이 최신이 된다.
  const pending = coordinator.claimPendingRequests([first, second])
  assert.deepEqual(pending, [second])
  assert.equal(coordinator.isLatestRequest('contextTeam', first.requestKey), false)
  assert.equal(coordinator.isLatestRequest('contextTeam', second.requestKey), true)
})

test('coordinator는 팀 간 최신 키를 독립적으로 관리한다', () => {
  const coordinator = createTeamSummaryFetchCoordinator()
  const contextTeam = { teamKey: 'contextTeam', requestKey: 'kr:stock:contextTeam:v1' }
  const marketTeam = { teamKey: 'marketTeam', requestKey: 'kr:stock:marketTeam:v1' }

  coordinator.claimPendingRequests([contextTeam, marketTeam])
  coordinator.claimPendingRequests([{ ...contextTeam, requestKey: 'kr:stock:contextTeam:v2' }])

  assert.equal(coordinator.isLatestRequest('marketTeam', marketTeam.requestKey), true)
  assert.equal(coordinator.isLatestRequest('contextTeam', contextTeam.requestKey), false)
})
