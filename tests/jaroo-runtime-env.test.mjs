import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('런타임 env 주입: 루트 레이아웃이 window.__JAROO_ENV__를 서버 env에서 심는다', () => {
  const layout = read('app/layout.tsx')
  assert.match(layout, /buildJarooRuntimeEnvScript/)
  assert.match(layout, /process\.env\.SUPABASE_URL/)
  assert.match(layout, /process\.env\.SUPABASE_ANON_KEY/)
})

test('클라이언트 수파베이스 설정은 window.__JAROO_ENV__를 최우선한다', () => {
  const config = read('lib/supabase/config.ts')
  assert.match(config, /readJarooRuntimeEnv\(\)/)
  assert.match(config, /runtime\.supabaseUrl/)
})

test('프록시(미들웨어)는 런타임 env로 /auth/v1·/rest/v1을 내부망으로 전달한다', () => {
  const proxy = read('proxy.ts')
  assert.match(proxy, /SUPABASE_AUTH_INTERNAL_URL/)
  assert.match(proxy, /SUPABASE_REST_INTERNAL_URL/)
  assert.match(proxy, /proxySupabaseRequest/)
  assert.match(proxy, /updateSupabaseSession/)
})

test('로그인 페이지 자동로그인 플래그는 런타임 주입 값을 읽는다', () => {
  const page = read('app/login/page.tsx')
  assert.match(page, /window\.__JAROO_ENV__\?\.devAutoLogin/)
})
