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
  autoLogin?: unknown
}

function errorJson(message: string, status = 400, code = 'auth_error') {
  return jsonNoStore({ error: { code, message } }, { status })
}

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  // DEV ONLY(dev 배포 전용): autoLogin 요청은 DEV_AUTO_LOGIN_EMAIL 고정 계정으로 즉시 로그인한다.
  // 계정이 없으면(휘발성 dev DB 재초기화 직후) autoconfirm 가입으로 만들고 바로 세션을 발급한다.
  // 운영(prod)·로컬에서는 DEV_AUTO_LOGIN_EMAIL 변수가 없어 이 분기가 절대 실행되지 않는다.
  if (body.autoLogin === true) {
    const autoEmail = process.env.DEV_AUTO_LOGIN_EMAIL?.trim().toLowerCase()
    const autoPassword = process.env.DEV_AUTO_LOGIN_PASSWORD ?? ''
    if (!autoEmail || !autoPassword) {
      return errorJson('자동 로그인이 설정되지 않았어요.', 400, 'auto_login_disabled')
    }
    try {
      const supabase = await createSupabaseServerClient()
      const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
        email: autoEmail,
        password: autoPassword,
      })
      if (!signInError && signedIn.user) {
        return jsonNoStore(createAuthMeFromSupabaseUser(signedIn.user))
      }
      const { data: signedUp, error: signUpError } = await supabase.auth.signUp({
        email: autoEmail,
        password: autoPassword,
      })
      if (signUpError) {
        return errorJson(signUpError.message, signUpError.status ?? 401, signUpError.code ?? 'auto_login_failed')
      }
      if (!signedUp.user) {
        return errorJson('자동 로그인 가입 응답에서 사용자를 확인하지 못했어요.', 502, 'auto_login_missing_user')
      }
      return jsonNoStore(createAuthMeFromSupabaseUser(signedUp.user))
    } catch {
      return errorJson('자동 로그인 처리 중 문제가 생겼어요.', 500, 'auto_login_unexpected')
    }
  }

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
