import test from 'node:test'
import assert from 'node:assert/strict'

import { scoreUsCommitteeMember } from './llm-committee'

test('scoreUsCommitteeMember sends strict OpenRouter schema request and parses JSON response', async () => {
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
                reason: '밸류에이션과 목표주가 맥락이 긍정적이에요.',
                confidence: 'medium',
                warnings: ['일부 컨센서스 공백이 있어요.'],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const result = await scoreUsCommitteeMember('valuation', {
      shared: { instrument: { ticker: { value: 'NVDA' } } },
      memberDump: { member: 'valuation', facts: { per: { value: 20 } } },
    })

    assert.equal(result.score, 82)
    assert.equal(result.confidence, 'medium')
    assert.equal(result.reason, '밸류에이션과 목표주가 맥락이 긍정적이에요.')
    assert.deepEqual(result.warnings, ['일부 컨센서스 공백이 있어요.'])
    const provider = capturedBody?.['provider'] as { require_parameters?: boolean } | undefined
    const responseFormat = capturedBody?.['response_format'] as { type?: string } | undefined
    assert.equal(provider?.require_parameters, true)
    assert.equal(responseFormat?.type, 'json_schema')
  } finally {
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreUsCommitteeMember surfaces upstream OpenRouter errors', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const originalRetryCount = process.env.DEEPSCAN_LLM_RETRY_COUNT
  process.env.OPENROUTER_API_KEY = 'test-key'
  process.env.DEEPSCAN_LLM_RETRY_COUNT = '0'

  global.fetch = (async () => new Response(
    JSON.stringify({ error: { message: 'bad upstream', code: 502 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch

  try {
    await assert.rejects(
      () => scoreUsCommitteeMember('momentum', { shared: {}, memberDump: {} }),
      /bad upstream/,
    )
  } finally {
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
    if (originalRetryCount) {
      process.env.DEEPSCAN_LLM_RETRY_COUNT = originalRetryCount
    } else {
      delete process.env.DEEPSCAN_LLM_RETRY_COUNT
    }
  }
})
