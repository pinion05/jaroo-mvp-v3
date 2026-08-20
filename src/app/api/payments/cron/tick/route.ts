import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { chargeTossBilling, deleteTossBillingKey, getTossPaymentByOrderId, type TossPayment } from '@/lib/payments/toss-client'
import { hasTossServerConfig } from '@/lib/payments/config'
import { PRO_PLAN } from '@/lib/payments/products'
import { NO_STORE_PRIVATE_HEADERS, tossCustomerKeyFor } from '@/lib/payments/server'

export const runtime = 'nodejs'

function secretsMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

// 갱신 orderId: (사용자, 갱신 대상 기간)에 결정론적으로 고정한다.
// 재시도 틱이 같은 orderId 를 유지해 chargeTossBilling 의 Idempotency-Key(=orderId)가
// 중복 승인을 막고, 토스 승인 전적 조회(getTossPaymentByOrderId)의 기준이 된다.
function renewalOrderIdFor(userId: string, currentPeriodEnd: string | null): string {
  const userPart = userId.replaceAll('-', '').slice(0, 12)
  const periodPart = (currentPeriodEnd ?? '').slice(0, 10).replaceAll('-', '') || 'unknown'
  return `jrw-prorenew-${userPart}-${periodPart}`
}

// 구독 갱신/만료 워커. 토스는 스케줄링을 제공하지 않으므로 외부 cron(Railway cron,
// GitHub Actions 등)이 주기적으로 호출한다.
//   Authorization: Bearer $PAYMENTS_CRON_SECRET
// 동작:
//   1) 기간 만료 + cancel_at_period_end 구독 → expired 처리 + 빌링키 삭제
//   2) 기간 만료 + 계속 구독 → 빌링키로 결제 승인 → 기간 연장 (실패/정합성 실패 시 past_due, 매 틱 재시도)
//   3) past_due 가 7일 경과 → expired
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENTS_CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'cron-not-configured' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  const authorization = request.headers.get('authorization') ?? ''
  if (!secretsMatch(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (!hasTossServerConfig()) {
    return NextResponse.json({ error: 'toss-not-configured' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const now = new Date()
  const service = createSupabaseServiceClient()
  const summary = { expired: 0, renewed: 0, renewalFailed: 0, skipped: 0 }

  try {
    // 1) 만료 예정(해지 요청) 구독 정리
    const { data: toExpire } = await service
      .from('pro_subscriptions')
      .select('user_id, billing_key')
      .eq('status', 'active')
      .eq('cancel_at_period_end', true)
      .lt('current_period_end', now.toISOString())
    for (const sub of toExpire ?? []) {
      if (sub.billing_key) {
        try {
          await deleteTossBillingKey(sub.billing_key)
        } catch (error) {
          console.error('[payments/cron] billing key delete failed', error)
        }
      }
      await service
        .from('pro_subscriptions')
        .update({ status: 'expired', canceled_at: now.toISOString(), billing_key: null, updated_at: now.toISOString() })
        .eq('user_id', sub.user_id)
      summary.expired += 1
    }

    // 2) past_due 7일 경과 → expired
    const graceDeadline = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: overdue } = await service
      .from('pro_subscriptions')
      .select('user_id, billing_key')
      .eq('status', 'past_due')
      .lt('current_period_end', graceDeadline)
    for (const sub of overdue ?? []) {
      if (sub.billing_key) {
        try {
          await deleteTossBillingKey(sub.billing_key)
        } catch (error) {
          console.error('[payments/cron] overdue billing key delete failed', error)
        }
      }
      await service
        .from('pro_subscriptions')
        .update({ status: 'expired', canceled_at: now.toISOString(), billing_key: null, updated_at: now.toISOString() })
        .eq('user_id', sub.user_id)
      summary.expired += 1
    }

    // 3) 갱신 대상: active|past_due + 해지 예약 아님 + 기간 종료.
    //    past_due 도 매 틱 재시도한다(7일 경과는 위 2)에서 만료 처리).
    //    orderId 를 (사용자, 갱신 대상 기간)으로 고정하고 결제 전에 토스 승인 전적을
    //    재조회해, 이전 틱에서 승인됐던 결제를 다시 치는 이중 청구를 원천 차단한다.
    const { data: toRenew } = await service
      .from('pro_subscriptions')
      .select('user_id, billing_key, card_company, current_period_end')
      .in('status', ['active', 'past_due'])
      .eq('cancel_at_period_end', false)
      .lt('current_period_end', now.toISOString())
    for (const sub of toRenew ?? []) {
      const orderId = renewalOrderIdFor(sub.user_id, sub.current_period_end)

      const { data: existingOrder } = await service
        .from('payment_orders')
        .select('order_id, status')
        .eq('order_id', orderId)
        .maybeSingle()
      if (existingOrder?.status === 'DONE') {
        // 이 기간 갱신은 이미 완료(주문만 DONE 인 상태). 구독 상태만 정리한다.
        await service.from('pro_subscriptions').update({ status: 'active', updated_at: now.toISOString() }).eq('user_id', sub.user_id)
        summary.skipped += 1
        continue
      }

      // 승인 전적 확인: 우리 기록이 FAILED 여도 네트워크 단절 등으로 토스에는
      // DONE 결제가 남아 있을 수 있다. 본문이 아니라 토스를 진실로 삼는다.
      let payment: TossPayment | null = null
      try {
        payment = await getTossPaymentByOrderId(orderId)
      } catch {
        payment = null // 해당 orderId 로 승인된 결제 없음
      }

      if (!payment || payment.status !== 'DONE') {
        if (!sub.billing_key) {
          await service
            .from('pro_subscriptions')
            .update({ status: 'past_due', updated_at: now.toISOString() })
            .eq('user_id', sub.user_id)
          summary.renewalFailed += 1
          continue
        }

        if (!existingOrder) {
          const { error: orderError } = await service.from('payment_orders').insert({
            user_id: sub.user_id,
            order_id: orderId,
            product_id: PRO_PLAN.id,
            kind: 'pro_subscription',
            amount_krw: PRO_PLAN.amountKrw,
            status: 'PENDING',
          })
          if (orderError) {
            console.error('[payments/cron] renewal order insert failed', orderError)
            summary.renewalFailed += 1
            continue
          }
        }

        try {
          payment = await chargeTossBilling(sub.billing_key, {
            customerKey: tossCustomerKeyFor(sub.user_id),
            orderId,
            orderName: 'Jaroo Pro 월 구독 (갱신)',
            amount: PRO_PLAN.amountKrw,
          })
          if (payment.status !== 'DONE') {
            throw new Error(`billing charge status ${payment.status}`)
          }
        } catch (error) {
          console.error('[payments/cron] renewal charge failed', sub.user_id, error)
          // 결제 시도 자체가 실패한 경우. (승인은 됐고 응답을 못 받은 경우라면 다음
          // 틱의 getTossPaymentByOrderId 가 DONE 을 발견해 복구한다.)
          await service.from('payment_orders').update({ status: 'FAILED', fail_reason: String(error).slice(0, 300) }).eq('order_id', orderId)
          await service.from('pro_subscriptions').update({ status: 'past_due', updated_at: now.toISOString() }).eq('user_id', sub.user_id)
          summary.renewalFailed += 1
          continue
        }
      }

      // 여기부터 payment.status === 'DONE' 보장. 주문을 PENDING 으로 정리 뒤
      // 기간 연장 RPC 를 호출한다(주문 DONE 처리 + 기간 연장이 한 트랜잭션이라
      // RPC 부분 실패 시 다음 틱이 같은 orderId 로 안전 재시도한다).
      if (!existingOrder) {
        await service.from('payment_orders').insert({
          user_id: sub.user_id,
          order_id: orderId,
          product_id: PRO_PLAN.id,
          kind: 'pro_subscription',
          amount_krw: PRO_PLAN.amountKrw,
          status: 'PENDING',
        })
      } else if (existingOrder.status !== 'PENDING') {
        await service.from('payment_orders').update({ status: 'PENDING', fail_reason: null }).eq('order_id', orderId)
      }

      try {
        const { error: rpcError } = await service.rpc('renew_pro_subscription', {
          p_user_id: sub.user_id,
          p_order_id: orderId,
          p_period_days: PRO_PLAN.periodDays,
          p_payment_key: payment.paymentKey,
          p_toss_raw: payment,
        })
        if (rpcError) throw rpcError
        summary.renewed += 1
      } catch (error) {
        console.error('[payments/cron] renewal apply failed', sub.user_id, error)
        // 결제는 승인됐고 주문은 PENDING 유지 → 다음 틱이 재시도.
        await service.from('pro_subscriptions').update({ status: 'past_due', updated_at: now.toISOString() }).eq('user_id', sub.user_id)
        summary.renewalFailed += 1
      }
    }

    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error('[payments/cron] tick failed', error)
    return NextResponse.json({ error: 'cron-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }
}
