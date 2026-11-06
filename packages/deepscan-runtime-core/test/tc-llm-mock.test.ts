import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isLlmMockEnabled,
  llmMockDateToken,
  createLlmMockSeededRandom,
  pickLlmMockItem,
  llmMockIntInRange,
  llmMockLatencyMs,
  sleepLlmMockLatency,
} from '../src/llm-mock.js'

// src/llm-mock.js는 기존 테스트가 전혀 없었던 커버리지 갭 영역이다.
// dev 게이트 파싱(JAROO_LLM_MOCK), 결정적 PRNG, 지연 유틸의 계약을 검증한다.
// 외부 네트워크·실 LLM 호출은 일절 없으며 타이머 기반 sleep은 0~30ms로 고정한다.

test('isLlmMockEnabled accepts the documented truthy toggle values with trim+lowercase', () => {
  for (const raw of ['1', 'true', 'TRUE', '  On  ', 'yes', 'YES']) {
    assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: raw }), true, `value=${raw}`)
  }
})

test('isLlmMockEnabled rejects falsy, unknown, and non-string toggle values', () => {
  for (const raw of ['0', 'false', 'no', 'off', '', '   ', 'enabled', null, undefined, 1, true]) {
    assert.equal(isLlmMockEnabled({ JAROO_LLM_MOCK: raw as unknown as string }), false, `value=${String(raw)}`)
  }
})

test('isLlmMockEnabled defaults to false when the env var is absent', () => {
  const original = process.env.JAROO_LLM_MOCK
  delete process.env.JAROO_LLM_MOCK
  try {
    assert.equal(isLlmMockEnabled(), false)
  } finally {
    if (original !== undefined) process.env.JAROO_LLM_MOCK = original
  }
})

test('llmMockDateToken returns the UTC YYYY-MM-DD slice of the given date', () => {
  assert.equal(llmMockDateToken(new Date('2026-11-05T15:30:00Z')), '2026-11-05')
  assert.equal(llmMockDateToken(new Date('2026-01-09T00:00:00Z')), '2026-01-09')
  assert.match(llmMockDateToken(), /^\d{4}-\d{2}-\d{2}$/)
})

test('createLlmMockSeededRandom is deterministic for the same seed and bounded in [0,1)', () => {
  const first = createLlmMockSeededRandom('valuation|NVDA|2026-11-05')
  const second = createLlmMockSeededRandom('valuation|NVDA|2026-11-05')
  const seqA = [first(), first(), first(), first()]
  const seqB = [second(), second(), second(), second()]
  assert.deepEqual(seqA, seqB)
  for (const value of seqA) {
    assert.ok(value >= 0 && value < 1)
  }
})

test('createLlmMockSeededRandom diverges across different seeds and tolerates null seed', () => {
  const seqA = (() => {
    const r = createLlmMockSeededRandom('a|b|c')
    return [r(), r(), r()]
  })()
  const seqB = (() => {
    const r = createLlmMockSeededRandom('a|b|d')
    return [r(), r(), r()]
  })()
  assert.notDeepEqual(seqA, seqB)

  const nullSeedRandom = createLlmMockSeededRandom(null)
  assert.equal(typeof nullSeedRandom(), 'number')
})

test('pickLlmMockItem returns empty string for missing lists and honors the random draw', () => {
  const values = ['alpha', 'beta', 'gamma']
  assert.equal(pickLlmMockItem(createLlmMockSeededRandom('x'), []), '')
  assert.equal(pickLlmMockItem(createLlmMockSeededRandom('x'), null), '')
  assert.equal(pickLlmMockItem(createLlmMockSeededRandom('x'), undefined), '')

  const alwaysFirst = () => 0
  const alwaysLast = () => 0.999999
  assert.equal(pickLlmMockItem(alwaysFirst, values), 'alpha')
  assert.equal(pickLlmMockItem(alwaysLast, values), 'gamma')
})

test('llmMockIntInRange swaps reversed bounds, keeps single-value range, and stays inclusive', () => {
  assert.equal(llmMockIntInRange(createLlmMockSeededRandom('s'), 5, 1), 3)
  assert.equal(llmMockIntInRange(createLlmMockSeededRandom('s'), 3, 3), 3)

  const seen = new Set<number>()
  for (let index = 0; index < 2000; index += 1) {
    const value = llmMockIntInRange(createLlmMockSeededRandom(String(index)), 1, 3)
    assert.ok(value >= 1 && value <= 3)
    seen.add(value)
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3])
})

test('llmMockLatencyMs honors configured non-negative values and rounds decimals', () => {
  const random = createLlmMockSeededRandom('latency')
  assert.equal(llmMockLatencyMs(random, { JAROO_LLM_MOCK_LATENCY_MS: '0' }), 0)
  assert.equal(llmMockLatencyMs(random, { JAROO_LLM_MOCK_LATENCY_MS: '1000' }), 1000)
  assert.equal(llmMockLatencyMs(random, { JAROO_LLM_MOCK_LATENCY_MS: '123.7' }), 124)
})

test('llmMockLatencyMs falls back to the deterministic 200..800ms range on non-numeric input', () => {
  const random = createLlmMockSeededRandom('fallback')
  for (const raw of ['-5', 'abc', 'NaN', '1e999']) {
    const value = llmMockLatencyMs(random, { JAROO_LLM_MOCK_LATENCY_MS: raw })
    assert.ok(value >= 200 && value <= 800, `raw=${raw} value=${value}`)
  }
})

test('llmMockLatencyMs treats an empty env value as 0 via the Number("") quirk', () => {
  // Number('') === 0 이므로 빈 문자열은 fallback이 아니라 0(무지연)으로 고정된다.
  // 의도 여부가 애매한 경계 동작이라 현재 계약을 기록으로 남긴다(버그 후보 후보군 아님, 문서화 목적).
  const random = createLlmMockSeededRandom('empty')
  assert.equal(llmMockLatencyMs(random, { JAROO_LLM_MOCK_LATENCY_MS: '' }), 0)
})

test('sleepLlmMockLatency resolves without meaningful delay when latency is zero', async () => {
  const startedAt = Date.now()
  await sleepLlmMockLatency(createLlmMockSeededRandom('sleep'), { JAROO_LLM_MOCK_LATENCY_MS: '0' })
  assert.ok(Date.now() - startedAt < 50)
})

test('sleepLlmMockLatency waits at least the configured fixed latency', async () => {
  // unref된 타이머만 남으면 node:test가 이벤트 루프를 먼저 드레인하므로,
  // 테스트 동안만 keepalive interval로 루프를 붙잡아 둔다(프로덕션 코드 변경 없음).
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const startedAt = Date.now()
    await sleepLlmMockLatency(createLlmMockSeededRandom('sleep'), { JAROO_LLM_MOCK_LATENCY_MS: '30' })
    const elapsed = Date.now() - startedAt
    assert.ok(elapsed >= 25, `elapsed=${elapsed}`)
    assert.ok(elapsed < 300, `elapsed=${elapsed}`)
  } finally {
    clearInterval(keepAlive)
  }
})
