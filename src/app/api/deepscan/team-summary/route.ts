import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEEPSCAN_TEAM_SUMMARY_MODEL = 'openai/gpt-oss-120b'
export const DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS = 1000
export const DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT = [
  'Reasoning: minimal.',
  '너는 모바일 주식 분석 앱의 한국어 애널리스트 겸 카피 에디터다.',
  '입력은 한 팀에 속한 3명 위원의 판단이며, 세 의견을 최종 사용자가 읽을 팀 단위 해석으로 풀어쓴다.',
  '출력은 JSON만 허용한다: {"summary":"..."}.',
  'summary는 한국어 2~3문장, 150~240자, 줄바꿈/목록/콜론/이모지 금지, 3문장 초과 금지.',
  '입력의 의견 1, 의견 2, 의견 3은 내부 구분용 라벨이며 출력에 절대 쓰지 마라.',
  '위원명·역할명·개별 주체명 언급을 금지한다. 금지어: 가치 분석가, 성장 전략가, 재무 감사관, 차트 마스터, 수급 추적기, 모멘텀 스카우터, 심리 분석AI, 산업 전문가, 이벤트 스캐너.',
  'A는 B라고 보고 C는 D라고 본다는 식의 개별 발언 나열을 금지하고, 공통 결론과 핵심 근거를 자연스럽게 합성하라.',
  '일부라도 리스크나 반대 신호가 있으면 세 위원 모두, 모두 긍정 같은 만장일치 표현을 쓰지 말고 전반적으로 또는 긍정·부정 신호가 엇갈린다는 식으로 균형 있게 써라.',
  '평단 대비 수익률이나 이미 크게 오른 가격은 추가 상승 여력의 근거가 아니라 현재 포지션 상태다. 상승 여력은 목표가와 현재가 차이 등 입력 근거가 있을 때만 말하라.',
  '현재가가 목표가에 근접했다면 추가 상승 여력이 크다고 쓰지 말고 여력 제한 또는 확인 필요로 해석하라.',
  '입력 간 충돌이 있으면 단정하지 말고 핵심 근거와 리스크를 함께 연결하며, 입력에 없는 수치·사실을 만들지 마라.',
  '매수·매도·보유·포지션 유지 같은 투자 행동 권유와 새 목표가 제시는 금지한다.',
].join(' ')
const DEFAULT_TEAM_SUMMARY_TIMEOUT_MS = 2500
const MAX_TEAM_BODY_CHARS = 2400

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

export function removeForbiddenInvestmentActionAdvice(value: string) {
  return cleanupSummary(value)
    .replace(/현재\s*포지션을\s*유지(?:하면서|하고|한다|하는|해야\s*한다)?/gu, '현재 구간을 기준으로')
    .replace(/포지션을\s*유지(?:하면서|하고|한다|하는|해야\s*한다)?/gu, '현재 구간을 기준으로')
    .replace(/포지션\s*유지/gu, '현재 구간 점검')
    .replace(/보유를\s*유지(?:하면서|하고|한다|하는|해야\s*한다)?/gu, '현재 구간을 기준으로')
    .replace(/보유\s*유지/gu, '현재 구간 점검')
    .replace(/매수를?\s*(?:추천|권고|권장|제안|고려)(?:합니다|한다|하세요)?/gu, '추가 진입 판단')
    .replace(/매수\s*하(?:세요|십시오|라|는\s*것이\s*좋습니다|는\s*게\s*좋습니다|는\s*전략)/gu, '추가 진입 판단')
    .replace(/매수(?:하세요|하십시오|하라|해야\s*합니다|해야\s*한다|가\s*유리합니다|보다)/gu, '추가 진입 판단')
    .replace(/매도를?\s*(?:추천|권고|권장|제안|고려)(?:합니다|한다|하세요)?/gu, '비중 조정 판단')
    .replace(/매도\s*하(?:세요|십시오|라|는\s*것이\s*좋습니다|는\s*게\s*좋습니다|는\s*전략)/gu, '비중 조정 판단')
    .replace(/매도(?:하세요|하십시오|하라|해야\s*합니다|해야\s*한다|가\s*유리합니다|보다)/gu, '비중 조정 판단')
    .replace(/보유를?\s*(?:추천|권고|권장|제안|고려)(?:합니다|한다|하세요)?/gu, '현재 구간 점검')
    .replace(/보유\s*하(?:세요|십시오|라|는\s*것이\s*좋습니다|는\s*게\s*좋습니다|는\s*전략)/gu, '현재 구간 점검')
    .replace(/보유(?:하세요|하십시오|하라|해야\s*합니다|해야\s*한다|가\s*유리합니다|가\s*낫습니다|관점)/gu, '현재 구간 점검')
    .replace(/\s+/g, ' ')
    .trim()
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
      return summary ? removeForbiddenInvestmentActionAdvice(summary) : null
    }
  } catch {
    // Some providers may return the sentence directly despite the JSON instruction.
  }

  return removeForbiddenInvestmentActionAdvice(text.replace(/^```(?:json)?/i, '').replace(/```$/i, ''))
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
          content: DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT,
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
    summary: removeForbiddenInvestmentActionAdvice(summary),
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
    const summary = removeForbiddenInvestmentActionAdvice(result.summary)
    return NextResponse.json({
      ok: true,
      teamKey,
      teamName,
      summary,
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
