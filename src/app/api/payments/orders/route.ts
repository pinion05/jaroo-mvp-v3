import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { findProduct, orderNameFor } from '@/lib/payments/products'
import { NO_STORE_PRIVATE_HEADERS, createOrderId, resolvePaymentUserId, tossCustomerKeyFor } from '@/lib/payments/server'

export const runtime = 'nodejs'

// 주문 생성: 상품 검증 + PENDING 주문 row 생성. 결제 금액의 진실 소스는 이 row 다.
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

  const productId = (body as { productId?: unknown } | null)?.productId
  if (typeof productId !== 'string') {
    return NextResponse.json({ error: 'product-id-required' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const product = findProduct(productId)
  if (!product) {
    return NextResponse.json({ error: 'unknown-product' }, { status: 400, headers: NO_STORE_PRIVATE_HEADERS })
  }

  const orderId = createOrderId(product.type === 'credit_pack' ? 'credit' : 'pro')
  const orderName = orderNameFor(product)

  try {
    const service = createSupabaseServiceClient()
    const { error } = await service.from('payment_orders').insert({
      user_id: auth.userId,
      order_id: orderId,
      product_id: product.id,
      kind: product.type,
      amount_krw: product.amountKrw,
      credits: product.type === 'credit_pack' ? product.credits : null,
      status: 'PENDING',
    })

    if (error) {
      console.error('[payments/orders] insert failed', error)
      return NextResponse.json({ error: 'order-create-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }
  } catch (error) {
    console.error('[payments/orders] infrastructure failed', error)
    return NextResponse.json({ error: 'order-create-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }

  return NextResponse.json(
    {
      orderId,
      orderName,
      amountKrw: product.amountKrw,
      productType: product.type,
      customerKey: tossCustomerKeyFor(auth.userId),
    },
    { headers: NO_STORE_PRIVATE_HEADERS },
  )
}
