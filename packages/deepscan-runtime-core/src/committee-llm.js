import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_LOG_DIR = join(process.cwd(), '.omx', 'context', 'committee-debug-logs')
const EMPTY_RESPONSE_RETRY_DELAY_MS = 2000

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

async function requestCommitteeAttempt(memberKey, dumps, runtimeOptions) {
  const startedAt = Date.now()
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
      body: JSON.stringify({
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
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenRouter committee request failed'
    throw new Error(`OpenRouter request failed for ${memberKey}: ${message}`)
  }

  const result = await upstreamResponse.json().catch(() => null)
  const upstreamErrorMessage = extractOpenRouterErrorMessage(result)
  if (!upstreamResponse.ok || upstreamErrorMessage) {
    throw new Error(upstreamErrorMessage || `OpenRouter committee request failed (${!upstreamResponse.ok ? upstreamResponse.status : extractOpenRouterErrorStatus(result)})`)
  }

  const rawContent = extractTextContent(result?.choices?.[0]?.message?.content)
  let parsed = null
  if (rawContent) {
    try {
      parsed = JSON.parse(rawContent)
    } catch {
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

export async function scoreCommitteeMember(memberKey, dumps, options) {
  const runtimeOptions = {
    apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
    model: options.model ?? process.env.DEEPSCAN_LLM_MODEL ?? process.env.OCR_MODEL ?? 'qwen/qwen3.5-flash-02-23',
    schemaName: options.schemaName ?? 'jaroo_committee_member',
    referer: options.referer ?? 'http://localhost:3312',
    title: options.title ?? 'jaroo-mvp-v3 DeepScan Committee',
    temperature: options.temperature ?? 0.1,
    timeoutMs: options.timeoutMs ?? 45000,
    logDir: options.logDir ?? DEFAULT_LOG_DIR,
    systemPrompt: options.systemPrompt,
  }

  if (!runtimeOptions.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.')
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptResult = await requestCommitteeAttempt(memberKey, dumps, runtimeOptions)
    const { upstreamResponse, rawContent, parsed, elapsedMs } = attemptResult

    if (!rawContent || parsed === null) {
      if (attempt === 0) {
        await delay(EMPTY_RESPONSE_RETRY_DELAY_MS)
        continue
      }

      writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, {
        member: memberKey,
        empty_content: rawContent.length === 0,
        status: upstreamResponse.status,
        elapsed_ms: elapsedMs,
        timestamp: new Date().toISOString(),
      })
      throw new Error(`OpenRouter returned ${rawContent ? 'null' : 'empty'} committee response for ${memberKey}`)
    }

    const coerced = coerceCommitteeResult(parsed)
    if (!coerced) {
      throw new Error(`OpenRouter returned invalid committee schema for ${memberKey}`)
    }

    writeLog(runtimeOptions.logDir, `${memberKey}.json`, {
      member: memberKey,
      model: runtimeOptions.model,
      elapsed_ms: elapsedMs,
      status: upstreamResponse.status,
      raw_content: rawContent,
      parsed,
      coerced,
      timestamp: new Date().toISOString(),
    })

    return coerced
  }

  throw new Error(`OpenRouter retry loop exhausted for ${memberKey}`)
}

export async function scoreCommitteeMembers({ memberKeys, shared, members, options }) {
  const settled = await Promise.allSettled(
    memberKeys.map(async (memberKey) => {
      const memberDump = members[memberKey]
      if (typeof memberDump === 'undefined') {
        throw new Error(`Missing generated runtime dump for ${memberKey}`)
      }
      const result = await scoreCommitteeMember(memberKey, { shared, memberDump }, options)
      return [memberKey, result]
    }),
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

  const logDir = options.logDir ?? DEFAULT_LOG_DIR
  writeLog(logDir, `_summary-${options.summaryKey ?? 'committee'}.json`, {
    summaryKey: options.summaryKey ?? 'committee',
    model: options.model ?? process.env.DEEPSCAN_LLM_MODEL ?? process.env.OCR_MODEL ?? 'qwen/qwen3.5-flash-02-23',
    members: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, { score: value?.score, confidence: value?.confidence, reason_preview: value?.reason.slice(0, 80) }])),
    errors,
    timestamp: new Date().toISOString(),
  })

  return { results, errors }
}
