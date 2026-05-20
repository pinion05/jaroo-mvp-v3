import { NextRequest, NextResponse } from 'next/server'

import {
  buildDeepScanPayloadFromSearchParams,
  buildRawInputFromSearchParams,
  CrawlerDeepScanRequestError,
} from '@/lib/deepscan-runtime/build-payload'
import { recordDeepScanPayloadPerf } from '@/lib/deepscan-runtime/perf-trace'

export const runtime = 'nodejs'

export function buildDeepScanCanonicalInput(searchParams: URLSearchParams) {
  return buildRawInputFromSearchParams(searchParams)
}

export async function createDeepScanCanonicalResponse(
  searchParams: URLSearchParams,
  builder: typeof buildDeepScanPayloadFromSearchParams = buildDeepScanPayloadFromSearchParams,
) {
  const startedAt = new Date()

  try {
    const payload = await builder(searchParams)
    void recordDeepScanPayloadPerf(payload, { route: 'api/deepscan', startedAt }).catch(() => undefined)
    return NextResponse.json(payload)
  } catch (error) {
    const status = error instanceof CrawlerDeepScanRequestError ? error.status : 400
    return NextResponse.json(
      {
        ok: false,
        data: null,
        count: 0,
        error: {
          message: error instanceof Error ? error.message : 'deepscan builder failed',
        },
      },
      { status },
    )
  }
}

export async function GET(request: NextRequest) {
  return createDeepScanCanonicalResponse(request.nextUrl.searchParams)
}
