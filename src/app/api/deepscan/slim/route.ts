import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

const KR_SUMMARY_SLIM_VERSION = 'v1.1'
const KR_CANONICAL_SLIM_VERSION = 'v1.2'

export function resolveKrDeepScanSlimVersion(version: string | null | undefined) {
  const normalizedVersion = version?.trim().toLowerCase()
  return normalizedVersion === KR_CANONICAL_SLIM_VERSION || normalizedVersion === '1.2'
    ? KR_CANONICAL_SLIM_VERSION
    : KR_SUMMARY_SLIM_VERSION
}

export function resolveDeepScanSlimUpstreamPath(searchParams: URLSearchParams) {
  const market = searchParams.get('market')?.trim().toUpperCase()
  const code = searchParams.get('code')?.trim()
  const ticker = searchParams.get('ticker')?.trim().toUpperCase()
  const version = searchParams.get('version')?.trim().toLowerCase()

  if (market === 'KR' && code) {
    const krVersion = resolveKrDeepScanSlimVersion(version)
    return `/api/major/wisereport-fnguide/kr/companies/${encodeURIComponent(code)}/slim/${krVersion}`
  }

  if (market === 'US' && ticker) {
    return `/api/major/wisereport-global/us/companies/${encodeURIComponent(ticker)}/slim/v1.1`
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
