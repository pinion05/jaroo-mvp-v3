import type { NextRequest } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/proxy'
import { devAccessGate } from '@/lib/dev-access-gate'

export async function proxy(request: NextRequest) {
  // DEV ONLY 접근 게이트(DEV_BASIC_AUTH env가 있을 때만, dev 배포 전용) —
  // 운영(prod)·로컬에서는 게이트가 null을 반환해 기존 흐름 그대로.
  const gate = devAccessGate(request)
  if (gate) return gate
  return updateSupabaseSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
