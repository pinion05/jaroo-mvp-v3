import { NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export const US_MARKET_INDICATORS_PROXY_TIMEOUT_MS = 12000

export class UsMarketIndicatorsProxyTimeoutError extends Error {
  constructor(message = 'us market indicators upstream timed out') {
    super(message)
    this.name = 'UsMarketIndicatorsProxyTimeoutError'
  }
}

export function buildUsMarketIndicatorsUpstreamUrl(baseUrl: string) {
  return buildCrawlerUrl(baseUrl, '/api/source/polygon-yahoo/us/market/indicators')
}

export function getUsMarketIndicatorsProxyTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.US_MARKET_INDICATORS_PROXY_TIMEOUT_MS)
  return Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : US_MARKET_INDICATORS_PROXY_TIMEOUT_MS
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export async function fetchUsMarketIndicatorsUpstream(
  upstreamUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = getUsMarketIndicatorsProxyTimeoutMs(),
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
        reject(new UsMarketIndicatorsProxyTimeoutError())
      }, timeoutMs)
    })

    return await Promise.race([
      fetcher(upstreamUrl, { cache: 'no-store', signal: abortController.signal }),
      timeoutPromise,
    ])
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new UsMarketIndicatorsProxyTimeoutError()
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    externalSignal?.removeEventListener('abort', handleExternalAbort)
  }
}

type UsMarketIndicatorsRequestOptions = {
  fetcher?: typeof fetch
  timeoutMs?: number
}

export async function handleUsMarketIndicatorsRequest(request: Request, options: UsMarketIndicatorsRequestOptions = {}) {
  const upstreamUrl = buildUsMarketIndicatorsUpstreamUrl(getCrawlerBaseUrl())

  try {
    const response = await fetchUsMarketIndicatorsUpstream(
      upstreamUrl,
      options.fetcher ?? fetch,
      options.timeoutMs ?? getUsMarketIndicatorsProxyTimeoutMs(),
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
    return NextResponse.json(
      {
        ok: false,
        data: null,
        count: 0,
        error: {
          message: error instanceof Error ? error.message : 'crawler proxy failed',
        },
      },
      { status: error instanceof UsMarketIndicatorsProxyTimeoutError ? 504 : 502 },
    )
  }
}

export async function GET(request: Request) {
  return handleUsMarketIndicatorsRequest(request)
}
