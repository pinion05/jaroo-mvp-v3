import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS,
  DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT,
  buildTeamSummarySystemPrompt,
  callOpenRouterTeamSummary,
  createDeepScanTeamSummaryResponse,
  parseTeamSummaryContent,
  removeForbiddenInvestmentActionAdvice,
} from './route'


test('team summary system prompt favors detailed three-member interpretation', () => {
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /3명 위원/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /220~360자/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /4문장 초과 금지/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /Jaroo 말투를 고정/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /친근한 존댓말/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /~입니다/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /위원명·역할명·개별 주체명·메타 표현 언급을 금지/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /현재 상태 → 근거 → 리스크\/확인점/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /평단 대비 수익률이나 이미 크게 오른 가격은 추가 상승 여력의 근거가 아니라 현재 포지션 상태/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /모두 긍정/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /현재가가 목표가에 근접했다면 추가 상승 여력이 크다고 쓰지 말고/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /매수·매도·보유·포지션 유지 같은 투자 행동 권유/)
  assert.match(DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT, /나쁜 예/)
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

test('team summary route logs elapsedMs on success and failure message on error', async () => {
  const originalLog = console.log
  const originalError = console.error
  const logged: string[] = []
  console.log = (message: unknown) => { logged.push(String(message)) }
  console.error = (message: unknown) => { logged.push(String(message)) }

  try {
    await createDeepScanTeamSummaryResponse(
      {
        teamKey: 'contextTeam',
        teamName: '심리·환경 팀',
        body: '의견 1: 긍정. 의견 2: 중립. 의견 3: 주의.',
      },
      async () => ({
        summary: '지금 구간은 확인이 필요해요. 변동성 관리가 중요해요.',
        model: 'openai/gpt-oss-120b',
        provider: 'Cerebras/fp16',
        elapsedMs: 547,
      }),
    )

    await createDeepScanTeamSummaryResponse(
      {
        teamKey: 'contextTeam',
        teamName: '심리·환경 팀',
        body: '의견 1: 긍정. 의견 2: 중립. 의견 3: 주의.',
      },
      async () => {
        throw new Error('OpenRouter team summary failed (502)')
      },
    )
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  assert.ok(
    logged.some((line) => line.includes('[team-summary] ok') && line.includes("'contextTeam'") && line.includes('547')),
    `success log missing: ${JSON.stringify(logged)}`,
  )
  assert.ok(
    logged.some((line) => line.includes('[team-summary] fail') && line.includes('OpenRouter team summary failed')),
    `failure log missing: ${JSON.stringify(logged)}`,
  )
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

// --- JAROO_LLM_MOCK=1 dev 전용 결정적 모의 응답(비용 0) 검증 ---

test('JAROO_LLM_MOCK=1이면 팀 요약이 네트워크 0회·키 없이 결정적 [MOCK] 문장을 반환한다', async () => {
  const originalMock = process.env.JAROO_LLM_MOCK
  const originalLatency = process.env.JAROO_LLM_MOCK_LATENCY_MS
  const originalKey = process.env.OPENROUTER_API_KEY
  const originalFetch = global.fetch

  process.env.JAROO_LLM_MOCK = '1'
  process.env.JAROO_LLM_MOCK_LATENCY_MS = '0'
  delete process.env.OPENROUTER_API_KEY
  let fetchCalls = 0
  global.fetch = (async () => {
    fetchCalls += 1
    throw new Error('network must not be called in llm-mock mode')
  }) as typeof fetch

  try {
    const input = {
      teamKey: 'marketTeam',
      teamName: '시장/차트 팀',
      body: '차트 마스터: 강한 추세입니다.\n수급 추적기: 거래량이 늘었습니다.\n모멘텀 스카우터: 기대가 큽니다.',
      market: 'KR',
    }
    const first = await callOpenRouterTeamSummary(input)
    const second = await callOpenRouterTeamSummary(input)

    assert.equal(fetchCalls, 0, 'mock 모드에서는 fetch 네트워크 호출이 0회여야 한다')
    assert.match(first.summary, /^\[MOCK\]/, '요약 앞에 [MOCK] 접두가 있어야 한다')
    assert.equal(first.provider, 'llm-mock')
    assert.equal(first.summary, second.summary, '같은 입력(팀+날짜)엔 같은 요약이 나와야 한다')
    assert.ok(typeof first.elapsedMs === 'number' && first.elapsedMs >= 0)
    // 실제 응답 파싱·정리 체인을 통과했는지(줄바꿈 제거·금지 표현 부재).
    assert.doesNotMatch(first.summary, /[\r\n]/)
    assert.doesNotMatch(first.summary, /매수|매도|포지션을 유지/)
  } finally {
    process.env.JAROO_LLM_MOCK = originalMock
    process.env.JAROO_LLM_MOCK_LATENCY_MS = originalLatency
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = originalKey
    }
    global.fetch = originalFetch
  }
})

test('JAROO_LLM_MOCK 미설정(기본)이면 기존 키 게이트가 그대로 작동한다', async () => {
  const originalMock = process.env.JAROO_LLM_MOCK
  const originalKey = process.env.OPENROUTER_API_KEY
  delete process.env.JAROO_LLM_MOCK
  delete process.env.OPENROUTER_API_KEY

  try {
    await assert.rejects(
      callOpenRouterTeamSummary({ teamKey: 'marketTeam', teamName: '시장/차트 팀', body: '본문' }),
      /OPENROUTER_API_KEY is not configured/,
    )
  } finally {
    process.env.JAROO_LLM_MOCK = originalMock
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = originalKey
    }
  }
})
