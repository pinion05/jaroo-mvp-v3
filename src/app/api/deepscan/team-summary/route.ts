import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEEPSCAN_TEAM_SUMMARY_MODEL = 'openai/gpt-oss-120b'
export const DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS = 220
const DEFAULT_TEAM_SUMMARY_TIMEOUT_MS = 5000
const MAX_TEAM_BODY_CHARS = 2400
const MAX_TEAM_SUMMARY_CHARS = 88

type TeamSummaryRequestBody = {
  teamKey?: unknown
  teamName?: unknown
  body?: unknown
}

type TeamSummaryResult = {
  summary: string
  elapsedMs?: number
  model?: string
  provider?: string
}

type TeamSummaryRequester = (input: { teamKey: string; teamName: string; body: string }) => Promise<TeamSummaryResult>

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function truncateForPrompt(value: string) {
  return value.length <= MAX_TEAM_BODY_CHARS ? value : value.slice(0, MAX_TEAM_BODY_CHARS)
}

function cleanupSummary(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[-*•\d.\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function constrainSummaryLength(value: string) {
  const summary = cleanupSummary(value)
  if (summary.length <= MAX_TEAM_SUMMARY_CHARS) {
    return summary
  }

  const sliced = summary.slice(0, MAX_TEAM_SUMMARY_CHARS)
  const breakIndex = Math.max(sliced.lastIndexOf('다.'), sliced.lastIndexOf('.'), sliced.lastIndexOf(','), sliced.lastIndexOf('·'), sliced.lastIndexOf(' '))
  const candidate = breakIndex >= 42 ? sliced.slice(0, breakIndex + 1) : sliced
  return `${candidate.replace(/[,.·\s]+$/u, '').trim()}.`
}

export function parseTeamSummaryContent(content: string) {
  const text = content.trim()
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const summary = normalizeText((parsed as { summary?: unknown }).summary)
      return summary ? constrainSummaryLength(summary) : null
    }
  } catch {
    // Some providers may return the sentence directly despite the JSON instruction.
  }

  const unfencedText = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  if (/^[{[]/u.test(unfencedText)) {
    return null
  }

  return constrainSummaryLength(unfencedText)
}

async function callOpenRouterTeamSummary(input: { teamKey: string; teamName: string; body: string }): Promise<TeamSummaryResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.')
  }

  const startedAt = Date.now()
  const timeoutMs = parsePositiveInteger(process.env.DEEPSCAN_TEAM_SUMMARY_TIMEOUT_MS, DEFAULT_TEAM_SUMMARY_TIMEOUT_MS)
  const model = process.env.DEEPSCAN_TEAM_SUMMARY_MODEL ?? DEEPSCAN_TEAM_SUMMARY_MODEL
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'http://localhost:3000',
      'X-Title': 'jaroo-mvp-v3 DeepScan team summary',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      provider: {
        order: ['Cerebras'],
        quantizations: ['fp16'],
        allow_fallbacks: false,
      },
      reasoning: { effort: 'minimal', exclude: true },
      include_reasoning: false,
      temperature: 0.1,
      max_tokens: DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS,
      messages: [
        {
          role: 'system',
          content: [
            'Reasoning: minimal.',
            '너는 모바일 주식 분석 앱의 카피 에디터다.',
            '입력은 한 팀의 3명 위원 판단이다.',
            '출력은 JSON만 허용한다: {"summary":"..."}.',
            'summary는 한국어 한 문장, 55~85자, 절대 90자 초과 금지.',
            '줄바꿈/목록/위원 이름/콜론/말줄임표/투자 권유 금지.',
            '핵심 근거 1~2개와 판단만 짧게 압축하라.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `${input.teamName}\n${truncateForPrompt(input.body)}`,
        },
      ],
    }),
  })

  const result = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } } | null
  if (!response.ok || result?.error?.message) {
    throw new Error(result?.error?.message ?? `OpenRouter team summary failed (${response.status})`)
  }

  const content = typeof result?.choices?.[0]?.message?.content === 'string' ? result.choices[0].message.content : ''
  const summary = parseTeamSummaryContent(content)
  if (!summary) {
    throw new Error('OpenRouter team summary returned empty content.')
  }

  return {
    summary,
    elapsedMs: Date.now() - startedAt,
    model,
    provider: 'Cerebras/fp16',
  }
}

export async function createDeepScanTeamSummaryResponse(
  body: TeamSummaryRequestBody,
  requester: TeamSummaryRequester = callOpenRouterTeamSummary,
) {
  const teamKey = normalizeText(body.teamKey)
  const teamName = normalizeText(body.teamName)
  const rawBody = normalizeText(body.body)

  if (!teamKey || !teamName || !rawBody) {
    return NextResponse.json({ ok: false, error: { message: 'teamKey, teamName and body are required.' } }, { status: 400 })
  }

  try {
    const result = await requester({ teamKey, teamName, body: rawBody })
    return NextResponse.json({
      ok: true,
      teamKey,
      teamName,
      summary: constrainSummaryLength(result.summary),
      model: result.model ?? process.env.DEEPSCAN_TEAM_SUMMARY_MODEL ?? DEEPSCAN_TEAM_SUMMARY_MODEL,
      provider: result.provider ?? 'Cerebras/fp16',
      elapsedMs: result.elapsedMs,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        teamKey,
        teamName,
        error: { message: error instanceof Error ? error.message : 'team summary failed' },
      },
      { status: 502 },
    )
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as TeamSummaryRequestBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: { message: 'invalid JSON body' } }, { status: 400 })
  }

  return createDeepScanTeamSummaryResponse(body)
}
