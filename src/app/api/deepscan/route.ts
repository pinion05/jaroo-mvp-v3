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

  // 스냅샷 캐시 — 기본 경로(재열람)는 최근 결과를 즉시 돌려준다(과금 0·대기 0).
  // 갱신은 명시적 refresh=1(다시 분석) 요청만 허용한다.
  // ⚠️ 과금 시스템(Toss) 설정 여부와 무관하게 가장 먼저 판정한다 —
  //    미과금 환경(운영 체험 기간 등)에서 캐시가 죽는 결함(이슈: 캐시히트 안 됨)의 수정.
  const refreshRequested = searchParams.get('refresh') === '1'
  const snapshotKey = resolveDeepScanSnapshotKey({
    code: searchParams.get('code'),
    ticker: searchParams.get('ticker'),
  })
  let sessionUserId: string | null = null
  if (!refreshRequested && snapshotKey) {
    try {
      const supabase = await createSupabaseServerClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        sessionUserId = user.id
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

  // 미과금 환경(결제 연동 꺼짐) — 무과금 직행. 세션 유저의 스냅샷은 여기서도
  // 저장한다(chargedCredits=0). 다음 재열람이 히트되어 체험 기간 UX·비용 모두 절감.
  if (!hasTossServerConfig()) {
    const unpaidUserId = sessionUserId ?? (await resolveDeepScanSessionUserId())
    const unpaidSnapshotSaver = makeSnapshotSaver(unpaidUserId, 0)
    return createDeepScanCanonicalResponse(
      searchParams,
      undefined,
      null,
      unpaidSnapshotSaver ? (payload) => unpaidSnapshotSaver(payload, snapshotKey, searchParams) : undefined,
    )
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
  const paidSnapshotSaver = makeSnapshotSaver(gate.userId ?? null, gate.status === 'allowed' ? gate.charged : 0)
  return createDeepScanCanonicalResponse(
    searchParams,
    undefined,
    charge,
    paidSnapshotSaver ? (payload) => paidSnapshotSaver(payload, snapshotKey, searchParams) : undefined,
  )
}

/** 세션 유저 id — 게이트 밖 경로(무과금 직행)에서 스냅샷 귀속용 */
async function resolveDeepScanSessionUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

/** 스냅샷 저장 클로저 — 유저가 없으면(게스트 등) 저장하지 않는다 */
function makeSnapshotSaver(userId: string | null, chargedCredits: number) {
  if (!userId) return null
  return (payload: JarooDeepScanPayload, snapshotKey: string | null, searchParams: URLSearchParams): void => {
    if (!snapshotKey) return
    void saveDeepScanSnapshot({
      userId,
      targetKey: snapshotKey,
      market: searchParams.get('market'),
      payload,
      priceBasis: extractSnapshotPriceBasis(payload),
      chargedCredits,
    })
  }
}
