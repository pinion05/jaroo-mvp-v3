import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 세션 쿠키 HttpOnly·Secure 계약(TC-blackbox-security TC-BBS-001/002/003, R1) —
// 세션 토큰 쿠키는 어떤 경로(서버 라우트 발급·미들웨어 리프레시 갱신·삭제)에서도
// 강화 속성 없이 응답에 실려서는 안 된다. 운영에서는 미들웨어 토큰 리프레시가
// @supabase/ssr 기본 옵션(httpOnly:false)을 그대로 전달해 서버가 구은 httpOnly 쿠키를
// JS-가독 쿠키로 덮어쓰는 것이 노출 원인이었다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('세션 쿠키 속성 단일 소스 — httpOnly·prod Secure·SameSite=Lax·30일 상한', () => {
  const policy = read('src/lib/supabase/session-cookie.ts')

  assert.match(policy, /httpOnly:\s*true/, '세션 쿠키는 항상 httpOnly')
  assert.match(policy, /secure:\s*nodeEnv === 'production'/, '운영(https)에서는 Secure')
  assert.match(policy, /sameSite:\s*'lax'/, 'SameSite=Lax 이상')
  assert.match(
    policy,
    /SESSION_COOKIE_MAX_AGE_SECONDS = 30 \* 24 \* 60 \* 60/,
    '세션 쿠키 만료는 30일 슬라이딩(R2, 400일 고정 금지)',
  )
})

test('서버(setAll)와 proxy(미들웨어)의 모든 세션 쿠키 쓰기는 강화 헬퍼를 통과한다', () => {
  const server = read('src/lib/supabase/server.ts')
  assert.match(
    server,
    /cookieStore\.set\(name, value, hardenSessionCookieOptions\(options \?\? \{\}\)\)/,
    '서버 클라이언트의 쿠키 발급/갱신/삭제는 hardenSessionCookieOptions 를 거쳐야 한다',
  )
  assert.doesNotMatch(server, /cookieStore\.set\(name, value, options\)/, '옵션 통과 발급 금지')

  const proxy = read('src/lib/supabase/proxy.ts')
  assert.match(
    proxy,
    /response\.cookies\.set\(name, value, hardenSessionCookieOptions\(options \?\? \{\}\)\)/,
    '미들웨어 토큰 리프레시의 쿠키 재발급도 강화 속성을 적용해야 한다(운영 노출의 근원)',
  )
  assert.doesNotMatch(proxy, /response\.cookies\.set\(name, value, options\)/, '옵션 통과 발급 금지')
})

test('브라우저 supabase 클라이언트는 세션 발급·갱신 경로가 꺼져 있다', () => {
  // createBrowserClient 기본값은 URL 코드 교환(detectSessionInUrl)·브라우저 토큰 자동
  // 갱신(autoRefreshToken)으로 document.cookie 세션을 재발급한다 — httpOnly 가 불가능한
  // 유일한 발급 경로이므로 클라이언트에서는 OAuth 시작(verifier 쿠키)만 남긴다.
  const client = read('src/lib/supabase/client.ts')

  assert.match(client, /detectSessionInUrl:\s*false/)
  assert.match(client, /autoRefreshToken:\s*false/)
})

test('OAuth/PKCE 콜백·세션 주입·로그인 라우트는 서버 클라이언트로만 세션을 발급한다', () => {
  // 세션 성립(코드 교환·비번 로그인·토큰 주입)은 전부 서버 경로여야 한다(TC-BBS-003).
  for (const route of [
    'src/app/auth/callback/route.ts',
    'src/app/auth/dev-set-session/route.ts',
    'src/app/auth/reset-password/confirm/route.ts',
    'src/app/api/auth/login/route.ts',
    'src/app/api/auth/logout/route.ts',
  ]) {
    const source = read(route)
    assert.match(source, /createSupabaseServerClient/, `${route} 는 서버 클라이언트로 세션을 다뤄야 한다`)
    assert.doesNotMatch(source, /createSupabaseBrowserClient|createBrowserClient/, `${route} 에서 브라우저 클라이언트 사용 금지`)
  }
})
