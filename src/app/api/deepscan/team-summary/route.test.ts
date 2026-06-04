import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS,
  DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT,
  createDeepScanTeamSummaryResponse,
  parseTeamSummaryContent,
} from './route'


test('team summary system prompt favors detailed three-member interpretation', () => {
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /3명 위원/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /150~240자/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /3문장 초과 금지/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /위원명·역할명·개별 주체명 언급을 금지/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /평단 대비 수익률이나 이미 크게 오른 가격은 추가 상승 여력의 근거가 아니라 현재 포지션 상태/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /세 위원 모두, 모두 긍정 같은 만장일치 표현을 쓰지 말고/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /현재가가 목표가에 근접했다면 추가 상승 여력이 크다고 쓰지 말고/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /매수·매도·보유·포지션 유지 같은 투자 행동 권유/)
})

test('team summary route validates required fields', async () => {
  const response = await createDeepScanTeamSummaryResponse({}, async () => ({ summary: 'unused' }))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).ok, false)
})

test('team summary route returns requester summary with Cerebras max-token contract', async () => {
  assert.equal(DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS, 1000)

  const response = await createDeepScanTeamSummaryResponse(
    {
      teamKey: 'marketTeam',
      teamName: '시장/차트 팀',
      body: '차트 마스터: 강한 추세입니다.\n수급 추적기: 거래량이 늘었습니다.\n모멘텀 스카우터: 기대가 큽니다.',
    },
    async (input) => {
      assert.equal(input.teamKey, 'marketTeam')
      assert.equal(input.teamName, '시장/차트 팀')
      assert.match(input.body, /차트 마스터/)
      return {
        summary: '강한 주가 추세와 거래량 확대가 모멘텀을 뒷받침하지만 급등 후 변동성 관리는 필요합니다.',
        model: 'openai/gpt-oss-120b',
        provider: 'Cerebras/fp16',
        elapsedMs: 480,
      }
    },
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.teamKey, 'marketTeam')
  assert.equal(body.model, 'openai/gpt-oss-120b')
  assert.equal(body.provider, 'Cerebras/fp16')
  assert.match(body.summary, /거래량 확대/)
})

test('parseTeamSummaryContent accepts JSON or direct sentence and normalizes whitespace', () => {
  assert.equal(parseTeamSummaryContent('{"summary":"강한 추세입니다.\\n단, 변동성은 봐야 합니다."}'), '강한 추세입니다. 단, 변동성은 봐야 합니다.')
  assert.equal(parseTeamSummaryContent('  직접 한 문장입니다.  '), '직접 한 문장입니다.')
})
