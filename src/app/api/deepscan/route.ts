import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

const ALLOWED_DEEPSCAN_CANONICAL_QUERY_KEYS = [
  'market',
  'code',
  'ticker',
  'name',
  'shares',
  'averagePrice',
  'evaluationAmount',
  'selectedAt',
  'from',
] as const

export function buildDeepScanCanonicalUpstreamPath(searchParams: URLSearchParams) {
  const upstreamSearchParams = new URLSearchParams()

  for (const key of ALLOWED_DEEPSCAN_CANONICAL_QUERY_KEYS) {
    const value = searchParams.get(key)?.trim()

    if (!value) {
      continue
    }

    upstreamSearchParams.set(key, value)
  }

  const query = upstreamSearchParams.toString()
  return `/api/deepscan${query ? `?${query}` : ''}`
}

export async function GET(request: NextRequest) {
  let response: Response

  try {
    const upstreamPath = buildDeepScanCanonicalUpstreamPath(request.nextUrl.searchParams)
    const upstreamUrl = buildCrawlerUrl(getCrawlerBaseUrl(), upstreamPath)
    response = await fetch(upstreamUrl, { cache: 'no-store' })
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

  const body = await response.text()

  return new NextResponse(body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
    },
  })
}
