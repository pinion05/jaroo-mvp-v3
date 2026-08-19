import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { isExpectedSupabaseAuthMiss } from '@/lib/supabase/auth-error'
import { deleteTossBillingKey } from '@/lib/payments/toss-client'
import { NO_STORE_PRIVATE_HEADERS } from '@/lib/payments/server'

export const runtime = 'nodejs'

// 구독 해지. 기본은 기간 종료 후 만료(남은 기간 유지), immediate=true 면 즉시 만료.
export async function POST(request: NextRequest) {
  let userId: string
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      if (error && !isExpectedSupabaseAuthMiss(error)) {
        console.error('[payments/cancel] auth failed', error)
      }
      return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE_PRIVATE_HEADERS })
    }
    userId = data.user.id
  } catch (error) {
    console.error('[payments/cancel] auth infrastructure failed', error)
    return NextResponse.json({ error: 'auth-unavailable' }, { status: 503, headers: NO_STORE_PRIVATE_HEADERS })
  }

  let immediate = false
  try {
    const body = (await request.json()) as { immediate?: unknown } | null
    immediate = body?.immediate === true
  } catch {
    // 본문 없으면 기본값(기간 종료 후 만료)
  }

  try {
    const service = createSupabaseServiceClient()
    const { error: rpcError } = await service.rpc('cancel_my_subscription', { p_immediate: immediate })
    if (rpcError) {
      console.error('[payments/cancel] rpc failed', rpcError)
      return NextResponse.json({ error: 'cancel-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
    }

    if (immediate) {
      // 즉시 해지면 빌링키도 삭제 (best-effort)
      const { data: sub } = await service.from('pro_subscriptions').select('billing_key').eq('user_id', userId).maybeSingle()
      if (sub?.billing_key) {
        try {
          await deleteTossBillingKey(sub.billing_key)
          await service.from('pro_subscriptions').update({ billing_key: null }).eq('user_id', userId)
        } catch (error) {
          console.error('[payments/cancel] billing key delete failed (ignored)', error)
        }
      }
    }

    return NextResponse.json({ ok: true, immediate }, { headers: NO_STORE_PRIVATE_HEADERS })
  } catch (error) {
    console.error('[payments/cancel] failed', error)
    return NextResponse.json({ error: 'cancel-failed' }, { status: 500, headers: NO_STORE_PRIVATE_HEADERS })
  }
}
