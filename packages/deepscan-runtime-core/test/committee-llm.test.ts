import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  getCommitteeProgress,
  scoreCommitteeMember,
  scoreCommitteeMembers,
  scoreCommitteeMembersProgressive,
} from '../src/committee-llm.js'

test('committee request, retry, success, and summary logs redact nested credential sentinels', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-safe-'))
  const secret = 'core-log-secret-sentinel-195'
  process.env.OPENROUTER_API_KEY = 'transport-secret-sentinel-195'
  let attempt = 0

  global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    attempt += 1
    const requestBody = String(init?.body ?? '')
    assert.equal(requestBody.includes(secret), false)
    if (attempt === 1) {
      return new Response(JSON.stringify({
        error: { message: `api_key=${secret}` },
        access_token: secret,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ score: 70, reason: '정상 응답입니다.', confidence: 'medium' }),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const result = await scoreCommitteeMembers({
      memberKeys: ['valuation'],
      shared: {
        ApiKey: secret,
        nested: { authorization: `Bearer ${secret}`, url: `https://example.test/?token=${secret}` },
      },
      members: { valuation: { member: 'valuation', facts: { safe: true } } },
      options: {
        schemaName: 'jaroo_safe_log_test',
        title: 'safe log test',
        systemPrompt: () => 'test',
        logDir,
        retryCount: 1,
        emptyResponseRetryDelayMs: 1,
        summaryKey: 'safe-log',
      },
    })
    assert.equal(result.results.valuation.score, 70)

    const files = [
      'request-valuation-attempt-1.json',
      'valuation-attempt-1-failure.json',
      'valuation.json',
      '_summary-safe-log.json',
    ]
    for (const file of files) {
      const contents = readFileSync(join(logDir, file), 'utf8')
      assert.equal(contents.includes(secret), false, file)
      assert.equal(contents.includes('transport-secret-sentinel-195'), false, file)
    }
    assert.match(readFileSync(join(logDir, 'request-valuation-attempt-1.json'), 'utf8'), /\[REDACTED\]/)
    assert.match(readFileSync(join(logDir, 'valuation-attempt-1-failure.json'), 'utf8'), /\[REDACTED\]/)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
  }
})

test('scoreCommitteeMember sends strict OpenRouter schema request and parses JSON response', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
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
        logDir,
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

    const requestLog = JSON.parse(readFileSync(join(logDir, 'request-valuation.json'), 'utf8')) as { request?: { messages?: Array<{ role?: string; content?: string }> } }
    assert.equal(requestLog.request?.messages?.[0]?.role, 'system')
    assert.equal(requestLog.request?.messages?.[0]?.content, 'member:valuation')
    assert.match(requestLog.request?.messages?.[1]?.content ?? '', /sharedContext=/)

    const successLog = JSON.parse(readFileSync(join(logDir, 'valuation.json'), 'utf8')) as { raw_content?: string; attempt?: number }
    assert.equal(successLog.attempt, 1)
    assert.match(successLog.raw_content ?? '', /덤프 근거/)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
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
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  global.fetch = (async () => new Response(
    JSON.stringify({ error: { message: 'bad upstream', code: 502 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch

  try {
    await assert.rejects(
      () => scoreCommitteeMember('momentum', { shared: {}, memberDump: {} }, {
        systemPrompt: () => 'prompt',
        logDir,
        retryCount: 0,
      }),
      /bad upstream/,
    )

    const requestLog = JSON.parse(readFileSync(join(logDir, 'request-momentum.json'), 'utf8')) as { request?: { messages?: Array<{ content?: string }> } }
    assert.equal(requestLog.request?.messages?.[0]?.content, 'prompt')
    const failureLog = JSON.parse(readFileSync(join(logDir, 'momentum-failure.json'), 'utf8')) as { error?: string; upstream_result?: { error?: { message?: string } } }
    assert.equal(failureLog.error, 'bad upstream')
    assert.equal(failureLog.upstream_result?.error?.message, 'bad upstream')
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMember does not retry deterministic provider content inspection rejections', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  let fetchCount = 0
  global.fetch = (async () => {
    fetchCount += 1
    return new Response(
      JSON.stringify({
        error: {
          message: 'Upstream error from Alibaba: <400> InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.',
          code: 502,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    await assert.rejects(
      () => scoreCommitteeMember('trend', { shared: {}, memberDump: {} }, {
        systemPrompt: () => 'prompt',
        logDir,
        retryCount: 3,
        emptyResponseRetryDelayMs: 1,
      }),
      /DataInspectionFailed/,
    )

    assert.equal(fetchCount, 1)
    const failureLog = JSON.parse(readFileSync(join(logDir, 'trend-failure.json'), 'utf8')) as { retryable?: boolean; attempt?: number }
    assert.equal(failureLog.retryable, false)
    assert.equal(failureLog.attempt, 1)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMember retries invalid JSON before returning a valid verdict', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  let fetchCount = 0
  global.fetch = (async () => {
    fetchCount += 1
    if (fetchCount === 1) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{not-json' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 66,
                reason: '재시도 후 정상 JSON을 받았어요.',
                confidence: 'medium',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const result = await scoreCommitteeMember('valuation', { shared: {}, memberDump: {} }, {
      systemPrompt: () => 'prompt',
      logDir,
      emptyResponseRetryDelayMs: 1,
      retryCount: 3,
    })

    assert.equal(fetchCount, 2)
    assert.equal(result.score, 66)
    assert.equal(result.attempts, 2)
    assert.equal(result.finalStatus, 'success')
    const firstFailure = JSON.parse(readFileSync(join(logDir, 'valuation-attempt-1-failure.json'), 'utf8')) as { errorKind?: string }
    assert.equal(firstFailure.errorKind, 'llm-invalid-json')
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMembers limits parallel OpenRouter requests and records concurrency in the summary log', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  let active = 0
  let maxActive = 0

  global.fetch = (async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 70,
                reason: '동시성 제한 안에서 처리됐어요.',
                confidence: 'medium',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const memberKeys = ['profitability', 'valuation', 'trend', 'upsideBuffer']
    const { results, errors } = await scoreCommitteeMembers({
      memberKeys,
      shared: { source: 'fixture' },
      members: Object.fromEntries(memberKeys.map((memberKey) => [memberKey, { member: memberKey }])),
      options: {
        concurrency: 2,
        schemaName: 'jaroo_test_member',
        title: 'test committee',
        systemPrompt: (memberKey: string) => `member:${memberKey}`,
        logDir,
      },
    })

    assert.equal(maxActive, 2)
    assert.deepEqual(errors, [])
    assert.deepEqual(Object.keys(results).sort(), memberKeys.sort())
    const summary = JSON.parse(readFileSync(join(logDir, '_summary-committee.json'), 'utf8')) as { concurrency?: number }
    assert.equal(summary.concurrency, 2)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMembers exhausts initial attempt plus three retries into structured member errors', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  let momentumAttempts = 0
  global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role?: string; content?: string }> }
    const userMessage = body.messages?.find((message) => message.role === 'user')
    const content = userMessage?.content ?? ''
    if (content.includes('"member":"momentum"')) {
      momentumAttempts += 1
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 72,
                reason: '정상 위원 응답입니다.',
                confidence: 'high',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const { results, errors } = await scoreCommitteeMembers({
      memberKeys: ['valuation', 'momentum'],
      shared: { source: 'fixture' },
      members: {
        valuation: { member: 'valuation' },
        momentum: { member: 'momentum' },
      },
      options: {
        concurrency: 1,
        schemaName: 'jaroo_test_member',
        title: 'test committee',
        systemPrompt: (memberKey: string) => `member:${memberKey}`,
        logDir,
        emptyResponseRetryDelayMs: 1,
        retryCount: 3,
      },
    })

    assert.equal(momentumAttempts, 4)
    const typedResults = results as Record<string, { score?: number }>
    assert.equal(typedResults.valuation?.score, 72)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].member, 'momentum')
    assert.equal(errors[0].errorKind, 'llm-empty-content')
    assert.equal(errors[0].attempts, 4)
    assert.equal(errors[0].finalStatus, 'error')
    assert.equal(errors[0].llmResultPresent, false)

    const summary = JSON.parse(readFileSync(join(logDir, '_summary-committee.json'), 'utf8')) as { errors?: Array<{ member?: string; attempts?: number; errorKind?: string }> }
    assert.equal(summary.errors?.[0]?.member, 'momentum')
    assert.equal(summary.errors?.[0]?.attempts, 4)
    assert.equal(summary.errors?.[0]?.errorKind, 'llm-empty-content')
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMembers reports missing generated dumps with runtime taxonomy and no attempts', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  try {
    const { results, errors } = await scoreCommitteeMembers({
      memberKeys: ['valuation'],
      shared: { source: 'fixture' },
      members: {},
      options: {
        schemaName: 'jaroo_test_member',
        title: 'test committee',
        systemPrompt: (memberKey: string) => `member:${memberKey}`,
        logDir,
      },
    })

    assert.deepEqual(results, {})
    assert.equal(errors.length, 1)
    assert.equal(errors[0].member, 'valuation')
    assert.equal(errors[0].errorKind, 'runtime-missing-dump')
    assert.equal(errors[0].attempts, 0)
    assert.equal(errors[0].retryable, false)
    assert.equal(errors[0].llmResultPresent, false)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMembersProgressive returns partial at soft deadline and updates registry later', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  const requestId = `test-progressive-${Date.now()}`
  process.env.OPENROUTER_API_KEY = 'test-key'

  global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role?: string; content?: string }> }
    const userMessage = body.messages?.find((message) => message.role === 'user')
    const content = userMessage?.content ?? ''
    if (content.includes('"member":"slow"')) {
      await new Promise((resolve) => setTimeout(resolve, 60))
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: content.includes('"member":"slow"') ? 51 : 74,
                reason: 'progressive 테스트 응답입니다.',
                confidence: 'medium',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const startedAt = Date.now()
    const initial = await scoreCommitteeMembersProgressive({
      memberKeys: ['fast', 'slow'],
      shared: { source: 'fixture' },
      members: {
        fast: { member: 'fast' },
        slow: { member: 'slow' },
      },
      options: {
        requestId,
        concurrency: 2,
        softDeadlineMs: 10,
        schemaName: 'jaroo_test_member',
        title: 'test committee',
        systemPrompt: (memberKey: string) => `member:${memberKey}`,
        logDir,
      },
    })

    assert.equal(initial.status, 'partial')
    assert.equal(initial.results.fast.score, 74)
    assert.deepEqual(initial.pending, ['slow'])
    assert.ok(Date.now() - startedAt < 50)

    await new Promise((resolve) => setTimeout(resolve, 80))
    const final = getCommitteeProgress(requestId)
    assert.equal(final?.status, 'complete')
    assert.equal(final?.results.slow.score, 51)
    assert.deepEqual(final?.pending, [])
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})

test('scoreCommitteeMembersProgressive evicts completed progress after TTL', async () => {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-llm-'))
  const requestId = `test-progressive-ttl-${Date.now()}`
  process.env.OPENROUTER_API_KEY = 'test-key'

  global.fetch = (async () => new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 68,
              reason: 'ttl 테스트 응답입니다.',
              confidence: 'medium',
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch

  try {
    const initial = await scoreCommitteeMembersProgressive({
      memberKeys: ['valuation'],
      shared: { source: 'fixture' },
      members: {
        valuation: { member: 'valuation' },
      },
      options: {
        requestId,
        concurrency: 1,
        softDeadlineMs: 0,
        progressTtlMs: 10,
        schemaName: 'jaroo_test_member',
        title: 'test committee',
        systemPrompt: (memberKey: string) => `member:${memberKey}`,
        logDir,
      },
    })

    assert.equal(initial.status, 'complete')
    assert.equal(getCommitteeProgress(requestId)?.status, 'complete')

    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(getCommitteeProgress(requestId), null)
  } finally {
    rmSync(logDir, { recursive: true, force: true })
    global.fetch = originalFetch
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  }
})
