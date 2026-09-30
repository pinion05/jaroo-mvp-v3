import { NextResponse, type NextRequest } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { originAllowedForStateChange } from '@/lib/http-origin-guard'
import { normalizeAlertLevel } from '@/lib/watch/levels'

// 워치 알림 강도 설정 — 계정 단위(#222 §3-6: 종목별 설정 없음).
// GET  : {alertLevel} — 행이 없으면 기본값('normal') 반환
// PUT  : {alertLevel} upsert

async function requireUser() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user: user ?? null }
}

export async function GET() {
  const { supabase, user } = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabase
    .from('watch_settings')
    .select('alert_level')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ alertLevel: normalizeAlertLevel(data?.alert_level) })
}

export async function PUT(request: NextRequest) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: 'forbidden-origin' }, { status: 403 })
  }
  const { supabase, user } = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => ({}))) as { alertLevel?: unknown }
  const alertLevel = normalizeAlertLevel(body.alertLevel)
  const { error } = await supabase
    .from('watch_settings')
    .upsert({ user_id: user.id, alert_level: alertLevel, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, alertLevel })
}
