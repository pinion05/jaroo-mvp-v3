// [phase=load] E2E — 실제 Store(:memory:) + 페이크 원장 + 페이크 시세로 상태 적재 검증.
// 원장의 진짜 체결 로직은 paper-trade 패키지 테스트가 보증한다 —
// 여기선 오케스트레이션(계좌 매핑·원장×시세 조합·fresh 파생값)만 검증한다.
// #378 Node 전환: bun:test → node:test + node:assert/strict.

import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
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
    assert.ok(first.paperTradeAccountId)
    const second = await ensureAccount({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    assert.equal(second.paperTradeAccountId, first.paperTradeAccountId)
    assert.deepEqual(paper.createAccountCalls, ['소심이']) // 중복 생성 없음
  })

  test('존재하지 않는 캐릭터 404', async () => {
    await assert.rejects(
      ensureAccount({ store, paper, quotes: fakeQuotes({}) }, 'ghost'),
      (error: unknown) => (error as { code?: string }).code === 'character_not_found',
    )
  })
})

describe('loadTurnContext — 턴 출발 상태 적재', () => {
  test('빈 계좌: 현금 전액·포지션 0·목표 진행률 = 현금/목표', async () => {
    const context = await loadTurnContext({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    assert.equal(context.ledger.cashKrw, 1_000_000)
    assert.deepEqual(context.ledger.positions, [])
    assert.equal(context.ledger.lastOrderAt, null)
    assert.equal(context.valuation.equityKrw, 1_000_000)
    assert.ok(Math.abs((context.valuation.cashGoalProgressPct ?? 0) - 1_000_000 / 2_300_000) < 0.00005)
    assert.ok(context.loadedAt.endsWith('+09:00')) // KST 기록
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
    assert.equal(context.ledger.positions.length, 1)
    assert.ok(context.ledger.cashKrw < 500_000) // 매수 체결 후
    assert.ok(context.ledger.lastOrderAt)
    // 평가: 평단 70,000 × 10주, 현재가 73,500 → +5%
    assert.ok(Math.abs((context.valuation.unrealizedPctBySymbol['005930'] ?? 0) - 0.05) < 0.00005)
    assert.equal(context.valuation.positionsValueKrw, 735_000)
    assert.equal(context.valuation.equityKrw, context.ledger.cashKrw + 735_000)
  })

  test('시세 없는 보유 종목은 평단으로 대체 평가 (equity 보존)', async () => {
    const account = await paper.createAccount('소심이', 500_000)
    await paper.placeOrder(account.accountId, {
      symbol: '005930', side: 'buy', quantity: 10, priceKrw: 70_000, name: '삼성전자', market: 'KR',
    })
    store.attachAccount('sosimi', account.accountId)

    const context = await loadTurnContext({ store, paper, quotes: fakeQuotes({}) }, 'sosimi')
    assert.equal(context.valuation.positionsValueKrw, 700_000) // 평단 대체
    assert.equal(context.valuation.unrealizedPctBySymbol['005930'], undefined) // 평가손익 계산 불가 — 생략
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
    assert.ok(entry.logId.startsWith('jdg_'))
    const journal = store.listJudgments('sosimi', 10)
    assert.equal(journal.length, 1)
    assert.equal(journal[0]?.fact.heroScore, 62)
    assert.equal(journal[0]?.orderId, 'od_1')
  })
})
