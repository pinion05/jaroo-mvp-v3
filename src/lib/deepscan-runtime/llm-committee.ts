import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepScanRawInputForDump } from './us-dump-contract-runtime'
import { generateUsDumpContractArtifacts } from './us-dump-contract-runtime'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const US_MEMBER_KEYS = [
  'valuation',
  'growth',
  'profitability-quality',
  'momentum',
  'estimate-revision',
  'event-risk',
  'financial-safety',
  'ownership-flow',
  'portfolio-fit',
] as const

export type UsMemberKey = (typeof US_MEMBER_KEYS)[number]

export type CommitteeLlmVerdict = {
  score: number
  reason: string
  confidence: 'low' | 'medium' | 'high'
  warnings?: string[]
}

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
  error?: {
    message?: string
    code?: number
  }
}

const COMMITTEE_SCHEMA = {
  name: 'jaroo_us_committee_member',
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
} as const

const MEMBER_PROMPTS: Record<UsMemberKey, { role: string; focus: string }> = {
  valuation: {
    role: 'Valuation analyst',
    focus: 'Judge valuation attractiveness from price, valuation multiples, consensus target context, and missing-data warnings.',
  },
  growth: {
    role: 'Growth analyst',
    focus: 'Judge growth quality from revenue, operating income, net income progression, and forecast/revision signals.',
  },
  'profitability-quality': {
    role: 'Profitability analyst',
    focus: 'Judge profitability quality from margin and ROE-like evidence, penalizing fragile or incomplete evidence.',
  },
  momentum: {
    role: 'Momentum analyst',
    focus: 'Judge market timing from recent returns, current-vs-latest-close context, and market regime evidence.',
  },
  'estimate-revision': {
    role: 'Estimate revision analyst',
    focus: 'Judge revision momentum from consensus spot, forecast values, and revision percentages.',
  },
  'event-risk': {
    role: 'Event scanner',
    focus: 'Judge event catalyst or event risk from recent news, earnings/recommendation coverage, and target range context.',
  },
  'financial-safety': {
    role: 'Financial safety analyst',
    focus: 'Judge balance-sheet and cash-flow resilience from assets, equity, cash flow, capex, free cash flow, and ROE context.',
  },
  'ownership-flow': {
    role: 'Ownership and flow analyst',
    focus: 'Judge ownership/flow quality carefully, explicitly downgrading confidence when only proxy peer context is available.',
  },
  'portfolio-fit': {
    role: 'Position fit analyst',
    focus: 'Judge fit for the current position from holding context, current price, market-cap context, and medium-term return context.',
  },
}

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
  }

  return ''
}

function extractOpenRouterErrorMessage(result: OpenRouterResponse | null | undefined) {
  return typeof result?.error?.message === 'string' ? result.error.message.trim() : ''
}

function extractOpenRouterErrorStatus(result: OpenRouterResponse | null | undefined) {
  return typeof result?.error?.code === 'number' && Number.isInteger(result.error.code) ? result.error.code : 502
}

function clampScore(score: number) {
  return Math.min(100, Math.max(0, Math.round(score)))
}


function normalizeConfidence(value: unknown): CommitteeLlmVerdict['confidence'] | null {
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

function coerceCommitteeResult(value: unknown): CommitteeLlmVerdict | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  if (!record) {
    return null
  }

  let maybeWrapped: Record<string, unknown> = record
  for (const key of ['result', 'data', 'output', 'analysis', 'committee_result']) {
    if (maybeWrapped[key] && typeof maybeWrapped[key] === 'object' && !Array.isArray(maybeWrapped[key])) {
      maybeWrapped = maybeWrapped[key] as Record<string, unknown>
      break
    }
  }

  const scoreRaw = maybeWrapped.score ?? maybeWrapped.value ?? maybeWrapped.rating
  const score = typeof scoreRaw === 'number' ? scoreRaw : typeof scoreRaw === 'string' ? Number(scoreRaw) : NaN
  const reason = [maybeWrapped.reason, maybeWrapped.summary, maybeWrapped.analysis, maybeWrapped.rationale, maybeWrapped.thesis]
    .find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim() ?? ''
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
      ? { warnings: warningsSource.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) }
      : {}),
  }
}

function systemPromptForMember(member: UsMemberKey) {
  const prompt = MEMBER_PROMPTS[member]
  return [
    `You are Jaroo US DeepScan committee member: ${prompt.role}.`,
    prompt.focus,
    'Use only the provided shared/member JSON generated from the frozen llm-deepscan-us-dump-contract contract.',
    'Respect quality/issues metadata. Missing or unavailable facts must lower confidence and can lower the score.',
    'Return only valid JSON matching the schema. Write the reason in concise Korean.',
    'Score semantics: 0 extremely negative, 50 mixed/unclear, 100 extremely positive. Warnings are optional short Korean caveats.',
  ].join(' ')
}

export async function scoreUsCommitteeMember(
  member: UsMemberKey,
  dumps: { shared: unknown; memberDump: unknown },
): Promise<CommitteeLlmVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.DEEPSCAN_LLM_MODEL || process.env.OCR_MODEL || 'qwen/qwen3.5-flash-02-23'

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.')
  }

  const t0 = Date.now()
  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3312',
        'X-Title': 'jaroo-mvp-v3 DeepScan Committee',
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
      model,
      temperature: 0.1,
      provider: {
        require_parameters: true,
      },
      response_format: {
        type: 'json_schema',
        json_schema: COMMITTEE_SCHEMA,
      },
      messages: [
        {
          role: 'system',
          content: systemPromptForMember(member),
        },
        {
          role: 'user',
          content: `sharedContext:\n${JSON.stringify(dumps.shared, null, 2)}\n\nmemberContext:\n${JSON.stringify(dumps.memberDump, null, 2)}`,
        },
      ],
    }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenRouter committee request failed'
    throw new Error(`OpenRouter request failed for ${member}: ${message}`)
  }

  const result = (await upstreamResponse.json().catch(() => null)) as OpenRouterResponse | null
  const upstreamErrorMessage = extractOpenRouterErrorMessage(result)

  if (!upstreamResponse.ok || upstreamErrorMessage) {
    throw new Error(upstreamErrorMessage || `OpenRouter committee request failed (${!upstreamResponse.ok ? upstreamResponse.status : extractOpenRouterErrorStatus(result)})`)
  }

  const rawContent = extractTextContent(result?.choices?.[0]?.message?.content)
  if (!rawContent) {
    throw new Error(`OpenRouter returned empty committee response for ${member}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent) as unknown
  } catch {
    throw new Error(`OpenRouter returned invalid JSON for ${member}`)
  }

  const coerced = coerceCommitteeResult(parsed)
  if (!coerced) {
    throw new Error(`OpenRouter returned invalid committee schema for ${member}`)
  }

  const elapsed = Date.now() - t0
  const logEntry = {
    member,
    model,
    elapsed_ms: elapsed,
    status: upstreamResponse.status,
    raw_content: rawContent,
    parsed,
    coerced,
    timestamp: new Date().toISOString(),
  }

  // Write individual member log
  const logDir = join(process.cwd(), '.omx', 'context', 'committee-debug-logs')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(join(logDir, `${member}.json`), JSON.stringify(logEntry, null, 2))

  return coerced
}

export async function scoreUsCommitteeFromGeneratedDump(rawInput: DeepScanRawInputForDump, ticker: string) {
  const totalT0 = Date.now()
  const artifacts = await generateUsDumpContractArtifacts(rawInput, ticker)
  const dumpElapsed = Date.now() - totalT0
  const shared = artifacts.runtimeShape.shared
  const members = artifacts.runtimeShape.members as Record<UsMemberKey, unknown>

  const results = await Promise.all(
    US_MEMBER_KEYS.map(async (member) => {
      const memberDump = members[member]
      if (typeof memberDump === 'undefined') {
        throw new Error(`Missing generated runtime dump for ${member}`)
      }
      const result = await scoreUsCommitteeMember(member, { shared, memberDump })
      return [member, result] as const
    }),
  )

  const totalElapsed = Date.now() - totalT0
  const summaryLog = {
    ticker,
    model: process.env.DEEPSCAN_LLM_MODEL || process.env.OCR_MODEL || 'qwen/qwen3.5-flash-02-23',
    dump_generation_ms: dumpElapsed,
    total_llm_ms: totalElapsed - dumpElapsed,
    total_ms: totalElapsed,
    members: Object.fromEntries(results.map(([k, v]) => [k, { score: v.score, confidence: v.confidence, reason_preview: v.reason.slice(0, 80) }])),
    timestamp: new Date().toISOString(),
  }
  const logDir = join(process.cwd(), '.omx', 'context', 'committee-debug-logs')
  writeFileSync(join(logDir, '_summary.json'), JSON.stringify(summaryLog, null, 2))

  return {
    artifacts,
    results: Object.fromEntries(results) as Record<UsMemberKey, CommitteeLlmVerdict>,
  }
}
