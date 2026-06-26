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
