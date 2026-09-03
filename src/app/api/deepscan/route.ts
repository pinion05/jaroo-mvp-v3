import { NextRequest, NextResponse } from 'next/server'

import {
  buildDeepScanPayloadFromSearchParams,
  buildRawInputFromSearchParams,
  CrawlerDeepScanRequestError,
} from '@/lib/deepscan-runtime/build-payload'
import { recordDeepScanPayloadPerf } from '@/lib/deepscan-runtime/perf-trace'
import { hasTossServerConfig } from '@/lib/payments/config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildSnapshotCacheAnnotatedPayload,
  extractSnapshotPriceBasis,
  isSnapshotFresh,
  resolveDeepScanSnapshotKey,
} from '@/lib/deepscan-snapshot-policy'
import { lookupDeepScanSnapshot, saveDeepScanSnapshot } from '@/lib/deepscan-snapshot-store'
import type { JarooDeepScanPayload } from '../../../../packages/contracts/src/deepscan'

export const runtime = 'nodejs'

export function buildDeepScanCanonicalInput(searchParams: URLSearchParams) {
  return buildRawInputFromSearchParams(searchParams)
}

export async function createDeepScanCanonicalResponse(
  searchParams: URLSearchParams,
  builder: typeof buildDeepScanPayloadFromSearchParams = buildDeepScanPayloadFromSearchParams,
  charge?: { userId: string; amount: number; ref?: string | null } | null,
  onPayload?: (payload: JarooDeepScanPayload) => void | Promise<void>,
) {
  const startedAt = new Date()

  try {
    const payload = await builder(searchParams)
    void recordDeepScanPayloadPerf(payload, { route: 'api/deepscan', startedAt }).catch(() => undefined)
    if (onPayload) {
      await onPayload(payload)
    }
    return NextResponse.json(payload)
  } catch (error) {
    const status = error instanceof CrawlerDeepScanRequestError ? error.status : 400

    // §6-6: 유저에게 아무것도 전달되지 않은 실패 — 선차감 크레딧을 돌려준다.
    let refundedCredits = 0
    if (charge && charge.amount > 0) {
      const { refundDeepScanCredits } = await import('@/lib/payments/deepscan-entitlement')
      let refunded = false
      try {
        refunded = await refundDeepScanCredits(charge.userId, charge.amount, charge.ref ?? undefined)
      } catch (refundError) {
        // RPC 호출 자체의 reject도 수동 정산 추적 대상이다 (리뷰 P2).
        console.error('[deepscan] credit refund call rejected — 수동 정산 필요', {
          userId: charge.userId,
          amount: charge.amount,
          ref: charge.ref,
          refundError,
        })
      }
      if (refunded) {
        refundedCredits = charge.amount
      } else {
        // 환불 실패는 금액 불일치로 이어지므로 반드시 추적 가능한 로그를 남긴다.
        console.error('[deepscan] credit refund failed — 수동 정산 필요', {
          userId: charge.userId,
          amount: charge.amount,
          ref: charge.ref,
        })
      }
    }

    if (refundedCredits > 0) {
      // §6-6: 사용자에게는 실패 + 차감 취소를 한국어로 안내한다. 원문 예외는 로그로만 남긴다.
      console.error('[deepscan] builder failed (credits refunded)', { status, refundedCredits, error })
      return NextResponse.json(
        {
          ok: false,
          data: null,
          count: 0,
          refundedCredits,
          error: {
            message: '딥스캔 분석이 실패했어요. 크레딧은 차감되지 않았어요. 잠시 후 다시 시도해 주세요.',
          },
        },
        { status },
      )
    }

    // §7: 인프라 원문(영문 진단·업스트림 응답 본문)은 로그로만 남기고 화면에는 한국어 공통 문구를 내린다 (리뷰 P2).
    console.error('[deepscan] builder failed', { status, error })
    return NextResponse.json(
      {
        ok: false,
        data: null,
        count: 0,
        error: {
          message: '딥스캔에 일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
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

  // 스냅샷 캐시 — 기본 경로(재열람)는 최근 결과를 즉시 돌려준다(과금 0·대기 0).
  // 갱신은 명시적 refresh=1(다시 분석) 요청만 허용한다.
  const refreshRequested = searchParams.get('refresh') === '1'
  const snapshotKey = resolveDeepScanSnapshotKey({
    code: searchParams.get('code'),
    ticker: searchParams.get('ticker'),
  })
  if (!refreshRequested && snapshotKey) {
    try {
      const supabase = await createSupabaseServerClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const snapshot = await lookupDeepScanSnapshot(user.id, snapshotKey)
        if (snapshot && isSnapshotFresh(snapshot.scannedAt)) {
          return NextResponse.json(
            buildSnapshotCacheAnnotatedPayload(snapshot.payload, {
              scannedAt: snapshot.scannedAt,
              chargedCredits: snapshot.chargedCredits,
            }),
          )
        }
      }
    } catch (cacheError) {
      // 캐시 조회 실패는 정상 스캔 경로를 막지 않는다
      console.error('[deepscan-snapshot] lookup failed — 정상 경로로 진행', cacheError)
    }
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
  // 차감이 실제로 일어난 경우에만 실패 시 환불 컨텍스트를 넘긴다(Pro 면제·무료 통과는 제외).
  const targetRef = searchParams.get('code') ?? searchParams.get('ticker') ?? undefined
  const charge = gate.status === 'allowed' && gate.charged > 0 && gate.userId
    ? { userId: gate.userId, amount: gate.charged, ref: targetRef }
    : null
  // 스캔 성공 시 (user_id, 종목) 스냅샷 저장 — 저장 실패는 응답에 영향 없음
  const snapshotUserId = gate.userId ?? null
  const onSnapshotReady = (payload: JarooDeepScanPayload): void => {
    if (!snapshotUserId || !snapshotKey) return
    void saveDeepScanSnapshot({
      userId: snapshotUserId,
      targetKey: snapshotKey,
      market: searchParams.get('market'),
      payload,
      priceBasis: extractSnapshotPriceBasis(payload),
      chargedCredits: gate.status === 'allowed' ? gate.charged : 0,
    })
  }
  return createDeepScanCanonicalResponse(searchParams, undefined, charge, onSnapshotReady)
}
