import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProfitIntroMention } from './deepscan-intro-mention'

// 스펙 spec_v7 §4 표:
//   +20%↑ "꽤 오르셨네요" / +3~20% "수익 구간이에요" / −3~+3% "거의 본전이네요"
//   −15~−3% "조금 빠졌네요" / −15%↓ "쉽지 않은 구간이네요"
// 판정 = 손익액 ÷ 전체 포트폴리오 평가액(종목 손익률 아님).
const total = 10_000_000

test('손익 인트로 5단계 — 경계값 포함 전 구간', () => {
  const cases: Array<[number, string]> = [
    [20, '삼성전자, 꽤 오르셨네요'],
    [25, '삼성전자, 꽤 오르셨네요'],
    [3, '삼성전자, 수익 구간이에요'],
    [10, '삼성전자, 수익 구간이에요'],
    [0, '삼성전자, 거의 본전이네요'],
    [-3 + 0.001, '삼성전자, 거의 본전이네요'],
    [-3, '삼성전자, 조금 빠졌네요'],
    [-10, '삼성전자, 조금 빠졌네요'],
    [-15, '삼성전자, 쉽지 않은 구간이네요'],
    [-30, '삼성전자, 쉽지 않은 구간이네요'],
  ]
  for (const [pct, expected] of cases) {
    assert.equal(
      buildProfitIntroMention({ name: '삼성전자', profitAmount: total * (pct / 100), portfolioTotal: total }),
      expected,
      `shock ${pct}%`,
    )
  }
})

test('종목 손익률이 아닌 전체 자산 대비 기준 — 비중 작으면 가벼운 톤', () => {
  // 종목 자체는 큰 수익이어도 전체 대비 +2%면 "거의 본전"
  assert.equal(
    buildProfitIntroMention({ name: 'SFA반도체', profitAmount: 200_000, portfolioTotal: 10_000_000 }),
    'SFA반도체, 거의 본전이네요',
  )
})

test('폴백: 합계 0 / 손익 불가 / 이름 없음 → null (기존 안내 문구 유지)', () => {
  assert.equal(buildProfitIntroMention({ name: 'A', profitAmount: 1000, portfolioTotal: 0 }), null)
  assert.equal(buildProfitIntroMention({ name: 'A', profitAmount: Number.NaN, portfolioTotal: total }), null)
  assert.equal(buildProfitIntroMention({ name: ' ', profitAmount: 1000, portfolioTotal: total }), null)
})
