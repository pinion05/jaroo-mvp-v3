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
      // (F1-a2) record_payment_event 는 row 존재 여부만 반환하므로(false=이미 존재),
      // 재전송이 '미처리 row'에 닿았는지 processed_at 으로 판별한다. NULL 이면
      // duplicate-ack 으로 소진시키지 않고 핸들러를 재실행한다 — 모든 핸들러는
      // ①시크릿 재조회 ②조건부 전환 가드로 멱등이라 이중 실행이 수렴한다.
      const { data: existing, error: probeError } = await service
        .from('payment_events')
        .select('processed_at')
        .eq('event_id', eventId)
        .maybeSingle()
      if (probeError || existing?.processed_at != null) {
        return NextResponse.json({ ok: true, duplicate: true }) // 완결된 이벤트(판별 불가 시 cron 스윕이 안전망)
      }
      console.warn('[payments/webhook] unprocessed event redelivered — re-dispatching', eventId)
    }

    if (eventType === 'PAYMENT_STATUS_CHANGED' && paymentKey) {
      const handled = await handlePaymentStatusChanged(service, paymentKey, eventId)
      if (!handled) {
        // (F1-a1) 처리 실패: processed_at 라인에 도달하지 않고 500 → 토스 백오프
        // 재전송이 위 (a-2) 재dispatch 로 회수한다. 200 을 돌려주면 재전송이 없어
        // 영구 누락(유저는 환불받고 크레딧도 유지).
        return NextResponse.json({ ok: false, error: 'handler-failed' }, { status: 500 })
      }
    } else if (eventType === 'BILLING_DELETED' && billingKey) {
      // 빌링키 삭제(고객 직접 해지 등): 즉시 canceled 로 바꾸면 만료 cron(active 만
      // 조회)이 이 구독을 만료 처리할 수 없어 성골 상태가 된다. 남은 기간은 유지하고
      // 기간 말료 예약만 걸며, 실제 만료/빌링키 정리는 기존 갱신 cron 에 위임한다.
      const { error: markError } = await service
        .from('pro_subscriptions')
        .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
        .eq('billing_key', billingKey)
        .in('status', ['active', 'past_due'])
      if (markError) {
        console.error('[payments/webhook] billing-deleted mark failed', eventId, markError)
        return NextResponse.json({ ok: false, error: 'handler-failed' }, { status: 500 })
      }
    }

    await service.from('payment_events').update({ processed_at: new Date().toISOString() }).eq('event_id', eventId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payments/webhook] handler failed', eventId, error)
    // 500: 토스는 유한 백오프로 재전송한다(폭주하지 않는다). getTossPayment 실패
    // (토스 장애)가 최대 throw 소스 — 200 으로 삼키면 (a-2) 회수 경로가 발동할
    // 재전송 자체가 없다. processed_at 미기입 row 는 재dispatch 대상이 된다.
    return NextResponse.json({ ok: false, error: 'handler-failed' }, { status: 500 })
  }
}

async function handlePaymentStatusChanged(
  service: ReturnType<typeof createSupabaseServiceClient>,
  paymentKey: string,
  eventId: string,
): Promise<boolean> {
  // 본문이 아니라 시크릿 키 조회 결과를 진실로 삼는다.
  const payment = await getTossPayment(paymentKey)

  const { data: order, error: orderError } = await service
    .from('payment_orders')
    .select('order_id, user_id, kind, credits, status')
    .eq('order_id', payment.orderId)
    .maybeSingle()
  if (orderError) {
    console.error('[payments/webhook] order lookup failed', eventId, orderError)
    return false
  }
  if (!order) return true

  if (payment.status === 'CANCELED' && order.status === 'DONE' && order.kind === 'credit_pack') {
    // 전액 환불: 잔액 차감 + refund 원장 insert + 주문 CANCELED 전환을 하나의
    // 원자적 RPC 로 처리한다(DONE→CANCELED 조건부 전환이 멱등 가드). 웹훅 재전송,
    // 처리 도중 실패로 인한 부분 반영(잔액만 깎고 원장 누락 등)을 원천 차단한다.
    const { error: revokeError } = await service.rpc('revoke_refunded_credits', {
      p_order_id: order.order_id,
      p_fail_reason: payment.cancels?.[0]?.cancelReason ?? 'canceled',
    })
    if (revokeError) {
      console.error('[payments/webhook] revoke failed', eventId, order.order_id, revokeError)
      return false
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
        console.error('[payments/webhook] partial revoke failed', eventId, order.order_id, revokeError)
        return false
      }
    }
  } else if (payment.status === 'DONE' && order.status === 'PENDING') {
    // confirm/확정 누락 복구 (멱등 RPC). 결제는 승인됐는데 주문이 PENDING 인 경우.
    if (order.kind === 'credit_pack') {
      const { error: applyError } = await service.rpc('apply_credit_purchase', {
        p_user_id: order.user_id,
        p_order_id: order.order_id,
        p_credits: order.credits ?? 0,
        p_payment_key: paymentKey,
        p_toss_raw: payment,
      })
      if (applyError) {
        console.error('[payments/webhook] credit purchase recover failed', eventId, order.order_id, applyError)
        return false
      }
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
        console.error('[payments/webhook] subscription recover failed', eventId, order.order_id, renewError)
        return false
      } else if (!renewed) {
        // (F2) renewed=false 는 두 의미다: ①주문이 이미 DONE(경합 패배 — 승자가
        // 처리함) ②구독 row 부재(첫 활성화 누락). '주문 재조회'로는 판별할 수
        // 없다 — ②의 경우 renew 가 주문을 이미 DONE 으로 소비한 뒤 false 를
        // 반환하기 때문(둘 다 DONE 이 된다). 구독 row 존재로 판별한다.
        const { data: sub, error: subError } = await service
          .from('pro_subscriptions')
          .select('current_period_end')
          .eq('user_id', order.user_id)
          .maybeSingle()
        if (subError) {
          console.error('[payments/webhook] renew fallback lookup failed', eventId, order.order_id, subError)
          return false
        }
        if (sub) {
          // ① 경합 패배 — 승자가 이미 처리했다. 조용히 넘기지 않는다: '결제금 수령
          // 후 기간이 늘지 않은 이상 상태'와의 구분용 로그(current_period_end 포함).
          console.warn('[payments/webhook] renew race lost — subscription exists, skip activate', eventId, order.order_id, sub.current_period_end)
          return true
        }
        const { error: activateError } = await service.rpc('activate_pro_subscription', {
          p_user_id: order.user_id,
          p_order_id: order.order_id,
          p_billing_key: null, // SQL 이 coalesce 로 기존 키를 보존한다(F2 방어)
          p_card_company: null,
          p_card_number: null,
          p_period_days: PRO_PLAN.periodDays,
          p_payment_key: paymentKey,
          p_toss_raw: payment,
        })
        if (activateError) {
          console.error('[payments/webhook] subscription activate failed', eventId, order.order_id, activateError)
          return false
        }
      }
    }
  } else if (payment.status === 'DONE' && order.status === 'DONE' && order.kind === 'pro_subscription') {
    // (F2 회복) 결제 승인 + 주문 DONE 인데 구독 row 가 없으면 activate 실패 잔재
    // (renew 가 주문을 소비한 뒤 activate 가 실패 → 500 → 재전송이 이 분기에
    // 닿는다). 멱등 activate 로 자가 회복한다 — 재전송 회수 루프를 닫는 분기.
    const { data: sub, error: subError } = await service
      .from('pro_subscriptions')
      .select('user_id')
      .eq('user_id', order.user_id)
      .maybeSingle()
    if (subError) {
      console.error('[payments/webhook] backfill lookup failed', eventId, order.order_id, subError)
      return false
    }
    if (!sub) {
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
        console.error('[payments/webhook] subscription backfill failed', eventId, order.order_id, activateError)
        return false
      }
      console.warn('[payments/webhook] subscription backfilled for DONE order', eventId, order.order_id)
    }
  }

  return true
}

function createHashHex(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 24)
}
