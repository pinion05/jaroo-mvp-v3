import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '@supabase/supabase-js'
import { EMAIL_RATE_LIMIT_MESSAGE, isLikelyExistingSignupUser, signupErrorMessage } from './signup'

function userWithIdentities(identities: unknown[] | undefined): User {
  return {
    id: 'user-123',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    identities,
  } as User
}

test('detects Supabase obfuscated existing-email signup response', () => {
  assert.equal(isLikelyExistingSignupUser(userWithIdentities([])), true)
  assert.equal(isLikelyExistingSignupUser(userWithIdentities([{ provider: 'email' }])), false)
  assert.equal(isLikelyExistingSignupUser(userWithIdentities(undefined)), false)
})

test('maps Supabase email rate-limit error to user-friendly Korean copy', () => {
  assert.equal(signupErrorMessage('email rate limit exceeded'), EMAIL_RATE_LIMIT_MESSAGE)
  assert.equal(signupErrorMessage('Password should be at least 8 characters'), 'Password should be at least 8 characters')
})
