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

// TC-BBL-020 회귀: 게스트 4페이지(/login·/terms·/privacy·/home)는 각자 자기 참조 canonical을
// 선언해야 한다. `/`→`/login` 307 리다이렉트 구조에서 URL 정규화(중복 수집 방지) 관점.

test('게스트 4페이지가 자기 참조 canonical(alternates.canonical)을 선언한다', () => {
  // 서버 컴포넌트 페이지 — 페이지 metadata에 직접
  assert.match(read('src/app/terms/page.tsx'), /alternates:\s*\{\s*canonical:\s*'\/terms'/)
  assert.match(read('src/app/privacy/page.tsx'), /alternates:\s*\{\s*canonical:\s*'\/privacy'/)

  // 클라이언트 페이지(/login·/home) — metadata를 내보낼 수 없어 라우트 layout이 담당
  assert.match(read('src/app/login/layout.tsx'), /alternates:\s*\{\s*canonical:\s*'\/login'/)
  assert.match(read('src/app/home/layout.tsx'), /alternates:\s*\{\s*canonical:\s*'\/home'/)
})

test('canonical이 절대 URL로 직렬화되려면 루트 layout의 metadataBase가 유지되어야 한다', () => {
  const root = read('src/app/layout.tsx')
  assert.match(root, /metadataBase:\s*new URL\(SITE_URL\)/)
})
