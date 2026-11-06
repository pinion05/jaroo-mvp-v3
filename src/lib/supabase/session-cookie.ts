// 세션 쿠키(sb-*-auth-token 계열 + PKCE code-verifier) 속성의 단일 소스.
//
// 2026-11-06 블랙박스 TC(TC-BBS-001/002/003, docs/tc/TC-blackbox-security.md R1):
// 운영에서 세션 쿠키가 httpOnly=false·secure=false 로 관찰됐다. 원인은 이중 발급 —
// 서버 라우트(callback·dev-set-session)는 httpOnly 로 굽지만, 세션 리프레시가 일어난
// 요청의 proxy(미들웨어)가 @supabase/ssr 기본 옵션(httpOnly:false, maxAge 400일)을
// 그대로 response.cookies.set 에 전달해 1시간 토큰마다 쿠키를 JS-가독 쿠키로 덮어썼다.
//
// 이 모듈을 통과하는 모든 세션 쿠키 쓰기(발급·갱신·삭제)는:
//   - httpOnly: true  — document.cookie 노출 차단(XSS 세션 탈취 방어)
//   - secure: production — 평문 HTTP 구간 전송 차단(prod). dev(localhost http)는 예외
//   - sameSite: 'lax'  — 크로스사이트 전송 최소화(OAuth 콜백 리다이렉트는 허용)
//   - maxAge: 최대 30일 — 400일 고정 만료(R2) 대신 활동 시 슬라이딩 갱신
//
// 삭제(maxAge<=0)에도 httpOnly 를 유지한다 — RFC 6265bis 는 HttpOnly 쿠키를
// HttpOnly 아닌 Set-Cookie 로 덮어쓰는 것을 거부하므로, 로그아웃 폐기가 조용히
// 실패하지 않도록 발급·삭제 속성을 같게 유지해야 한다.

export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30일 슬라이딩 상한

/** @supabase/ssr setAll 이 넘기는 쿠키 옵션(라이브러리 버전에 따라 키가 늘어나도
 *  통째로 보존한다 — path/domain 등은 원본을 존중하고 보안 속성만 덮어쓴다). */
export type SessionCookieWriteOptions = { maxAge?: number | undefined } & Record<string, unknown>

export function hardenSessionCookieOptions<T extends SessionCookieWriteOptions>(
  options: T,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): T & { httpOnly: true; secure: boolean; sameSite: 'lax' } {
  const hardened: T & { httpOnly: true; secure: boolean; sameSite: 'lax' } = {
    ...options,
    // 세션 토큰의 JS 노출 차단. 서버 교환으로만 쓰이며 클라이언트 직접 읽기
    // 경로는 없다(프로필/재설정 전부 서버 이전 완료).
    httpOnly: true,
    // prod(https)에서만 Secure. dev 는 http://localhost 라 Secure 쿠키가 저장되지 않는다.
    secure: nodeEnv === 'production',
    sameSite: 'lax',
  }

  // @supabase/ssr 0.12 은 발급 maxAge 를 라이브러리 기본값(400일)으로 강제한다.
  // 브라우저에 굽는 순간 30일로 잘라 탈취 시 장기 악용 여지를 없앤다(R2).
  // 활동 중인 세션은 토큰 리프레시(기본 1시간 주기)마다 쿠키가 다시 발급되므로
  // 30일 슬라이딩으로 동작한다.
  if (typeof options.maxAge === 'number' && options.maxAge > SESSION_COOKIE_MAX_AGE_SECONDS) {
    hardened.maxAge = SESSION_COOKIE_MAX_AGE_SECONDS
  }

  return hardened
}
