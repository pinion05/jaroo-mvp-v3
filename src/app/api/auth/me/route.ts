import { NextResponse } from 'next/server'
import { createAuthMeFromSupabaseUser, createGuestAuthMe } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isExpectedSupabaseAuthMiss } from '@/lib/supabase/auth-error'

export const runtime = 'nodejs'

const NO_STORE_PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' }

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_PRIVATE_HEADERS })
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()

    if (error) {
      if (isExpectedSupabaseAuthMiss(error)) {
        return jsonNoStore(createGuestAuthMe())
      }

      console.error('[auth/me] Supabase auth resolution failed', error)
      return jsonNoStore({ error: 'auth-unavailable' }, { status: 503 })
    }

    if (!data.user) {
      return jsonNoStore(createGuestAuthMe())
    }

    return jsonNoStore(createAuthMeFromSupabaseUser(data.user))
  } catch (error) {
    console.error('[auth/me] Supabase auth infrastructure failed', error)
    return jsonNoStore({ error: 'auth-unavailable' }, { status: 503 })
  }
}
