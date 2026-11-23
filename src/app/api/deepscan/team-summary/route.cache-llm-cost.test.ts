// 화이트박스 TC — "캐시된 딥스캔을 불러올 때 LLM 호출 비용이 발생하는가"
// 대상: src/app/api/deepscan/team-summary/route.ts — 로딩 화면 팀 요약 LLM
//        (웹 서버가 직접 OpenRouter openai/gpt-oss-120b를 호출하는 유일한 경로)
//
// 의존성 주입: createDeepScanTeamSummaryResponse(body, requester)의 requester가
// LLM HTTP 층(callOpenRouterTeamSummary)이다. 카운팅 requester로 갈음한다 —
// 실제 네트워크·API 키 사용 없음.
//
// 검증 계약(버그 고정 — 수정 전 동작 문서화):
//   TC-TSM-1  팀 요약 1요청 = LLM 1회. 3팀 = 3회.
//   TC-TSM-2  라우트 자체에는 요청간 캐시가 없다(동일 입력 재요청 = LLM 재호출).
//             [수정 반영] 재방문(캐시 로드)은 로딩 화면 씨드 게이트가 이 라우트에
//             도달하지 않게 차단한다 — 이 재호출은 본문 변경(스테일 inputKey) 등
//             재생성이 필요한 경로에서만 발생한다.
//   TC-TSM-3  입력 검증(400)은 requester(LLM)를 부르지 않는다.
//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md

import test from 'node:test'
import assert from 'node:assert/strict'

import { createDeepScanTeamSummaryResponse } from './route'

function createCountingRequester() {
  let llmCalls = 0
  const requester = async () => {
    llmCalls += 1
    return {
      summary: '지금 구간은 보유 맥락을 먼저 확인해야 해요.',
      elapsedMs: 5,
      model: 'wb-test-model',
      provider: 'wb-test',
    }
  }
  return {
    get llmCalls() {
      return llmCalls
    },
    requester,
  }
}

const teamBodies = [
  { teamKey: 'fundamentalTeam', teamName: '가치·기본 팀', body: '의견 1: 근거A\n의견 2: 근거B\n의견 3: 근거C' },
  { teamKey: 'marketTeam', teamName: '시장·차트 팀', body: '의견 1: 근거D\n의견 2: 근거E\n의견 3: 근거F' },
  { teamKey: 'contextTeam', teamName: '심리·환경 팀', body: '의견 1: 근거G\n의견 2: 근거H\n의견 3: 근거I' },
]

test('TC-TSM-1: 팀 요약 1요청 = LLM 1회 — 3팀(캐시된 완성 payload 재열람)이면 3회', async () => {
  const counter = createCountingRequester()

  for (const team of teamBodies) {
    const response = await createDeepScanTeamSummaryResponse({ ...team, market: 'KR' }, counter.requester)
    assert.equal(response.status, 200, `${team.teamKey} 요청은 성공해야 한다`)
    const body = (await response.json()) as { ok: boolean; summary?: string }
    assert.equal(body.ok, true)
    assert.ok(typeof body.summary === 'string' && body.summary.length > 0)
  }

  assert.equal(counter.llmCalls, 3, `팀 요약 LLM은 팀당 1회, 총 3회여야 한다 (실제 ${counter.llmCalls})`)
})

test('TC-TSM-2: 라우트 요청간 캐시 없음(누적 2) — 재방문은 씨드 게이트로 도달 자체를 차단', async () => {
  const counter = createCountingRequester()
  const team = { ...teamBodies[0], market: 'KR' }

  await createDeepScanTeamSummaryResponse(team, counter.requester)
  assert.equal(counter.llmCalls, 1)

  // 이 라우트에 같은 팀 바디가 다시 도달하는 상황(본문 변경 등 재생성 경로) —
  // 라우트는 무상태라 그때마다 LLM이 다시 불린다. 정상 재방문은 씨드 게이트가
  // 발사 자체를 건너뛰므로 여기까지 오지 않는다(TC-BUG-1 수정 반영 참조).
  const second = await createDeepScanTeamSummaryResponse(team, counter.requester)
  assert.equal(second.status, 200)
  assert.equal(counter.llmCalls, 2, '라우트는 요청간 캐시가 없다 — 도달하면 팀별 1회씩 호출')
})

test('TC-TSM-3: 입력 검증 실패(400)는 requester(LLM)를 부르지 않는다', async () => {
  const counter = createCountingRequester()

  const invalid = await createDeepScanTeamSummaryResponse({ teamKey: '', teamName: '', body: '' }, counter.requester)
  assert.equal(invalid.status, 400)
  assert.equal(counter.llmCalls, 0, '검증 단계에서 LLM 비용이 새면 안 된다')
})
