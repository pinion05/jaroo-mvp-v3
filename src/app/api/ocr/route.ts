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

const OCR_SCHEMA = {
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
            profitRate: { type: 'string' },
            evaluationAmount: { type: 'string' },
            code: { type: 'string' },
            ticker: { type: 'string' },
          },
          required: ['name', 'quantity', 'profitRate', 'evaluationAmount'],
        },
      },
    },
    required: ['rows'],
  },
} as const

export const OCR_SYSTEM_PROMPT = `You are an OCR extraction engine for Korean and English brokerage screenshots.
Return ONLY valid JSON matching the provided schema.
Never output markdown, prose, explanations, code fences, or extra keys.
Top-level object must be exactly {"rows": [...]}.
Every row must contain the 4 required string fields: name, quantity, profitRate, evaluationAmount.
You may additionally include code and/or ticker when they are visibly shown in the same row.
Do not add any other fields.
If a value is unreadable, use an empty string.
If there are no holdings rows, return {"rows": []}.

Field rules:
- name: stock/security name as shown in the screenshot. Preserve Korean or English text.
- quantity: holding quantity as shown. Keep units if visible, for example "12주", "5 shares", "1,000".
- profitRate: profit/loss percentage as shown, for example "+12.4%", "-3.18%", "0%".
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
- profitRate must map to the return/percentage column, not profit amount.
- Korean brokerage rows often show profit/loss amount followed by the percentage in parentheses.
  In that case, extract the parenthesized percentage and carry the sign from the visible profit/loss amount or color.
  Examples: "+262,740 (12.7%)" means "+12.7%"; "-13,263 (6.8%)" means "-6.8%".
- evaluationAmount must map to the row-level valuation/market value amount, not profit/loss amount, principal, or a totals summary.
- If the same row appears twice due to sticky headers or repeated sections, keep one row only.`

export function extractOpenRouterErrorMessage(result: OpenRouterResponse | null | undefined) {
  return typeof result?.error?.message === 'string' ? result.error.message.trim() : ''
}

export function extractOpenRouterErrorStatus(result: OpenRouterResponse | null | undefined) {
  return typeof result?.error?.code === 'number' && Number.isInteger(result.error.code) ? result.error.code : 502
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

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.OCR_MODEL || 'qwen/qwen3.5-flash-02-23'

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

  const upstreamResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'jaroo-mvp-v3 OCR',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: OCR_SCHEMA,
      },
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
              text: `Extract holdings rows from this brokerage screenshot. Broker hint: ${broker || 'unknown'}. Filename: ${fileName}. Return JSON matching the schema exactly.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    }),
  })

  const result = (await upstreamResponse.json().catch(() => null)) as OpenRouterResponse | null
  const upstreamErrorMessage = extractOpenRouterErrorMessage(result)

  if (!upstreamResponse.ok || upstreamErrorMessage) {
    return NextResponse.json(
      { error: upstreamErrorMessage || 'OpenRouter OCR request failed.' },
      { status: !upstreamResponse.ok ? upstreamResponse.status || 502 : extractOpenRouterErrorStatus(result) },
    )
  }

  const rawContent = extractTextContent(result?.choices?.[0]?.message?.content)

  if (!rawContent) {
    return NextResponse.json({ error: 'OpenRouter returned an empty OCR response.' }, { status: 502 })
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(rawContent)
  } catch {
    return NextResponse.json({ error: 'OpenRouter returned invalid JSON.' }, { status: 502 })
  }

  const rows = sanitizeOcrRows((parsed as { rows?: unknown })?.rows)

  return NextResponse.json({ rows })
}
