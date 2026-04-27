import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_LOG_DIR = join(process.cwd(), '.omx', 'context', 'committee-debug-logs')
const EMPTY_RESPONSE_RETRY_DELAY_MS = 2000

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function ensureLogDir(logDir) {
  mkdirSync(logDir, { recursive: true })
}

function writeLog(logDir, filename, payload) {
  ensureLogDir(logDir)
  writeFileSync(join(logDir, filename), JSON.stringify(payload, null, 2))
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function allSettledWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(items.length, concurrency))
  const settled = new Array(items.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      try {
        settled[currentIndex] = {
          status: 'fulfilled',
          value: await worker(items[currentIndex], currentIndex),
        }
      } catch (reason) {
        settled[currentIndex] = {
          status: 'rejected',
          reason,
        }
      }
    }
  }

  if (items.length === 0) {
    return settled
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()))
  return settled
}

function buildRequestBody(memberKey, dumps, runtimeOptions) {
  return {
    model: runtimeOptions.model,
    temperature: runtimeOptions.temperature,
    provider: {
      require_parameters: true,
    },
    response_format: {
      type: 'json_schema',
      json_schema: createSchema(runtimeOptions.schemaName),
    },
    messages: [
      {
        role: 'system',
        content: runtimeOptions.systemPrompt(memberKey),
      },
      {
        role: 'user',
        content: `sharedContext=${JSON.stringify(dumps.shared)}\nmemberContext=${JSON.stringify(dumps.memberDump)}`,
      },
    ],
  }
}

function summarizeChoice(result) {
  const choice = result?.choices?.[0]
  if (!choice || typeof choice !== 'object') {
    return null
  }

  return {
    finish_reason: choice.finish_reason ?? null,
    native_finish_reason: choice.native_finish_reason ?? null,
    message_role: choice.message?.role ?? null,
    message_refusal: choice.message?.refusal ?? null,
    content_shape: Array.isArray(choice.message?.content) ? 'array' : typeof choice.message?.content,
  }
}

function extractUsage(result) {
  return result?.usage && typeof result.usage === 'object' ? result.usage : null
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim()
  }

  return ''
}

function extractOpenRouterErrorMessage(result) {
  return typeof result?.error?.message === 'string' ? result.error.message.trim() : ''
}

function extractOpenRouterErrorStatus(result) {
  return typeof result?.error?.code === 'number' && Number.isInteger(result.error.code) ? result.error.code : 502
}

function clampScore(score) {
  return Math.min(100, Math.max(0, Math.round(score)))
}

function normalizeConfidence(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized
  }
  if (['strong', 'confident'].includes(normalized)) {
    return 'high'
  }
  if (['mixed', 'moderate', 'mid'].includes(normalized)) {
    return 'medium'
  }
  if (['weak', 'caution', 'uncertain'].includes(normalized)) {
    return 'low'
  }
  return null
}

function coerceCommitteeResult(value) {
  const record = value && typeof value === 'object' ? value : null
  if (!record) {
    return null
  }

  let maybeWrapped = record
  for (const key of ['result', 'data', 'output', 'analysis', 'committee_result']) {
    if (maybeWrapped[key] && typeof maybeWrapped[key] === 'object' && !Array.isArray(maybeWrapped[key])) {
      maybeWrapped = maybeWrapped[key]
      break
    }
  }

  const scoreRaw = maybeWrapped.score ?? maybeWrapped.value ?? maybeWrapped.rating
  const score = typeof scoreRaw === 'number' ? scoreRaw : typeof scoreRaw === 'string' ? Number(scoreRaw) : NaN
  const reason = [maybeWrapped.reason, maybeWrapped.summary, maybeWrapped.analysis, maybeWrapped.rationale, maybeWrapped.thesis]
    .find((item) => typeof item === 'string' && item.trim().length > 0)?.trim() ?? ''
  const confidence = normalizeConfidence(maybeWrapped.confidence ?? maybeWrapped.certainty) ?? 'medium'
  const warningsSource = maybeWrapped.warnings ?? maybeWrapped.caveats
  if (!Number.isFinite(score) || !reason) {
    return null
  }

  return {
    score: clampScore(score),
    reason,
    confidence,
    ...(Array.isArray(warningsSource)
      ? { warnings: warningsSource.filter((item) => typeof item === 'string' && item.trim().length > 0) }
      : {}),
  }
}

function createSchema(schemaName) {
  return {
    name: schemaName,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        reason: { type: 'string', minLength: 1, maxLength: 400 },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        warnings: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['score', 'reason', 'confidence'],
    },
  }
}

async function requestCommitteeAttempt(memberKey, dumps, runtimeOptions, attempt) {
  const startedAt = Date.now()
  const requestBody = buildRequestBody(memberKey, dumps, runtimeOptions)
  const requestLog = {
    member: memberKey,
    attempt,
    request: requestBody,
    timestamp: new Date().toISOString(),
  }
  writeLog(runtimeOptions.logDir, `request-${memberKey}.json`, requestLog)
  writeLog(runtimeOptions.logDir, `request-${memberKey}-attempt-${attempt}.json`, requestLog)

  let upstreamResponse
  try {
    upstreamResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeOptions.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': runtimeOptions.referer,
        'X-Title': runtimeOptions.title,
      },
      signal: AbortSignal.timeout(runtimeOptions.timeoutMs),
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenRouter committee request failed'
    writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, {
      member: memberKey,
      attempt,
      error: message,
      elapsed_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
    throw new Error(`OpenRouter request failed for ${memberKey}: ${message}`)
  }

  const result = await upstreamResponse.json().catch(() => null)
  const upstreamErrorMessage = extractOpenRouterErrorMessage(result)
  if (!upstreamResponse.ok || upstreamErrorMessage) {
    const message = upstreamErrorMessage || `OpenRouter committee request failed (${!upstreamResponse.ok ? upstreamResponse.status : extractOpenRouterErrorStatus(result)})`
    writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, {
      member: memberKey,
      attempt,
      error: message,
      status: upstreamResponse.status,
      elapsed_ms: Date.now() - startedAt,
      choice: summarizeChoice(result),
      usage: extractUsage(result),
      upstream_result: result,
      timestamp: new Date().toISOString(),
    })
    throw new Error(message)
  }

  const rawContent = extractTextContent(result?.choices?.[0]?.message?.content)
  let parsed = null
  if (rawContent) {
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, {
        member: memberKey,
        attempt,
        error: `OpenRouter returned invalid JSON for ${memberKey}`,
        status: upstreamResponse.status,
        elapsed_ms: Date.now() - startedAt,
        raw_content: rawContent,
        choice: summarizeChoice(result),
        usage: extractUsage(result),
        upstream_result: result,
        timestamp: new Date().toISOString(),
      })
      throw new Error(`OpenRouter returned invalid JSON for ${memberKey}`)
    }
  }

  return {
    upstreamResponse,
    result,
    rawContent,
    parsed,
    elapsedMs: Date.now() - startedAt,
  }
}

export async function scoreCommitteeMember(memberKey, dumps, options = {}) {
  const runtimeOptions = {
    apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
    model: options.model ?? process.env.DEEPSCAN_LLM_MODEL ?? process.env.OCR_MODEL ?? 'qwen/qwen3.5-flash-02-23',
    schemaName: options.schemaName ?? 'jaroo_committee_member',
    referer: options.referer ?? 'http://localhost:3312',
    title: options.title ?? 'jaroo-mvp-v3 DeepScan Committee',
    temperature: options.temperature ?? 0.1,
    timeoutMs: parsePositiveInteger(options.timeoutMs ?? process.env.DEEPSCAN_LLM_TIMEOUT_MS, 45000),
    emptyResponseRetryDelayMs: parsePositiveInteger(options.emptyResponseRetryDelayMs ?? process.env.DEEPSCAN_LLM_EMPTY_RETRY_DELAY_MS, EMPTY_RESPONSE_RETRY_DELAY_MS),
    logDir: options.logDir ?? DEFAULT_LOG_DIR,
    systemPrompt: options.systemPrompt,
  }

  if (!runtimeOptions.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.')
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptNumber = attempt + 1
    const attemptResult = await requestCommitteeAttempt(memberKey, dumps, runtimeOptions, attemptNumber)
    const { upstreamResponse, result, rawContent, parsed, elapsedMs } = attemptResult

    if (!rawContent || parsed === null) {
      const emptyAttemptLog = {
        member: memberKey,
        attempt: attemptNumber,
        empty_content: rawContent.length === 0,
        status: upstreamResponse.status,
        elapsed_ms: elapsedMs,
        raw_content: rawContent,
        parsed,
        choice: summarizeChoice(result),
        usage: extractUsage(result),
        upstream_result: result,
        timestamp: new Date().toISOString(),
      }
      writeLog(runtimeOptions.logDir, `${memberKey}-attempt-${attemptNumber}.json`, emptyAttemptLog)
      if (attempt === 0) {
        await delay(runtimeOptions.emptyResponseRetryDelayMs)
        continue
      }

      writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, {
        member: memberKey,
        attempt: attemptNumber,
        empty_content: rawContent.length === 0,
        status: upstreamResponse.status,
        elapsed_ms: elapsedMs,
        raw_content: rawContent,
        parsed,
        choice: summarizeChoice(result),
        usage: extractUsage(result),
        upstream_result: result,
        timestamp: new Date().toISOString(),
      })
      throw new Error(`OpenRouter returned ${rawContent ? 'null' : 'empty'} committee response for ${memberKey}`)
    }

    const coerced = coerceCommitteeResult(parsed)
    if (!coerced) {
      writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, {
        member: memberKey,
        attempt: attemptNumber,
        error: `OpenRouter returned invalid committee schema for ${memberKey}`,
        status: upstreamResponse.status,
        elapsed_ms: elapsedMs,
        raw_content: rawContent,
        parsed,
        choice: summarizeChoice(result),
        usage: extractUsage(result),
        upstream_result: result,
        timestamp: new Date().toISOString(),
      })
      throw new Error(`OpenRouter returned invalid committee schema for ${memberKey}`)
    }

    writeLog(runtimeOptions.logDir, `${memberKey}.json`, {
      member: memberKey,
      model: runtimeOptions.model,
      attempt: attemptNumber,
      elapsed_ms: elapsedMs,
      status: upstreamResponse.status,
      raw_content: rawContent,
      parsed,
      coerced,
      choice: summarizeChoice(result),
      usage: extractUsage(result),
      timestamp: new Date().toISOString(),
    })

    return coerced
  }

  throw new Error(`OpenRouter retry loop exhausted for ${memberKey}`)
}

export async function scoreCommitteeMembers({ memberKeys, shared, members, options = {} }) {
  const runtimeOptions = options ?? {}
  const concurrency = parsePositiveInteger(runtimeOptions.concurrency ?? process.env.DEEPSCAN_LLM_CONCURRENCY, memberKeys.length || 1)
  const settled = await allSettledWithConcurrency(
    memberKeys,
    concurrency,
    async (memberKey) => {
      const memberDump = members[memberKey]
      if (typeof memberDump === 'undefined') {
        throw new Error(`Missing generated runtime dump for ${memberKey}`)
      }
      const result = await scoreCommitteeMember(memberKey, { shared, memberDump }, runtimeOptions)
      return [memberKey, result]
    },
  )

  const results = {}
  const errors = []
  settled.forEach((entry, index) => {
    const memberKey = memberKeys[index]
    if (entry.status === 'fulfilled') {
      const [fulfilledMember, result] = entry.value
      results[fulfilledMember] = result
      return
    }
    const reason = entry.reason instanceof Error ? entry.reason.message : String(entry.reason)
    errors.push({ member: memberKey, error: reason })
  })

  const logDir = runtimeOptions.logDir ?? DEFAULT_LOG_DIR
  writeLog(logDir, `_summary-${runtimeOptions.summaryKey ?? 'committee'}.json`, {
    summaryKey: runtimeOptions.summaryKey ?? 'committee',
    model: runtimeOptions.model ?? process.env.DEEPSCAN_LLM_MODEL ?? process.env.OCR_MODEL ?? 'qwen/qwen3.5-flash-02-23',
    concurrency: Math.max(1, Math.min(memberKeys.length || 1, concurrency)),
    members: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, { score: value?.score, confidence: value?.confidence, reason_preview: value?.reason.slice(0, 80) }])),
    errors,
    timestamp: new Date().toISOString(),
  })

  return { results, errors }
}
