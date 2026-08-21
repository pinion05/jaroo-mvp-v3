import { NextResponse } from 'next/server'
import { createAuthMeFromSupabaseUser } from '@/lib/supabase/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { EXISTING_SIGNUP_MESSAGE, isLikelyExistingSignupUser, signupErrorMessage } from '@/lib/supabase/signup'
import { parseTermsConsentAt } from '@/lib/supabase/terms-consent'
import { TERMS_VERSION } from '@/lib/terms'

export const runtime = 'nodejs'

const NO_STORE_PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private' }

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_PRIVATE_HEADERS })
}

type SignupBody = {
  email?: unknown
  password?: unknown
  name?: unknown
  termsAcceptedAt?: unknown
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : undefined
}

function errorJson(message: string, status = 400, code = 'auth_error') {
  return jsonNoStore({ error: { code, message } }, { status })
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
    // 가입 동의 시점은 로그인 화면 체크박스에서 왔다. 검증 통과 시 raw_user_meta_data 에
    // 실어 보내고 handle_new_auth_user 트리거가 profiles 로 옮긴다(이메일 확인 전에도 생성됨).
    const consentAt = parseTermsConsentAt(body.termsAcceptedAt)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          ...(name ? { display_name: name, name } : {}),
          ...(consentAt ? { terms_accepted_at: consentAt, terms_version: TERMS_VERSION } : {}),
        },
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

    return jsonNoStore({ ...createAuthMeFromSupabaseUser(data.user), needsEmailConfirmation: !data.session })
  } catch (error) {
    const message = error instanceof Error && /Supabase URL\/anon key/.test(error.message)
      ? 'Supabase 환경변수가 설정되지 않았어요.'
      : '회원가입 처리 중 문제가 생겼어요.'
    return errorJson(message, 500, 'signup_unexpected')
  }
}
