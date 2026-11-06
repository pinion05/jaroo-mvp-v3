import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

// TC-BBF-008 회귀: 인증된 사용자가 /login에 재접근하면 서버에서 세션을 확인해
// 앱(/home)으로 리다이렉트해야 한다(로그인 화면에 머무르지 않음).

test('로그인 라우트가 서버 세션을 확인해 인증 사용자를 /home으로 리다이렉트한다', () => {
  const layout = read('src/app/login/layout.tsx')
  // 루트 페이지 가드(src/app/page.tsx)와 동일한 서버 세션 확인 방식
  assert.match(layout, /createSupabaseServerClient/)
  assert.match(layout, /supabase\.auth\.getUser\(\)/)
  assert.match(layout, /redirect\('\/home'\)/)
  // 세션 확인 실패(일시적 장애)는 게스트 취급 — 루트 가드 정책과 일치
  assert.match(layout, /isExpectedSupabaseAuthMiss/)
})

test('로그인 라우트 가드는 로그인 UI 페이지를 대체하지 않고 레이아웃으로 감싼다', () => {
  const layout = read('src/app/login/layout.tsx')
  // 가드 통과(게스트) 시 기존 로그인 화면이 그대로 렌더링되어야 한다
  assert.match(layout, /return <>\{children\}<\/>/)
  const page = read('src/app/login/page.tsx')
  assert.match(page, /'use client'/)
  assert.match(page, /export default function LoginPage/)
})
