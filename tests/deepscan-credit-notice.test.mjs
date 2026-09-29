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

// 2026-09-29: 딥스캔 크레딧 부족(402 insufficient-credits)은 일시적 오류가 아니다.
// "다시 시도"를 반복하게 하는 일반 오류 화면 대신, 크레딧 문구와 충전 CTA가
// 화면에 나타나야 한다 (제품 결정 — 크레딧 부족 문구 노출 요청).

test('deepscan canonical fetch가 서버 오류 code를 보존한다', () => {
  const source = read('src/lib/deepscan-canonical.ts')
  // §6-6 안내 메시지 전달에 더해, error.code(예: insufficient-credits)와
  // HTTP status까지 화면 계층으로 실어 올려야 UI가 종류별로 분기할 수 있다.
  assert.match(source, /class DeepScanApiError/)
  assert.match(source, /readonly code/)
  assert.match(source, /readonly status/)
  assert.match(source, /throw new DeepScanApiError/)
})

test('deepscan 스토어가 에러 코드를 함께 보관한다', () => {
  const source = read('src/lib/stores/use-deepscan-store.ts')
  assert.match(source, /errorCode: string \| null/)
  assert.match(source, /finishError: \(errorMessage: string, errorCode\?: string \| null\) => void/)
})

test('딥스캔 페이지는 크레딧 부족(402)을 전용 문구와 충전 CTA로 안내한다', () => {
  const source = read('src/app/deepscan/page.tsx')

  // 서버가 주는 code로 분기
  assert.match(source, /insufficient-credits/)
  assert.match(source, /DeepScanApiError/)

  // 전용 타이틀 — "데이터를 표시할 수 없어요"가 아니라 크레딧 문구가 나온다
  assert.match(source, /딥스캔 크레딧이 부족해요/)

  // 충전 CTA — 마이페이지 크레딧 페이지로 보낸다
  assert.match(source, /\/mypage\/credit/)
  assert.match(source, /errorPrimaryAction/)
})

test('딥스캔 로딩 화면 오류 카드가 primary 링크 액션을 지원한다', () => {
  // 크레딧 부족처럼 재시도가 무의미한 오류는 충전 링크가 1차 액션이 된다
  const types = read('src/components/deepscan-loading-types.ts')
  assert.match(types, /errorPrimaryAction\?: \{ label: string; href: string \}/)

  const source = read('src/components/deepscan-loading-screen.tsx')
  assert.match(source, /errorPrimaryAction\.href/)
  // 1차 액션이 있으면 '다시 시도' 대신 링크 버튼이 렌더된다
  assert.match(source, /errorPrimaryAction \? \(/)
})
