import test from 'node:test'
import assert from 'node:assert/strict'

import { NextResponse } from 'next/server'

import { SESSION_COOKIE_MAX_AGE_SECONDS, hardenSessionCookieOptions } from './session-cookie'

// @supabase/ssr 0.12 의 applyServerStorage 가 setAll 로 넘기는 옵션을 그대로 재현한
// 픽스처. 라이브러리 기본(DEFAULT_COOKIE_OPTIONS)은 httpOnly:false, maxAge 400일이다 —
// 이 값이 응답에 그대로 실리면 TC-BBS-001/002(운영 세션 쿠키 JS 노출)가 재현된다.
function ssrDefaultSetOptions() {
  return { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 400 * 24 * 60 * 60 }
}

// 삭제(Set-Cookie maxAge=0) 픽스처 — 로그아웃·세션 정리 때 넘어오는 형태.
function ssrRemoveOptions() {
  return { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 0 }
}

test('hardenSessionCookieOptions — 세션 쿠키 발급은 httpOnly+SameSite=Lax, 30일 슬라이딩 상한', () => {
  const hardened = hardenSessionCookieOptions(ssrDefaultSetOptions(), 'development')

  assert.equal(hardened.httpOnly, true, 'httpOnly 미설정이면 document.cookie 로 토큰이 노출된다(TC-BBS-002)')
  assert.equal(hardened.sameSite, 'lax')
  assert.equal(hardened.secure, false, 'dev(http://localhost)는 Secure 쿠키가 저장되지 않으므로 예외')
  assert.equal(hardened.maxAge, SESSION_COOKIE_MAX_AGE_SECONDS, '400일 고정 만료를 30일로 자른다(R2)')
  assert.equal(SESSION_COOKIE_MAX_AGE_SECONDS, 30 * 24 * 60 * 60)
  assert.equal(hardened.path, '/', '원본 옵션(path 등)은 보존한다')
})

test('hardenSessionCookieOptions — 운영(production)에서는 Secure', () => {
  const hardened = hardenSessionCookieOptions(ssrDefaultSetOptions(), 'production')

  assert.equal(hardened.secure, true, 'prod 는 https 이므로 Secure 필수(평문 HTTP 전송 차단, TC-BBS-001)')
  assert.equal(hardened.httpOnly, true)
})

test('hardenSessionCookieOptions — 삭제(maxAge=0)는 상한 적용 없이 그대로, httpOnly 유지', () => {
  const hardened = hardenSessionCookieOptions(ssrRemoveOptions(), 'production')

  assert.equal(hardened.maxAge, 0, '삭제 Set-Cookie 의 maxAge=0 을 훼손하지 않는다')
  assert.equal(
    hardened.httpOnly,
    true,
    'HttpOnly 쿠키는 HttpOnly 인 Set-Cookie 로만 덮어쓸 수 있다(RFC 6265bis) — 로그아웃 폐기 실패 방지',
  )
})

test('hardenSessionCookieOptions — 상한 이하 maxAge 는 원본 값을 침해하지 않는다', () => {
  const hardened = hardenSessionCookieOptions({ ...ssrDefaultSetOptions(), maxAge: 3600 }, 'development')

  assert.equal(hardened.maxAge, 3600)
})

test('proxy 응답 직렬화 계약 — 청크 세션 쿠키(.0/.1)의 Set-Cookie 는 HttpOnly·SameSite=Lax·Max-Age=2592000', () => {
  // 미들웨어(proxy.ts) setAll 이 response.cookies.set 으로 굽는 형태를 재현한다.
  // 운영 관찰: sb-*-auth-token.0/.1 두 청크 모두 httpOnly=false 로 발급됐다.
  const response = NextResponse.next()
  for (const name of ['sb-ref-auth-token.0', 'sb-ref-auth-token.1']) {
    response.cookies.set(name, 'base64-eyJhY2Nlc3NfdG9rZW4i', hardenSessionCookieOptions(ssrDefaultSetOptions(), 'development'))
  }

  const setCookies = response.headers.getSetCookie()
  assert.equal(setCookies.length, 2)
  for (const setCookie of setCookies) {
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Lax/i)
    assert.match(setCookie, /Max-Age=2592000/)
    assert.doesNotMatch(setCookie, /;\s*Secure/, 'dev 는 http 라 Secure 미포함이 정상')
  }
})

test('proxy 응답 직렬화 계약 — 운영 환경 옵션은 Secure 를 포함한다', () => {
  const response = NextResponse.next()
  response.cookies.set(
    'sb-ref-auth-token.0',
    'base64-eyJhY2Nlc3NfdG9rZW4i',
    hardenSessionCookieOptions(ssrDefaultSetOptions(), 'production'),
  )

  const [setCookie] = response.headers.getSetCookie()
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /Max-Age=2592000/)
})
