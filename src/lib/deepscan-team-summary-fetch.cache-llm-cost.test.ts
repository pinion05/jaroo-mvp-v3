// 화이트박스 TC — "캐시된 딥스캔을 불러올 때 LLM 호출 비용이 발생하는가"
// 대상: src/lib/deepscan-team-summary-fetch.ts — 팀 요약 발사 코디네이터
//        (deepscan-loading-screen.tsx의 teamSummaryRequests effect가 사용)
//
// 실행 시뮬레이션(순수 모듈이라 실컴포넌트 렌더 없이 검증):
//   캐시 재방문 = 로딩 화면 리마운트 = 코디네이터 재생성 → 같은 팀 요청 3건이
//   다시 pending으로 클레임된다. [수정 반영] 재방문의 실제 발사는 로딩 화면의
//   저장 요약 씨드 게이트(TC-BUG-1)가 필터로 차단한다 — 코디네이터는 세션 내
//   중복 방지 장치일 뿐 결과 저장소가 아니다(그 역할은 payload.teamSummaries).
//
// 검증 계약:
//   TC-COORD-1  세션 내 같은 requestKey 재발사 0회(중복 방지 계약 유지)
//   TC-COORD-2  코디네이터 재생성(리마운트) → 동일 3요청 재클레임 — 인스턴스 단위
//               무상태 계약(씨드 게이트가 없다면 재발사 조건이 성립함을 고정)
//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTeamSummaryFetchCoordinator } from './deepscan-team-summary-fetch'

/** 캐시된 완성 payload의 committee.axes 기반 팀 요청 — 로딩 화면의
 *  teamSummaryRequests useMemo(deepscan-loading-screen.tsx)와 동일한 키 구성.
 *  requestKey는 `${scope}:${teamKey}:${inputKey}` — inputKey는 팀 바디 해시. */
function buildCachedRevisitTeamRequests() {
  const teamBodies: Array<{ teamKey: string; body: string }> = [
    { teamKey: 'fundamentalTeam', body: '의견 1: 밸류에이션 근거\n의견 2: 수익성 근거\n의견 3: 지분 안정성 근거' },
    { teamKey: 'marketTeam', body: '의견 1: 가격 위치 근거\n의견 2: 평단 격차 근거\n의견 3: 트렌드 근거' },
    { teamKey: 'contextTeam', body: '의견 1: 입력 완성도 근거\n의견 2: 상방 버퍼 근거\n의견 3: 이벤트 스캐너 근거' },
  ]
  const hash = (value: string) => {
    let acc = 0
    for (let index = 0; index < value.length; index += 1) {
      acc = (acc * 31 + value.charCodeAt(index)) | 0
    }
    return String(acc)
  }
  return teamBodies.map((team) => ({
    teamKey: team.teamKey,
    inputKey: hash(team.body),
    requestKey: `KR:stock:stock:${team.teamKey}:${hash(team.body)}`,
  }))
}

test('TC-COORD-1: 세션 내 같은 requestKey 재클레임은 0건(중복 발사 방지 계약)', () => {
  const requests = buildCachedRevisitTeamRequests()
  const coordinator = createTeamSummaryFetchCoordinator()

  const first = coordinator.claimPendingRequests(requests)
  assert.deepEqual(first.map((request) => request.teamKey), ['fundamentalTeam', 'marketTeam', 'contextTeam'])

  // 같은 세션에서 스테이지 갱신으로 effect가 재실행돼도 재발사되지 않는다
  const second = coordinator.claimPendingRequests(requests)
  assert.equal(second.length, 0)
})

test('TC-COORD-2: 재방문(코디네이터 재생성=리마운트) → 동일 3요청이 다시 클레임된다', () => {
  // 첫 방문(유료 런) — 팀 요약 3회 발사
  const firstVisit = createTeamSummaryFetchCoordinator().claimPendingRequests(buildCachedRevisitTeamRequests())
  assert.equal(firstVisit.length, 3)

  // 캐시 재방문 — 로딩 화면이 다시 마운트되면 코디네이터 인스턴스도 새로 만들어지고
  // 같은 requestKey 3건이 다시 pending이 된다(= 팀 요약 LLM 3회 재발사 조건 성립).
  // 코디네이터는 '세션 내' 중복 방지일 뿐 결과 저장소가 아니다.
  const revisit = createTeamSummaryFetchCoordinator().claimPendingRequests(buildCachedRevisitTeamRequests())
  assert.equal(revisit.length, 3, '코디네이터는 인스턴스 단위로 무상태 — 재클레임 자체는 막지 않는다(발사 억제는 씨드 게이트 담당)')

  // 최신 요청 판정도 인스턴스 단위라 이전 세션 결과를 무효화하지 않는다
  const revisitCoordinator = createTeamSummaryFetchCoordinator()
  const claimed = revisitCoordinator.claimPendingRequests(buildCachedRevisitTeamRequests())
  for (const request of claimed) {
    assert.equal(revisitCoordinator.isLatestRequest(request.teamKey, request.requestKey), true)
  }
})
