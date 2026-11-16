// 체결 수학 단위테스트 — 평단가/수수료/거래세/실현손익/검증.
// 체결가는 입력(priceKrw)일 뿐 — 시세 조회/신선도 개념 없음.

import { describe, test } from 'node:test'
import { deepStrictEqual, fail, strictEqual } from 'node:assert/strict'
import {
  DEFAULT_RATES,
  EngineError,
  computeFeeKrw,
  computeSellTaxKrw,
  executeMarketOrder,
  isKrSymbol,
  nextAvgPriceCenti,
  positionBasisKrw,
} from '../src/engine.ts'

const order = (symbol: string, side: 'buy' | 'sell', quantity: number, priceKrw: number) => ({
  symbol,
  side,
  quantity,
  priceKrw,
  name: null,
  market: null,
})

describe('심볼 검증', () => {
  test('한국 주식코드만 허용', () => {
    strictEqual(isKrSymbol('005930'), true)
    strictEqual(isKrSymbol('QN620760'), false) // 8자리
    strictEqual(isKrSymbol('AAPL'), false)
    strictEqual(isKrSymbol('00593a'), false) // 소문자
  })
})

describe('수수료/세금 — 원 단위 올림', () => {
  test('수수료 0.015% (1.5bps)', () => {
    strictEqual(computeFeeKrw(10_000_000, DEFAULT_RATES), 1_500)
    strictEqual(computeFeeKrw(1_000, DEFAULT_RATES), 1) // 0.15원 → 올림 1원
    strictEqual(computeFeeKrw(0, DEFAULT_RATES), 0)
  })

  test('증권거래세 0.15% 매도만', () => {
    strictEqual(computeSellTaxKrw(10_000_000, DEFAULT_RATES), 15_000)
    strictEqual(computeSellTaxKrw(999, DEFAULT_RATES), 2) // 1.4985 → 올림 2
    strictEqual(computeSellTaxKrw(0, DEFAULT_RATES), 0)
  })
})

describe('평단가 가중평균 (centi-won 정수)', () => {
  test('1차 매수', () => {
    strictEqual(nextAvgPriceCenti(0, 0, 10, 50_000), 5_000_000) // 50,000.00원
  })

  test('추가 매수 — 소수 평단 발생', () => {
    strictEqual(nextAvgPriceCenti(10, 5_000_000, 10, 50_500), 5_025_000)
    strictEqual(nextAvgPriceCenti(3, 3_333_300, 7, 33_334), 3_333_370)
  })

  test('반올림 half-up', () => {
    strictEqual(nextAvgPriceCenti(1, 101, 1, 102), 5151) // 5150.5 → 5151
    strictEqual(nextAvgPriceCenti(1, 101, 3, 100), 7525) // 7525.25 → 7525
  })

  test('매도는 평단 불변 — 엔진 레벨 확인', () => {
    const exec = executeMarketOrder({
      cashKrw: 100_000_000,
      position: { quantity: 10, avgPriceCenti: 5_000_000 },
      order: order('005930', 'sell', 4, 60_000),
      rates: DEFAULT_RATES,
    })
    deepStrictEqual(exec.positionAfter, { quantity: 6, avgPriceCenti: 5_000_000 })
  })
})

describe('매수 체결', () => {
  test('기본 — 수수료 포함 현금 차감', () => {
    const exec = executeMarketOrder({
      cashKrw: 10_000_000,
      position: null,
      order: order('005930', 'buy', 10, 70_000),
      rates: DEFAULT_RATES,
    })
    strictEqual(exec.grossKrw, 700_000)
    strictEqual(exec.feeKrw, 105)
    strictEqual(exec.taxKrw, 0)
    strictEqual(exec.settlementKrw, -700_105)
    strictEqual(exec.cashAfterKrw, 9_299_895)
    deepStrictEqual(exec.positionAfter, { quantity: 10, avgPriceCenti: 7_000_000 })
    strictEqual(exec.realizedPnlKrw, null)
  })

  test('현금 부족 → insufficient_cash', () => {
    try {
      executeMarketOrder({
        cashKrw: 700_104, // 105원 모자람
        position: null,
        order: order('005930', 'buy', 10, 70_000),
        rates: DEFAULT_RATES,
      })
      fail('unreachable')
    } catch (error) {
      strictEqual((error as EngineError).code, 'insufficient_cash')
    }
  })
})

describe('매도 체결', () => {
  test('기본 — 수수료+거래세 공제, 실현손익', () => {
    const exec = executeMarketOrder({
      cashKrw: 0,
      position: { quantity: 10, avgPriceCenti: 5_000_000 }, // 평단 50,000
      order: order('005930', 'sell', 10, 60_000),
      rates: DEFAULT_RATES,
    })
    strictEqual(exec.grossKrw, 600_000)
    strictEqual(exec.feeKrw, 90)
    strictEqual(exec.taxKrw, 900)
    strictEqual(exec.settlementKrw, 599_010)
    strictEqual(exec.realizedPnlKrw, 99_010)
    strictEqual(exec.cashAfterKrw, 599_010)
    strictEqual(exec.positionAfter.quantity, 0)
    strictEqual(exec.positionAfter.avgPriceCenti, 0)
  })

  test('소수 평단 매도 — basis 반올림', () => {
    // 평단 33,333.70 × 3주 = 100,001.10원 → 반올림 100,001원
    const exec = executeMarketOrder({
      cashKrw: 1_000_000,
      position: { quantity: 3, avgPriceCenti: 3_333_370 },
      order: order('006400', 'sell', 3, 35_000),
      rates: DEFAULT_RATES,
    })
    // gross 105,000 / fee 16 / tax 158 → net 104,826; basis 100,001
    strictEqual(exec.feeKrw, 16)
    strictEqual(exec.taxKrw, 158)
    strictEqual(exec.realizedPnlKrw, 104_826 - 100_001)
  })

  test('보유 초과 매도 → insufficient_quantity', () => {
    try {
      executeMarketOrder({
        cashKrw: 0,
        position: { quantity: 5, avgPriceCenti: 5_000_000 },
        order: order('005930', 'sell', 6, 60_000),
        rates: DEFAULT_RATES,
      })
      fail('unreachable')
    } catch (error) {
      strictEqual((error as EngineError).code, 'insufficient_quantity')
    }
  })
})

describe('입력 검증', () => {
  test('해외 심볼 → invalid_symbol', () => {
    try {
      executeMarketOrder({
        cashKrw: 10_000_000,
        position: null,
        order: order('AAPL', 'buy', 1, 200_000),
        rates: DEFAULT_RATES,
      })
      fail('unreachable')
    } catch (error) {
      strictEqual((error as EngineError).code, 'invalid_symbol')
    }
  })

  test('수량 0/음수/정수아님 → invalid_quantity', () => {
    for (const quantity of [0, -1, 1.5]) {
      try {
        executeMarketOrder({
          cashKrw: 10_000_000,
          position: null,
          order: order('005930', 'buy', quantity, 70_000),
          rates: DEFAULT_RATES,
        })
        fail('unreachable')
      } catch (error) {
        strictEqual((error as EngineError).code, 'invalid_quantity')
      }
    }
  })

  test('가격 0/음수/정수아님/누락 → invalid_price', () => {
    for (const priceKrw of [0, -1, 70_000.5]) {
      try {
        executeMarketOrder({
          cashKrw: 10_000_000,
          position: null,
          order: order('005930', 'buy', 1, priceKrw),
          rates: DEFAULT_RATES,
        })
        fail('unreachable')
      } catch (error) {
        strictEqual((error as EngineError).code, 'invalid_price')
      }
    }
  })
})

describe('매입원본 (자기 데이터만으로 계산)', () => {
  test('basis = 평단×수량, 반올림', () => {
    strictEqual(positionBasisKrw({ quantity: 10, avgPriceCenti: 5_000_000 }), 500_000)
    // 33,333.70 × 3 = 100,001.10 → 100,001
    strictEqual(positionBasisKrw({ quantity: 3, avgPriceCenti: 3_333_370 }), 100_001)
  })
})
