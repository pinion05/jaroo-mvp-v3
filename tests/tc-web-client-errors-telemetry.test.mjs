import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 클라이언트 렌더 크래시 리포트 수집 라우트(/api/client-errors)는 전용 테스트가 없었다.
// global-error.tsx가 망가졌을 때 크래시 관측 자체가 끊기므로, 라우트 계약(Origin 가드·
// 필드 클램프·서비스롤 적재·항상 200)과 발신측 배선을 함께 고정한다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('크래시 수집 라우트는 Origin 가드·필드 클램프·서비스롤 적재·항상 200 규약을 유지한다', () => {
  const source = read('src/app/api/client-errors/route.ts')
  // 비로그인 크래시도 수집하므로 인증 게이트는 없지만, 브라우저 상태 변경성 POST에는 Origin 가드가 있다
  assert.match(source, /originAllowedForStateChange\(request\)/)
  assert.match(source, /error: 'Not allowed'\s*\},\s*\{\s*status: 403/)
  // JSON 파싱 실패 400 / message 필수 400
  assert.match(source, /error: 'Invalid JSON'\s*\},\s*\{\s*status: 400/)
  assert.match(source, /error: 'message required'\s*\},\s*\{\s*status: 400/)
  // 모든 텍스트 필드는 2000자로 클램프 (로그 테이블 비대 방지)
  assert.match(source, /const MAX_FIELD_LENGTH = 2000/)
  assert.match(source, /trimmed\.slice\(0, MAX_FIELD_LENGTH\)/)
  // user_id 귀속은 세션이 있을 때만 — 로그아웃 상태 크래시도 수용
  assert.match(source, /user_id: user\?\.id \?\? null/)
  // client_error_logs는 deny-all RLS — 적재는 서비스 롤만 가능
  assert.match(source, /createSupabaseServiceClient\(\)/)
  assert.match(source, /\.from\('client_error_logs'\)\.insert/)
  // 적재 실패가 사용자 경험을 해치지 않도록 항상 200 계열
  assert.match(source, /status: 200/)
})

test('global-error 바운더리가 크래시를 /api/client-errors 로 발신한다', () => {
  const source = read('src/app/global-error.tsx')
  assert.match(source, /\/api\/client-errors/)
  // 렌더 크래시 임베딩용 표준 필드 전송
  assert.match(source, /digest/)
  // 발신은 결과를 기다리지 않는 fire-and-forget
  assert.match(source, /void fetch\('\/api\/client-errors'/)
})
