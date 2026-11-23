import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 개발 전용·내부 진단 라우트는 프로덕션에서 반드시 404로 비활성화되어야 한다.
// dev-tokens/dev-set-session은 세션 토큰을 노출하는 라우트라 누출 시 계정 탈취로 직결되고,
// perf-summary는 내부 성능 진단이며, account/profile은 세 전용 테스트가 없던 라우트다.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('개발 전용 세션·내부 진단 라우트는 프로덕션에서 404로 비활성화된다', () => {
  // 세션 토큰 전이 도구(Orca 웹뷰 OAuth 우회용) — 운영 빌드 노출 금지
  for (const route of [
    'src/app/api/auth/dev-tokens/route.ts',
    'src/app/auth/dev-set-session/route.ts',
  ]) {
    const source = read(route)
    assert.match(source, /NODE_ENV === 'production'/, `${route} 는 프로덕션 가드가 있어야 한다`)
    assert.match(source, /status: 404/, `${route} 는 프로덕션에서 404를 반환해야 한다`)
  }
  // 내부 성능 진단도 동일한 dev 라우트 패턴
  const perf = read('src/app/api/deepscan/perf-summary/route.ts')
  assert.match(perf, /NODE_ENV === 'production'[\s\S]*?status: 404/)
  assert.match(perf, /export const runtime = 'nodejs'/)
  // dev-tokens는 개발 환경에서도 세션 없으면 토큰을 주지 않는다
  const devTokens = read('src/app/api/auth/dev-tokens/route.ts')
  assert.match(devTokens, /error \|\| !data\.session[\s\S]*?status: 401/)
})

test('프로필 표시명 수정은 Origin 가드·로그인 게이트·닉네임 1~30자 검증을 거친다', () => {
  const source = read('src/app/api/account/profile/route.ts')
  // 상태 변경 — Origin 2차 방어(403)와 미인증 401
  assert.match(source, /originAllowedForStateChange\(request\)/)
  assert.match(source, /error: 'origin-not-allowed'\s*\},\s*\{\s*status: 403/)
  assert.match(source, /status: 401/)
  // 닉네임은 1~30자 — 빈 문자열·과대 문자열 400
  assert.match(source, /if \(!displayName \|\| displayName\.length > 30\) \{/)
  assert.match(source, /닉네임은 1~30자로 입력해주세요/)
  // 브라우저 직접 updateUser 대신 서버가 display_name을 갱신(#224 E1 — httpOnly 쿠키 전제)
  assert.match(source, /updateUser\(\{ data: \{ display_name: displayName \} \}\)/)
  // 모든 응답 no-store, private (7곳: import 1 + 응답 6)
  assert.match(source, /import \{[^}]*NO_STORE_PRIVATE_HEADERS[^}]*\} from '@\/lib\/supabase\/api-auth'/)
  assert.equal((source.match(/NO_STORE_PRIVATE_HEADERS/g) ?? []).length, 7)
})
