import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOAuthCallbackOrigin, safeOAuthNext } from './oauth-callback-origin'

test('OAuth callback keeps plain localhost callbacks local for development', () => {
  assert.equal(resolveOAuthCallbackOrigin({ requestUrl: 'http://localhost:3000/auth/callback?code=x' }), 'http://localhost:3000')
})

test('OAuth callback keeps HTTPS localhost proxy callbacks on the same origin (dev↔운영 혼선 차단)', () => {
  // 과거에는 https://localhost 콜백을 운영 https://jaroo.kr로 추정해 리다이렉트했다 —
  // dev 세션이 운영 도메인으로 흘러들어가는 혼선의 원인(TC-blackbox-data §6-2).
  // 이제는 요청 자기 origin을 유지한다. 미등록 redirect URI는 공급자가 거부한다.
  assert.equal(resolveOAuthCallbackOrigin({ requestUrl: 'https://localhost:3000/auth/callback?code=x' }), 'https://localhost:3000')
  assert.equal(resolveOAuthCallbackOrigin({ requestUrl: 'https://127.0.0.1/auth/callback?code=x' }), 'https://127.0.0.1')
})

test('OAuth callback never resolves to the production origin from a local hostname', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const origin = resolveOAuthCallbackOrigin({ requestUrl: `https://${hostname}:8443/auth/callback?code=x` })
    assert.notEqual(origin, 'https://jaroo.kr')
    assert.ok(origin.includes(hostname === '[::1]' ? '[::1]' : hostname))
  }
})

test('OAuth callback honors non-local forwarded host', () => {
  assert.equal(
    resolveOAuthCallbackOrigin({
      requestUrl: 'https://localhost:3000/auth/callback?code=x',
      forwardedHost: 'jaroo-dev.up.railway.app',
      forwardedProto: 'https',
    }),
    'https://jaroo-dev.up.railway.app',
  )
  assert.equal(
    resolveOAuthCallbackOrigin({
      requestUrl: 'https://localhost:3000/auth/callback?code=x',
      forwardedHost: 'jaroo.kr',
      forwardedProto: 'https',
    }),
    'https://jaroo.kr',
  )
})

test('safeOAuthNext allows same-origin paths and blocks absolute redirects', () => {
  assert.equal(safeOAuthNext('/mypage?tab=profile#top', 'https://jaroo.kr'), '/mypage?tab=profile#top')
  assert.equal(safeOAuthNext('https://evil.example', 'https://jaroo.kr'), '/home')
  assert.equal(safeOAuthNext('//evil.example', 'https://jaroo.kr'), '/home')
})
