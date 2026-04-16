import { NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export function buildUsdKrwFxUpstreamUrl(baseUrl: string) {
  return buildCrawlerUrl(baseUrl, '/api/source/investing/market/fx/usd-krw')
}

export async function GET() {
  const upstreamUrl = buildUsdKrwFxUpstreamUrl(getCrawlerBaseUrl())

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
