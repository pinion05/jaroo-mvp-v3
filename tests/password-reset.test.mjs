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

test('로그인 화면의 비밀번호 찾기가 재설정 메일을 발송한다', () => {
  const source = read('src/app/login/page.tsx')
  assert.match(source, /resetPasswordForEmail/)
  // 2026-08-26: code 교환은 서버(/auth/reset-password/confirm)가 수행한다.
  assert.match(source, /redirectTo: `\$\{window\.location\.origin\}\/auth\/reset-password\/confirm`/)
  // 이메일 미입력/형식 오류 안내
  assert.match(source, /이메일을 먼저 입력해주세요\./)
})

test('재설정 페이지는 세션 확인 후 서버 API로 새 비밀번호를 설정한다', () => {
  const pagePath = 'src/app/auth/reset-password/page.tsx'
  assert.equal(fs.existsSync(path.join(__dirname, '..', pagePath)), true, 'reset-password 페이지가 있어야 한다')

  const source = read(pagePath)
  // 세션 판정은 /api/auth/me, 변경은 /api/account/password (서버 이전, 이슈 #224 E1-b)
  assert.match(source, /\/api\/auth\/me/)
  assert.match(source, /\/api\/account\/password/)
  // 구버전 메일 링크(?code=)는 서버 교환 라우트로 포워딩
  assert.match(source, /\/auth\/reset-password\/confirm/)
  // 만료/사용된 링크 안내
  assert.match(source, /링크가 만료되었거나 이미 사용됐어요\./)
  assert.match(source, /8자 이상/)
  assert.match(source, /비밀번호가 일치하지 않아요\./)
})

test('재설정 code 교환과 비밀번호 변경은 서버 라우트가 담당한다', () => {
  const confirmSource = read('src/app/auth/reset-password/confirm/route.ts')
  assert.match(confirmSource, /exchangeCodeForSession/)
  assert.match(confirmSource, /error=link/)

  const passwordSource = read('src/app/api/account/password/route.ts')
  assert.match(passwordSource, /updateUser\(\{ password \}\)/)
  assert.match(passwordSource, /originAllowedForStateChange/)
  assert.match(passwordSource, /resolveApiUserId/)
})

test('재설정 페이지는 로그인 화면과 같은 필드 UI를 재사용한다', () => {
  const source = read('src/app/auth/reset-password/page.tsx')
  assert.match(source, /login\.module\.css/)
  assert.match(source, /autoComplete='new-password'/)
})
