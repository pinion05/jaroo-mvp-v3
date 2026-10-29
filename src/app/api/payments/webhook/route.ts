import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { getTossPayment } from '@/lib/payments/toss-client'
import { hasTossServerConfig } from '@/lib/payments/config'
import { PRO_PLAN } from '@/lib/payments/products'

export const runtime = 'nodejs'

// 토스페이먼츠 웹훅. 10초 내 200 응답. 신뢰 원칙: 본문을 믿지 않고 paymentKey 로
// 시크릿 키 재조회(re-query)한 뒤 상태를 반영한다. 처리는 payment_events 로 멱등.
//
// 엔드포인트 신뢰(fail-closed): 토스 웹훅에는 서명 헤더가 없어 누구나 POST 할 수 있다.
// PAYMENTS_WEBHOOK_SECRET 를 설정하면 토스 콘솔의 웹훅 URL 에 ?secret=<값> 을
// 붙여 등록하고, 헤더(x-jaroo-webhook-secret) 또는 쿼리 파라미터 어느 쪽이든
// 일치해야 처리한다. 미설정 시 503 로 거부한다(위조 웹훅 방어가 우선).
const WEBHOOK_SECRET_HEADER = 'x-jaroo-webhook-secret'

function secretsMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

function resolveWebhookSecretStatus(request: NextRequest): 'ok' | 'not-configured' | 'mismatch' {
  const secret = process.env.PAYMENTS_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return 'not-configured'
  }
  const presented = request.headers.get(WEBHOOK_SECRET_HEADER) ?? request.nextUrl.searchParams.get('secret') ?? ''
  return presented.length > 0 && secretsMatch(presented, secret) ? 'ok' : 'mismatch'
}

export async function POST(request: NextRequest) {
  if (!hasTossServerConfig()) {
    return NextResponse.json({ ok: true })
  }
  const secretStatus = resolveWebhookSecretStatus(request)
  if (secretStatus === 'not-configured') {
    console.error('[payments/webhook] PAYMENTS_WEBHOOK_SECRET 미설정 — fail-closed 거부. 토스 콘솔 웹훅 URL에 secret를 등록해야 한다.')
    return NextResponse.json({ error: 'webhook-secret-not-configured' }, { status: 503 })
  }
  if (secretStatus === 'mismatch') {
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
      // 이벤트 저장 실패 = 멱등 처리가 불가능한 상태. 200 을 돌려주면 이 결제 상태는
      // 영영 반영되지 않으므로 500 으로 토스 재전송을 유도한다.
      return NextResponse.json({ ok: false, error: 'event-record-failed' }, { status: 500 })
    }
    if (!inserted) {
      return NextResponse.json({ ok: true, duplicate: true }) // 이미 처리된 이벤트
    }

    if (eventType === 'PAYMENT_STATUS_CHANGED' && paymentKey) {
      await handlePaymentStatusChanged(service, paymentKey)
    } else if (eventType === 'BILLING_DELETED' && billingKey) {
      // 빌링키 삭제(고객 직접 해지 등): 즉시 canceled 로 바꾸면 만료 cron(active 만
      // 조회)이 이 구독을 만료 처리할 수 없어 성골 상태가 된다. 남은 기간은 유지하고
      // 기간 말료 예약만 걸며, 실제 만료/빌링키 정리는 기존 갱신 cron 에 위임한다.
      await service
        .from('pro_subscriptions')
        .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
        .eq('billing_key', billingKey)
        .in('status', ['active', 'past_due'])
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
    // 전액 환불: 잔액 차감 + refund 원장 insert + 주문 CANCELED 전환을 하나의
    // 원자적 RPC 로 처리한다(DONE→CANCELED 조건부 전환이 멱등 가드). 웹훅 재전송,
    // 처리 도중 실패로 인한 부분 반영(잔액만 깎고 원장 누락 등)을 원천 차단한다.
    const { error: revokeError } = await service.rpc('revoke_refunded_credits', {
      p_order_id: order.order_id,
      p_fail_reason: payment.cancels?.[0]?.cancelReason ?? 'canceled',
    })
    if (revokeError) {
      console.error('[payments/webhook] revoke failed', order.order_id, revokeError)
    }
  } else if (payment.status === 'PARTIAL_CANCELED' && order.status === 'DONE' && order.kind === 'credit_pack') {
    // 부분 취소: 취소 금액(cancelAmount 누적합)에 비례해 크레딧을 회수한다.
    // RPC 가 이미 회수한 원장 합과의 차분만 차감하므로 재전송/누적 부분취소에 멱등.
    const cancelledKrw = (payment.cancels ?? []).reduce((sum, cancel) => sum + (cancel.cancelAmount ?? 0), 0)
    if (payment.totalAmount > 0 && cancelledKrw > 0) {
      const { error: revokeError } = await service.rpc('revoke_partial_refund_credits', {
        p_order_id: order.order_id,
        p_cancel_amount: cancelledKrw,
        p_total_amount: payment.totalAmount,
      })
      if (revokeError) {
        console.error('[payments/webhook] partial revoke failed', order.order_id, revokeError)
      }
    }
  } else if (payment.status === 'DONE' && order.status === 'PENDING') {
    // confirm/확정 누락 복구 (멱등 RPC). 결제는 승인됐는데 주문이 PENDING 인 경우.
    if (order.kind === 'credit_pack') {
      await service.rpc('apply_credit_purchase', {
        p_user_id: order.user_id,
        p_order_id: order.order_id,
        p_credits: order.credits ?? 0,
        p_payment_key: paymentKey,
        p_toss_raw: payment,
      })
    } else if (order.kind === 'pro_subscription') {
      // 구독 주문 복구: 구독 row 가 있으면 기간 연장(갱신/재구독), 없으면(첫 결제
      // 활성화 누락) 활성화로 이어진다. 빌링키는 웹훅에서 복구 불가하므로 결제분
      // 기간만 활성화하고, 이후 갱신은 cron 이 past_due 경과 처리한다.
      const { data: renewed, error: renewError } = await service.rpc('renew_pro_subscription', {
        p_user_id: order.user_id,
        p_order_id: order.order_id,
        p_period_days: PRO_PLAN.periodDays,
        p_payment_key: paymentKey,
        p_toss_raw: payment,
      })
      if (renewError) {
        console.error('[payments/webhook] subscription recover failed', order.order_id, renewError)
      } else if (!renewed) {
        const { error: activateError } = await service.rpc('activate_pro_subscription', {
          p_user_id: order.user_id,
          p_order_id: order.order_id,
          p_billing_key: null,
          p_card_company: null,
          p_card_number: null,
          p_period_days: PRO_PLAN.periodDays,
          p_payment_key: paymentKey,
          p_toss_raw: payment,
        })
        if (activateError) {
          console.error('[payments/webhook] subscription activate failed', order.order_id, activateError)
        }
      }
    }
  }
}

function createHashHex(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 24)
}
