import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  detectDuplicateNumericCitations,
  getCommitteeProgress,
  scoreCommitteeMember,
} from '../src/committee-llm.js'

// committee-llm.js의 기존 테스트는 리트라이/동시성/soft-deadline/TTL 흐름을 다뤘지만
// LLM 응답 정규화 계약(점수 clamp, confidence 별칭, wrapper 언랩, warnings 필터)과
// 레지스트리/지표의 빈 입력 경계는 검증하지 않았다. 이 파일이 그 갭을 메운다.
// fetch는 기존 테스트와 동일하게 global.fetch를 mock으로 교체한다(외부 호출 없음).

type MockContent = Record<string, unknown>

function withMockedVerdict(content: MockContent) {
  const originalFetch = global.fetch
  const originalKey = process.env.OPENROUTER_API_KEY
  const logDir = mkdtempSync(join(tmpdir(), 'committee-normalize-'))
  process.env.OPENROUTER_API_KEY = 'test-key'

  global.fetch = (async () => new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch

  return {
    logDir,
    async run(memberKey = 'valuation') {
      return scoreCommitteeMember(memberKey, { shared: {}, memberDump: {} }, {
        systemPrompt: () => 'prompt',
        logDir,
        retryCount: 0,
        emptyResponseRetryDelayMs: 1,
      })
    },
    restore() {
      rmSync(logDir, { recursive: true, force: true })
      global.fetch = originalFetch
      if (originalKey !== undefined) process.env.OPENROUTER_API_KEY = originalKey
      else delete process.env.OPENROUTER_API_KEY
    },
  }
}

test('scoreCommitteeMember clamps out-of-range verdict scores into 0..100', async () => {
  const over = withMockedVerdict({ score: 250, reason: 'clamp 상한 검증', confidence: 'medium' })
  try {
    const result = await over.run('clampHigh')
    assert.equal(result.score, 100)
  } finally {
    over.restore()
  }

  const under = withMockedVerdict({ score: -20, reason: 'clamp 하한 검증', confidence: 'medium' })
  try {
    const result = await under.run('clampLow')
    assert.equal(result.score, 0)
  } finally {
    under.restore()
  }
})

test('scoreCommitteeMember rounds numeric string scores from wrapped payloads', async () => {
  const wrapped = withMockedVerdict({ result: { score: '76.5', reason: 'wrapper 언랩 검증' } })
  try {
    const result = await wrapped.run('wrapped')
    assert.equal(result.score, 77) // '76.5' → Number → Math.round
    assert.equal(result.reason, 'wrapper 언랩 검증')
    assert.equal(result.confidence, 'medium') // 누락 시 기본값
  } finally {
    wrapped.restore()
  }
})

test('scoreCommitteeMember normalizes confidence aliases to the canonical scale', async () => {
  const cases: Array<[string, 'high' | 'medium' | 'low']> = [
    ['STRONG', 'high'],
    ['mid', 'medium'],
    ['weak', 'low'],
  ]
  for (const [raw, expected] of cases) {
    const harness = withMockedVerdict({ score: 60, reason: '별칭 검증', confidence: raw })
    try {
      const result = await harness.run('confidence')
      assert.equal(result.confidence, expected, `raw=${raw}`)
    } finally {
      harness.restore()
    }
  }

  const unknown = withMockedVerdict({ score: 60, reason: '미지 신뢰도', confidence: 'meh' })
  try {
    const result = await unknown.run('confidence')
    assert.equal(result.confidence, 'medium')
  } finally {
    unknown.restore()
  }
})

test('scoreCommitteeMember filters empty and non-string warnings out of the verdict', async () => {
  const harness = withMockedVerdict({
    score: 70,
    reason: 'warnings 필터 검증',
    confidence: 'high',
    warnings: ['유효한 경고', '', '   ', 42, null],
  })
  try {
    const result = await harness.run('warnings')
    assert.deepEqual(result.warnings, ['유효한 경고'])
  } finally {
    harness.restore()
  }
})

test('getCommitteeProgress returns null for unknown or falsy requestIds', () => {
  assert.equal(getCommitteeProgress('no-such-request-id-123'), null)
  assert.equal(getCommitteeProgress(''), null)
  assert.equal(getCommitteeProgress(undefined), null)
})

test('detectDuplicateNumericCitations ignores null input, empty maps, and non-string reasons', () => {
  assert.deepEqual(detectDuplicateNumericCitations(null), [])
  assert.deepEqual(detectDuplicateNumericCitations(undefined), [])
  assert.deepEqual(detectDuplicateNumericCitations({}), [])
  assert.deepEqual(detectDuplicateNumericCitations({
    a: { reason: 12345 },
    b: { reason: '목표가 67,800원 대비 여력.' },
    c: { reason: '같은 숫자 67800원 인용.' },
  }), [{ token: '67800', members: ['b', 'c'] }])
})
