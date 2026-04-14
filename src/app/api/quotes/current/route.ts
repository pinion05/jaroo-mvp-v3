import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export function buildQuotesCurrentUpstreamUrl(baseUrl: string, searchParams: URLSearchParams) {
  const query = searchParams.toString()
  return buildCrawlerUrl(baseUrl, `/api/quotes/current${query ? `?${query}` : ''}`)
}

export async function GET(request: NextRequest) {
  const upstreamUrl = buildQuotesCurrentUpstreamUrl(getCrawlerBaseUrl(), request.nextUrl.searchParams)

  try {
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
      { status: 502 },
    )
  }
}
