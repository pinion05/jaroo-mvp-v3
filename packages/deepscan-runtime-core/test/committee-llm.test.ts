import test from 'node:test'
import assert from 'node:assert/strict'

import { scoreCommitteeMember } from '../src/committee-llm.js'

test('scoreCommitteeMember sends strict OpenRouter schema request and parses JSON response', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'test-key'

  let capturedBody: Record<string, unknown> | null = null

  global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 81.7,
                reason: '덤프 근거가 전반적으로 긍정적이에요.',
                confidence: 'medium',
                warnings: ['일부 데이터가 누락됐어요.'],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const result = await scoreCommitteeMember(
      'valuation',
      {
        shared: { instrument: { ticker: { value: 'NVDA' } } },
        memberDump: { member: 'valuation', facts: { per: { value: 20 } } },
      },
      {
        schemaName: 'jaroo_test_member',
        title: 'test committee',
        systemPrompt: (memberKey: string) => `member:${memberKey}`,
      },
    )

    assert.equal(result.score, 82)
    assert.equal(result.confidence, 'medium')
    assert.equal(result.reason, '덤프 근거가 전반적으로 긍정적이에요.')
    assert.deepEqual(result.warnings, ['일부 데이터가 누락됐어요.'])
    const requestBody = capturedBody as Record<string, unknown> | null
    const provider = requestBody?.provider as { require_parameters?: boolean } | undefined
    const responseFormat = requestBody?.response_format as { type?: string; json_schema?: { name?: string } } | undefined
    assert.equal(provider?.require_parameters, true)
    assert.equal(responseFormat?.type, 'json_schema')
    assert.equal(responseFormat?.json_schema?.name, 'jaroo_test_member')
  } finally {
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMember surfaces upstream OpenRouter errors', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'test-key'

  global.fetch = (async () => new Response(
    JSON.stringify({ error: { message: 'bad upstream', code: 502 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch

  try {
    await assert.rejects(
      () => scoreCommitteeMember('momentum', { shared: {}, memberDump: {} }, {
        systemPrompt: () => 'prompt',
      }),
      /bad upstream/,
    )
  } finally {
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})
