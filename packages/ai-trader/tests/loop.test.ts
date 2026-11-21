// [phase=load] E2E — 실제 Store(:memory:) + 페이크 원장 + 페이크 시세로 상태 적재 검증.
// 원장의 진짜 체결 로직은 paper-trade 패키지 테스트가 보증한다 —
// 여기선 오케스트레이션(계좌 매핑·원장×시세 조합·fresh 파생값)만 검증한다.

import { beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_CHARACTERS } from '../src/characters.ts'
import { Store } from '../src/journal.ts'
import { loadMigrationsSql } from '../src/migrations.ts'
import { ensureAccount, loadTurnContext } from '../src/loop.ts'
import { FakePaper, fakeQuotes } from './helpers.ts'

const schemaSql = loadMigrationsSql()

let store: Store
let paper: FakePaper

beforeEach(() => {
  store = new Store(':memory:', schemaSql)
  store.seedCharacters(DEFAULT_CHARACTERS)
  paper = new FakePaper()
})

describe('ensureAccount — 캐릭터=계좌 1개 부트스트랩', () => {
  test('매핑 없으면 계좌 생성 후 등록(멱등)', async () => {
    const first = await ensureAccount({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    expect(first.paperTradeAccountId).toBeTruthy()
    const second = await ensureAccount({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    expect(second.paperTradeAccountId).toBe(first.paperTradeAccountId)
    expect(paper.createAccountCalls).toEqual(['소심이']) // 중복 생성 없음
  })

  test('존재하지 않는 캐릭터 404', async () => {
    await expect(ensureAccount({ store, paper, quotes: fakeQuotes({}) }, 'ghost')).rejects.toMatchObject({
      code: 'character_not_found',
    })
  })
})

describe('loadTurnContext — 턴 출발 상태 적재', () => {
  test('빈 계좌: 현금 전액·포지션 0·목표 진행률 = 현금/목표', async () => {
    const context = await loadTurnContext({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    expect(context.ledger.cashKrw).toBe(1_000_000)
    expect(context.ledger.positions).toEqual([])
    expect(context.ledger.lastOrderAt).toBeNull()
    expect(context.valuation.equityKrw).toBe(1_000_000)
    expect(context.valuation.cashGoalProgressPct).toBeCloseTo(1_000_000 / 2_300_000, 4)
    expect(context.loadedAt.endsWith('+09:00')).toBe(true) // KST 기록
  })

  test('보유 계좌: 원장×시세 조합 평가·미실현 손익률·lastOrderAt', async () => {
    // 페이크 원장에 직접 포지션·주문 세팅 (load는 원장을 믿는다 — D2)
    const account = await paper.createAccount('소심이', 500_000)
    await paper.placeOrder(account.accountId, {
      symbol: '005930', side: 'buy', quantity: 10, priceKrw: 70_000, name: '삼성전자', market: 'KR',
    })
    store.attachAccount('sosimi', account.accountId)

    const context = await loadTurnContext(
      { store, paper, quotes: fakeQuotes({ '005930': [73_500, 0.01] }) },
      'sosimi',
    )
    expect(context.ledger.positions).toHaveLength(1)
    expect(context.ledger.cashKrw).toBeLessThan(500_000) // 매수 체결 후
    expect(context.ledger.lastOrderAt).toBeTruthy()
    // 평가: 평단 70,000 × 10주, 현재가 73,500 → +5%
    expect(context.valuation.unrealizedPctBySymbol['005930']).toBeCloseTo(0.05, 4)
    expect(context.valuation.positionsValueKrw).toBe(735_000)
    expect(context.valuation.equityKrw).toBe(context.ledger.cashKrw + 735_000)
  })

  test('시세 없는 보유 종목은 평단으로 대체 평가 (equity 보존)', async () => {
    const account = await paper.createAccount('소심이', 500_000)
    await paper.placeOrder(account.accountId, {
      symbol: '005930', side: 'buy', quantity: 10, priceKrw: 70_000, name: '삼성전자', market: 'KR',
    })
    store.attachAccount('sosimi', account.accountId)

    const context = await loadTurnContext({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    expect(context.valuation.positionsValueKrw).toBe(700_000) // 평단 대체
    expect(context.valuation.unrealizedPctBySymbol['005930']).toBeUndefined() // 평가손익 계산 불가 — 생략
  })
})

describe('판단 로그 저장 — 결정은 외부(⑤)에서 전달, 저장만', () => {
  test('buy 판단 + 체결 연결 저장', () => {
    const entry = store.appendJudgment('sosimi', '2026-11-19T18:00:00.000+09:00', {
      decision: 'buy',
      symbol: '093320',
      quantity: 9,
      priceKrw: 31_100,
      reasonCode: 'wedge_breakout',
      fact: { amountKrw: 300_000, debugId: 'ds_xxx', heroScore: 62 },
      rationale: '하강 쐐기 돌파 + 위원회 강세 — 내 원칙 크기로 진입',
      order: { orderId: 'od_1', orderStatus: 'filled' },
    })
    expect(entry.logId).toStartWith('jdg_')
    const journal = store.listJudgments('sosimi', 10)
    expect(journal).toHaveLength(1)
    expect(journal[0]?.fact).toMatchObject({ heroScore: 62 })
    expect(journal[0]?.orderId).toBe('od_1')
  })
})
