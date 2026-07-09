import { NextResponse } from 'next/server'
import { createAuthMeFromSupabaseUser } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const NO_STORE_PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' }

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_PRIVATE_HEADERS })
}

type LoginBody = {
  email?: unknown
  password?: unknown
}

function errorJson(message: string, status = 400, code = 'auth_error') {
  return jsonNoStore({ error: { code, message } }, { status })
}

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    return errorJson('이메일과 비밀번호를 입력해주세요.', 400, 'invalid_login_input')
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return errorJson(error.message, error.status ?? 401, error.code ?? 'login_failed')
    }

    if (!data.user) {
      return errorJson('로그인 응답에서 사용자를 확인하지 못했어요.', 502, 'login_missing_user')
    }

    return jsonNoStore(createAuthMeFromSupabaseUser(data.user))
  } catch (error) {
    const message = error instanceof Error && /Supabase URL\/anon key/.test(error.message)
      ? 'Supabase 환경변수가 설정되지 않았어요.'
      : '로그인 처리 중 문제가 생겼어요.'
    return errorJson(message, 500, 'login_unexpected')
  }
}
