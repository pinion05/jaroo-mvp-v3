import test from 'node:test'
import assert from 'node:assert/strict'

import { safeJsonStringify, sanitizeForJson } from '../src/safe-json.js'

// 기존 safe-json.test.ts는 순환 참조 + 자격증명 마스킹의 대표 경로 1건만 검증했다.
// 이 파일은 커버리지 갭인 스칼라/특수 값 직렬화 경계와 명시적 secrets 옵션을 보완한다.

test('sanitizeForJson maps top-level null and undefined to null and keeps plain strings', () => {
  assert.equal(sanitizeForJson(null), null)
  assert.equal(sanitizeForJson(undefined), null)
  assert.equal(sanitizeForJson('plain'), 'plain')
})

test('sanitizeForJson stringifies non-finite numbers so JSON.stringify stays valid', () => {
  const sanitized = sanitizeForJson({ nan: Number.NaN, posInf: Number.POSITIVE_INFINITY, negInf: Number.NEGATIVE_INFINITY })
  assert.deepEqual(sanitized, { nan: 'NaN', posInf: 'Infinity', negInf: '-Infinity' })

  const serialized = safeJsonStringify({ nan: Number.NaN })
  assert.equal(JSON.parse(serialized).nan, 'NaN')
})

test('sanitizeForJson converts Date to ISO string and Invalid Date to sentinel text', () => {
  assert.equal(sanitizeForJson({ d: new Date('2026-11-05T09:00:00Z') }).d, '2026-11-05T09:00:00.000Z')
  assert.equal(sanitizeForJson({ d: new Date('not-a-date') }).d, 'Invalid Date')
})

test('sanitizeForJson serializes symbols and functions into tagged placeholders', () => {
  const sanitized = sanitizeForJson({
    tagged: Symbol('tag'),
    untagged: Symbol(),
    named: function myFn() {},
    anonymous: () => 1,
  })
  assert.equal(sanitized.tagged, '[Symbol:tag]')
  assert.equal(sanitized.untagged, '[Symbol]')
  assert.equal(sanitized.named, '[Function:myFn]')
  // tsx 트랜스파일 환경에서는 익명 화살표 함수의 name이 'anonymous'로 채워질 수 있어 완화 매칭한다.
  assert.match(sanitized.anonymous, /^\[Function(:anonymous)?\]$/)
})

test('sanitizeForJson survives cycles introduced through arrays', () => {
  const arrayCycle: unknown[] = [1]
  arrayCycle.push(arrayCycle)

  const sanitized = sanitizeForJson(arrayCycle) as unknown[]
  assert.equal(sanitized[0], 1)
  assert.equal(sanitized[1], '[Circular]')
  assert.doesNotThrow(() => JSON.stringify(sanitized))
})

test('sanitizeForJson honors explicit options.secrets in arbitrary string values', () => {
  const sanitized = sanitizeForJson(
    { note: 'x ab-secret y' },
    { secrets: ['ab-secret'] },
  )
  assert.equal(sanitized.note, 'x [REDACTED] y')
})

test('sanitizeForJson keeps secrets shorter than 4 chars unredacted (documented guard)', () => {
  // redactString은 secret.length >= 4일 때만 치환한다 — 과도한 마스킹(예: 'a' 하나로 전문 마스킹)을
  // 막기 위한 의도된 가드로 판단해 현재 동작을 그대로 계약으로 고정한다.
  const sanitized = sanitizeForJson({ note: 'ab-secret' }, { secrets: ['ab'] })
  assert.equal(sanitized.note, 'ab-secret')
})

test('safeJsonStringify redacts credential assignments and cookies embedded in plain strings', () => {
  // 주의: 키 이름을 'cookie' 등으로 쓰면 sensitive-key 수집이 값 전체를 시크릿으로 취급해
  // 문자열 전체가 [REDACTED] 된다. 여기서는 중립 키로 문자열 내부 패턴 마스킹만 검증한다.
  const serialized = safeJsonStringify({
    assignmentSample: 'api_key=super-secret-value-42',
    headerSample: 'Set-Cookie: session=abcdef0123; Path=/',
  })

  assert.doesNotThrow(() => JSON.parse(serialized))
  const parsed = JSON.parse(serialized)
  assert.equal(parsed.assignmentSample.includes('super-secret-value-42'), false)
  assert.match(parsed.assignmentSample, /api_key=\[REDACTED\]/)
  assert.equal(parsed.headerSample.includes('abcdef0123'), false)
  assert.match(parsed.headerSample, /Set-Cookie: \[REDACTED\]/)
})

test('safeJsonStringify redacts bare Bearer tokens embedded in plain strings', () => {
  const parsed = JSON.parse(safeJsonStringify({ bearerSample: 'Bearer sk-or-v1-tokenvalue' }))
  assert.equal(parsed.bearerSample.includes('sk-or-v1-tokenvalue'), false)
  assert.match(parsed.bearerSample, /Bearer \[REDACTED\]/)
})

test('[버그 후보] Authorization 접두어 뒤 Bearer 토큰 값은 마스킹되지 않고 남는다 (의도적 FAIL)', () => {
  // [원인 추정] redactString의 치환 순서가 QUERY → ASSIGNMENT → BEARER이기 때문.
  // SENSITIVE_ASSIGNMENT_PATTERN의 'authorization' 키워드가 'Authorization: ' 뒤 첫 토큰인
  // 'Bearer'를 값으로 소비해 버리고, 그다음 BEARER_PATTERN은 남은 'Bearer'를 찾지 못해
  // 실제 토큰 값이 문자열에 그대로 남는다.
  // 기존 테스트는 시크릿이 sensitive 키(ApiKey 등)에도 함께 있어 collectSecrets 전역 치환으로
  // 지워졌을 뿐, plain 문자열에만 존재하는 토큰은 이 경로로 새어 나간다.
  // 프로덕션 코드 수정 금지 규칙에 따라 이 테스트는 버그 후보 증거로 FAIL 상태로 남긴다.
  const parsed = JSON.parse(safeJsonStringify({ bearerSample: 'Authorization: Bearer sk-or-v1-tokenvalue' }))
  assert.equal(parsed.bearerSample.includes('sk-or-v1-tokenvalue'), false)
  assert.match(parsed.bearerSample, /Bearer \[REDACTED\]/)
})

test('safeJsonStringify redacts sensitive keys such as password everywhere in the tree', () => {
  const sanitized = sanitizeForJson({ deep: { password: 'pw-secret-123', keep: 'visible' } })
  assert.deepEqual(sanitized, { deep: { password: '[REDACTED]', keep: 'visible' } })
})
