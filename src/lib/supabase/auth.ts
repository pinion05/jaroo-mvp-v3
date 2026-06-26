import type { User } from '@supabase/supabase-js'
import type { JarooAuthMe } from './types'

export function displayNameFromUser(user: User): string | null {
  const metadata = user.user_metadata ?? {}
  const candidate = metadata.display_name ?? metadata.name ?? metadata.full_name

  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

export function createGuestAuthMe(): JarooAuthMe {
  return {
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
  }
}

export function createAuthMeFromSupabaseUser(user: User): JarooAuthMe {
  const email = user.email ?? null
  const displayName = displayNameFromUser(user)

  return {
    authScope: 'authenticated',
    provider: 'supabase-email-password',
    user: {
      id: user.id,
      email,
      displayName,
    },
    userContract: {
      userId: user.id,
      authScope: 'authenticated',
      provider: 'supabase-email-password',
      email,
      displayName,
    },
  }
}
