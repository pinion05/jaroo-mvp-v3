import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOAuthCallbackOrigin, safeOAuthNext } from './oauth-callback-origin'

test('OAuth callback keeps plain localhost callbacks local for development', () => {
  assert.equal(resolveOAuthCallbackOrigin({ requestUrl: 'http://localhost:3000/auth/callback?code=x' }), 'http://localhost:3000')
})

test('OAuth callback canonicalizes HTTPS localhost proxy callbacks to jaroo.kr', () => {
  assert.equal(resolveOAuthCallbackOrigin({ requestUrl: 'https://localhost:3000/auth/callback?code=x' }), 'https://jaroo.kr')
})

test('OAuth callback honors non-local forwarded host', () => {
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
