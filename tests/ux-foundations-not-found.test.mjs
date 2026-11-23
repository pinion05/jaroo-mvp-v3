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

// TC-BBF-007 회귀: 존재하지 않는 경로는 한국어 안내 + 홈 복귀 진출점을 제공해야 한다
// (Next.js 기본 영문 404 "This page could not be found." 대체).

test('커스텀 404 페이지가 한국어 안내와 홈 복귀 링크를 갖는다', () => {
  const source = read('src/app/not-found.tsx')
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/app/not-found.tsx')), true)
  assert.match(source, /페이지를 찾을 수 없어요/)
  assert.match(source, /홈으로 돌아가기/)
  assert.match(source, /href='\/home'/)
  // 404 표면도 페이지 대표 헤딩을 갖는다(h1 계층 — TC-BBL-008 확장)
  assert.match(source, /<h1[^>]*>페이지를 찾을 수 없어요<\/h1>/)
})
