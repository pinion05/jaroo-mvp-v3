import { NextRequest, NextResponse } from 'next/server'

import {
  buildKrCommitteeAxesFromLlmResults,
  getDeepScanKrCommitteeProgress,
} from '../../../../../packages/crawler/src/services/deepscan-kr-committee-runtime.js'

export const runtime = 'nodejs'

export function createDeepScanCommitteeStatusResponse(
  searchParams: URLSearchParams,
  reader: typeof getDeepScanKrCommitteeProgress = getDeepScanKrCommitteeProgress,
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
    committeeAxes: buildKrCommitteeAxesFromLlmResults(null, progress.results, progress.errors, progress.pending).axes,
  })
}

export async function GET(request: NextRequest) {
  return createDeepScanCommitteeStatusResponse(request.nextUrl.searchParams)
}
