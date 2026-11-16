// 규칙 엔진 순수 함수 테스트 — I/O 없음, 결정론 검증 포함.

import { describe, expect, test } from 'bun:test'
import { equityKrw, hoursSinceLastOrder, synthesizeDecisions } from '../src/strategy.ts'
import type { PortfolioSnapshot, Quote, StrategyParams, WatchItem } from '../src/domain.ts'

const PARAMS: StrategyParams = {
  maxPositionPct: 0.1,
  maxDrawdownPct: 0.05,
  takeProfitPct: 0.08,
  maxSymbols: 5,
  tradeFrequency: 'weekly',
  buyDipPct: -0.03,
}

const WATCHLIST: WatchItem[] = [
  { symbol: '005930', name: '삼성전자' },
  { symbol: '000660', name: 'SK하이닉스' },
]

const NOW = Date.parse('2026-11-16T10:00:00+09:00')

function quoteMap(quotes: Record<string, [number, number | null]>): Map<string, Quote> {
  return new Map(
    Object.entries(quotes).map(([symbol, [priceKrw, changePct]]) => [symbol, { symbol, priceKrw, changePct }] as const),
  )
}

function snapshot(over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return { cashKrw: 1_000_000, positions: [], lastOrderAt: null, ...over }
}

describe('equityKrw / hoursSinceLastOrder', () => {
  test('총자산 = 현금 + Σ(수량×시세), 시세 없으면 평단 대체', () => {
    const snap = snapshot({
      cashKrw: 500_000,
      positions: [
        { symbol: '005930', name: null, quantity: 10, avgPriceKrw: 70_000 },
        { symbol: '000660', name: null, quantity: 5, avgPriceKrw: 180_000 },
      ],
    })
    const quotes = quoteMap({ '005930': [80_000, null] }) // 000660 시세 없음 → 평단
    expect(equityKrw(snap, quotes)).toBe(500_000 + 10 * 80_000 + 5 * 180_000)
  })

  test('마지막 체결 후 경과 시간 — 없으면 null', () => {
    expect(hoursSinceLastOrder(snapshot(), NOW)).toBeNull()
    const hours = hoursSinceLastOrder(snapshot({ lastOrderAt: '2026-11-15T10:00:00+09:00' }), NOW)
    expect(hours).toBeCloseTo(24, 1)
  })
})

describe('위험 관리 매도', () => {
  test('손절 — 평단 대비 -maxDrawdownPct 도달 시 전량 매도', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ positions: [{ symbol: '005930', name: null, quantity: 10, avgPriceKrw: 100_000 }] }),
      quotes: quoteMap({ '005930': [94_000, null] }), // -6% ≤ -5%
      nowMs: NOW,
    })
    const sell = decisions.find((d) => d.kind === 'sell')
    expect(sell?.symbol).toBe('005930')
    expect(sell?.reasonCode).toBe('stop_loss')
    expect(sell?.quantity).toBe(10)
    expect(sell?.fact.returnPct).toBeCloseTo(-0.06, 4)
  })

  test('익절 — +takeProfitPct 도달 시 전량 매도', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ positions: [{ symbol: '005930', name: null, quantity: 7, avgPriceKrw: 100_000 }] }),
      quotes: quoteMap({ '005930': [109_000, null] }), // +9% ≥ +8%
      nowMs: NOW,
    })
    expect(decisions.find((d) => d.kind === 'sell')?.reasonCode).toBe('take_profit')
  })

  test('밴드 내 보유는 판단 기록 없음', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: [],
      snapshot: snapshot({ positions: [{ symbol: '005930', name: null, quantity: 3, avgPriceKrw: 100_000 }] }),
      quotes: quoteMap({ '005930': [102_000, null] }),
      nowMs: NOW,
    })
    expect(decisions.filter((d) => d.symbol === '005930')).toEqual([])
  })

  test('시세 없는 보유 종목은 quote_missing 관망', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: [],
      snapshot: snapshot({ positions: [{ symbol: '005930', name: null, quantity: 3, avgPriceKrw: 100_000 }] }),
      quotes: new Map(),
      nowMs: NOW,
    })
    const hold = decisions.find((d) => d.symbol === '005930')
    expect(hold?.kind).toBe('hold')
    expect(hold?.reasonCode).toBe('quote_missing')
  })
})

describe('빈도 게이트', () => {
  test('마지막 체결로부터 창(주간=168h) 미경과 시 매수 없음 — 관망 1건', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ lastOrderAt: '2026-11-16T09:00:00+09:00' }), // 1시간 전
      quotes: quoteMap({ '005930': [70_000, -0.05] }),
      nowMs: NOW,
    })
    expect(decisions.some((d) => d.kind === 'buy')).toBe(false)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.reasonCode).toBe('frequency_gate')
  })

  test('빈도 게이트는 손절을 막지 않는다', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: {
        cashKrw: 1_000_000,
        positions: [{ symbol: '005930', name: null, quantity: 10, avgPriceKrw: 100_000 }],
        lastOrderAt: '2026-11-16T09:00:00+09:00', // 1시간 전 — 게이트 활성
      },
      quotes: quoteMap({ '005930': [90_000, null] }), // -10% 손절
      nowMs: NOW,
    })
    expect(decisions.find((d) => d.kind === 'sell')?.reasonCode).toBe('stop_loss')
  })

  test('창 경과(주간) 후 매수 허용', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ lastOrderAt: '2026-11-01T10:00:00+09:00' }), // 15일 전
      quotes: quoteMap({ '005930': [70_000, -0.05] }),
      nowMs: NOW,
    })
    expect(decisions.some((d) => d.kind === 'buy')).toBe(true)
  })
})

describe('배분 매수', () => {
  test('dip 조건 충족 — 종목당 한도 = 총자산×maxPositionPct', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ cashKrw: 2_000_000 }), // 한도 20만원 — 두 종목 모두 1주 이상 가능
      quotes: quoteMap({ '005930': [70_000, -0.035], '000660': [180_000, -0.04] }), // 둘 다 -3% 이하
      nowMs: NOW,
    })
    const buys = decisions.filter((d) => d.kind === 'buy')
    expect(buys.map((b) => b.symbol)).toEqual(['005930', '000660']) // watchlist 순서
    expect(buys.every((b) => b.reasonCode === 'dip_buy')).toBe(true)
    expect(buys[0]?.quantity).toBe(Math.floor(200_000 / 70_000)) // 총자산 200만 × 10% = 20만
    expect(buys[1]?.quantity).toBe(Math.floor(200_000 / 180_000))
  })

  test('등락률 미제공(null)이면 dip 게이트 생략 — allocation_buy', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ cashKrw: 1_000_000 }),
      quotes: quoteMap({ '005930': [70_000, null] }),
      nowMs: NOW,
    })
    const buy = decisions.find((d) => d.kind === 'buy')
    expect(buy?.reasonCode).toBe('allocation_buy')
  })

  test('dip 미충족(상승 중)은 no_signal 관망', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ cashKrw: 1_000_000 }),
      quotes: quoteMap({ '005930': [70_000, 0.01], '000660': [180_000, 0.02] }),
      nowMs: NOW,
    })
    expect(decisions.some((d) => d.kind === 'buy')).toBe(false)
    expect(decisions.every((d) => d.reasonCode === 'no_signal')).toBe(true)
  })

  test('종목당 한도 < 주가 → cap_below_minimum 관망, 순회는 유지', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: [
        { symbol: '035420', name: 'NAVER' }, // 34만원 — 한도 10만원으로 1주 불가
        { symbol: '005930', name: '삼성전자' }, // 뒤 순서 종목은 계속 평가돼야 함
      ],
      snapshot: snapshot({ cashKrw: 1_000_000 }),
      quotes: quoteMap({ '035420': [340_000, -0.04], '005930': [70_000, -0.04] }),
      nowMs: NOW,
    })
    const capBelow = decisions.find((d) => d.reasonCode === 'cap_below_minimum')
    expect(capBelow?.symbol).toBe('035420')
    expect(capBelow?.fact.targetAmountKrw).toBe(100_000)
    expect(decisions.find((d) => d.kind === 'buy')?.symbol).toBe('005930') // 순회 유지
  })

  test('현금 소진 시 insufficient_cash 관망 후 중단', () => {
    const decisions = synthesizeDecisions({
      params: { ...PARAMS, maxPositionPct: 1.0 }, // 한도 부족과 현금 부족을 분리해 현금 케이스만 격리
      watchlist: [
        { symbol: '005930', name: '삼성전자' }, // 1주 매수 후 현금 ~19,860원
        { symbol: '000660', name: 'SK하이닉스' }, // 2만원 — 한도는 충분, 현금 부족
      ],
      snapshot: snapshot({ cashKrw: 90_000 }),
      quotes: quoteMap({ '005930': [70_000, null], '000660': [20_000, null] }),
      nowMs: NOW,
    })
    expect(decisions.some((d) => d.kind === 'buy')).toBe(true)
    const insufficient = decisions.find((d) => d.reasonCode === 'insufficient_cash')
    expect(insufficient?.symbol).toBe('000660')
    // 중단: insufficient_cash 이후 종목은 평가되지 않는다 (관망 1건으로 끝)
    expect(decisions).toHaveLength(2)
  })

  test('보유 종목 수 상한 — position_cap 관망', () => {
    const positions = Array.from({ length: 5 }, (_, i) => ({
      symbol: `00000${i + 1}`,
      name: null,
      quantity: 1,
      avgPriceKrw: 10_000,
    }))
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ positions }),
      quotes: quoteMap({ '005930': [70_000, null] }),
      nowMs: NOW,
    })
    expect(decisions.some((d) => d.kind === 'buy')).toBe(false)
    expect(decisions.find((d) => d.reasonCode === 'position_cap')).toBeDefined()
  })

  test('이미 보유한 종목은 재매수 후보에서 제외', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({
        cashKrw: 2_000_000,
        positions: [{ symbol: '005930', name: null, quantity: 1, avgPriceKrw: 70_000 }],
      }),
      quotes: quoteMap({ '005930': [70_000, null], '000660': [180_000, null] }),
      nowMs: NOW,
    })
    const buys = decisions.filter((d) => d.kind === 'buy').map((b) => b.symbol)
    expect(buys).toEqual(['000660'])
  })

  test('매수 예산 로컬 차감 — 현금을 초과하는 연속 매수 없음', () => {
    const decisions = synthesizeDecisions({
      params: { ...PARAMS, maxPositionPct: 1.0 }, // 예산 제어 격리 — 현금 차감만 검증
      watchlist: WATCHLIST, // 005930=7만, 000660=18만
      snapshot: snapshot({ cashKrw: 150_000 }), // 첫 종목(2주=140,280원) 후 잔여 ~9,720원 → 둘째(18만원) 불가
      quotes: quoteMap({ '005930': [70_000, null], '000660': [100_000, null] }),
      nowMs: NOW,
    })
    const buys = decisions.filter((d) => d.kind === 'buy')
    expect(buys).toHaveLength(1)
    expect(buys[0]?.symbol).toBe('005930')
    expect(buys[0]?.quantity).toBe(2)
    expect(decisions.find((d) => d.reasonCode === 'insufficient_cash')).toBeDefined()
  })
})

describe('결정론', () => {
  test('같은 입력 → 같은 출력 (배열 순서 포함)', () => {
    const input = {
      params: PARAMS,
      watchlist: WATCHLIST,
      snapshot: snapshot({ cashKrw: 500_000 }),
      quotes: quoteMap({ '005930': [70_000, -0.04], '000660': [180_000, 0.01] }),
      nowMs: NOW,
    }
    expect(synthesizeDecisions(input)).toEqual(synthesizeDecisions(input))
  })

  test('아무 신호 없으면 관망 1건 (symbol=null)', () => {
    const decisions = synthesizeDecisions({
      params: PARAMS,
      watchlist: [],
      snapshot: snapshot({ positions: [{ symbol: '005930', name: null, quantity: 1, avgPriceKrw: 70_000 }] }),
      quotes: quoteMap({ '005930': [71_000, null] }),
      nowMs: NOW,
    })
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.kind).toBe('hold')
    expect(decisions[0]?.symbol).toBeNull()
    expect(decisions[0]?.reasonCode).toBe('no_signal')
  })
})
