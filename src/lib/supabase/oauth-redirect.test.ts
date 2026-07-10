import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOAuthRedirectTo, resolveOAuthRedirectOrigin } from './oauth-redirect'

test('OAuth redirect uses localhost only for local development origins', () => {
  assert.equal(
    buildOAuthRedirectTo({ hostname: 'localhost', origin: 'http://localhost:3000' }),
    'http://localhost:3000/auth/callback',
  )
  assert.equal(
    buildOAuthRedirectTo({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:3000' }),
    'http://127.0.0.1:3000/auth/callback',
  )
})

test('OAuth redirect canonicalizes deployed origins to jaroo.kr', () => {
  assert.equal(resolveOAuthRedirectOrigin({ hostname: 'jaroo.kr', origin: 'https://jaroo.kr' }), 'https://jaroo.kr')
  assert.equal(resolveOAuthRedirectOrigin({ hostname: '158.179.162.98', origin: 'http://158.179.162.98:3000' }), 'https://jaroo.kr')
  assert.equal(buildOAuthRedirectTo({ hostname: 'www.jaroo.kr', origin: 'https://www.jaroo.kr' }), 'https://jaroo.kr/auth/callback')
})
