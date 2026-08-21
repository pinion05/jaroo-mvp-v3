import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { getTossPayment } from '@/lib/payments/toss-client'
import { hasTossServerConfig } from '@/lib/payments/config'

export const runtime = 'nodejs'

// 토스페이먼츠 웹훅. 10초 내 200 응답. 신뢰 원칙: 본문을 믿지 않고 paymentKey 로
// 시크릿 키 재조회(re-query)한 뒤 상태를 반영한다. 처리는 payment_events 로 멱등.
//
// 엔드포인트 신뢰(선택): 토스 웹훅에는 서명 헤더가 없어 누구나 POST 할 수 있다.
// PAYMENTS_WEBHOOK_SECRET 를 설정하면 토스 콘솔의 웹훅 URL 에 ?secret=<값> 을
// 붙여 등록하고, 헤더(x-jaroo-webhook-secret) 또는 쿼리 파라미터 어느 쪽이든
// 일치해야 처리한다. 미설정 시 기존 동작을 유지하되 경고를 한 번만 남긴다.
const WEBHOOK_SECRET_HEADER = 'x-jaroo-webhook-secret'
let warnedWebhookSecretMissing = false

function secretsMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

function webhookSecretMatches(request: NextRequest): boolean {
  const secret = process.env.PAYMENTS_WEBHOOK_SECRET?.trim()
  if (!secret) {
    if (!warnedWebhookSecretMissing) {
      warnedWebhookSecretMissing = true
      console.warn('[payments/webhook] PAYMENTS_WEBHOOK_SECRET 미설정 — 엔드포인트가 공개 상태로 동작 중. 설정을 권장한다.')
    }
    return true
  }
  const presented = request.headers.get(WEBHOOK_SECRET_HEADER) ?? request.nextUrl.searchParams.get('secret') ?? ''
  return presented.length > 0 && secretsMatch(presented, secret)
}

export async function POST(request: NextRequest) {
  if (!hasTossServerConfig()) {
    return NextResponse.json({ ok: true })
  }
  if (!webhookSecretMatches(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
  }

  const eventType = typeof body.eventType === 'string' ? body.eventType : 'UNKNOWN'
  const data = (body.data ?? {}) as Record<string, unknown>
  const paymentKey = typeof data.paymentKey === 'string' ? data.paymentKey : null
  const billingKey = typeof data.billingKey === 'string' ? data.billingKey : null

  // 이벤트 id: webhookId 우선, 없으면 본문 해시
  const eventId =
    typeof body.webhookId === 'string' && body.webhookId
      ? body.webhookId
      : `wh-${eventType}-${createHashHex(JSON.stringify(body))}`

  try {
    const service = createSupabaseServiceClient()
    const { data: inserted, error: eventError } = await service.rpc('record_payment_event', {
      p_event_id: eventId,
      p_event_type: eventType,
      p_payment_key: paymentKey ?? billingKey,
      p_payload: body,
    })
    if (eventError) {
      console.error('[payments/webhook] record failed', eventError)
      return NextResponse.json({ ok: true })
    }
    if (!inserted) {
      return NextResponse.json({ ok: true, duplicate: true }) // 이미 처리된 이벤트
    }

    if (eventType === 'PAYMENT_STATUS_CHANGED' && paymentKey) {
      await handlePaymentStatusChanged(service, paymentKey)
    } else if (eventType === 'BILLING_DELETED' && billingKey) {
      await service
        .from('pro_subscriptions')
        .update({ status: 'canceled', canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('billing_key', billingKey)
    }

    await service.from('payment_events').update({ processed_at: new Date().toISOString() }).eq('event_id', eventId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payments/webhook] handler failed', error)
    // 웹훅은 200 을 유지해 재전송 폭주를 막는다(이벤트 row 로 이후 추적 가능).
    return NextResponse.json({ ok: true })
  }
}

async function handlePaymentStatusChanged(service: ReturnType<typeof createSupabaseServiceClient>, paymentKey: string) {
  // 본문이 아니라 시크릿 키 조회 결과를 진실로 삼는다.
  const payment = await getTossPayment(paymentKey)

  const { data: order } = await service
    .from('payment_orders')
    .select('order_id, user_id, kind, credits, status')
    .eq('order_id', payment.orderId)
    .maybeSingle()
  if (!order) return

  if (payment.status === 'CANCELED' && order.status === 'DONE' && order.kind === 'credit_pack') {
    // 환불: 이미 사용해 차감이 불가능한 만큼은 0에 클램프.
    const { data: balanceRow } = await service
      .from('credit_balances')
      .select('balance')
      .eq('user_id', order.user_id)
      .maybeSingle()
    const revoke = Math.min(order.credits ?? 0, balanceRow?.balance ?? 0)
    if (revoke > 0) {
      await service.from('credit_balances').update({ balance: revoke === (balanceRow?.balance ?? 0) ? 0 : (balanceRow?.balance ?? 0) - revoke }).eq('user_id', order.user_id)
      await service.from('credit_ledger').insert({
        user_id: order.user_id,
        delta: -revoke,
        reason: 'refund',
        order_id: order.order_id,
        balance_after: revoke === (balanceRow?.balance ?? 0) ? 0 : (balanceRow?.balance ?? 0) - revoke,
      })
    }
    await service.from('payment_orders').update({ status: 'CANCELED', fail_reason: payment.cancels?.[0]?.cancelReason ?? 'canceled' }).eq('order_id', order.order_id)
  } else if (payment.status === 'DONE' && order.status === 'PENDING' && order.kind === 'credit_pack') {
    // confirm 누락 복구 (멱등 RPC)
    await service.rpc('apply_credit_purchase', {
      p_user_id: order.user_id,
      p_order_id: order.order_id,
      p_credits: order.credits ?? 0,
      p_payment_key: paymentKey,
      p_toss_raw: payment,
    })
  }
}

function createHashHex(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 24)
}
