import { NextRequest, NextResponse } from 'next/server'

import { buildDeepScanPayloadFromSearchParams, buildRawInputFromSearchParams } from '@/lib/deepscan-runtime/build-payload'

export const runtime = 'nodejs'

export function buildDeepScanCanonicalInput(searchParams: URLSearchParams) {
  return buildRawInputFromSearchParams(searchParams)
}

export async function createDeepScanCanonicalResponse(
  searchParams: URLSearchParams,
  builder: typeof buildDeepScanPayloadFromSearchParams = buildDeepScanPayloadFromSearchParams,
) {
  try {
    const payload = await builder(searchParams)
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        count: 0,
        error: {
          message: error instanceof Error ? error.message : 'deepscan builder failed',
        },
      },
      { status: 400 },
    )
  }
}

export async function GET(request: NextRequest) {
  return createDeepScanCanonicalResponse(request.nextUrl.searchParams)
}
