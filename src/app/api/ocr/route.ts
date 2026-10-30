import { NextResponse } from 'next/server'
import { sanitizeOcrRows } from '@/lib/screenshot-ocr'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'
import { originAllowedForStateChange } from '@/lib/http-origin-guard'
import {
  createLlmMockSeededRandom,
  isLlmMockEnabled,
  llmMockDateToken,
  sleepLlmMockLatency,
} from '../../../../packages/deepscan-runtime-core/src/llm-mock.js'
import {
  DEFAULT_OCR_MODEL,
  MOCK_OCR_ROWS,
  OCR_MAX_IMAGE_DATA_URL_LENGTH,
  OCR_MAX_REQUEST_BYTES,
  OCR_UPSTREAM_TIMEOUT_MS,
  buildOpenRouterOcrBody,
  extractJsonObjectText,
  extractOpenRouterErrorMessage,
  extractOpenRouterErrorStatus,
  extractTextContent,
  getFallbackModels,
  isOcrRateLimited,
  toPublicOcrErrorMessage,
  type OpenRouterResponse,
} from './shared'

export const dynamic = 'force-dynamic'

async function requestOpenRouterOcr(options: {
  apiKey: string
  model: string
  broker: string
  fileName: string
  imageDataUrl: string
  useJsonSchema: boolean
}) {
  // JAROO_LLM_MOCK=1: 업로드 이미지와 무관하게 고정 픽스처를 반환한다(미설정 시 기존 경로 그대로).
  if (isLlmMockEnabled()) {
    const mockRandom = createLlmMockSeededRandom(`ocr|${options.broker || 'unknown'}|${options.fileName}|${llmMockDateToken()}`)
    console.log(`[llm-mock] ocr broker=${options.broker || 'unknown'} file=${options.fileName}`)
    await sleepLlmMockLatency(mockRandom)
    return {
      ok: true as const,
      rows: sanitizeOcrRows(MOCK_OCR_ROWS),
    }
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3200',
        'X-Title': 'jaroo-mvp-v3 OCR',
      },
      body: JSON.stringify(buildOpenRouterOcrBody(options)),
      // 업스트림 지연이 응답을 붙잡지 않게 한다(폴백 체인이 다음 모델을 시도).)
      signal: AbortSignal.timeout(OCR_UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      ok: false as const,
      status: 504,
      errorMessage: error instanceof Error && error.name === 'TimeoutError'
        ? 'OpenRouter OCR request timed out.'
        : 'OpenRouter OCR request failed to connect.',
    }
  }

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

  // JAROO_LLM_MOCK=1이면 키 없이도 모의 경로가 돌아간다(dev 비용 0).
  if (!apiKey && !isLlmMockEnabled()) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY is not configured.' }, { status: 500 })
  }

  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: '허용되지 않은 요청 경로예요.' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const auth = await resolveApiUserId('ocr')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: '로그인 상태를 확인할 수 없어요. 잠시 후 다시 시도해주세요.' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: '로그인 후 스크린샷 분석을 사용할 수 있어요.' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }

  if (isOcrRateLimited(auth.userId)) {
    return NextResponse.json({ error: '요청이 잠시 많아요. 몇 분 뒤에 다시 시도해주세요.' }, { status: 429, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const contentLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > OCR_MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: '이미지가 너무 커요. 장수를 줄이거나 더 작은 스크린샷으로 시도해주세요.' }, { status: 413, headers: NO_STORE_PRIVATE_HEADERS })
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

  // content-length 헤더가 없거나 속인 요청도 여기서 막는다(실제 문자열 길이 기준).
  if (imageDataUrl.length > OCR_MAX_IMAGE_DATA_URL_LENGTH) {
    return NextResponse.json({ error: '이미지가 너무 커요. 장수를 줄이거나 더 작은 스크린샷으로 시도해주세요.' }, { status: 413, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const attempts = [
    { model, useJsonSchema },
    ...getFallbackModels(model).map((fallbackModel) => ({ model: fallbackModel, useJsonSchema: false })),
  ]
  const errors: Array<{ status: number; errorMessage: string }> = []

  for (const attempt of attempts) {
    const result = await requestOpenRouterOcr({
      // mock 모드에서는 키가 없어도 모의 분기가 fetch 전에 반환되므로 빈 값이 흘러도 안전하다.
      apiKey: apiKey ?? '',
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
