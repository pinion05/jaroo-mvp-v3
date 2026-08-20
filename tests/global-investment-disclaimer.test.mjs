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

test('홈 화면 하단에 전역 투자 디스클레이머가 상시 노출된다', () => {
  const source = read('src/components/home/jaroo-home-screen.tsx')
  assert.match(source, /globalDisclaimer/)
  assert.match(source, /투자 자문·권유가 아니며 투자 판단과 책임은 이용자에게 있습니다/)
  // AppBottomNav 직전(main 끝)에 위치해 홈 스크롤 마지막에 항상 보인다
  assert.match(source, /globalDisclaimer[\s\S]*?<\/main>/)

  const css = read('src/components/home/jaroo-home-screen.module.css')
  assert.match(css, /\.globalDisclaimer/)
})

test('DeepScan 결과/로딩 화면의 기존 투자 경고 문구가 유지된다', () => {
  const inline = read('src/components/deepscan-inline-results.tsx')
  assert.match(inline, /투자 권유나 수익 보장이 아닙니다/)
  const loading = read('src/components/deepscan-loading-screen.tsx')
  assert.match(loading, /투자 권유가 아닌 참고 자료입니다/)
})

test('자본시장법 검토 착수 문서가 존재하고 핵심 쟁점을 다룬다', () => {
  const doc = read('docs/capital-markets-law-review-2026-08-20.md')
  assert.match(doc, /자본시장법 제94조/)
  assert.match(doc, /투자자문업/)
  assert.match(doc, /법률 자문이 아니다/) // 문서의 성격 고지
  assert.match(doc, /전자상거래법/)
  assert.match(doc, /체크리스트/)
})
