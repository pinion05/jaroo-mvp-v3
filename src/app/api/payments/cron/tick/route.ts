import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { chargeTossBilling, deleteTossBillingKey } from '@/lib/payments/toss-client'
import { hasTossServerConfig } from '@/lib/payments/config'
import { PRO_PLAN } from '@/lib/payments/products'
import { createOrderId, NO_STORE_PRIVATE_HEADERS, tossCustomerKeyFor } from '@/lib/payments/server'

export const runtime = 'nodejs'

// 구독 갱신/만료 워커. 토스는 스케줄링을 제공하지 않으므로 외부 cron(Railway cron,
// GitHub Actions 등)이 주기적으로 호출한다.
//   Authorization: Bearer $PAYMENTS_CRON_SECRET
// 동작:
//   1) 기간 만료 + cancel_at_period_end 구독 → expired 처리 + 빌링키 삭제
//   2) 기간 만료 + 계속 구독 → 빌링키로 결제 승인 → 기간 연장 (실패 시 past_due, 매 틱 재시도)
//   3) past_due 가 7일 경과 → expired
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENTS_CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'cron-not-configured' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization !== `Bearer ${secret}`) {
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

    // 3) 갱신 대상: active + 해지 예약 아님 + 기간 종료
    const { data: toRenew } = await service
      .from('pro_subscriptions')
      .select('user_id, billing_key, card_company')
      .eq('status', 'active')
      .eq('cancel_at_period_end', false)
      .lt('current_period_end', now.toISOString())
    for (const sub of toRenew ?? []) {
      if (!sub.billing_key) {
        await service
          .from('pro_subscriptions')
          .update({ status: 'past_due', updated_at: now.toISOString() })
          .eq('user_id', sub.user_id)
        summary.renewalFailed += 1
        continue
      }

      const orderId = createOrderId('prorenew')
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

      try {
        const payment = await chargeTossBilling(sub.billing_key, {
          customerKey: tossCustomerKeyFor(sub.user_id),
          orderId,
          orderName: 'Jaroo Pro 월 구독 (갱신)',
          amount: PRO_PLAN.amountKrw,
        })
        if (payment.status !== 'DONE') {
          throw new Error(`billing charge status ${payment.status}`)
        }
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
        console.error('[payments/cron] renewal failed', sub.user_id, error)
        await service.from('payment_orders').update({ status: 'FAILED', fail_reason: String(error).slice(0, 300) }).eq('order_id', orderId)
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
