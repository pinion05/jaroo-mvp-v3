import { NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export const USD_KRW_FX_PROXY_TIMEOUT_MS = 4500

export class UsdKrwFxProxyTimeoutError extends Error {
  constructor(message = 'usd krw fx upstream timed out') {
    super(message)
    this.name = 'UsdKrwFxProxyTimeoutError'
  }
}

export function buildUsdKrwFxUpstreamUrl(baseUrl: string) {
  return buildCrawlerUrl(baseUrl, '/api/major/market/fx/usd-krw')
}

export function getUsdKrwFxProxyTimeoutMs() {
  const configuredTimeoutMs = Number(process.env.USD_KRW_FX_PROXY_TIMEOUT_MS)
  return Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : USD_KRW_FX_PROXY_TIMEOUT_MS
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export async function fetchUsdKrwFxUpstream(
  upstreamUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = getUsdKrwFxProxyTimeoutMs(),
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
        reject(new UsdKrwFxProxyTimeoutError())
      }, timeoutMs)
    })

    return await Promise.race([
      fetcher(upstreamUrl, { cache: 'no-store', signal: abortController.signal }),
      timeoutPromise,
    ])
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new UsdKrwFxProxyTimeoutError()
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    externalSignal?.removeEventListener('abort', handleExternalAbort)
  }
}

type UsdKrwFxRequestOptions = {
  fetcher?: typeof fetch
  timeoutMs?: number
}

export async function handleUsdKrwFxRequest(request: Request, options: UsdKrwFxRequestOptions = {}) {
  const upstreamUrl = buildUsdKrwFxUpstreamUrl(getCrawlerBaseUrl())

  try {
    const response = await fetchUsdKrwFxUpstream(
      upstreamUrl,
      options.fetcher ?? fetch,
      options.timeoutMs ?? getUsdKrwFxProxyTimeoutMs(),
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
      { status: error instanceof UsdKrwFxProxyTimeoutError ? 504 : 502 },
    )
  }
}

export async function GET(request: Request) {
  return handleUsdKrwFxRequest(request)
}
