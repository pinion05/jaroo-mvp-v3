import { NextResponse } from 'next/server'
import { sanitizeOcrRows } from '@/lib/screenshot-ocr'

export const dynamic = 'force-dynamic'

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
You may additionally include code and/or ticker when they are visibly shown in the same row.
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
- evaluationAmount must map to the row-level valuation/market value amount, not profit/loss amount, principal, or a totals summary.
- If the same row appears twice due to sticky headers or repeated sections, keep one row only.`

const DEFAULT_OCR_MODEL = 'google/gemini-2.0-flash-lite-001'
const DEFAULT_OCR_FALLBACK_MODELS = [
  'qwen/qwen3-vl-8b-instruct',
  'google/gemma-4-26b-a4b-it',
  'qwen/qwen3.5-9b',
] as const


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

function getFallbackModels(primaryModel: string) {
  const configuredFallbacks = (process.env.OCR_FALLBACK_MODELS ?? '')
    .split(',')
    .map((fallbackModel) => fallbackModel.trim())
    .filter(Boolean)
  const fallbackModels = configuredFallbacks.length > 0 ? configuredFallbacks : [...DEFAULT_OCR_FALLBACK_MODELS]

  return fallbackModels.filter((fallbackModel, index, models) => fallbackModel !== primaryModel && models.indexOf(fallbackModel) === index)
}

function buildOpenRouterOcrBody(options: {
  model: string
  broker: string
  fileName: string
  imageDataUrl: string
  useJsonSchema: boolean
}): OpenRouterRequestBody {
  return {
    model: options.model,
    temperature: 0,
    max_tokens: 1024,
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

async function requestOpenRouterOcr(options: {
  apiKey: string
  model: string
  broker: string
  fileName: string
  imageDataUrl: string
  useJsonSchema: boolean
}) {
  const upstreamResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3200',
      'X-Title': 'jaroo-mvp-v3 OCR',
    },
    body: JSON.stringify(buildOpenRouterOcrBody(options)),
  })

  const result = (await upstreamResponse.json().catch(() => null)) as OpenRouterResponse | null
  const upstreamErrorMessage = extractOpenRouterErrorMessage(result)

  if (!upstreamResponse.ok || upstreamErrorMessage) {
    return {
      ok: false as const,
      status: !upstreamResponse.ok ? upstreamResponse.status || 502 : extractOpenRouterErrorStatus(result),
      errorMessage: upstreamErrorMessage || 'OpenRouter OCR request failed.',
    }
  }

  const rawContent = extractTextContent(result?.choices?.[0]?.message?.content)

  if (!rawContent) {
    return {
      ok: false as const,
      status: 502,
      errorMessage: 'OpenRouter returned an empty OCR response.',
    }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(extractJsonObjectText(rawContent))
  } catch {
    return {
      ok: false as const,
      status: 502,
      errorMessage: 'OpenRouter returned invalid JSON.',
    }
  }

  return {
    ok: true as const,
    rows: sanitizeOcrRows((parsed as { rows?: unknown })?.rows),
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.OCR_MODEL || DEFAULT_OCR_MODEL
  const useJsonSchema = process.env.OCR_RESPONSE_FORMAT === 'json_schema'

  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY is not configured.' }, { status: 500 })
  }

  const body = (await request.json().catch(() => null)) as
    | {
        imageDataUrl?: unknown
        fileName?: unknown
        broker?: unknown
      }
    | null

  const imageDataUrl = typeof body?.imageDataUrl === 'string' ? body.imageDataUrl : ''
  const fileName = typeof body?.fileName === 'string' ? body.fileName : 'screenshot'
  const broker = typeof body?.broker === 'string' ? body.broker : ''

  if (!imageDataUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'A valid imageDataUrl is required.' }, { status: 400 })
  }

  const attempts = [
    { model, useJsonSchema },
    ...getFallbackModels(model).map((fallbackModel) => ({ model: fallbackModel, useJsonSchema: false })),
  ]
  const errors: Array<{ status: number; errorMessage: string }> = []

  for (const attempt of attempts) {
    const result = await requestOpenRouterOcr({
      apiKey,
      model: attempt.model,
      broker,
      fileName,
      imageDataUrl,
      useJsonSchema: attempt.useJsonSchema,
    })

    if (result.ok) {
      return NextResponse.json({ rows: result.rows })
    }

    errors.push({
      status: result.status,
      errorMessage: result.errorMessage,
    })
  }

  const firstError = errors[0]

  return NextResponse.json(
    { error: toPublicOcrErrorMessage(firstError?.errorMessage || 'OpenRouter OCR request failed.') },
    { status: firstError?.status || 502 },
  )
}
