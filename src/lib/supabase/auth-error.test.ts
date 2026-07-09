import test from 'node:test'
import assert from 'node:assert/strict'

import { isExpectedSupabaseAuthMiss } from './auth-error'

test('isExpectedSupabaseAuthMiss treats missing sessions and auth 4xx as user auth misses', () => {
  assert.equal(isExpectedSupabaseAuthMiss({ name: 'AuthSessionMissingError' }), true)
  assert.equal(isExpectedSupabaseAuthMiss({ name: 'AuthApiError', status: 401 }), true)
  assert.equal(isExpectedSupabaseAuthMiss({ name: 'AuthApiError', status: 403 }), true)
})

test('isExpectedSupabaseAuthMiss treats auth 5xx and thrown infra errors as infrastructure failures', () => {
  assert.equal(isExpectedSupabaseAuthMiss({ name: 'AuthApiError', status: 500 }), false)
  assert.equal(isExpectedSupabaseAuthMiss(new Error('Supabase URL/anon key is not configured')), false)
})
