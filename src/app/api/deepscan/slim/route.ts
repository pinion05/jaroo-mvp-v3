import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export function resolveDeepScanSlimUpstreamPath(searchParams: URLSearchParams) {
  const market = searchParams.get('market')?.trim().toUpperCase()
  const code = searchParams.get('code')?.trim()
  const ticker = searchParams.get('ticker')?.trim().toUpperCase()

  if (market === 'KR' && code) {
    return `/api/source/wisereport-fnguide/kr/companies/${encodeURIComponent(code)}/slim/v1.1`
  }

  if (market === 'US' && ticker) {
    return `/api/source/wisereport-global/us/companies/${encodeURIComponent(ticker)}/slim/v1.1`
  }

  throw new Error('invalid deepscan slim query')
}

export async function GET(request: NextRequest) {
  try {
    const upstreamPath = resolveDeepScanSlimUpstreamPath(request.nextUrl.searchParams)
    const upstreamUrl = buildCrawlerUrl(getCrawlerBaseUrl(), upstreamPath)
    const response = await fetch(upstreamUrl, { cache: 'no-store' })
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
      { status: 400 },
    )
  }
}
