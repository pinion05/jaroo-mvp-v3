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

test('서비스 이용약관 페이지가 존재하고 투자자문업 아님·면책·청약철회를 고지한다', () => {
  const source = read('src/app/terms/page.tsx')
  assert.match(source, /투자자문업·투자일임업/) // 자문업이 아님을 명시
  assert.match(source, /투자 권유, 매수·매도의 청약·권유, 수익 보장이 아니며/)
  assert.match(source, /모든 투자 판단과 그 결과에 대한 책임은 회원 본인에게 있습니다/)
  assert.match(source, /청약철회가 제한/) // 전자상거래법 디지털 콘텐츠 철회 제한
  assert.match(source, /만 14세/) // 가입 연령 고지
  assert.match(source, /회원 탈퇴/)
  assert.match(source, /TERMS_VERSION/)
  assert.match(source, /TERMS_EFFECTIVE_DATE/)
})

test('개인정보처리방침 페이지가 PIPA 필수 고지 항목을 담는다', () => {
  const source = read('src/app/privacy/page.tsx')
  assert.match(source, /개인정보보호법/)
  assert.match(source, /수집 항목|처리 목적과 수집 항목/)
  assert.match(source, /보유 및 이용 기간/)
  assert.match(source, /처리 위탁/)
  assert.match(source, /Supabase/)
  assert.match(source, /토스페이먼츠/)
  assert.match(source, /OpenRouter/)
  assert.match(source, /이용자의 권리/) // 열람·정정·삭제·철회
  assert.match(source, /파기 절차/)
  assert.match(source, /만 14세 미만 아동/)
  assert.match(source, /support@jaroo\.kr/)
  // 스크린샷 즉시 파기 — 서비스 화면의 고지와 약관이 일치해야 한다
  assert.match(source, /스크린샷은 OCR\(문자 인식\) 분석 목적으로만 사용되며/)
})

test('약관/개인정보 문서는 공통 LegalDocument 레이아웃을 공유한다', () => {
  const layout = read('src/components/legal/legal-document.tsx')
  assert.match(layout, /SpecFrame/)
  for (const page of ['src/app/terms/page.tsx', 'src/app/privacy/page.tsx']) {
    assert.match(read(page), /LegalDocument/)
  }
  assert.match(read('src/lib/terms.ts'), /export const TERMS_VERSION = 'v1'/)
})
