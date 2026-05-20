import { NextRequest, NextResponse } from 'next/server'

import { type DeepScanPerfStatus, summarizeDeepScanPerfEvents } from '@/lib/deepscan-runtime/perf-trace'

export const runtime = 'nodejs'

const STATUSES = new Set<DeepScanPerfStatus>(['pending', 'ready', 'confirmed_missing', 'failed', 'blocked'])

function parseLimit(value: string | null) {
  if (!value) {
    return undefined
  }

  const limit = Number(value)
  if (!Number.isFinite(limit)) {
    return undefined
  }

  return Math.trunc(limit)
}

function parseStatus(value: string | null) {
  if (!value || !STATUSES.has(value as DeepScanPerfStatus)) {
    return undefined
  }

  return value as DeepScanPerfStatus
}

export async function GET(request: NextRequest) {
  const summary = await summarizeDeepScanPerfEvents({
    limit: parseLimit(request.nextUrl.searchParams.get('limit')),
    status: parseStatus(request.nextUrl.searchParams.get('status')),
  })

  return NextResponse.json(summary)
}
