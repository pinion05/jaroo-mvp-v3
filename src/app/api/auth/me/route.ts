import { NextResponse } from 'next/server'
import { createAuthMeFromSupabaseUser, createGuestAuthMe } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()

    if (error || !data.user) {
      return NextResponse.json(createGuestAuthMe())
    }

    return NextResponse.json(createAuthMeFromSupabaseUser(data.user))
  } catch {
    return NextResponse.json(createGuestAuthMe())
  }
}
