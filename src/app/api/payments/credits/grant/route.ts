import { NextResponse } from 'next/server'

import { isPaymentsPipelineConfigured } from '@/lib/payments/config'
import { DEEPSCAN_CREDIT_COST, FREE_GRANT_CREDITS, deepScanRunsLeft } from '@/lib/payments/products'
import { NO_STORE_PRIVATE_HEADERS, resolvePaymentUserId } from '@/lib/payments/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

// 무료 크레딧 지급 — 결제 파이프라인이 열리기 전까지의 임시 밸브.
// 결제 UI가 준비되지 않은 동안 '크레딧 충전' 진입 시 즉시 FREE_GRANT_CREDITS(999)를
// 원장(reason='grant')에 적립한다.
// 파이프라인(클라이언트 키·시크릿 키·웹훅 시크릿)이 완비되면 409 로 닫히므로
// 유료 전환 시 자동 무효화된다. 클라이언트 키만 env에 있는 반쪽 상태(웹훅 미설정)에서는
// 결제가 실제로 열릴 수 없으므로 무료 지급이 유지된다.
export async function POST() {
  if (isPaymentsPipelineConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'payment-open', message: '결제가 열려 있어 무료 지급이 닫혔어요.' },
      { status: 409, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }

  const auth = await resolvePaymentUserId('payments/credits/grant')
  if (auth.status === 'unavailable') {
    return NextResponse.json({ ok: false, error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }
  if (auth.status === 'unauthorized') {
    return NextResponse.json(
      { ok: false, error: 'auth-required', message: '로그인 후 무료 크레딧을 받을 수 있어요.' },
      { status: 401, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }

  const service = createSupabaseServiceClient()
  const userId = auth.userId

  try {
    const { data: balanceRow, error: balanceError } = await service
      .from('credit_balances')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle()
    if (balanceError) {
      console.error('[payments/credits/grant] balance lookup failed', balanceError)
      return NextResponse.json({ ok: false, error: 'query-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    const before = balanceRow?.balance ?? 0
    const after = before + FREE_GRANT_CREDITS

    // 원장 먼저 — 적립 기록이 남은 뒤 잔액이 반영되는 방향으로 쓴다(webhook 환불과 같은 직접 쓰기 패턴).
    const { error: ledgerError } = await service.from('credit_ledger').insert({
      user_id: userId,
      delta: FREE_GRANT_CREDITS,
      // credit_ledger check 제약 허용값: purchase | deepscan | grant | refund
      reason: 'grant',
      ref: `free-grant-${new Date().toISOString().slice(0, 10)}`,
      balance_after: after,
    })
    if (ledgerError) {
      console.error('[payments/credits/grant] ledger insert failed', ledgerError)
      return NextResponse.json({ ok: false, error: 'ledger-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    const { error: upsertError } = await service
      .from('credit_balances')
      .upsert({ user_id: userId, balance: after }, { onConflict: 'user_id' })
    if (upsertError) {
      console.error('[payments/credits/grant] balance upsert failed', upsertError)
      return NextResponse.json({ ok: false, error: 'balance-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    return NextResponse.json(
      {
        ok: true,
        granted: FREE_GRANT_CREDITS,
        balance: after,
        deepScanLeft: deepScanRunsLeft(after),
        deepScanCreditCost: DEEPSCAN_CREDIT_COST,
      },
      { headers: NO_STORE_PRIVATE_HEADERS },
    )
  } catch (error) {
    console.error('[payments/credits/grant] failed', error)
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }
}
