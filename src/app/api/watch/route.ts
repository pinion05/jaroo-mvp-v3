import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { originAllowedForStateChange } from '@/lib/http-origin-guard'

// 워치(종목 감시 등록) — 내 목록 조회/등록/해지.
// GET    : {rows: [{code, name, market, created_at}]}
// POST   : {code, name, market?} upsert (재등록 갱신)
// DELETE : ?code= 해당 종목 해지

const MAX_CODE = 24
const MAX_NAME = 80
const MAX_MARKET = 24

function clampText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

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
    return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('watch_items')
    .select('code, name, market, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: '워치 목록을 불러오지 못했어요.' }, { status: 500 })
  }
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: '보안 검증에 실패했어요.' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })
  }

  const body = (payload ?? {}) as Record<string, unknown>
  const code = clampText(body.code, MAX_CODE)
  const name = clampText(body.name, MAX_NAME)
  const market = clampText(body.market, MAX_MARKET)
  if (!code || !name) {
    return NextResponse.json({ error: '종목 코드와 이름이 필요해요.' }, { status: 400 })
  }

  const { supabase, user } = await requireUser()
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 })
  }

  const { error } = await supabase
    .from('watch_items')
    .upsert({ user_id: user.id, code, name, market }, { onConflict: 'user_id,code' })

  if (error) {
    return NextResponse.json({ error: '등록하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  if (!originAllowedForStateChange(request)) {
    return NextResponse.json({ error: '보안 검증에 실패했어요.' }, { status: 403 })
  }

  const code = clampText(new URL(request.url).searchParams.get('code'), MAX_CODE)
  if (!code) {
    return NextResponse.json({ error: '종목 코드가 필요해요.' }, { status: 400 })
  }

  const { supabase, user } = await requireUser()
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 })
  }

  const { error } = await supabase
    .from('watch_items')
    .delete()
    .eq('user_id', user.id)
    .eq('code', code)

  if (error) {
    return NextResponse.json({ error: '해지하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
