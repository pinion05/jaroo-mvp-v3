// OCR 라우트의 순수 부분(스키마·프롬프트·상수·가드·추출기) —
// 서버 전용 의존(next/server·api-auth)이 없어 노드 테스트에서 직접 import된다.
// 라우트 핸들러(requestOpenRouterOcr·POST)는 ./route에 남는다.

export type OpenRouterResponse = {
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

export const OCR_SCHEMA = {
  name: 'ocr_rows_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            quantity: { type: 'string' },
            profitAmount: { type: 'string' },
            profitRate: { type: 'string' },
            evaluationAmount: { type: 'string' },
            code: { type: 'string' },
            ticker: { type: 'string' },
            averagePrice: { type: 'string' },
          },
          required: ['name', 'quantity', 'profitAmount', 'profitRate', 'evaluationAmount'],
        },
      },
    },
    required: ['rows'],
  },
} as const

type OpenRouterRequestBody = {
  model: string
  temperature: number
  max_tokens: number
  response_format?: {
    type: 'json_schema'
    json_schema: typeof OCR_SCHEMA
  }
  messages: Array<{
    role: 'system' | 'user'
    content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  }>
}


export const OCR_SYSTEM_PROMPT = `You are an OCR extraction engine for Korean and English brokerage screenshots.
Return ONLY valid JSON matching the provided schema.
Never output markdown, prose, explanations, code fences, or extra keys.
Top-level object must be exactly {"rows": [...]}.
Every row must contain the 5 required string fields: name, quantity, profitAmount, profitRate, evaluationAmount.
You may additionally include code, ticker, and/or averagePrice when they are visibly shown in the same row.
Do not add any other fields.
If a value is unreadable or not visible, use an empty string.
If there are no holdings rows, return {"rows": []}.

Field rules:
- name: stock/security name as shown in the screenshot. Preserve Korean or English text.
- quantity: holding quantity as shown. Keep units if visible, for example "12주", "5 shares", "1,000".
- profitAmount: signed row-level profit/loss amount, not market value, for example "+262,740원", "-13,263원", "+$25.30".
- profitRate: signed profit/loss percentage, for example "+12.4%", "-3.18%", "0%".
- evaluationAmount: holding evaluation/market value as shown, for example "1,234,000원", "$845.12", "2,500".
- code: local stock code/security code when visibly shown, for example "005930". Otherwise use "".
- ticker: market ticker when visibly shown, for example "AAPL". Otherwise use "".
- averagePrice: per-share average purchase price when visibly shown (labels such as 매입가, 매입단가, 평단, 평균단가, Avg Price), for example "71,500", "$150.20". Otherwise use "".

OCR guidance:
- The screenshot may contain Korean labels such as 종목명, 보유수량, 수익률, 평가금액, 평가금, 평가손익, 잔고, 보유종목.
- The screenshot may also contain English labels such as Name, Qty, Shares, P/L, Return, Profit Rate, Valuation, Market Value, Amount.
- Extract only actual holding rows from the portfolio/list area.
- Ignore totals, headers, footers, tabs, buttons, timestamps, ads, and account summary text unless they are part of a row.
- Do not infer hidden values. Use only what is visible.
- Quantity must map to the user's holding count, not price or valuation.
- profitAmount must map to the signed row-level profit/loss amount, not evaluationAmount.
- profitRate must map to the row-level return percentage, not profitAmount.
- Korean brokerage rows often show a signed profitAmount followed by an unsigned percentage in parentheses.
  "-13,263 (6.8%)" means profitAmount "-13,263" and profitRate "-6.8%".
  "+262,740 (12.7%)" means profitAmount "+262,740" and profitRate "+12.7%".
- If the parenthesized percentage has no sign, inherit the sign from the visible profitAmount or the loss/profit color.
- Many Korean brokerage apps show amounts and percentages with NO sign, using color instead: red means profit (+), blue means loss (-).
  The color rule applies to EVERY unsigned numeric field in the row, including both profitAmount and profitRate.
  In that case infer the sign from the color (or from any signed field in the same row) and ALWAYS emit an explicit leading sign.
  An unsigned "1,234,567" shown in red must be returned as "+1,234,567" with its unsigned "5.4%" as "+5.4%";
  an unsigned amount or percentage shown in blue must be returned with a leading "-", for example "-1,234,567" and "-5.4%".
- evaluationAmount must map to the row-level valuation/market value amount, not profit/loss amount, principal, or a totals summary.
- Never use a per-share purchase price (매입가/평단/매입단가) or a total purchase amount (매입금액/총매입) as evaluationAmount.
  If the row shows a purchase price but no row-level valuation, leave evaluationAmount "" and put the per-share price in averagePrice.
- If the same row appears twice due to sticky headers or repeated sections, keep one row only.`

// reasoning 계열 모델이 completion 예산을 사고(reasoning)에 소진해 JSON이 잘리는 사고 방지.
// 벤치마크(2026-09-07, 잔고 스크린샷 9종) 기준 8192에서 reasoning 모델도 finish=stop 완성.
// reasoning 없는 모델은 필요한 만큼만 쓰고 조기 종료하므로 cap 상양은 비용에 영향이 없다.
const OCR_MAX_COMPLETION_TOKENS = 8192
// 벤치마크(2026-09-07, 잔고 스크린샷 9종 30행) 기준 gemma-4-31b가 26b-a4b와 동일 장당 비용에 필드 정확도 +9pp.
// gemini-2.0-flash-lite-001은 OpenRouter에서 단종(No endpoints found)되어 기본값으로 부적합.
export const DEFAULT_OCR_MODEL = 'google/gemma-4-31b-it'
const DEFAULT_OCR_FALLBACK_MODELS = [
  'qwen/qwen3-vl-8b-instruct',
  'google/gemma-4-26b-a4b-it',
  'qwen/qwen3.5-9b',
] as const


// --- 남용 방지 가드(2026-09-14, 코드 감사 B1) ---
// OCR은 유료 비전 LLM을 호출한다. 과거 IP 쿼터(#224 H1)는 인증 사용자까지
// 막아 제거됐었는데, 그 대신 아래 4겹으로 비용 표면을 막는다:
//   1) 세션 인증 필수  2) 유저별 레이트리밋  3) 본문/이미지 크기 상한  4) 업스트림 타임아웃

export const OCR_MAX_IMAGE_DATA_URL_LENGTH = 4_000_000 // 스크린샷 클라이언트 총량 상한과 동일
export const OCR_MAX_REQUEST_BYTES = OCR_MAX_IMAGE_DATA_URL_LENGTH + 64 * 1024 // JSON 래핑 여유
export const OCR_UPSTREAM_TIMEOUT_MS = 30_000
export const OCR_RATE_LIMIT_MAX = 10 // 배치 업로드 상한(5) + 재시도 여유
export const OCR_RATE_LIMIT_WINDOW_MS = 5 * 60_000

// 유저별 슬라이딩 윈도 레이트리밋 — 인메모리. 단일 인스턴스 운영(G7: Railway 스케일 1) 가정.
const ocrRateBuckets = new Map<string, number[]>()

export function isOcrRateLimited(userId: string, now = Date.now()): boolean {
  const windowStart = now - OCR_RATE_LIMIT_WINDOW_MS
  const stamps = (ocrRateBuckets.get(userId) ?? []).filter((stamp) => stamp > windowStart)
  if (stamps.length >= OCR_RATE_LIMIT_MAX) {
    ocrRateBuckets.set(userId, stamps)
    return true
  }
  stamps.push(now)
  ocrRateBuckets.set(userId, stamps)
  return false
}

export function extractOpenRouterErrorMessage(result: OpenRouterResponse | null | undefined) {
  return typeof result?.error?.message === 'string' ? result.error.message.trim() : ''
}

export function extractOpenRouterErrorStatus(result: OpenRouterResponse | null | undefined) {
  return typeof result?.error?.code === 'number' && Number.isInteger(result.error.code) ? result.error.code : 502
}

export function toPublicOcrErrorMessage(message: string) {
  const normalizedMessage = message.trim()

  if (!normalizedMessage) {
    return '스크린샷 분석에 실패했어요. 잠시 후 다시 시도해주세요.'
  }

  if (/key limit exceeded|rate limit|quota|insufficient credits|credit limit/i.test(normalizedMessage)) {
    return 'OCR 사용량 한도를 초과했어요. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.'
  }

  if (/invalid image|image size|unsupported image/i.test(normalizedMessage)) {
    return '이미지 형식을 확인할 수 없어요. 더 선명한 스크린샷으로 다시 시도해주세요.'
  }

  return '스크린샷 분석에 실패했어요. 잠시 후 다시 시도해주세요.'
}

export function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined) {
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


export function extractJsonObjectText(rawContent: string) {
  const trimmedContent = rawContent.trim()
  const fencedJsonMatch = trimmedContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const unfencedContent = (fencedJsonMatch?.[1] ?? trimmedContent).trim()

  if (unfencedContent.startsWith('{') && unfencedContent.endsWith('}')) {
    return unfencedContent
  }

  const jsonStart = unfencedContent.indexOf('{')
  const jsonEnd = unfencedContent.lastIndexOf('}')

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    return unfencedContent.slice(jsonStart, jsonEnd + 1)
  }

  return unfencedContent
}

export function getFallbackModels(primaryModel: string) {
  const configuredFallbacks = (process.env.OCR_FALLBACK_MODELS ?? '')
    .split(',')
    .map((fallbackModel) => fallbackModel.trim())
    .filter(Boolean)
  const fallbackModels = configuredFallbacks.length > 0 ? configuredFallbacks : [...DEFAULT_OCR_FALLBACK_MODELS]

  return fallbackModels.filter((fallbackModel, index, models) => fallbackModel !== primaryModel && models.indexOf(fallbackModel) === index)
}

export function buildOpenRouterOcrBody(options: {
  model: string
  broker: string
  fileName: string
  imageDataUrl: string
  useJsonSchema: boolean
}): OpenRouterRequestBody {
  return {
    model: options.model,
    temperature: 0,
    max_tokens: OCR_MAX_COMPLETION_TOKENS,
    ...(options.useJsonSchema
      ? {
          response_format: {
            type: 'json_schema' as const,
            json_schema: OCR_SCHEMA,
          },
        }
      : {}),
    messages: [
      {
        role: 'system',
        content: OCR_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract holdings rows from this brokerage screenshot. Broker hint: ${options.broker || 'unknown'}. Filename: ${options.fileName}. Return JSON matching the schema exactly.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: options.imageDataUrl,
            },
          },
        ],
      },
    ],
  }
}
