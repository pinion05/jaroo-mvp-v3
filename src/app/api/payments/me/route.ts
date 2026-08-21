import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveApiUserId } from '@/lib/supabase/api-auth'
import { DEEPSCAN_CREDIT_COST, deepScanRunsLeft } from '@/lib/payments/products'
import { NO_STORE_PRIVATE_HEADERS } from '@/lib/payments/server'

export const runtime = 'nodejs'

// 마이페이지 결제 요약: 크레딧 잔액/구독 상태/주문 내역.
// 사용자 세션(쿠키)으로 my_* security_invoker 뷰를 조회한다.
export async function GET() {
  const auth = await resolveApiUserId('payments/me')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json({ authScope: 'guest', balance: 0, deepScanLeft: 0, subscription: null, orders: [] }, { headers: NO_STORE_PRIVATE_HEADERS })
  }

  let supabase
  try {
    supabase = await createSupabaseServerClient()
  } catch (error) {
    console.error('[payments/me] supabase client failed', error)
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }

  try {
    const [balanceRes, subscriptionRes, ordersRes] = await Promise.all([
      supabase.from('my_credit_balance').select('balance').maybeSingle(),
      supabase.from('my_subscription').select('status, card_company, card_number, current_period_end, cancel_at_period_end, canceled_at').maybeSingle(),
      supabase.from('my_payment_orders').select('order_id, product_id, kind, amount_krw, credits, status, created_at').order('created_at', { ascending: false }).limit(20),
    ])

    if (balanceRes.error || subscriptionRes.error || ordersRes.error) {
      console.error('[payments/me] view query failed', balanceRes.error ?? subscriptionRes.error ?? ordersRes.error)
      return NextResponse.json({ error: 'query-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    const balance = balanceRes.data?.balance ?? 0

    return NextResponse.json(
      {
        authScope: 'authenticated',
        balance,
        deepScanLeft: deepScanRunsLeft(balance),
        deepScanCreditCost: DEEPSCAN_CREDIT_COST,
        subscription: subscriptionRes.data ?? null,
        orders: ordersRes.data ?? [],
      },
      { headers: NO_STORE_PRIVATE_HEADERS },
    )
  } catch (error) {
    console.error('[payments/me] failed', error)
    return NextResponse.json({ error: 'unavailable' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }
}
