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

// TC-BBL-008 회귀: 게스트 진입 페이지(/login·/terms·/privacy·/home)는 각각 h1 1개 이상을 가져야 한다.
// 스크린리더 탐색·SEO 모두 페이지 대표 헤딩을 기대한다.

test('로그인 페이지의 브랜드 타이포가 h1으로 승격되어 있다(양쪽 뷰 각각)', () => {
  const page = read('src/app/login/page.tsx')
  // select 뷰: 시안의 큰 브랜드 텍스트를 태그만 승격(시각 디자인 유지)
  assert.match(page, /<h1 className=\{styles\.brand\}>Jaroo<\/h1>/)
  // email 뷰: '이메일로 시작' 헤딩
  assert.match(page, /<h1 className=\{cn\(styles\.brand, styles\.brandSm\)\}>이메일로 시작<\/h1>/)
  // div 버전은 잔존하지 않아야 한다(승격 누락 방지)
  assert.doesNotMatch(page, /<div className=\{styles\.brand\}>/)
  assert.doesNotMatch(page, /<div className=\{cn\(styles\.brand, styles\.brandSm\)\}>/)
})

test('로그인 h1 승격이 레이아웃을 흐트러뜨리지 않게 UA 마진이 리셋되어 있다', () => {
  const css = read('src/app/login/login.module.css')
  assert.match(css, /\.brand\s*\{[^}]*margin:\s*0 0 12px/s)
})

test('약관·개인정보처리방침 페이지가 공통 LegalDocument 레이아웃으로 h1을 갖는다', () => {
  const layout = read('src/components/legal/legal-document.tsx')
  // 시각 디자인 유지 — title prop을 sr-only h1으로 노출
  assert.match(layout, /<h1 className='sr-only'>\{title\}<\/h1>/)
  // 조문 헤딩은 h2 계층 유지(h1→h2 헤딩 계층)
  assert.match(layout, /<h2 className=\{styles\.h\}>/)

  for (const page of ['src/app/terms/page.tsx', 'src/app/privacy/page.tsx']) {
    const source = read(page)
    assert.match(source, /title='(서비스 이용약관|개인정보처리방침)'/, `${page} 가 문서 title을 전달해야 한다`)
  }
})

test('홈 페이지가 포트폴리오 상태와 무관한 sr-only h1을 갖는다', () => {
  const page = read('src/app/home/page.tsx')
  assert.match(page, /<h1 className='sr-only'>내 포트폴리오<\/h1>/)
})
