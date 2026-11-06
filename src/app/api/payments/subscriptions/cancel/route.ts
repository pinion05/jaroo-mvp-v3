import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveApiUserId } from '@/lib/supabase/api-auth'
import { deleteTossBillingKey } from '@/lib/payments/toss-client'
import { NO_STORE_PRIVATE_HEADERS } from '@/lib/payments/server'

export const runtime = 'nodejs'

// 구독 해지. 기본은 기간 종료 후 만료(남은 기간 유지), immediate=true 면 즉시 만료.
export async function POST(request: NextRequest) {
  const auth = await resolveApiUserId('payments/cancel')
  if (auth.status === 'unauthorized') {
    return NextResponse.json(
      { error: 'unauthorized', message: '로그인이 필요해요. 다시 로그인한 뒤 시도해주세요.' },
      { status: 401, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }
  if (auth.status === 'unavailable') {
    return NextResponse.json(
      { error: 'auth-unavailable', message: '로그인 상태를 확인할 수 없어요. 잠시 후 다시 시도해주세요.' },
      { status: 503, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }
  const userId = auth.userId

  let immediate = false
  try {
    const body = (await request.json()) as { immediate?: unknown } | null
    immediate = body?.immediate === true
  } catch {
    // 본문 없으면 기본값(기간 종료 후 만료)
  }

  try {
    // cancel_my_subscription 은 auth.uid() 로 본인 구독만 갱신하는 RPC(authenticated 에만 실행 허용).
    // 서비스롤로 호출하면 auth.uid() 가 NULL 이 되어 UPDATE 가 항상 0행(해지 no-op)이므로
    // 사용자 세션(쿠키 JWT) 클라이언트로 호출한다.
    const supabase = await createSupabaseServerClient()
    const { error: rpcError } = await supabase.rpc('cancel_my_subscription', { p_immediate: immediate })
    if (rpcError) {
      console.error('[payments/cancel] rpc failed', rpcError)
      return NextResponse.json(
        { error: 'cancel-failed', message: '구독 해지 처리에 실패했어요. 잠시 후 다시 시도해주세요.' },
        { status: 500, headers: NO_STORE_PRIVATE_HEADERS },
      )
    }

    if (immediate) {
      // 즉시 해지면 빌링키도 삭제 (best-effort).
      // billing_key 는 서비스롤만 접근하는 컬럼이고 authenticated 에는 UPDATE 정책이 없어
      // 이 경로는 서비스롤 클라이언트를 쓴다.
      const service = createSupabaseServiceClient()
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
    return NextResponse.json(
      { error: 'cancel-failed', message: '구독 해지 처리에 실패했어요. 잠시 후 다시 시도해주세요.' },
      { status: 500, headers: NO_STORE_PRIVATE_HEADERS },
    )
  }
}
