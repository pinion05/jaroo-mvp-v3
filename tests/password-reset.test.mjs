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
  assert.match(source, /redirectTo: `\$\{window\.location\.origin\}\/auth\/reset-password`/)
  // 이메일 미입력/형식 오류 안내
  assert.match(source, /이메일을 먼저 입력해주세요\./)
})

test('재설정 페이지는 세션 확보 후 새 비밀번호로 업데이트한다', () => {
  const pagePath = 'src/app/auth/reset-password/page.tsx'
  assert.equal(fs.existsSync(path.join(__dirname, '..', pagePath)), true, 'reset-password 페이지가 있어야 한다')

  const source = read(pagePath)
  assert.match(source, /getSession/)
  assert.match(source, /exchangeCodeForSession/)
  assert.match(source, /updateUser\(\{ password \}\)/)
  // 만료/사용된 링크 안내
  assert.match(source, /링크가 만료되었거나 이미 사용됐어요\./)
  assert.match(source, /8자 이상/)
  assert.match(source, /비밀번호가 일치하지 않아요\./)
})

test('재설정 페이지는 로그인 화면과 같은 필드 UI를 재사용한다', () => {
  const source = read('src/app/auth/reset-password/page.tsx')
  assert.match(source, /login\.module\.css/)
  assert.match(source, /autoComplete='new-password'/)
})
