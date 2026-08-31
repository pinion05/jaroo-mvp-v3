import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { isExpectedSupabaseAuthMiss } from '@/lib/supabase/auth-error'
import { DEEPSCAN_CREDIT_COST } from './products'
import { isPaymentConfigured } from './server'

// 딥스캔 실행 크레딧 게이트 — 유일한 과금 지점.
// 딥스캔 라우트 6곳 중 정규 실행을 트리거하는 것은 /api/deepscan (GET) 하나뿐이고,
// 과금 정책(크레딧 필요, Pro 면제, 게이트 예외)은 이 모듈에만 존재한다.
// 정책 변경 시 이 파일만 수정하면 된다.
//
// 동작:
//   - 결제 미설정(로컬 dev, 키 미등록 배포) → 무료 통과(기존 동작 유지)
//   - 로그인 없음 → auth-required
//   - Pro 구독 active/past_due(유예) → 무제한 통과
//   - 그 외 → spend_credits RPC 로 1회분 차감(부족 시 insufficient-credits)

export type DeepScanRunGateResult =
  | { status: 'allowed'; charged: number; proCovered: boolean; userId?: string }
  | { status: 'auth-required' }
  | { status: 'insufficient-credits'; balance: number; cost: number }
  | { status: 'unavailable' }

export async function authorizeDeepScanRun(targetRef?: string): Promise<DeepScanRunGateResult> {
  // 결제 연동이 꺼져 있으면 과금하지 않는다. 키가 없는 환경(로컬/스테이징)에서
  // 딥스캔이 막히지 않도록 하는 안전 밸브다.
  if (!isPaymentConfigured()) {
    return { status: 'allowed', charged: 0, proCovered: false }
  }

  let userId: string | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      if (isExpectedSupabaseAuthMiss(error)) {
        userId = null
      } else {
        console.error('[deepscan-gate] auth resolution failed', error)
        return { status: 'unavailable' }
      }
    } else {
      userId = data.user?.id ?? null
    }
  } catch (error) {
    console.error('[deepscan-gate] auth infrastructure failed', error)
    return { status: 'unavailable' }
  }

  if (!userId) {
    return { status: 'auth-required' }
  }

  const service = createSupabaseServiceClient()

  // Pro 구독자는 무제한. past_due 도 cron 의 7일 유예 기간 동안은 혜택을 유지한다.
  const { data: subscription, error: subError } = await service
    .from('pro_subscriptions')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle()
  if (subError) {
    console.error('[deepscan-gate] subscription lookup failed', subError)
    return { status: 'unavailable' }
  }
  if (subscription?.status === 'active' || subscription?.status === 'past_due') {
    return { status: 'allowed', charged: 0, proCovered: true, userId }
  }

  const { data: spent, error: spendError } = await service.rpc('spend_credits', {
    p_user_id: userId,
    p_amount: DEEPSCAN_CREDIT_COST,
    // credit_ledger 의 check 제약 허용값: purchase | deepscan | grant | refund
    p_reason: 'deepscan',
    p_ref: targetRef ?? null,
  })
  if (spendError) {
    console.error('[deepscan-gate] spend_credits failed', spendError)
    return { status: 'unavailable' }
  }
  if (!spent) {
    const { data: balanceRow } = await service
      .from('credit_balances')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle()
    return { status: 'insufficient-credits', balance: balanceRow?.balance ?? 0, cost: DEEPSCAN_CREDIT_COST }
  }

  return { status: 'allowed', charged: DEEPSCAN_CREDIT_COST, proCovered: false, userId }
}

/**
 * 선차감 크레딧 환불 (§6-6) — 유저에게 아무것도 전달되지 않은 실패에 사용.
 * refund_credits RPC(service role 전용)로 잔액 복구 + credit_ledger refund 기록.
 * 실패하면 false — 호출부는 로그로 수동 정산 추적을 남겨야 한다.
 */
export async function refundDeepScanCredits(userId: string, amount: number, ref?: string): Promise<boolean> {
  if (amount <= 0) {
    return false
  }
  const service = createSupabaseServiceClient()
  const { data: refunded, error } = await service.rpc('refund_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: 'refund',
    p_ref: ref ?? null,
  })
  if (error) {
    console.error('[deepscan-gate] refund_credits failed', error)
    return false
  }
  return Boolean(refunded)
}
