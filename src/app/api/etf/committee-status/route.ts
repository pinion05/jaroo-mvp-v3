import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

// /api/etf/committee-status — 크롤러 /kr/committee-status 프록시.
// /api/deepscan/committee-status와 같은 계약이지만 ETF 위원회는 스냅샷 쓰래백이 없다
// (완성 결과는 크롤러 캐시가 담당). requestId만 검증하고 그대로 릴레이한다.

export const runtime = 'nodejs'

export function buildEtfCommitteeStatusUpstreamUrl(baseUrl: string, requestId: string): string {
  return buildCrawlerUrl(
    baseUrl,
    `/api/source/deepscan/kr/committee-status?requestId=${encodeURIComponent(requestId)}`,
  )
}

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get('requestId')?.trim()
  if (!requestId) {
    return NextResponse.json(
      { ok: false, requestId: null, status: 'error', error: { message: 'requestId is required' } },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    )
  }

  try {
    const upstreamUrl = buildEtfCommitteeStatusUpstreamUrl(getCrawlerBaseUrl(), requestId)
    const response = await fetch(upstreamUrl, { cache: 'no-store' })
    const body = await response.text()

    return new NextResponse(body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        status: 'error',
        error: { message: 'AI 위원회 진행 상태를 가져오지 못했어요.' },
      },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}
