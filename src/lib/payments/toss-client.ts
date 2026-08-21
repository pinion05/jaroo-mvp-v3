import 'server-only'

import { assertTossServerConfig } from './config'

// 토스페이먼츠 v1 REST API 서버 클라이언트 (https://docs.tosspayments.com/reference)
// 인증: Basic base64("{secretKey}:") — 시크릿 키 뒤 콜론 필수.

const API_BASE = 'https://api.tosspayments.com/v1'

export type TossPaymentStatus =
  | 'READY'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_DEPOSIT'
  | 'DONE'
  | 'CANCELED'
  | 'PARTIAL_CANCELED'
  | 'ABORTED'
  | 'EXPIRED'

export type TossPayment = {
  paymentKey: string
  orderId: string
  orderName: string
  status: TossPaymentStatus
  method: string | null
  totalAmount: number
  balanceAmount: number
  suppliedAmount: number
  vat: number
  currency: string
  requestedAt: string
  approvedAt: string | null
  type: string | null // NORMAL | BILLING | ...
  card: {
    issuerCode?: string | null
    number?: string | null
    installmentPlanMonths?: number | null
    cardType?: string | null
    ownerType?: string | null
  } | null
  easyPay: { provider?: string | null; amount?: number | null } | null
  failure: { code?: string | null; message?: string | null } | null
  cancels: Array<{ cancelReason?: string | null; canceledAt?: string | null; cancelAmount?: number | null }> | null
}

export type TossBillingKeyResponse = {
  billingKey: string
  customerKey: string
  authenticatedAt: string
  cardCompany: string | null
  cardNumber: string | null
  card: {
    issuerCode?: string | null
    number?: string | null
    cardType?: string | null
    ownerType?: string | null
  } | null
}

export class TossApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'TossApiError'
    this.status = status
    this.code = code
  }
}

function basicAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`
}

async function tossFetch<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const { secretKey } = assertTossServerConfig()
  const { idempotencyKey, ...rest } = init

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: basicAuthHeader(secretKey),
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...rest.headers,
    },
    cache: 'no-store',
  })

  const rawBody = await response.text()
  let body: unknown = null
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = rawBody
    }
  }

  if (!response.ok) {
    const err = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) as Record<string, unknown>
    throw new TossApiError(
      response.status,
      typeof err.code === 'string' ? err.code : 'UNKNOWN',
      typeof err.message === 'string' ? err.message : `토스페이먼츠 API 요청 실패 (HTTP ${response.status})`,
    )
  }

  return body as T
}

/** 일회성 결제 승인: 결제창 successUrl 리다이렉트 후 서버에서 호출. */
export function confirmTossPayment(paymentKey: string, orderId: string, amount: number): Promise<TossPayment> {
  return tossFetch<TossPayment>(`/payments/${encodeURIComponent(paymentKey)}`, {
    method: 'POST',
    body: JSON.stringify({ orderId, amount }),
  })
}

/** 결제 단건 조회 (웹훅/정합성 검증용). */
export function getTossPayment(paymentKey: string): Promise<TossPayment> {
  return tossFetch<TossPayment>(`/payments/${encodeURIComponent(paymentKey)}`)
}

/** 주문번호로 결제 조회 (중복 승인 방지/복구용). */
export function getTossPaymentByOrderId(orderId: string): Promise<TossPayment> {
  return tossFetch<TossPayment>(`/payments/orders/${encodeURIComponent(orderId)}`)
}

/** 결제 취소(환불). cancelAmount 생략 시 전액 취소. */
export function cancelTossPayment(paymentKey: string, cancelReason: string, cancelAmount?: number): Promise<TossPayment> {
  return tossFetch<TossPayment>(`/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancelReason, ...(cancelAmount != null ? { cancelAmount } : {}) }),
  })
}

/** 빌링키 발급: 결제창 requestBillingAuth successUrl 이후 authKey로 1회 호출. */
export function issueTossBillingKey(customerKey: string, authKey: string): Promise<TossBillingKeyResponse> {
  return tossFetch<TossBillingKeyResponse>('/billing/authorizations/issue', {
    method: 'POST',
    body: JSON.stringify({ customerKey, authKey }),
  })
}

/** 빌링키로 자동결제 승인 (구독 갱신). Idempotency-Key로 재시도 중복 승인 방지. */
export function chargeTossBilling(
  billingKey: string,
  params: { customerKey: string; orderId: string; orderName: string; amount: number },
): Promise<TossPayment> {
  return tossFetch<TossPayment>(`/billing/${encodeURIComponent(billingKey)}`, {
    method: 'POST',
    body: JSON.stringify(params),
    idempotencyKey: params.orderId,
  })
}

/** 빌링키 삭제 (구독 해지 시). */
export function deleteTossBillingKey(billingKey: string): Promise<{ billingKey: string }> {
  return tossFetch<{ billingKey: string }>(`/billing/${encodeURIComponent(billingKey)}`, {
    method: 'DELETE',
  })
}
