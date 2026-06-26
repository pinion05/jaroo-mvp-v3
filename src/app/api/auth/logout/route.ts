import { NextResponse } from 'next/server'
import { createGuestAuthMe } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch {
    // Treat logout as idempotent. The response still returns guest state.
  }

  return NextResponse.json(createGuestAuthMe())
}
