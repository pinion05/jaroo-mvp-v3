'use client'

import type { TossPaymentsPayment } from '@tosspayments/tosspayments-sdk'
import { CREDIT_PACKS, PRO_PLAN, type CreditPack } from './products'

// 결제 클라이언트 플로우 (브라우저 전용).
// 진실 소스는 서버: 주문 생성/승인은 모두 API 라우트가 검증한다.

export { CREDIT_PACKS, PRO_PLAN }
export type { CreditPack }

export type PaymentsMe = {
  authScope: string
  balance: number
  deepScanLeft: number
  deepScanCreditCost?: number
  subscription: {
    status: string
    card_company: string | null
    card_number: string | null
    current_period_end: string
    cancel_at_period_end: boolean
    canceled_at: string | null
  } | null
  orders: Array<{
    order_id: string
    product_id: string
    kind: string
    amount_krw: number
    credits: number | null
    status: string
    created_at: string
  }>
}

export function isTossClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY)
}

async function loadPayment(customerKey: string): Promise<TossPaymentsPayment> {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
  if (!clientKey) {
    throw new Error('결제가 설정되지 않았어요. (NEXT_PUBLIC_TOSS_CLIENT_KEY 누락)')
  }
  const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk')
  const tossPayments = await loadTossPayments(clientKey)
  return tossPayments.payment({ customerKey })
}

type OrderResponse = {
  orderId: string
  orderName: string
  amountKrw: number
  productType: 'credit_pack' | 'pro_subscription'
  customerKey: string
}

async function createOrder(productId: string): Promise<OrderResponse> {
  const response = await fetch('/api/payments/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId }),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    if (response.status === 401) throw new Error('로그인 후 이용해주세요.')
    if (response.status === 400 && body.error === 'unknown-product') throw new Error('알 수 없는 상품이에요.')
    throw new Error('주문을 생성하지 못했어요. 잠시 후 다시 시도해주세요.')
  }
  return body as unknown as OrderResponse
}

/** 크레딧 팩: 결제창 열기. 성공 시 /payments/success?orderId=&paymentKey=&amount= */
export async function startCreditPackCheckout(productId: string): Promise<void> {
  const order = await createOrder(productId)
  const payment = await loadPayment(order.customerKey)
  await payment.requestPayment({
    method: 'CARD',
    amount: { currency: 'KRW', value: order.amountKrw },
    orderId: order.orderId,
    orderName: order.orderName,
    successUrl: `${window.location.origin}/payments/success`,
    failUrl: `${window.location.origin}/payments/fail`,
  })
}

/** Pro 구독: 카드 등록(빌링 인증)창 열기. 성공 시 /payments/billing/callback?orderId=&customerKey=&authKey= */
export async function startProSubscriptionCheckout(): Promise<void> {
  const order = await createOrder(PRO_PLAN.id)
  const payment = await loadPayment(order.customerKey)
  await payment.requestBillingAuth({
    method: 'CARD',
    successUrl: `${window.location.origin}/payments/billing/callback?orderId=${encodeURIComponent(order.orderId)}`,
    failUrl: `${window.location.origin}/payments/fail`,
  })
}

/** success 페이지: 서버 승인 요청 */
export async function confirmCreditPayment(orderId: string, paymentKey: string): Promise<{ ok: boolean; credits?: number; error?: string; code?: string }> {
  const response = await fetch('/api/payments/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, paymentKey }),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    return { ok: false, error: typeof body.message === 'string' ? body.message : '결제 승인에 실패했어요.', code: typeof body.code === 'string' ? body.code : undefined }
  }
  return { ok: true, credits: typeof body.credits === 'number' ? body.credits : undefined }
}

/** 빌링 콜백 페이지: 빌링키 발급 + 첫 결제 + 구독 활성화 */
export async function confirmBillingAuth(orderId: string, authKey: string, customerKey: string): Promise<{ ok: boolean; error?: string; code?: string }> {
  const response = await fetch('/api/payments/billing/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, authKey, customerKey }),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    if (body.error === 'already-subscribed') {
      return { ok: false, error: '이미 구독 중이에요.', code: body.error as string }
    }
    return { ok: false, error: typeof body.message === 'string' ? body.message : '구독 결제에 실패했어요.', code: typeof body.code === 'string' ? body.code : undefined }
  }
  return { ok: true }
}

export async function cancelSubscription(immediate: boolean): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch('/api/payments/subscriptions/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ immediate }),
  })
  if (!response.ok) {
    return { ok: false, error: '해지 처리에 실패했어요. 잠시 후 다시 시도해주세요.' }
  }
  return { ok: true }
}

export async function fetchPaymentsMe(): Promise<PaymentsMe | null> {
  try {
    const response = await fetch('/api/payments/me', { cache: 'no-store' })
    if (!response.ok) return null
    return (await response.json()) as PaymentsMe
  } catch {
    return null
  }
}
