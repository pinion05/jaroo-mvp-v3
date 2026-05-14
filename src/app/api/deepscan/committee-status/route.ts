import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

export const runtime = 'nodejs'

type DeepScanCommitteeProgress = {
  requestId: string
  status: string
  results?: Record<string, unknown>
  errors?: unknown[]
  pending?: string[]
  completed?: number
  updatedAt?: string
  softDeadlineMs?: number
}

export function createDeepScanCommitteeStatusResponse(
  searchParams: URLSearchParams,
  reader: (requestId: string) => DeepScanCommitteeProgress | null,
) {
  const requestId = searchParams.get('requestId')?.trim()

  if (!requestId) {
    return NextResponse.json({ ok: false, status: 'error', error: { message: 'requestId is required' } }, { status: 400 })
  }

  const progress = reader(requestId)

  if (!progress) {
    return NextResponse.json({ ok: true, requestId, status: 'not_found', results: {}, errors: [], pending: [] })
  }

  return NextResponse.json({
    ok: true,
    requestId: progress.requestId,
    status: progress.status,
    results: progress.results,
    errors: progress.errors,
    pending: progress.pending,
    completed: progress.completed,
    updatedAt: progress.updatedAt,
    softDeadlineMs: progress.softDeadlineMs,
  })
}

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get('requestId')?.trim()

  if (!requestId) {
    return NextResponse.json({ ok: false, status: 'error', error: { message: 'requestId is required' } }, { status: 400 })
  }

  try {
    const upstreamUrl = buildCrawlerUrl(
      getCrawlerBaseUrl(),
      `/api/source/deepscan/kr/committee-status?requestId=${encodeURIComponent(requestId)}`,
    )
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
        requestId,
        status: 'error',
        error: {
          message: error instanceof Error ? error.message : 'crawler committee status proxy failed',
        },
      },
      { status: 502 },
    )
  }
}
