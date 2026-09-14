import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OCR_MAX_IMAGE_DATA_URL_LENGTH,
  OCR_RATE_LIMIT_MAX,
  OCR_RATE_LIMIT_WINDOW_MS,
  isOcrRateLimited,
} from './shared'

// isOcrRateLimited는 now를 주입할 수 있어 시간 의존 경계를 결정적으로 검증한다.
// 모듈 상태(버킷)가 공유되므로 각 케이스는 고유 userId를 쓴다.

test('한도까지는 통과하고 정확히 그 다음 요청부터 차단한다', () => {
  const user = 'rl-basic'
  for (let i = 0; i < OCR_RATE_LIMIT_MAX; i += 1) {
    assert.equal(isOcrRateLimited(user, 1_000_000), false, `요청 ${i + 1}째는 통과`)
  }
  assert.equal(isOcrRateLimited(user, 1_000_000), true, '한도+1째는 차단')
  assert.equal(isOcrRateLimited(user, 1_000_001), true, '이후 계속 차단')
})

test('윈도 밖의 오래된 스탬프는 세지 않는다', () => {
  const user = 'rl-window'
  const now = 10_000_000_000
  // 윈도 시작점보다 이전 스탬프 10개 — 만료 (경계 ±1ms 의미론 자체는 구현 세부로,
  for (let i = 0; i < OCR_RATE_LIMIT_MAX; i += 1) {
    assert.equal(isOcrRateLimited(user, now - OCR_RATE_LIMIT_WINDOW_MS - i), false)
  }
  // 경계 스탬프 1개차는 한도(10)에 행동적으로 무의미해 여기선 검증하지 않는다)
  assert.equal(isOcrRateLimited(user, now), false)
})

test('윈도가 지나면 버킷이 회복된다', () => {
  const user = 'rl-recovery'
  const t0 = 5_000_000_000
  for (let i = 0; i < OCR_RATE_LIMIT_MAX; i += 1) {
    assert.equal(isOcrRateLimited(user, t0), false)
  }
  assert.equal(isOcrRateLimited(user, t0), true, 't0 시점 한도 소진')
  // 1ms 부족하면 여전히 차단, 윈두 초과(+1ms)면 회복
  assert.equal(isOcrRateLimited(user, t0 + OCR_RATE_LIMIT_WINDOW_MS - 1), true, '윈도 -1ms: 아직 차단')
  assert.equal(isOcrRateLimited(user, t0 + OCR_RATE_LIMIT_WINDOW_MS + 1), false, '윈도 +1ms: 회복')
})

test('유저별 버킷은 독립이다', () => {
  const a = 'rl-user-a'
  const b = 'rl-user-b'
  for (let i = 0; i < OCR_RATE_LIMIT_MAX; i += 1) {
    assert.equal(isOcrRateLimited(a, 1_000), false)
  }
  assert.equal(isOcrRateLimited(a, 1_000), true, 'a 소진')
  assert.equal(isOcrRateLimited(b, 1_000), false, 'b는 영향 없음')
})

test('거부된 요청은 버킷을 추가로 채우지 않는다 (거부 반복이 영구 봉쇄로 이어지지 않음)', () => {
  const user = 'rl-reject-no-count'
  const t0 = 7_000_000_000
  for (let i = 0; i < OCR_RATE_LIMIT_MAX; i += 1) {
    isOcrRateLimited(user, t0)
  }
  // 소진 상태에서 100번 거부 반복
  for (let i = 0; i < 100; i += 1) {
    assert.equal(isOcrRateLimited(user, t0 + i), true)
  }
  // 스탬프 10개뿐 → 첫 스탬프가 윈도를 벗어나는 시점에 회복
  const firstStamp = t0
  const recoveryAt = firstStamp + OCR_RATE_LIMIT_WINDOW_MS + 2
  assert.equal(isOcrRateLimited(user, recoveryAt), false, '거부 반복 후에도 윈도 경계면 회복')
})

test('이미지 상한 상수는 클라이언트 총량 상한(4M자)과 일치한다', () => {
  assert.equal(OCR_MAX_IMAGE_DATA_URL_LENGTH, 4_000_000)
  assert.ok(OCR_RATE_LIMIT_MAX >= 5, '배치 업로드 상한(5장)보다 커야 한다')
})
