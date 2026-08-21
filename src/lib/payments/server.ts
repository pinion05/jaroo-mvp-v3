import 'server-only'

import { PRO_PLAN, type PaymentProduct } from './products'

// 결제 API 공통 서버 유틸.
// 인증 해석과 no-store 헤더는 lib/supabase/api-auth 단일 소스를 재사용한다.

export { NO_STORE_PRIVATE_HEADERS } from '@/lib/supabase/api-auth'
export { resolveApiUserId as resolvePaymentUserId } from '@/lib/supabase/api-auth'
export type { ApiAuthResult as PaymentAuthResult } from '@/lib/supabase/api-auth'

/** 토스 orderId: 최대 64자, 영숫자/-/_ 만 허용. */
export function createOrderId(kind: 'credit' | 'pro' | 'prorenew'): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  return `jrw-${kind}-${Date.now().toString(36)}-${rand}`
}

/** 토스 customerKey: 사용자별 고정값 (빌링키 발급/승인 시 일치해야 함). 최대 255자. */
export function tossCustomerKeyFor(userId: string): string {
  return `user-${userId}`
}

/** 카탈로그 금액 검증: 클라이언트가 보낸 amount 는 무시하고 이 값을 쓴다. */
export function catalogAmountFor(product: PaymentProduct): number {
  return product.type === 'credit_pack' ? product.amountKrw : PRO_PLAN.amountKrw
}

export function isPaymentConfigured(): boolean {
  return Boolean(process.env.TOSS_SECRET_KEY?.trim())
}
