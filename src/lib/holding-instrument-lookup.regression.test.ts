import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveHoldingInstrument, searchHoldingInstrumentCandidates } from './holding-instrument-lookup'

test('단일 문자 티커는 standalone query 에서만 exact shortcut 으로 유지한다', () => {
  const resolved = resolveHoldingInstrument('B')

  assert.equal(resolved?.ticker, 'B')
  assert.match(resolved?.name ?? '', /Barrick/i)
})

test('자연어 multi-token query 안의 단일 문자 embedded ticker 는 조기 exact 선택에서 제외한다', () => {
  const resolved = resolveHoldingInstrument('Berkshire Hathaway B')

  assert.equal(resolved?.ticker, 'BRK-B')
  assert.match(resolved?.name ?? '', /Berkshire/i)
})

test('pure ticker exact miss 는 더 짧은 ticker prefix/contains fuzzy 로 붙지 않는다', () => {
  const resolved = resolveHoldingInstrument('BITX')
  const candidates = searchHoldingInstrumentCandidates('BITX', 3)

  assert.equal(resolved, null)
  assert.equal(candidates.length, 0)
})

test('대표적인 한국 종목 별칭은 종목코드까지 안정적으로 매핑한다', () => {
  const cases = [
    { query: '네이버', expectedName: 'NAVER', expectedCode: '035420' },
    { query: 'SOOP', expectedName: 'SOOP', expectedCode: '067160' },
    { query: 'soop', expectedName: 'SOOP', expectedCode: '067160' },
    { query: '숲', expectedName: 'SOOP', expectedCode: '067160' },
    { query: '아프리카TV', expectedName: 'SOOP', expectedCode: '067160' },
    { query: '삼영', expectedName: '삼영화학공업', expectedCode: '003720' },
    { query: 'LST에너지', expectedName: 'SNT에너지', expectedCode: '100840' },
    { query: 'LST 에너지', expectedName: 'SNT에너지', expectedCode: '100840' },
    { query: 'SNT에너지', expectedName: 'SNT에너지', expectedCode: '100840' },
    { query: 'SNT 에너지', expectedName: 'SNT에너지', expectedCode: '100840' },
    { query: '현대차', expectedName: '현대자동차', expectedCode: '005380' },
    { query: '포스코홀딩스', expectedName: '포스코', expectedCode: '005490' },
    { query: 'POSCO홀딩스', expectedName: '포스코', expectedCode: '005490' },
    { query: 'LG에너지솔루션', expectedName: 'LG에너지솔루션', expectedCode: '373220' },
    { query: '엘지에너지솔루션', expectedName: 'LG에너지솔루션', expectedCode: '373220' },
    { query: '카카오뱅크', expectedName: '카카오뱅크', expectedCode: '323410' },
    { query: '카뱅', expectedName: '카카오뱅크', expectedCode: '323410' },
    { query: '삼전', expectedName: '삼성전자', expectedCode: '005930' },
  ]

  for (const { query, expectedName, expectedCode } of cases) {
    const resolved = resolveHoldingInstrument(query)

    assert.equal(resolved?.name, expectedName, query)
    assert.equal(resolved?.code, expectedCode, query)
    assert.equal(resolved?.locale, 'KR', query)
  }
})
