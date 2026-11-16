// 루프 E2E — 실제 Store(:memory:) + 페이크 원장 + 페이크 시세로 전 흐름 검증.
// 원장의 진짜 체결 로직은 paper-trade 패키지의 27/27 테스트가 보증한다 —
// 여기서는 오케스트레이션(순서·멱등·판단 로그·입증 연결)만 검증한다.

import { beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_CHARACTERS } from '../src/characters.ts'
import { Store } from '../src/journal.ts'
import { ensureAccount, runLoop } from '../src/loop.ts'
import type { PaperGateway } from '../src/papertrade.ts'
import { FakePaper, fakeQuotes } from './helpers.ts'

const schemaSql = await Bun.file(new URL('../migrations/0001_init.sql', import.meta.url)).text()

let store: Store
let paper: FakePaper
const nowStep = { ms: Date.parse('2026-11-16T10:00:00+09:00') }

beforeEach(() => {
  store = new Store(':memory:', schemaSql)
  store.seedCharacters(DEFAULT_CHARACTERS)
  paper = new FakePaper()
  nowStep.ms = Date.parse('2026-11-16T10:00:00+09:00')
})

const now = () => nowStep.ms

describe('ensureAccount — 캐릭터=계좌 1개 부트스트랩', () => {
  test('매핑 없으면 계좌 생성 후 등록(멱등)', async () => {
    const first = await ensureAccount({ store, paper, quotes: fakeQuotes({}), now }, 'sosimi')
    expect(first.paperTradeAccountId).toBeTruthy()
    const second = await ensureAccount({ store, paper, quotes: fakeQuotes({}), now }, 'sosimi')
    expect(second.paperTradeAccountId).toBe(first.paperTradeAccountId)
    expect(paper.createAccountCalls).toEqual(['소심이']) // 중복 생성 없음
  })

  test('존재하지 않는 캐릭터 404', async () => {
    await expect(ensureAccount({ store, paper, quotes: fakeQuotes({}), now }, 'ghost')).rejects.toMatchObject({
      code: 'character_not_found',
    })
  })
})

describe('runLoop — 매매 루프 전 흐름', () => {
  test('dip 매수 → 원장 적체 + 판단 로그(placed) + 입증 연결', async () => {
    const deps = { store, paper, quotes: fakeQuotes({ '005930': [70_000, -0.035], '000660': [180_000, 0.01] }), now }
    const result = await runLoop(deps, 'sosimi')

    // 원장: 005930 dip 매수 1건만 체결 (000660은 상승 중 no_signal)
    const orders = await paper.listOrders(result.character.accountId)
    expect(orders.items).toHaveLength(1)
    expect(orders.items[0]?.symbol).toBe('005930')
    expect(orders.items[0]?.side).toBe('buy')
    expect(orders.items[0]?.name).toBe('삼성전자') // watchlist 이름 동봉

    // 판단 로그: 매수 placed + 관망 skipped 전부 기록 (000660 상승 no_signal, 나머지 3종목 시세 없음 quote_missing)
    const placed = result.decisions.filter((d) => d.orderStatus === 'placed')
    const skipped = result.decisions.filter((d) => d.orderStatus === 'skipped')
    expect(placed).toHaveLength(1)
    expect(placed[0]?.orderId).toBe(orders.items[0]?.orderId) // 입증 연결
    expect(placed[0]?.rationale).toContain('무섭지만') // 페르소나 목소리(buy 음성)
    expect(skipped.map((s) => s.reasonCode)).toEqual(['no_signal', 'quote_missing', 'quote_missing', 'quote_missing'])
  })

  test('2회차 — 빈도 게이트(주간)로 매수 보류, 손절은 통과', async () => {
    const deps = { store, paper, quotes: fakeQuotes({ '005930': [70_000, -0.035] }), now }
    const first = await runLoop(deps, 'sosimi')
    expect(first.decisions.some((d) => d.orderStatus === 'placed')).toBe(true)

    // 30분 후 같은 종목 급락 → 매수는 빈도 게이트, 보유물량 손절은 실행
    nowStep.ms += 30 * 60 * 1000
    const second = await runLoop({ ...deps, quotes: fakeQuotes({ '005930': [64_000, -0.1] }) }, 'sosimi')

    const sell = second.decisions.find((d) => d.decision === 'sell')
    expect(sell?.reasonCode).toBe('stop_loss')
    expect(sell?.orderStatus).toBe('placed')
    const gate = second.decisions.find((d) => d.reasonCode === 'frequency_gate')
    expect(gate?.orderStatus).toBe('skipped')
  })

  test('주문 실패 시 failed 판단 로그 — 원장 미적체', async () => {
    // 클래스 인스턴스 spread는 프로토타입 메서드를 복사하지 않으므로 명시 위임
    const failing: PaperGateway = {
      createAccount: (name, cash) => paper.createAccount(name, cash),
      getAccount: (id) => paper.getAccount(id),
      listPositions: (id) => paper.listPositions(id),
      listOrders: (id) => paper.listOrders(id),
      placeOrder: async () => {
        throw new Error('insufficient cash')
      },
    }
    const deps = { store, paper: failing, quotes: fakeQuotes({ '005930': [70_000, -0.035] }), now }
    const result = await runLoop(deps, 'sosimi')

    const failed = result.decisions.find((d) => d.orderStatus === 'failed')
    expect(failed?.errorMessage).toBe('insufficient cash')
    const orders = await paper.listOrders(result.character.accountId) // 실제 원장은 그대로
    expect(orders.items).toHaveLength(0)
  })

  test('판단 로그 저널 저장 — 최신순 조회, KST 기록', async () => {
    const deps = { store, paper, quotes: fakeQuotes({ '005930': [70_000, -0.035] }), now }
    const result = await runLoop(deps, 'sosimi')
    const journal = store.listJudgments('sosimi', 10)
    expect(journal.map((j) => j.logId).sort()).toEqual(result.decisions.map((d) => d.logId).sort())
    expect(journal.every((j) => j.characterSlug === 'sosimi')).toBe(true)
    expect(journal.every((j) => j.loopAt.endsWith('+09:00'))).toBe(true)
  })

  test('시세 조회 실패가 아니라 quote_missing 관망으로 소화', async () => {
    // watchlist 전 종목 시세 누락 → 전부 quote_missing hold (루프는 죽지 않음)
    const deps = { store, paper, quotes: fakeQuotes({}), now }
    const result = await runLoop(deps, 'sosimi')
    expect(result.decisions.every((d) => d.orderStatus === 'skipped')).toBe(true)
    expect(result.decisions.every((d) => d.reasonCode === 'quote_missing')).toBe(true)
  })
})
