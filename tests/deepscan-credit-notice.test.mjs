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
  // 402 insufficient-credits 상세(필요/잔여)도 화면 계층으로 올려 전용 예외 화면이 쓴다
  assert.match(source, /finishError: \(errorMessage: string, errorCode\?: string \| null, errorCredit\?:/)
})

test('딥스캔 페이지는 크레딧 부족(402)을 친절한 전용 예외 화면으로 안내한다', () => {
  const source = read('src/app/deepscan/page.tsx')

  // 서버가 주는 code로 분기
  assert.match(source, /insufficient-credits/)
  assert.match(source, /DeepScanApiError/)

  // 로딩 스크린의 빨간 오류 카드 대신 전용 화면으로 전체 교체한다 (2026-10-30 UX 개선)
  assert.match(source, /DeepScanCreditShortageScreen/)

  // 서버 402 상세(필요/잔여)를 전용 화면에 그대로 넘긴다
  assert.match(source, /errorCredit\?\.cost/)
  assert.match(source, /errorCredit\?\.balance/)

  const screen = read('src/components/deepscan-credit-shortage-screen.tsx')
  // 버그 페이지 같은 압박감 대신 '오류가 아니에요'로 설명한다
  assert.match(screen, /오류가 아니에요/)
  // 충전 CTA — 마이페이지 크레딧 페이지(무료 지급)로 보낸다
  assert.match(screen, /\/mypage\/credit/)
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

test('오류 카드 1차 액션 버튼은 링크(a)에도 텍스트가 가운데 정렬된다', () => {
  // errorPrimaryAction은 Link(a)로 렌더된다 — 버튼 전용 스타일을 그대로 쓰면
  // a 태그는 기본 왼쪽 정렬이라 글자가 쏠린다(2026-09-29 jaroo.kr 시각 QA).
  const css = read('src/components/deepscan-loading-screen.module.css')
  const rule = css.match(/\.errorRetryButton \{[^}]+\}/)?.[0] ?? ''
  assert.match(rule, /justify-content:\s*center/)
  assert.match(rule, /align-items:\s*center/)
})
