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

// 코드 감사 B1(2026-09-14): /api/ocr은 유료 비전 LLM을 호출하지만
// 인증·쿼터·크기·타임아웃이 전부 없었다. 이 테스트는 4겹 가드가
// 존재하고 OpenRouter 호출 앞에서 실행되는지를 검증한다.
// (순수 헬퍼·상수는 shared.ts, 라우트 핸들러는 route.ts)

test('OCR shared: 가드 상수·레이트리밋이 정의된다', () => {
  const shared = read('src/app/api/ocr/shared.ts')

  // 2) 유저별 레이트리밋 — 배치 업로드 상한(5)보다 여유
  assert.match(shared, /isOcrRateLimited/)
  assert.match(shared, /OCR_RATE_LIMIT_MAX = 10/)
  assert.match(shared, /OCR_RATE_LIMIT_WINDOW_MS = 5 \* 60_000/)

  // 3) 본문/이미지 크기 상한
  assert.match(shared, /OCR_MAX_IMAGE_DATA_URL_LENGTH = 4_000_000/)
  assert.match(shared, /OCR_MAX_REQUEST_BYTES = OCR_MAX_IMAGE_DATA_URL_LENGTH/)

  // 4) 업스트림 타임아웃
  assert.match(shared, /OCR_UPSTREAM_TIMEOUT_MS = 30_000/)
})

test('OCR 라우트: 유료 LLM 호출 전에 4겹 가드가 배선된다', () => {
  const route = read('src/app/api/ocr/route.ts')

  // 1) 세션 인증 필수 (쿼터 제거 주석의 재도입 — 세션 기반)
  assert.match(route, /resolveApiUserId\('ocr'\)/)
  assert.match(route, /status: 401/)
  assert.match(route, /로그인 후 스크린샷 분석을 사용할 수 있어요/)

  assert.match(route, /isOcrRateLimited\(auth\.userId\)/)
  assert.match(route, /status: 429/)

  assert.match(route, /contentLength > OCR_MAX_REQUEST_BYTES/)
  assert.match(route, /imageDataUrl\.length > OCR_MAX_IMAGE_DATA_URL_LENGTH/)

  assert.match(route, /AbortSignal\.timeout\(OCR_UPSTREAM_TIMEOUT_MS\)/)
  assert.match(route, /status: 504/)
  assert.match(route, /TimeoutError/)

  // origin 검증(상태 변경 라우트 관례 — portfolio·account와 동일)
  assert.match(route, /originAllowedForStateChange\(request\)/)
  assert.match(route, /status: 403/)
})

test('OCR 라우트: 가드가 OpenRouter 호출보다 먼저 실행된다', () => {
  const route = read('src/app/api/ocr/route.ts')
  const postBody = route.slice(route.indexOf('export async function POST'))

  const authAt = postBody.indexOf("resolveApiUserId('ocr')")
  const rateAt = postBody.indexOf('isOcrRateLimited(auth.userId)')
  const sizeAt = postBody.indexOf('imageDataUrl.length > OCR_MAX_IMAGE_DATA_URL_LENGTH')
  const upstreamAt = postBody.indexOf('await requestOpenRouterOcr({')

  assert.ok(authAt >= 0 && rateAt > authAt, '인증 → 레이트리밋 순서')
  assert.ok(sizeAt > rateAt, '레이트리밋 → 크기 상한 순서')
  assert.ok(upstreamAt > sizeAt, '모든 가드가 OpenRouter 호출 앞')
})

test('OCR 라우트 테스트는 서버 전용 의존 없이 순수 모듈을 검증한다', () => {
  // route.test.ts가 './shared'를 import하는 한 server-only 로딩 문제가 재발하지 않는다
  const routeTest = read('src/app/api/ocr/route.test.ts')
  assert.match(routeTest, /from '\.\/shared'/)
  assert.doesNotMatch(routeTest, /from '\.\/route'/)
})
