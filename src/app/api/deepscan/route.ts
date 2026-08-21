import { NextRequest, NextResponse } from 'next/server'

import {
  buildDeepScanPayloadFromSearchParams,
  buildRawInputFromSearchParams,
  CrawlerDeepScanRequestError,
} from '@/lib/deepscan-runtime/build-payload'
import { recordDeepScanPayloadPerf } from '@/lib/deepscan-runtime/perf-trace'
import { hasTossServerConfig } from '@/lib/payments/config'

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

// 정규 딥스캔 실행 진입점. 과금(크레딧 차감/Pro 면제)은 이곳에서만 일어난다.
// 게이트 모듈은 server-only 의존(supabase service)을 물고 있어 결제 연동이
// 꺼진 환경(로컬 dev·테스트 러너)에서는 아예 로드하지 않는다.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  if (!hasTossServerConfig()) {
    return createDeepScanCanonicalResponse(searchParams)
  }

  const { authorizeDeepScanRun } = await import('@/lib/payments/deepscan-entitlement')
  const gate = await authorizeDeepScanRun(searchParams.get('code') ?? searchParams.get('ticker') ?? undefined)
  if (gate.status === 'auth-required') {
    return NextResponse.json(
      { ok: false, error: { code: 'auth-required', message: '로그인 후 딥스캔을 사용할 수 있어요.' } },
      { status: 401 },
    )
  }
  if (gate.status === 'insufficient-credits') {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'insufficient-credits',
          message: `딥스캔 크레딧이 부족해요(필요 ${gate.cost}크레딧, 잔여 ${gate.balance}크레딧). 마이페이지에서 충전할 수 있어요.`,
        },
      },
      { status: 402 },
    )
  }
  if (gate.status === 'unavailable') {
    return NextResponse.json(
      { ok: false, error: { code: 'entitlement-unavailable', message: '결제 상태를 확인할 수 없어요. 잠시 후 다시 시도해주세요.' } },
      { status: 503 },
    )
  }
  return createDeepScanCanonicalResponse(searchParams)
}
