import test from 'node:test'
import assert from 'node:assert/strict'

import { detectDuplicateNumericCitations } from '../src/committee-llm.js'

test('같은 수치를 2명 이상이 인용하면 보고한다', () => {
  const results = {
    valuation: { reason: '컨센서스 목표주가 487,045원 대비 94.8% 상승여력이 있습니다.' },
    upsideBuffer: { reason: '목표가 487,045원 대비 94.8%의 상방 여지를 확인했습니다.' },
    trend: { reason: '단기 흐름은 혼조입니다.' },
  }
  const dups = detectDuplicateNumericCitations(results)
  const tokens = dups.map((d) => d.token)
  assert.ok(tokens.includes('487045'))
  assert.ok(tokens.includes('94.8%'))
  for (const d of dups) {
    assert.deepEqual(d.members, ['upsideBuffer', 'valuation'])
  }
})

test('소유자 1명만 인용하면 보고하지 않는다', () => {
  const results = {
    valuation: { reason: 'PER 39.08배, PBR 11.58배로 multiple 부담이 있습니다.' },
    upsideBuffer: { reason: '목표가 대비 여력은 충분한 편입니다.' },
  }
  assert.deepEqual(detectDuplicateNumericCitations(results), [])
})

test('콤마 정규화와 % 구분 규칙을 따른다', () => {
  const results = {
    a: { reason: '현재가 58,800원입니다.' },
    b: { reason: '시세는 58800원 수준입니다.' },
    c: { reason: '약 58,800%라는 표현은 다른 토큰입니다.' },
  }
  const dups = detectDuplicateNumericCitations(results)
  assert.equal(dups.length, 1)
  assert.equal(dups[0].token, '58800')
  assert.deepEqual(dups[0].members, ['a', 'b'])
})

test('값 10 미만의 정수(%·소수 제외)는 노이즈로 무시한다', () => {
  const results = {
    a: { reason: '공시 4건 중 1건 위험, 0.5% 소폭 하락, 5페이지 확보.' },
    b: { reason: '4건의 공시와 5페이지, 1건 정정, 0.6% 등락 확인.' },
  }
  assert.deepEqual(detectDuplicateNumericCitations(results), [])
})

test('이유가 없거나 깨진 결과는 무시한다', () => {
  const results = {
    a: null,
    b: { reason: '' },
    c: { reason: '목표가 67,800원 대비 15.3% 상승 여지.' },
    d: { reason: '67,800원 목표가, 15.3% 여유.' },
  }
  const dups = detectDuplicateNumericCitations(results)
  assert.equal(dups.length, 2)
  assert.deepEqual(dups.map((d) => d.token).sort(), ['15.3%', '67800'])
})

test('연도(1900~2100 4자리)는 기간 맥락이라 중복으로 세지 않는다', () => {
  const results = {
    a: { reason: '2026년 상반기 매출이 감소했습니다.' },
    b: { reason: '2026년 실적 둔화와 2025년 대비 흐름을 확인했습니다.' },
  }
  assert.deepEqual(detectDuplicateNumericCitations(results), [])
})
