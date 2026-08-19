import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { confirmTossPayment, TossApiError } from '@/lib/payments/toss-client'
import { NO_STORE_PRIVATE_HEADERS, resolvePaymentUserId } from '@/lib/payments/server'

export const runtime = 'nodejs'

// 일회성(크레딧 팩) 결제 승인: successUrl 리다이렉트 후 호출.
// amount 는 쿼리값을 무시하고 DB 주문 row 금액으로만 승인한다.
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

  const { orderId, paymentKey } = (body ?? {}) as { orderId?: unknown; paymentKey?: unknown }
  if (typeof orderId !== 'string' || typeof paymentKey !== 'string' || !orderId || !paymentKey) {
    return NextResponse.json({ error: 'order-and-payment-key-required' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  try {
    const service = createSupabaseServiceClient()
    const { data: order, error: orderError } = await service
      .from('payment_orders')
      .select('order_id, user_id, kind, amount_krw, credits, status')
      .eq('order_id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'order-not-found' }, { status: 404, headers: NO_STORE_PRIVATE_HEADERS })
    }
    if (order.user_id !== auth.userId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE_PRIVATE_HEADERS })
    }
    if (order.kind !== 'credit_pack') {
      return NextResponse.json({ error: 'not-a-credit-pack-order' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
    }
    if (order.status === 'DONE') {
      return NextResponse.json({ ok: true, alreadyConfirmed: true, credits: order.credits }, { headers: NO_STORE_PRIVATE_HEADERS })
    }

    // 토스 승인 — 금액은 DB 값
    let payment
    try {
      payment = await confirmTossPayment(paymentKey, orderId, order.amount_krw)
    } catch (error) {
      if (error instanceof TossApiError && error.status === 404 && error.code === 'NOT_FOUND_PAYMENT') {
        // 이미 승인된 결제건 재확인 (중복 리다이렉트 등): 주문번호로 조회해 정합성 복구
        const { getTossPaymentByOrderId } = await import('@/lib/payments/toss-client')
        payment = await getTossPaymentByOrderId(orderId)
        if (payment.paymentKey !== paymentKey) {
          throw error
        }
      } else {
        throw error
      }
    }

    if (payment.status !== 'DONE') {
      await service.from('payment_orders').update({ status: 'FAILED', fail_reason: `toss status ${payment.status}` }).eq('order_id', orderId)
      return NextResponse.json({ error: 'payment-not-done', tossStatus: payment.status }, { status: 402, headers: NO_STORE_PRIVATE_HEADERS })
    }

    const { error: rpcError } = await service.rpc('apply_credit_purchase', {
      p_user_id: auth.userId,
      p_order_id: orderId,
      p_credits: order.credits ?? 0,
      p_payment_key: paymentKey,
      p_toss_raw: payment,
    })
    if (rpcError) {
      console.error('[payments/confirm] apply_credit_purchase failed', rpcError)
      return NextResponse.json({ error: 'credit-grant-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    return NextResponse.json({ ok: true, credits: order.credits, amountKrw: order.amount_krw }, { headers: NO_STORE_PRIVATE_HEADERS })
  } catch (error) {
    if (error instanceof TossApiError) {
      console.error('[payments/confirm] toss rejected', error.code, error.message)
      return NextResponse.json({ error: 'payment-rejected', code: error.code, message: error.message }, { status: 402, headers: NO_STORE_PRIVATE_HEADERS })
    }
    console.error('[payments/confirm] failed', error)
    return NextResponse.json({ error: 'confirm-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }
}
