import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('Supabase auth foundation exposes required routes and proxy', () => {
  for (const file of [
    'proxy.ts',
    'src/app/login/page.tsx',
    'src/app/signup/page.tsx',
    'src/app/api/auth/signup/route.ts',
    'src/app/api/auth/login/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/auth/me/route.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`)
  }
})

test('auth code uses Supabase SSR rather than local password storage', () => {
  assert.match(read('src/lib/supabase/server.ts'), /@supabase\/ssr/)
  assert.match(read('src/app/api/auth/login/route.ts'), /signInWithPassword/)
  assert.match(read('src/app/api/auth/signup/route.ts'), /signUp/)
  assert.notEqual(fs.existsSync(path.join(root, 'src/lib/auth/store.ts')), true)
})

test('signup route explains existing-email and email-rate-limit states', () => {
  const route = read('src/app/api/auth/signup/route.ts')
  assert.match(route, /isLikelyExistingSignupUser/)
  assert.match(route, /signup_existing_email/)
  assert.match(read('src/lib/supabase/signup.ts'), /이미 가입된 이메일일 수 있어요/)
  assert.match(read('src/lib/supabase/signup.ts'), /확인 이메일 발송 제한/)
})

test('profile migration links public profiles to auth.users with RLS', () => {
  const migration = read('supabase/migrations/20260626084500_create_auth_profiles.sql')
  assert.match(migration, /references auth\.users\(id\) on delete cascade/)
  assert.match(migration, /alter table public\.profiles enable row level security/)
  assert.match(migration, /create trigger on_auth_user_created/)
  assert.match(migration, /auth\.uid\(\)/)
})

test('home and mypage surface Supabase login state', () => {
  assert.match(read('src/components/home/jaroo-home-screen.tsx'), /<AuthHomeStatus \/>/)
  assert.match(read('src/app/mypage/page.tsx'), /<AuthAccountCard \/>/)
})

test('Supabase auth environment variables are documented', () => {
  const doc = read('docs/auth-supabase-foundation.md')
  assert.match(doc, /NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(doc, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  assert.match(doc, /SUPABASE_SERVICE_ROLE_KEY/)
})
