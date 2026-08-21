import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { chargeTossBilling, issueTossBillingKey, TossApiError } from '@/lib/payments/toss-client'
import { PRO_PLAN } from '@/lib/payments/products'
import { NO_STORE_PRIVATE_HEADERS, resolvePaymentUserId, tossCustomerKeyFor } from '@/lib/payments/server'

export const runtime = 'nodejs'

// Pro 구독 첫 결제: requestBillingAuth 성공 리다이렉트(customerKey, authKey) 이후 호출.
// 1) authKey 로 빌링키 발급 → 2) 빌링키로 첫 달 결제 승인 → 3) 구독 활성화 (모두 원자적 RPC).
export async function POST(request: NextRequest) {
  const auth = await resolvePaymentUserId()
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const { orderId, authKey, customerKey } = (body ?? {}) as { orderId?: unknown; authKey?: unknown; customerKey?: unknown }
  if (typeof orderId !== 'string' || typeof authKey !== 'string' || !orderId || !authKey) {
    return NextResponse.json({ error: 'order-and-auth-key-required' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const expectedCustomerKey = tossCustomerKeyFor(auth.userId)
  if (typeof customerKey === 'string' && customerKey !== expectedCustomerKey) {
    return NextResponse.json({ error: 'customer-key-mismatch' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  try {
    const service = createSupabaseServiceClient()
    const { data: order, error: orderError } = await service
      .from('payment_orders')
      .select('order_id, user_id, kind, amount_krw, status')
      .eq('order_id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'order-not-found' }, { status: 404, headers: NO_STORE_PRIVATE_HEADERS })
    }
    if (order.user_id !== auth.userId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
    }
    if (order.kind !== 'pro_subscription') {
      return NextResponse.json({ error: 'not-a-subscription-order' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
    }

    // 이미 활성 구독이 있으면 재결제 차단 (해지 후 재구독은 가능)
    const { data: existing } = await service
      .from('pro_subscriptions')
      .select('status, current_period_end')
      .eq('user_id', auth.userId)
      .single()
    if (existing && existing.status === 'active' && new Date(existing.current_period_end) > new Date()) {
      return NextResponse.json({ error: 'already-subscribed' }, { status: 409, headers: NO_STORE_PRIVATE_HEADERS })
    }

    // 1) 빌링키 발급 (authKey 는 1회성)
    const billing = await issueTossBillingKey(expectedCustomerKey, authKey)

    // 2) 첫 달 결제
    const payment = await chargeTossBilling(billing.billingKey, {
      customerKey: expectedCustomerKey,
      orderId,
      orderName: 'Jaroo Pro 월 구독',
      amount: order.amount_krw,
    })

    if (payment.status !== 'DONE') {
      await service.from('payment_orders').update({ status: 'FAILED', fail_reason: `billing charge ${payment.status}` }).eq('order_id', orderId)
      return NextResponse.json({ error: 'payment-not-done', tossStatus: payment.status }, { status: 402, headers: NO_STORE_PRIVATE_HEADERS })
    }

    // 3) 구독 활성화
    const { error: rpcError } = await service.rpc('activate_pro_subscription', {
      p_user_id: auth.userId,
      p_order_id: orderId,
      p_billing_key: billing.billingKey,
      p_card_company: billing.cardCompany ?? null,
      p_card_number: billing.cardNumber ?? null,
      p_period_days: PRO_PLAN.periodDays,
      p_payment_key: payment.paymentKey,
      p_toss_raw: payment,
    })
    if (rpcError) {
      console.error('[payments/billing/confirm] activate failed', rpcError)
      return NextResponse.json({ error: 'subscription-activate-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    return NextResponse.json({ ok: true, amountKrw: order.amount_krw }, { headers: NO_STORE_PRIVATE_HEADERS })
  } catch (error) {
    if (error instanceof TossApiError) {
      console.error('[payments/billing/confirm] toss rejected', error.code, error.message)
      return NextResponse.json({ error: 'billing-failed', code: error.code, message: error.message }, { status: 402, headers: NO_STORE_PRIVATE_HEADERS })
    }
    console.error('[payments/billing/confirm] failed', error)
    return NextResponse.json({ error: 'billing-confirm-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }
}
