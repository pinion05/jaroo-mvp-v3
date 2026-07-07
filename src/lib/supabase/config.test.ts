import test from 'node:test'
import assert from 'node:assert/strict'

import { assertSupabaseServiceConfig } from './config'

test('assertSupabaseServiceConfig는 service-role key가 없으면 throw한다', () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  delete process.env.SUPABASE_SERVICE_ROLE_KEY

  try {
    assert.throws(() => assertSupabaseServiceConfig(), /service-role key is not configured/)
  } finally {
    if (previousKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
    }
    if (previousUrl !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    }
  }
})

test('assertSupabaseServiceConfig는 url과 key가 있으면 설정을 반환한다', () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

  try {
    const config = assertSupabaseServiceConfig()
    assert.equal(config.url, 'https://example.supabase.co')
    assert.equal(config.serviceRoleKey, 'service-role-key')
  } finally {
    if (previousKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
    if (previousUrl !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    }
  }
})
