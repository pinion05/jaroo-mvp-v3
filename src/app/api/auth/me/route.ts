import { NextResponse } from 'next/server'
import { createAuthMeFromSupabaseUser, createGuestAuthMe } from '@/lib/supabase/auth'
import { NO_STORE_PRIVATE_HEADERS, resolveApiUserId } from '@/lib/supabase/api-auth'

export const runtime = 'nodejs'

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_PRIVATE_HEADERS })
}

export async function GET() {
  const auth = await resolveApiUserId('auth/me')

  if (auth.status === 'unavailable') {
    return jsonNoStore({ error: 'auth-unavailable' }, { status: 503 })
  }
  if (auth.status === 'unauthorized') {
    return jsonNoStore(createGuestAuthMe())
  }

  return jsonNoStore(createAuthMeFromSupabaseUser(auth.user))
}
