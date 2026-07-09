import { NextResponse } from 'next/server'
import { createGuestAuthMe } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const NO_STORE_PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' }

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_PRIVATE_HEADERS })
}

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch {
    // Treat logout as idempotent. The response still returns guest state.
  }

  return jsonNoStore(createGuestAuthMe())
}
