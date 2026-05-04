import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export const QUOTES_CURRENT_PROXY_TIMEOUT_MS = 4500

export class QuotesCurrentProxyTimeoutError extends Error {
  constructor(message = 'quotes current upstream timed out') {
    super(message)
    this.name = 'QuotesCurrentProxyTimeoutError'
  }
}

export function buildQuotesCurrentUpstreamUrl(baseUrl: string, searchParams: URLSearchParams) {
  const query = searchParams.toString()
  return buildCrawlerUrl(baseUrl, `/api/source/krx-polygon-fmp/market/quotes/current${query ? `?${query}` : ''}`)
}

export function getQuotesCurrentProxyTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.QUOTES_CURRENT_PROXY_TIMEOUT_MS)
  return Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : QUOTES_CURRENT_PROXY_TIMEOUT_MS
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export async function fetchQuotesCurrentUpstream(
  upstreamUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = getQuotesCurrentProxyTimeoutMs(),
  externalSignal?: AbortSignal,
) {
  const abortController = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (externalSignal?.aborted) {
    abortController.abort()
  }

  const handleExternalAbort = () => abortController.abort()
  externalSignal?.addEventListener('abort', handleExternalAbort, { once: true })

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        abortController.abort()
        reject(new QuotesCurrentProxyTimeoutError())
      }, timeoutMs)
    })

    return await Promise.race([
      fetcher(upstreamUrl, { cache: 'no-store', signal: abortController.signal }),
      timeoutPromise,
    ])
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new QuotesCurrentProxyTimeoutError()
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    externalSignal?.removeEventListener('abort', handleExternalAbort)
  }
}

type QuotesCurrentRequestOptions = {
  fetcher?: typeof fetch
  timeoutMs?: number
}

export async function handleQuotesCurrentRequest(request: NextRequest, options: QuotesCurrentRequestOptions = {}) {
  const upstreamUrl = buildQuotesCurrentUpstreamUrl(getCrawlerBaseUrl(), request.nextUrl.searchParams)

  try {
    const response = await fetchQuotesCurrentUpstream(
      upstreamUrl,
      options.fetcher ?? fetch,
      options.timeoutMs ?? getQuotesCurrentProxyTimeoutMs(),
      request.signal,
    )
    const body = await response.text()

    return new NextResponse(body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      },
    })
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json(
        {
          ok: false,
          data: null,
          count: 0,
          error: {
            code: 'client-abort',
            message: 'request aborted',
          },
        },
        { status: 499 },
      )
    }

    return NextResponse.json(
      {
        ok: false,
        data: null,
        count: 0,
        error: {
          code: error instanceof QuotesCurrentProxyTimeoutError ? 'upstream-timeout' : 'upstream-error',
          message: error instanceof Error ? error.message : 'crawler proxy failed',
        },
      },
      { status: error instanceof QuotesCurrentProxyTimeoutError ? 504 : 502 },
    )
  }
}

export async function GET(request: NextRequest) {
  return handleQuotesCurrentRequest(request)
}
