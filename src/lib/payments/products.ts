// 결제 상품 카탈로그 — 서버/클라이언트 공용 단일 진실 소스.
// 클라이언트가 보낸 productId/amount는 반드시 이 테이블 기준으로 서버에서 재검증한다.

export type ProductType = 'credit_pack' | 'pro_subscription'

/** 딥스캔 1회 소모 크레딧 (정책 변경 시 이 값만 수정). */
export const DEEPSCAN_CREDIT_COST = 10

/** 잔액으로 실행 가능한 딥스캔 횟수 — 서버(/api/payments/me)와 UI 가 같은 식으로 계산한다. */
export function deepScanRunsLeft(balance: number): number {
  return Math.floor(balance / DEEPSCAN_CREDIT_COST)
}

export type CreditPack = {
  id: string
  type: 'credit_pack'
  credits: number
  amountKrw: number
  label: string
  badge?: string
}

export type ProPlan = {
  id: string
  type: 'pro_subscription'
  amountKrw: number
  label: string
  periodDays: number
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'credit_300', type: 'credit_pack', credits: 300, amountKrw: 3000, label: '300 크레딧' },
  { id: 'credit_900', type: 'credit_pack', credits: 900, amountKrw: 8000, label: '900 크레딧', badge: '인기' },
  { id: 'credit_3000', type: 'credit_pack', credits: 3000, amountKrw: 22000, label: '3,000 크레딧', badge: '최대 혜택' },
] as const

export const PRO_PLAN: ProPlan = {
  id: 'pro_monthly',
  type: 'pro_subscription',
  amountKrw: 4900,
  label: 'Jaroo Pro (월 구독)',
  periodDays: 30,
} as const

export type PaymentProduct = CreditPack | ProPlan

export function findCreditPack(productId: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === productId) ?? null
}

export function findProduct(productId: string): PaymentProduct | null {
  const pack = findCreditPack(productId)
  if (pack) return pack
  return productId === PRO_PLAN.id ? PRO_PLAN : null
}

export function orderNameFor(product: PaymentProduct): string {
  return product.type === 'credit_pack' ? `Jaroo ${product.label} 충전` : 'Jaroo Pro 월 구독'
}
