import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProfitIntroMention } from './deepscan-intro-mention'

// 2축 판정(2026-11-02 확장):
//   ① 종목 손익률(profitAmount / costBasis) — 문구의 '상황' 축
//   ② 전체 대비 충격(profitAmount / portfolioTotal) — 톤(강도) 축
// "거의 본전이네요"는 종목 손익률 −3~+3%에서만 허용된다.
// costBasis가 없는 호출은 기존 5단계(충격 기준)로 폴백한다.
const total = 10_000_000

test('깊은 하락(≤ −40%)에서는 절대 “거의 본전”이라 말하지 않는다 (SOOP −50% 사례)', () => {
  // 종목 −50%, 전체 비중은 작음(충격 −0.5%p) — 과거엔 "거의 본전이네요"가 떴던 케이스
  assert.equal(
    buildProfitIntroMention({ name: 'SOOP', profitAmount: -50_000, costBasis: 100_000, portfolioTotal: total }),
    'SOOP, 깊이 내려앉은 종목이에요',
  )
  // 종목 −50% + 전체 충격 −5%p
  assert.equal(
    buildProfitIntroMention({ name: 'SOOP', profitAmount: -50_000, costBasis: 100_000, portfolioTotal: 1_000_000 }),
    'SOOP, 깊은 하락을 겪고 있네요',
  )
  // 종목 −50% + 전체 충격 −17%p (비중 큼)
  assert.equal(
    buildProfitIntroMention({ name: 'SOOP', profitAmount: -50_000, costBasis: 100_000, portfolioTotal: 300_000 }),
    'SOOP, 정말 쉽지 않은 구간이네요',
  )
})

test('큰 하락(−15~−40%) — 비중(충격)에 따라 3단계', () => {
  const at = (shock: number) =>
    buildProfitIntroMention({ name: '삼성전자', profitAmount: -20_000, costBasis: 100_000, portfolioTotal: 20_000 / (shock / 100) })
  assert.equal(at(1), '삼성전자, 많이 내려온 종목이에요')
  assert.equal(at(5), '삼성전자, 많이 빠졌네요')
  assert.equal(at(16), '삼성전자, 부담이 큰 하락이네요')
})

test('소폭 하락(−3~−15%) — 비중이 크면 눈에 띄게', () => {
  const at = (shock: number) =>
    buildProfitIntroMention({ name: '삼성전자', profitAmount: -5_000, costBasis: 100_000, portfolioTotal: 5_000 / (shock / 100) })
  assert.equal(at(1), '삼성전자, 조금 빠졌네요')
  assert.equal(at(4), '삼성전자, 눈에 띄게 빠졌네요')
})

test('수익·큰 수익 — 비중이 커지면 공을 인정하는 톤', () => {
  // 종목 +10%: 비중 작음 → 기본 수익 문구
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: 10_000, costBasis: 100_000, portfolioTotal: total }),
    '삼성전자, 수익 구간이에요',
  )
  // 종목 +10% + 전체 충격 +4%p
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: 10_000, costBasis: 100_000, portfolioTotal: 250_000 }),
    '삼성전자, 수익이 쌓이고 있어요',
  )
  // 종목 +30%: 비중 작음 → 기존 큰 수익 문구
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: 30_000, costBasis: 100_000, portfolioTotal: total }),
    '삼성전자, 꽤 오르셨네요',
  )
  // 종목 +30% + 전체 충격 +12%p
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: 30_000, costBasis: 100_000, portfolioTotal: 250_000 }),
    '삼성전자, 포트폴리오를 크게 끌어올렸네요',
  )
})

test('본전 근처(−3~+3%) — “거의 본전”은 오직 이 구간에서만', () => {
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: 2_000, costBasis: 100_000, portfolioTotal: total }),
    '삼성전자, 거의 본전이네요',
  )
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: -2_999, costBasis: 100_000, portfolioTotal: total }),
    '삼성전자, 거의 본전이네요',
  )
  // 경계 −3%는 소폭 하락으로
  assert.equal(
    buildProfitIntroMention({ name: '삼성전자', profitAmount: -3_000, costBasis: 100_000, portfolioTotal: total }),
    '삼성전자, 조금 빠졌네요',
  )
})

test('폴백: costBasis 없으면 기존 5단계(전체 대비 충격 기준)를 그대로 쓴다', () => {
  const cases: Array<[number, string]> = [
    [20, '삼성전자, 꽤 오르셨네요'],
    [10, '삼성전자, 수익 구간이에요'],
    [0, '삼성전자, 거의 본전이네요'],
    [-10, '삼성전자, 조금 빠졌네요'],
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

test('폴백: 합계 0 / 손익 불가 / 이름 없음 / costBasis 0 이하 → null (기존 안내 문구 유지)', () => {
  assert.equal(buildProfitIntroMention({ name: 'A', profitAmount: 1000, portfolioTotal: 0, costBasis: 1000 }), null)
  assert.equal(buildProfitIntroMention({ name: 'A', profitAmount: Number.NaN, portfolioTotal: total, costBasis: 1000 }), null)
  assert.equal(buildProfitIntroMention({ name: ' ', profitAmount: 1000, portfolioTotal: total, costBasis: 1000 }), null)
  assert.equal(buildProfitIntroMention({ name: 'A', profitAmount: 1000, portfolioTotal: total, costBasis: 0 }), 'A, 거의 본전이네요')
})
