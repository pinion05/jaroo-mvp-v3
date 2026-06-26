export type JarooAuthProvider = 'supabase-email-password'
export type JarooAuthScope = 'guest' | 'authenticated'

export type JarooUserContract = {
  userId: string
  authScope: JarooAuthScope
  provider: JarooAuthProvider | null
  email: string | null
  displayName: string | null
}

export type JarooAuthMe = {
  authScope: JarooAuthScope
  provider: JarooAuthProvider | null
  user: null | {
    id: string
    email: string | null
    displayName: string | null
  }
  userContract: JarooUserContract
}
