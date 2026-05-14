import { NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export const MARKET_INDICATORS_PROXY_TIMEOUT_MS = 4500

export class MarketIndicatorsProxyTimeoutError extends Error {
  constructor(message = 'market indicators upstream timed out') {
    super(message)
    this.name = 'MarketIndicatorsProxyTimeoutError'
  }
}

export function buildMarketIndicatorsUpstreamUrl(baseUrl: string) {
  return buildCrawlerUrl(baseUrl, '/api/source/stockplus-adrinfo-investing/market/indicators')
}

export function getMarketIndicatorsProxyTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.MARKET_INDICATORS_PROXY_TIMEOUT_MS)
  return Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : MARKET_INDICATORS_PROXY_TIMEOUT_MS
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export async function fetchMarketIndicatorsUpstream(
  upstreamUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = getMarketIndicatorsProxyTimeoutMs(),
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
        reject(new MarketIndicatorsProxyTimeoutError())
      }, timeoutMs)
    })

    return await Promise.race([
      fetcher(upstreamUrl, { cache: 'no-store', signal: abortController.signal }),
      timeoutPromise,
    ])
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new MarketIndicatorsProxyTimeoutError()
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    externalSignal?.removeEventListener('abort', handleExternalAbort)
  }
}

type MarketIndicatorsRequestOptions = {
  fetcher?: typeof fetch
  timeoutMs?: number
}

export async function handleMarketIndicatorsRequest(request: Request, options: MarketIndicatorsRequestOptions = {}) {
  const upstreamUrl = buildMarketIndicatorsUpstreamUrl(getCrawlerBaseUrl())

  try {
    const response = await fetchMarketIndicatorsUpstream(
      upstreamUrl,
      options.fetcher ?? fetch,
      options.timeoutMs ?? getMarketIndicatorsProxyTimeoutMs(),
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
      { status: error instanceof MarketIndicatorsProxyTimeoutError ? 504 : 502 },
    )
  }
}

export async function GET(request: Request) {
  return handleMarketIndicatorsRequest(request)
}
