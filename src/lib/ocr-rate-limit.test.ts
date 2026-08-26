import test from 'node:test'
import assert from 'node:assert/strict'

import { checkOcrQuota } from './ocr-rate-limit'

const MIN = 60 * 1000

test('시간당 한도 내 연속 호출은 허용된다', () => {
  const ip = 'quota-ok-test'
  const base = Date.now()
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(checkOcrQuota(ip, base + i * MIN), { allowed: true, retryAfterSec: 0 })
  }
})

test('시간당 한도(5) 초과 시 거부되고 재시도 대기시간을 반환한다', () => {
  const ip = 'quota-hour-test'
  const base = Date.now()
  for (let i = 0; i < 5; i += 1) {
    checkOcrQuota(ip, base + i * MIN)
  }
  const result = checkOcrQuota(ip, base + 5 * MIN)
  assert.equal(result.allowed, false)
  assert.equal(result.retryAfterSec, 60 * 60 - 5 * 60)
})

test('1시간이 지나면 시간 창이 초기화된다', () => {
  const ip = 'quota-window-test'
  const base = Date.now()
  for (let i = 0; i < 5; i += 1) {
    checkOcrQuota(ip, base + i * MIN)
  }
  assert.equal(checkOcrQuota(ip, base + 5 * MIN).allowed, false)
  assert.deepEqual(checkOcrQuota(ip, base + 61 * MIN), { allowed: true, retryAfterSec: 0 })
})

test('일일 한도(10) 초과 시 하루 종일 거부된다', () => {
  const ip = 'quota-day-test'
  const base = Date.now()
  // 시간당 5회 제한을 피해 2시간 간격으로 10회 소진
  for (let i = 0; i < 10; i += 1) {
    const r = checkOcrQuota(ip, base + i * 2 * 60 * MIN)
    assert.equal(r.allowed, true)
  }
  const blocked = checkOcrQuota(ip, base + 21 * 60 * MIN)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSec > 0)
})

test('서로 다른 IP는 독립적으로 계산된다', () => {
  const base = Date.now()
  for (let i = 0; i < 5; i += 1) {
    checkOcrQuota('quota-ip-a', base + i * MIN)
  }
  assert.equal(checkOcrQuota('quota-ip-a', base + 5 * MIN).allowed, false)
  assert.equal(checkOcrQuota('quota-ip-b', base + 5 * MIN).allowed, true)
})
