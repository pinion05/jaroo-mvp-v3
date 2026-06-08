import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEEPSCAN_TEAM_SUMMARY_MODEL = 'openai/gpt-oss-120b'
export const DEEPSCAN_TEAM_SUMMARY_MAX_TOKENS = 1000
export const DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT = [
  'Reasoning: minimal.',
  '너는 모바일 주식 분석 앱 Jaroo의 한국어 애널리스트 겸 카피 에디터다.',
  '입력은 한 팀에 속한 3명 위원의 판단이지만, 출력은 최종 사용자가 읽는 하나의 자연스러운 해석이어야 한다.',
  '출력은 JSON만 허용한다: {"summary":"..."}.',
  'summary는 한국어 3~4문장, 220~360자, 줄바꿈/목록/콜론/이모지 금지, 4문장 초과 금지.',
  'Jaroo 말투를 고정한다. 친근한 존댓말로 쓰고 문장 끝은 주로 “~예요”, “~해요”, “~보여요”, “~봐야 해요”를 사용하라.',
  '딱딱한 리포트체를 금지한다. “~입니다”, “~합니다”, “판단됩니다”, “평가됩니다”, “기록하고 있습니다” 같은 표현은 쓰지 마라.',
  '사용자에게 직접 설명하되 투자 조언처럼 명령하지 말고, “지금 구간은”, “눈여겨볼 부분은”, “확인할 점은”처럼 해석 중심으로 말하라.',
  '입력의 의견 1, 의견 2, 의견 3과 위원명은 내부 라벨이다. 출력에 절대 쓰지 말고, 라벨 뒤의 사실만 흡수하라.',
  '위원명·역할명·개별 주체명·메타 표현 언급을 금지한다. 금지어: 위원, 의견, 팀, 분석가, AI, 가치 분석가, 성장 전략가, 재무 감사관, 차트 마스터, 수급 추적기, 모멘텀 스카우터, 심리 분석AI, 산업 전문가, 이벤트 스캐너.',
  'A는 B라고 보고 C는 D라고 본다는 식의 개별 발언 나열을 금지하고, “현재 상태 → 근거 → 리스크/확인점” 순서로 하나의 해석처럼 합성하라.',
  '일부라도 리스크나 반대 신호가 있으면 “모두 긍정”, “전부 우호적”, “만장일치” 같은 표현을 쓰지 말고 긍정 신호와 확인점을 함께 써라.',
  '평단 대비 수익률이나 이미 크게 오른 가격은 추가 상승 여력의 근거가 아니라 현재 포지션 상태다. 상승 여력은 목표가와 현재가 차이 등 입력 근거가 있을 때만 말하라.',
  '현재가가 목표가에 근접했다면 추가 상승 여력이 크다고 쓰지 말고 여력 제한 또는 확인 필요로 해석하라.',
  '입력 간 충돌이 있으면 단정하지 말고 핵심 근거와 리스크를 함께 연결하며, 입력에 없는 수치·사실을 만들지 마라.',
  '매수·매도·보유·포지션 유지 같은 투자 행동 권유와 새 목표가 제시는 금지한다.',
  '좋은 예: “지금 구간은 평단 대비 수익권이라 포지션 자체는 안정적으로 보여요. 다만 단기 가격이 빠르게 올라온 만큼 추가 여지는 목표가와 거래량 흐름을 같이 봐야 해요. 최근 실적이나 리포트 신선도가 약하면 상승 논리보다 변동성 관리가 더 중요해요.”',
  '나쁜 예: “세 위원 모두 긍정적으로 평가합니다. 심리 분석AI는 수익률을 근거로 보고 산업 전문가는 목표가 차이를 상승 여력으로 해석합니다.”',
].join(' ')
const DEFAULT_TEAM_SUMMARY_TIMEOUT_MS = 2500
const MAX_TEAM_BODY_CHARS = 2400
const ETF_TEAM_SUMMARY_PROMPT_APPENDIX = [
  'ETF/ETN 입력에서는 개별 기업식 목표가, 증권사 컨센서스, 실적, EPS, PER, PBR 부재를 리스크나 한계로 쓰지 마라.',
  'ETF/ETN 입력에서는 NAV 괴리, 기초지수 흐름, 구성종목 비중, 유동성, 현재가와 평단 간격 등 실제 입력 근거만 합성하라.',
].join(' ')

type TeamSummaryRequestBody = {
  teamKey?: unknown
  teamName?: unknown
  body?: unknown
  market?: unknown
  instrumentKind?: unknown
}

type TeamSummaryResult = {
  summary: string
  elapsedMs?: number
  model?: string
  provider?: string
}

type TeamSummaryRequester = (input: { teamKey: string; teamName: string; body: string; market?: string; instrumentKind?: string }) => Promise<TeamSummaryResult>

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function isExchangeProductSummaryInput(input: { market?: string; instrumentKind?: string }) {
  return /(?:^|\b)(?:ETF|ETN)(?:\b|$)/iu.test(input.market ?? '') || /^(?:etf|etn)$/iu.test(input.instrumentKind ?? '')
}

export function buildTeamSummarySystemPrompt(input: { market?: string; instrumentKind?: string } = {}) {
  return isExchangeProductSummaryInput(input)
    ? `${DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT} ${ETF_TEAM_SUMMARY_PROMPT_APPENDIX}`
    : DEEPSCAN_TEAM_SUMMARY_SYSTEM_PROMPT
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

function removeForbiddenExchangeProductStockCopy(value: string) {
  return cleanupSummary(value)
    .replace(/ETF\s*특성상\s*개별\s*종목\s*분석과\s*목표가가?\s*없어\s*추가\s*상승\s*여력을\s*판단하기\s*어렵다\.?/gu, 'ETF는 NAV 괴리율과 기초지수 흐름 확인이 추가 판단의 핵심입니다.')
    .replace(/(?:개별\s*)?(?:종목\s*)?(?:분석과\s*)?목표가(?:와|가|는|를)?\s*없(?:어|어서|고)?[^.!?。！？]*(?:상승\s*여력|판단)[^.!?。！？]*(?:[.!?。！？]|$)/gu, 'NAV 괴리율과 기초지수 흐름을 추가로 확인해야 합니다. ')
    .replace(/목표가?\s*부재/gu, 'NAV·기초지수 확인 필요')
    .replace(/목표가/gu, 'NAV·기초지수 기준')
    .replace(/컨센서스[·\s]*(?:밸류|가치)?\s*(?:정보)?\s*부재/gu, 'NAV·괴리율 정보 추가 확인')
    .replace(/추가\s*상승\s*여력/gu, '지수·가격 여지')
    .replace(/수익을\s*실현했지만/gu, '평가이익이 있지만')
    .replace(/매도\s*판단/gu, '비중 점검')
    .replace(/매도\s*의사결정/gu, '비중 점검')
    .replace(/애널리스트\s*ETF\s*기준와\s*종목별\s*PER\/PBR\s*데이터는\s*제공되지\s*않습니다\.?/gu, 'NAV·괴리율과 구성종목 정보를 추가로 확인해야 합니다.')
    .replace(/종목별\s*PER\/PBR\s*데이터는\s*제공되지\s*않습니다\.?/gu, 'NAV·괴리율과 구성종목 정보를 추가로 확인해야 합니다.')
    .replace(/PER\/PBR/gu, 'NAV·괴리율')
    .replace(/ETF\s*기준와/gu, 'ETF 기준과')
    .replace(/보유\s*종목/gu, '보유 ETF')
    .replace(/보유\s*ETF은/gu, '보유 ETF는')
    .replace(/지수·가격\s*여지이/gu, '지수·가격 여지가')
    .replace(/보유\s*평가/gu, '현재 구간 평가')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanupTeamSummaryForInstrument(value: string, input: { market?: string; instrumentKind?: string } = {}) {
  const actionSafe = removeForbiddenInvestmentActionAdvice(value)
  return isExchangeProductSummaryInput(input) ? removeForbiddenExchangeProductStockCopy(actionSafe) : actionSafe
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

async function callOpenRouterTeamSummary(input: Parameters<TeamSummaryRequester>[0]): Promise<TeamSummaryResult> {
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
          content: buildTeamSummarySystemPrompt(input),
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
    summary: cleanupTeamSummaryForInstrument(summary, input),
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
  const market = normalizeText(body.market)
  const instrumentKind = normalizeText(body.instrumentKind)

  if (!teamKey || !teamName || !rawBody) {
    return NextResponse.json({ ok: false, error: { message: 'teamKey, teamName and body are required.' } }, { status: 400 })
  }

  try {
    const result = await requester({ teamKey, teamName, body: rawBody, market: market ?? undefined, instrumentKind: instrumentKind ?? undefined })
    const summary = cleanupTeamSummaryForInstrument(result.summary, { market: market ?? undefined, instrumentKind: instrumentKind ?? undefined })
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
