import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOAuthRedirectTo, resolveOAuthRedirectOrigin } from './oauth-redirect'

test('OAuth redirect uses localhost origin for local development', () => {
  assert.equal(
    buildOAuthRedirectTo({ hostname: 'localhost', origin: 'http://localhost:3000' }),
    'http://localhost:3000/auth/callback',
  )
  assert.equal(
    buildOAuthRedirectTo({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:3000' }),
    'http://127.0.0.1:3000/auth/callback',
  )
})

test('OAuth redirect uses the current deployment origin', () => {
  // Each host receives its own callback; the provider gates which are registered.
  assert.equal(resolveOAuthRedirectOrigin({ hostname: 'jaroo.kr', origin: 'https://jaroo.kr' }), 'https://jaroo.kr')
  assert.equal(
    resolveOAuthRedirectOrigin({ hostname: 'test.jaroo.kr', origin: 'https://test.jaroo.kr' }),
    'https://test.jaroo.kr',
  )
  assert.equal(
    buildOAuthRedirectTo({ hostname: 'app-production.up.railway.app', origin: 'https://app-production.up.railway.app' }),
    'https://app-production.up.railway.app/auth/callback',
  )
})
