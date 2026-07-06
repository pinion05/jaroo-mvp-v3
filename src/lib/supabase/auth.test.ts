import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthMeFromSupabaseUser, createGuestAuthMe, displayNameFromUser } from './auth'
import type { User } from '@supabase/supabase-js'

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-123',
    app_metadata: {},
    user_metadata: { display_name: '테스트사용자' },
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as User
}

test('displayNameFromUser prefers display_name metadata', () => {
  assert.equal(displayNameFromUser(user()), '테스트사용자')
  assert.equal(displayNameFromUser(user({ user_metadata: { full_name: 'Full Name' } })), 'Full Name')
  assert.equal(displayNameFromUser(user({ user_metadata: {} })), null)
})

test('createAuthMeFromSupabaseUser maps Supabase user id to Jaroo user contract', () => {
  const authMe = createAuthMeFromSupabaseUser(user({ email: 'user@example.com' }))

  assert.equal(authMe.authScope, 'authenticated')
  assert.equal(authMe.provider, 'supabase-email-password')
  assert.equal(authMe.user?.id, 'user-123')
  assert.deepEqual(authMe.userContract, {
    userId: 'user-123',
    authScope: 'authenticated',
    provider: 'supabase-email-password',
    email: 'user@example.com',
    displayName: '테스트사용자',
  })
})

test('createAuthMeFromSupabaseUser maps google OAuth provider', () => {
  const googleUser = user({ email: 'user@gmail.com', app_metadata: { provider: 'google' }, user_metadata: { full_name: '구글 사용자' } })
  const authMe = createAuthMeFromSupabaseUser(googleUser)

  assert.equal(authMe.provider, 'google')
  assert.equal(authMe.userContract.provider, 'google')
  assert.equal(authMe.userContract.displayName, '구글 사용자')
})

test('createAuthMeFromSupabaseUser defaults email provider to supabase-email-password', () => {
  const authMe = createAuthMeFromSupabaseUser(user({ email: 'user@example.com', app_metadata: { provider: 'email' } }))

  assert.equal(authMe.provider, 'supabase-email-password')
  assert.equal(authMe.userContract.provider, 'supabase-email-password')
})

test('createGuestAuthMe returns stable guest contract', () => {
  assert.deepEqual(createGuestAuthMe(), {
    authScope: 'guest',
    provider: null,
    user: null,
    userContract: {
      userId: 'guest',
      authScope: 'guest',
      provider: null,
      email: null,
      displayName: null,
    },
  })
})
