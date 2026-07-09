import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_COMMITTEE_LLM_MODEL = 'deepseek/deepseek-v4-flash'
const DEFAULT_LOG_DIR = join(/* turbopackIgnore: true */ process.cwd(), '.omx', 'context', 'committee-debug-logs')
const EMPTY_RESPONSE_RETRY_DELAY_MS = 2000
const DEFAULT_COMMITTEE_PROGRESS_TTL_MS = 300_000
const committeeProgressRegistry = new Map()

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback
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

function nowIso() {
  return new Date().toISOString()
}

async function waitForAllDoneOrSoftDeadline(allDone, softDeadlineMs) {
  if (softDeadlineMs <= 0) {
    await allDone
    return
  }

  let timeoutId
  try {
    await Promise.race([
      allDone,
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, softDeadlineMs)
        timeoutId?.unref?.()
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function scheduleCommitteeProgressCleanup(job, ttlMs = DEFAULT_COMMITTEE_PROGRESS_TTL_MS) {
  if (!job?.requestId || job.cleanupScheduled) {
    return
  }

  job.cleanupScheduled = true
  const timeoutId = setTimeout(() => {
    committeeProgressRegistry.delete(job.requestId)
  }, Math.max(0, ttlMs))
  timeoutId?.unref?.()
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

function isNonRetryableOpenRouterError(message, status) {
  const text = String(message || '')
  if (/DataInspectionFailed|inappropriate content|content policy|safety|moderation/i.test(text)) {
    return true
  }

  return status === 400 || status === 401 || status === 403
}

class CommitteeLlmError extends Error {
  constructor(kind, message, details = {}) {
    super(message)
    this.name = 'CommitteeLlmError'
    this.kind = kind
    this.errorKind = kind
    this.attempt = details.attempt ?? null
    this.attempts = details.attempts ?? details.attempt ?? null
    this.status = details.status ?? null
    this.retryable = details.retryable ?? true
    this.llmResultPresent = false
  }
}

function asCommitteeLlmError(error, fallbackKind, fallbackMessage, details = {}) {
  if (error instanceof CommitteeLlmError) {
    return error
  }

  const message = error instanceof Error ? error.message : (fallbackMessage ?? String(error))
  return new CommitteeLlmError(fallbackKind, message, details)
}

function writeAttemptFailureLog(runtimeOptions, memberKey, attempt, payload) {
  const failureLog = {
    member: memberKey,
    attempt,
    ...payload,
    timestamp: new Date().toISOString(),
  }
  writeLog(runtimeOptions.logDir, `${memberKey}-attempt-${attempt}-failure.json`, failureLog)
  writeLog(runtimeOptions.logDir, `${memberKey}-failure.json`, failureLog)
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
    writeAttemptFailureLog(runtimeOptions, memberKey, attempt, {
      errorKind: 'llm-timeout-or-network',
      error: message,
      elapsed_ms: Date.now() - startedAt,
    })
    throw new CommitteeLlmError('llm-timeout-or-network', `OpenRouter request failed for ${memberKey}: ${message}`, {
      attempt,
    })
  }

  const result = await upstreamResponse.json().catch(() => null)
  const upstreamErrorMessage = extractOpenRouterErrorMessage(result)
  if (!upstreamResponse.ok || upstreamErrorMessage) {
    const message = upstreamErrorMessage || `OpenRouter committee request failed (${!upstreamResponse.ok ? upstreamResponse.status : extractOpenRouterErrorStatus(result)})`
    const errorStatus = !upstreamResponse.ok ? upstreamResponse.status : extractOpenRouterErrorStatus(result)
    const retryable = !isNonRetryableOpenRouterError(message, errorStatus)
    writeAttemptFailureLog(runtimeOptions, memberKey, attempt, {
      errorKind: 'llm-upstream-error',
      error: message,
      status: upstreamResponse.status,
      retryable,
      elapsed_ms: Date.now() - startedAt,
      choice: summarizeChoice(result),
      usage: extractUsage(result),
      upstream_result: result,
    })
    throw new CommitteeLlmError('llm-upstream-error', message, {
      attempt,
      status: upstreamResponse.status,
      retryable,
    })
  }

  const rawContent = extractTextContent(result?.choices?.[0]?.message?.content)
  let parsed = null
  if (rawContent) {
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      writeAttemptFailureLog(runtimeOptions, memberKey, attempt, {
        errorKind: 'llm-invalid-json',
        error: `OpenRouter returned invalid JSON for ${memberKey}`,
        status: upstreamResponse.status,
        elapsed_ms: Date.now() - startedAt,
        raw_content: rawContent,
        choice: summarizeChoice(result),
        usage: extractUsage(result),
        upstream_result: result,
      })
      throw new CommitteeLlmError('llm-invalid-json', `OpenRouter returned invalid JSON for ${memberKey}`, {
        attempt,
        status: upstreamResponse.status,
      })
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
    model: options.model ?? process.env.DEEPSCAN_LLM_MODEL ?? DEFAULT_COMMITTEE_LLM_MODEL,
    schemaName: options.schemaName ?? 'jaroo_committee_member',
    referer: options.referer ?? 'http://localhost:3312',
    title: options.title ?? 'jaroo-mvp-v3 DeepScan Committee',
    temperature: options.temperature ?? 0.1,
    timeoutMs: parsePositiveInteger(options.timeoutMs ?? process.env.DEEPSCAN_LLM_TIMEOUT_MS, 45000),
    emptyResponseRetryDelayMs: parsePositiveInteger(options.emptyResponseRetryDelayMs ?? process.env.DEEPSCAN_LLM_EMPTY_RETRY_DELAY_MS, EMPTY_RESPONSE_RETRY_DELAY_MS),
    retryCount: parseNonNegativeInteger(options.retryCount ?? process.env.DEEPSCAN_LLM_RETRY_COUNT, 3),
    logDir: options.logDir ?? DEFAULT_LOG_DIR,
    systemPrompt: options.systemPrompt,
  }

  if (!runtimeOptions.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.')
  }

  const maxAttempts = runtimeOptions.retryCount + 1

  let attemptNumber = 0
  while (true) {
    attemptNumber += 1
    try {
      const attemptResult = await requestCommitteeAttempt(memberKey, dumps, runtimeOptions, attemptNumber)
      const { upstreamResponse, result, rawContent, parsed, elapsedMs } = attemptResult

      if (!rawContent || parsed === null) {
        const errorKind = rawContent ? 'llm-null-content' : 'llm-empty-content'
        writeAttemptFailureLog(runtimeOptions, memberKey, attemptNumber, {
          errorKind,
          error: `OpenRouter returned ${rawContent ? 'null' : 'empty'} committee response for ${memberKey}`,
          empty_content: rawContent.length === 0,
          status: upstreamResponse.status,
          elapsed_ms: elapsedMs,
          raw_content: rawContent,
          parsed,
          choice: summarizeChoice(result),
          usage: extractUsage(result),
          upstream_result: result,
        })
        throw new CommitteeLlmError(errorKind, `OpenRouter returned ${rawContent ? 'null' : 'empty'} committee response for ${memberKey}`, {
          attempt: attemptNumber,
          status: upstreamResponse.status,
        })
      }

      const coerced = coerceCommitteeResult(parsed)
      if (!coerced) {
        writeAttemptFailureLog(runtimeOptions, memberKey, attemptNumber, {
          errorKind: 'llm-invalid-schema',
          error: `OpenRouter returned invalid committee schema for ${memberKey}`,
          status: upstreamResponse.status,
          elapsed_ms: elapsedMs,
          raw_content: rawContent,
          parsed,
          choice: summarizeChoice(result),
          usage: extractUsage(result),
          upstream_result: result,
        })
        throw new CommitteeLlmError('llm-invalid-schema', `OpenRouter returned invalid committee schema for ${memberKey}`, {
          attempt: attemptNumber,
          status: upstreamResponse.status,
        })
      }

      const finalResult = {
        ...coerced,
        attempts: attemptNumber,
        finalStatus: 'success',
        errorKind: null,
        llmResultPresent: true,
        model: runtimeOptions.model,
      }

      writeLog(runtimeOptions.logDir, `${memberKey}.json`, {
        member: memberKey,
        model: runtimeOptions.model,
        attempt: attemptNumber,
        attempts: attemptNumber,
        finalStatus: 'success',
        errorKind: null,
        llmResultPresent: true,
        elapsed_ms: elapsedMs,
        status: upstreamResponse.status,
        raw_content: rawContent,
        parsed,
        coerced,
        choice: summarizeChoice(result),
        usage: extractUsage(result),
        timestamp: new Date().toISOString(),
      })

      return finalResult
    } catch (error) {
      const committeeError = asCommitteeLlmError(error, 'llm-unknown', `OpenRouter committee request failed for ${memberKey}`, {
        attempt: attemptNumber,
      })
      committeeError.attempts = attemptNumber
      const canRetry = committeeError.retryable !== false && attemptNumber < maxAttempts
      committeeError.retryable = canRetry
      if (canRetry) {
        await delay(runtimeOptions.emptyResponseRetryDelayMs)
        continue
      }
      committeeError.retryable = false
      throw committeeError
    }
  }
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
        throw new CommitteeLlmError('runtime-missing-dump', `Missing generated runtime dump for ${memberKey}`, {
          attempts: 0,
          retryable: false,
        })
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
    const reason = asCommitteeLlmError(entry.reason, 'llm-unknown', String(entry.reason), {
      attempts: parseNonNegativeInteger(runtimeOptions.retryCount ?? process.env.DEEPSCAN_LLM_RETRY_COUNT, 3) + 1,
    })
    errors.push({
      member: memberKey,
      error: reason.message,
      errorKind: reason.errorKind ?? reason.kind ?? 'llm-unknown',
      attempts: reason.attempts ?? null,
      finalStatus: 'error',
      retryable: false,
      llmResultPresent: false,
      model: runtimeOptions.model ?? process.env.DEEPSCAN_LLM_MODEL ?? DEFAULT_COMMITTEE_LLM_MODEL,
    })
  })

  const logDir = runtimeOptions.logDir ?? DEFAULT_LOG_DIR
  writeLog(logDir, `_summary-${runtimeOptions.summaryKey ?? 'committee'}.json`, {
    summaryKey: runtimeOptions.summaryKey ?? 'committee',
    model: runtimeOptions.model ?? process.env.DEEPSCAN_LLM_MODEL ?? DEFAULT_COMMITTEE_LLM_MODEL,
    concurrency: Math.max(1, Math.min(memberKeys.length || 1, concurrency)),
    members: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
      score: value?.score,
      confidence: value?.confidence,
      reason_preview: value?.reason.slice(0, 80),
      attempts: value?.attempts ?? null,
      finalStatus: value?.finalStatus ?? 'success',
      errorKind: value?.errorKind ?? null,
      llmResultPresent: value?.llmResultPresent ?? true,
      model: value?.model ?? runtimeOptions.model ?? null,
    }])),
    errors,
    timestamp: new Date().toISOString(),
  })

  return { results, errors }
}

function createMemberError(memberKey, reason, runtimeOptions) {
  const committeeError = asCommitteeLlmError(reason, 'llm-unknown', String(reason), {
    attempts: parseNonNegativeInteger(runtimeOptions.retryCount ?? process.env.DEEPSCAN_LLM_RETRY_COUNT, 3) + 1,
  })

  return {
    member: memberKey,
    error: committeeError.message,
    errorKind: committeeError.errorKind ?? committeeError.kind ?? 'llm-unknown',
    attempts: committeeError.attempts ?? null,
    finalStatus: 'error',
    retryable: false,
    llmResultPresent: false,
    model: runtimeOptions.model ?? process.env.DEEPSCAN_LLM_MODEL ?? DEFAULT_COMMITTEE_LLM_MODEL,
  }
}

function createCommitteeProgressSnapshot(job) {
  const pending = job.memberKeys.filter((memberKey) => !job.results[memberKey] && !job.errors.some((error) => error.member === memberKey))
  const status = pending.length > 0
    ? 'partial'
    : Object.keys(job.results).length === 0 && job.errors.length > 0
      ? 'error'
      : 'complete'

  return {
    requestId: job.requestId,
    status,
    results: { ...job.results },
    errors: job.errors.map((error) => ({ ...error })),
    pending,
    completed: Object.keys(job.results).length,
    updatedAt: job.updatedAt,
    softDeadlineMs: job.softDeadlineMs,
  }
}

function writeCommitteeSummary(runtimeOptions, memberKeys, concurrency, snapshot) {
  const logDir = runtimeOptions.logDir ?? DEFAULT_LOG_DIR
  writeLog(logDir, `_summary-${runtimeOptions.summaryKey ?? 'committee'}.json`, {
    summaryKey: runtimeOptions.summaryKey ?? 'committee',
    requestId: snapshot.requestId,
    status: snapshot.status,
    model: runtimeOptions.model ?? process.env.DEEPSCAN_LLM_MODEL ?? DEFAULT_COMMITTEE_LLM_MODEL,
    concurrency: Math.max(1, Math.min(memberKeys.length || 1, concurrency)),
    completed: snapshot.completed,
    pending: snapshot.pending,
    members: Object.fromEntries(Object.entries(snapshot.results).map(([key, value]) => [key, {
      score: value?.score,
      confidence: value?.confidence,
      reason_preview: value?.reason?.slice?.(0, 80),
      attempts: value?.attempts ?? null,
      finalStatus: value?.finalStatus ?? 'success',
      errorKind: value?.errorKind ?? null,
      llmResultPresent: value?.llmResultPresent ?? true,
      model: value?.model ?? runtimeOptions.model ?? null,
    }])),
    errors: snapshot.errors,
    timestamp: nowIso(),
  })
}

export function getCommitteeProgress(requestId) {
  if (!requestId || !committeeProgressRegistry.has(requestId)) {
    return null
  }

  return createCommitteeProgressSnapshot(committeeProgressRegistry.get(requestId))
}

export async function scoreCommitteeMembersProgressive({ memberKeys, shared, members, options = {} }) {
  const runtimeOptions = options ?? {}
  const requestId = runtimeOptions.requestId ?? `committee-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const concurrency = parsePositiveInteger(runtimeOptions.concurrency ?? process.env.DEEPSCAN_LLM_CONCURRENCY, memberKeys.length || 1)
  const softDeadlineMs = parseNonNegativeInteger(runtimeOptions.softDeadlineMs ?? process.env.DEEPSCAN_LLM_SOFT_DEADLINE_MS, 0)
  const job = {
    requestId,
    memberKeys: [...memberKeys],
    results: {},
    errors: [],
    updatedAt: nowIso(),
    softDeadlineMs,
    cleanupScheduled: false,
  }
  committeeProgressRegistry.set(requestId, job)

  let nextIndex = 0
  const limit = Math.max(1, Math.min(memberKeys.length || 1, concurrency))

  async function runWorker() {
    while (nextIndex < memberKeys.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const memberKey = memberKeys[currentIndex]

      try {
        const memberDump = members[memberKey]
        if (typeof memberDump === 'undefined') {
          throw new CommitteeLlmError('runtime-missing-dump', `Missing generated runtime dump for ${memberKey}`, {
            attempts: 0,
            retryable: false,
          })
        }

        job.results[memberKey] = await scoreCommitteeMember(memberKey, { shared, memberDump }, runtimeOptions)
      } catch (reason) {
        job.errors.push(createMemberError(memberKey, reason, runtimeOptions))
      } finally {
        job.updatedAt = nowIso()
      }
    }
  }

  const allDone = memberKeys.length === 0
    ? Promise.resolve()
    : Promise.all(Array.from({ length: limit }, () => runWorker())).then(() => undefined)

  await waitForAllDoneOrSoftDeadline(allDone, softDeadlineMs)

  const snapshot = createCommitteeProgressSnapshot(job)
  writeCommitteeSummary(runtimeOptions, memberKeys, concurrency, snapshot)

  void allDone
    .then(() => {
      const finalSnapshot = createCommitteeProgressSnapshot(job)
      writeCommitteeSummary(runtimeOptions, memberKeys, concurrency, finalSnapshot)
      scheduleCommitteeProgressCleanup(job, parseNonNegativeInteger(runtimeOptions.progressTtlMs, DEFAULT_COMMITTEE_PROGRESS_TTL_MS))
    })
    .catch((error) => {
      console.error(`[committee-llm] background committee job failed: ${requestId}`, error)
      committeeProgressRegistry.delete(requestId)
    })

  return snapshot
}
