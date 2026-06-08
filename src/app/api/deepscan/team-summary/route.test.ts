import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS,
  DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT,
  buildTeamSummarySystemPrompt,
  createDeepScanTeamSummaryResponse,
  parseTeamSummaryContent,
  removeForbiddenInvestmentActionAdvice,
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



test('team summary prompt adds ETF-native guardrails when instrument is ETF', () => {
  const prompt = buildTeamSummarySystemPrompt({ market: 'ETF', instrumentKind: 'etf' })
  assert.match(prompt, /ETF\/ETN 입력에서는/)
  assert.match(prompt, /NAV 괴리/)
  assert.match(prompt, /기초지수 흐름/)
  assert.match(prompt, /구성종목 비중/)
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
      market: 'ETF',
      instrumentKind: 'etf',
    },
    async (input) => {
      assert.equal(input.teamKey, 'marketTeam')
      assert.equal(input.teamName, '시장/차트 팀')
      assert.match(input.body, /차트 마스터/)
      assert.equal(input.market, 'ETF')
      assert.equal(input.instrumentKind, 'etf')
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



test('team summary route sanitizes ETF stock-centric missing-target language', async () => {
  const response = await createDeepScanTeamSummaryResponse(
    {
      teamKey: 'contextTeam',
      teamName: '심리/환경 팀',
      body: '의견 1: ETF입니다. 의견 2: 구성종목 확인. 의견 3: 유동성 확인.',
      market: 'ETF',
      instrumentKind: 'etf',
    },
    async () => ({
      summary: 'ETF 특성상 개별 종목 분석과 목표가가 없어 추가 상승 여력을 판단하기 어렵다. 목표가 부재도 확인됩니다. 매도 의사결정에 필요한 핵심 데이터는 충분합니다. 컨센서스·밸류 정보 부재가 있습니다. 종목별 PER/PBR 데이터는 제공되지 않습니다.',
      model: 'openai/gpt-oss-120b',
      provider: 'Cerebras/fp16',
    }),
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.doesNotMatch(body.summary, /목표가|NAV·기초지수 기준 부재|추가 상승 여력|매도 판단|매도 의사결정|컨센서스·밸류 정보 부재|PER\/PBR/)
  assert.match(body.summary, /NAV|기초지수|비중 점검|괴리율/)
})

test('parseTeamSummaryContent accepts JSON or direct sentence and normalizes whitespace', () => {
  assert.equal(parseTeamSummaryContent('{"summary":"강한 추세입니다.\\n단, 변동성은 봐야 합니다."}'), '강한 추세입니다. 단, 변동성은 봐야 합니다.')
  assert.equal(parseTeamSummaryContent('  직접 한 문장입니다.  '), '직접 한 문장입니다.')
})

test('team summary removes forbidden investment action advice phrases', async () => {
  assert.equal(
    removeForbiddenInvestmentActionAdvice('현재 포지션을 유지하면서 시장 전반의 흐름을 주시할 필요가 있습니다.'),
    '현재 구간을 기준으로 시장 전반의 흐름을 주시할 필요가 있습니다.',
  )

  assert.doesNotMatch(
    removeForbiddenInvestmentActionAdvice('매수해야 합니다. 매도보다 보유가 낫습니다.'),
    /매수해야|매도보다|보유가 낫/,
  )
  assert.doesNotMatch(
    removeForbiddenInvestmentActionAdvice('매수하세요. 매도하세요. 보유하세요. 보유를 추천합니다.'),
    /매수하세요|매도하세요|보유하세요|보유를 추천/,
  )

  const response = await createDeepScanTeamSummaryResponse(
    {
      teamKey: 'positionTeam',
      teamName: '포지션 팀',
      body: '의견 1: 수익권입니다. 의견 2: 변동성이 있습니다. 의견 3: 정보가 부족합니다.',
    },
    async () => ({
      summary: '보유를 유지하면서 ETF 전반의 변동성을 주시할 필요가 있습니다.',
      model: 'openai/gpt-oss-120b',
      provider: 'Cerebras/fp16',
    }),
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.doesNotMatch(body.summary, /포지션\s*유지|보유를\s*유지|보유\s*유지/)
  assert.match(body.summary, /현재 구간/)
})
