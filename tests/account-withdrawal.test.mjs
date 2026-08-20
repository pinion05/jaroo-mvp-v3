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

test('회원 탈퇴 API는 로그인된 본인만 삭제할 수 있다', () => {
  const route = read('src/app/api/account/delete/route.ts')
  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /unauthenticated/)
  assert.match(route, /status: 401/)
})

test('회원 탈퇴는 FK 없는 포트폴리오 행을 직접 지우고 auth.users 삭제로 CASCADE 시킨다', () => {
  const route = read('src/app/api/account/delete/route.ts')
  // portfolio_holdings 는 auth.users FK 가 없는 스키마 캡처 테이블
  assert.match(route, /from\('portfolio_holdings'\)\.delete\(\)\.eq\('user_id', user\.id\)/)
  assert.match(route, /admin\.deleteUser\(user\.id\)/)
  // RLS bypass 용 서비스 클라이언트 사용
  assert.match(route, /createSupabaseServiceClient/)
  // no-store 헤더
  assert.match(route, /no-store, private/)
})

test('마이페이지 회원 탈퇴는 확인 다이얼로그를 거쳐 API 를 호출한다', () => {
  const source = read('src/app/mypage/page.tsx')
  assert.match(source, /role='dialog'/)
  assert.match(source, /aria-modal='true'/)
  assert.match(source, /복구할 수 없/)
  assert.match(source, /\/api\/account\/delete/)
  assert.match(source, /\/api\/auth\/logout/)
  // 대기 중에는 닫기/재클릭을 막는다
  assert.match(source, /withdrawPending/)

  const css = read('src/app/mypage/mypage.module.css')
  assert.match(css, /\.confirmLayer/)
  assert.match(css, /\.confirmDanger/)
})
