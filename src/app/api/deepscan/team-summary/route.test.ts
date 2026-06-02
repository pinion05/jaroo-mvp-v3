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
  assert.equal(DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS, 220)

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

test('team summary route constrains long summaries for mobile cards', async () => {
  const response = await createDeepScanTeamSummaryResponse(
    {
      teamKey: 'contextTeam',
      teamName: '심리/환경 팀',
      body: '심리 분석AI: 수익률이 명확합니다.',
    },
    async () => ({
      summary: '보유 85주, 평단 6,958원, 현재가 8,840원으로 평가수익률 +27%가 명확하고 14개 리포트 페이지가 모두 확보되어 의사결정에 필요한 핵심 정보가 완전하게 갖춰져 있습니다. 컨센서스 목표주가가 없어 업사이드 여부를 가늠하기 어렵습니다.',
    }),
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.ok(typeof body.summary === 'string')
  assert.ok(body.summary.length <= 90)
  assert.doesNotMatch(body.summary, /…/)
})

test('parseTeamSummaryContent accepts JSON or direct sentence and normalizes whitespace', () => {
  assert.equal(parseTeamSummaryContent('{"summary":"강한 추세입니다.\\n단, 변동성은 봐야 합니다."}'), '강한 추세입니다. 단, 변동성은 봐야 합니다.')
  assert.equal(parseTeamSummaryContent('  직접 한 문장입니다.  '), '직접 한 문장입니다.')
  assert.equal(parseTeamSummaryContent('{"summary":"보유 85주, 평단 6,958원, 현재가 8,840원으로 평가수익률 +27%가 명확하고 14개 리포트 페이지가 모두 확보되어 의사결정에 필요한 핵심 정보가 완전하게 갖춰져 있습니다. 컨센서스 목표주가가 없어 업사이드 여부를 가늠하기 어렵습니다."}')?.includes('…'), false)
})

test('parseTeamSummaryContent rejects malformed JSON-like fragments', () => {
  assert.equal(parseTeamSummaryContent('{"summary":"현재 손실'), null)
  assert.equal(parseTeamSummaryContent('```json\n{"summary":"현재 손실\n```'), null)
})
