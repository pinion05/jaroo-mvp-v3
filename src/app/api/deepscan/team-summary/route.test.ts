import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS,
  createDeepScanTeamSummaryResponse,
  parseTeamSummaryContent,
} from './route'

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

test('parseTeamSummaryContent rejects malformed JSON-like fragments', () => {
  assert.equal(parseTeamSummaryContent('{"summary":"현재 손실'), null)
  assert.equal(parseTeamSummaryContent('```json\n{"summary":"현재 손실\n```'), null)
})
