import { createClient } from '@supabase/supabase-js'
import { assertSupabaseServiceConfig } from './config'

// Server-only. Bypasses RLS. Never import from a 'use client' module.
export function createSupabaseServiceClient() {
  const { url, serviceRoleKey } = assertSupabaseServiceConfig()

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
