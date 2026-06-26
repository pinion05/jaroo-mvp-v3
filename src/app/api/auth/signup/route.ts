import { NextResponse } from 'next/server'
import { createAuthMeFromSupabaseUser } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { EXISTING_SIGNUP_MESSAGE, isLikelyExistingSignupUser, signupErrorMessage } from '@/lib/supabase/signup'

export const runtime = 'nodejs'

type SignupBody = {
  email?: unknown
  password?: unknown
  name?: unknown
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : undefined
}

function errorJson(message: string, status = 400, code = 'auth_error') {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: Request) {
  const body = (await request.json()) as SignupBody
  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  const name = normalizeName(body.name)

  if (!email || password.length < 8) {
    return errorJson('이메일과 8자 이상 비밀번호를 입력해주세요.', 400, 'invalid_signup_input')
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: name ? { display_name: name, name } : undefined,
      },
    })

    if (error) {
      return errorJson(signupErrorMessage(error.message), error.status ?? 400, error.code ?? 'signup_failed')
    }

    if (!data.user) {
      return errorJson('회원가입 응답에서 사용자를 확인하지 못했어요.', 502, 'signup_missing_user')
    }

    if (isLikelyExistingSignupUser(data.user)) {
      return errorJson(EXISTING_SIGNUP_MESSAGE, 409, 'signup_existing_email')
    }

    return NextResponse.json({ ...createAuthMeFromSupabaseUser(data.user), needsEmailConfirmation: !data.session })
  } catch (error) {
    const message = error instanceof Error && /Supabase URL\/anon key/.test(error.message)
      ? 'Supabase 환경변수가 설정되지 않았어요.'
      : '회원가입 처리 중 문제가 생겼어요.'
    return errorJson(message, 500, 'signup_unexpected')
  }
}
