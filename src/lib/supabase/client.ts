import { createBrowserClient } from '@supabase/ssr'
import { assertSupabaseConfig } from './config'

export function createSupabaseBrowserClient() {
  const { url, anonKey } = assertSupabaseConfig()

  return createBrowserClient(url, anonKey)
}
