import type { User } from '@supabase/supabase-js'
import type { JarooAuthMe, JarooAuthProvider } from './types'

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

export function providerFromUser(user: User): JarooAuthProvider {
  const raw = (user.app_metadata?.provider as string | undefined) ?? 'email'
  return raw === 'google' ? 'google' : 'supabase-email-password'
}

export function createAuthMeFromSupabaseUser(user: User): JarooAuthMe {
  const email = user.email ?? null
  const displayName = displayNameFromUser(user)
  const provider = providerFromUser(user)

  return {
    authScope: 'authenticated',
    provider,
    user: {
      id: user.id,
      email,
      displayName,
    },
    userContract: {
      userId: user.id,
      authScope: 'authenticated',
      provider,
      email,
      displayName,
    },
  }
}
