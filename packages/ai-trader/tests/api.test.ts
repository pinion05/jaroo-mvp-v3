// API e2e — app.request() 로 서버 없이 전 흐름 검증 (paper-trade 계승).
// FakePaper/페이크 시세 주입으로 외부 의존 0.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import { DEFAULT_CHARACTERS } from '../src/characters.ts'
import { Store } from '../src/journal.ts'
import { FakePaper, fakeQuotes, type NowStep } from './helpers.ts'

const schemaSql = await Bun.file(new URL('../migrations/0001_init.sql', import.meta.url)).text()

let store: Store
let paper: FakePaper
let app: ReturnType<typeof createApp>
const nowStep: NowStep = { ms: Date.parse('2026-11-16T10:00:00+09:00') }

beforeEach(() => {
  store = new Store(':memory:', schemaSql)
  store.seedCharacters(DEFAULT_CHARACTERS)
  paper = new FakePaper()
  app = createApp({ store, paper, quotes: fakeQuotes({}), now: () => nowStep.ms })
})

type Json = Record<string, any>

async function req(path: string, init?: RequestInit): Promise<{ status: number; json: Json }> {
  const res = await app.request(path, init)
  return { status: res.status, json: (await res.json()) as Json }
}

describe('라우팅 기본', () => {
  test('unknown route 404 / healthz 폐지(paper-trade 관례 계승)', async () => {
    const notFound = await req('/healthz')
    expect(notFound.status).toBe(404)
    expect(notFound.json.error.code).toBe('not_found')
  })

  test('캐릭터 목록 — 소심이 1명 시드', async () => {
    const { status, json } = await req('/v1/characters')
    expect(status).toBe(200)
    expect(json.data.items).toHaveLength(1)
    expect(json.data.items[0].slug).toBe('sosimi')
    expect(json.data.items[0].narrativeGoal).toContain('여행자금')
    expect(json.data.items[0].paperTradeAccountId).toBeNull() // bootstrap 전
  })

  test('존재하지 않는 캐릭터 404', async () => {
    const { status, json } = await req('/v1/characters/ghost/loop', { method: 'POST' })
    expect(status).toBe(404)
    expect(json.error.code).toBe('character_not_found')
  })
})

describe('bootstrap / loop / journal / orders', () => {
  test('bootstrap → loop → journal → orders 전 흐름', async () => {
    // ① bootstrap — 계좌 생성·매핑
    const boot = await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    expect(boot.status).toBe(200)
    const accountId: string = boot.json.data.accountId
    expect(accountId).toBeTruthy()
    expect(paper.createAccountCalls).toEqual(['소심이'])

    // ② loop — dip 매수 1건 + 관망 기록
    app = createApp({
      store,
      paper,
      quotes: fakeQuotes({ '005930': [70_000, -0.035], '000660': [180_000, 0.01] }),
      now: () => nowStep.ms,
    })
    const loop = await req('/v1/characters/sosimi/loop', { method: 'POST' })
    expect(loop.status).toBe(201)
    expect(loop.json.data.decisions.some((d: Json) => d.orderStatus === 'placed')).toBe(true)
    expect(loop.json.data.decisions.some((d: Json) => d.orderStatus === 'skipped')).toBe(true)

    // ③ journal — 판단 로그 최신순
    const journal = await req('/v1/characters/sosimi/journal')
    expect(journal.status).toBe(200)
    expect(journal.json.data.items.length).toBeGreaterThanOrEqual(2)
    expect(journal.json.data.items[0].rationale).toBeTruthy()

    // ④ orders — 원장 입증 패스스루
    const orders = await req('/v1/characters/sosimi/orders')
    expect(orders.status).toBe(200)
    expect(orders.json.data.items).toHaveLength(1)
    expect(orders.json.data.items[0].symbol).toBe('005930')
    expect(orders.json.data.items[0].name).toBe('삼성전자')
  })

  test('bootstrap 멱등 — 재호출해도 계좌 추가 생성 없음', async () => {
    await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    expect(paper.createAccountCalls).toHaveLength(1)
  })

  test('계좌 매핑 전 orders는 빈 목록 + 힌트', async () => {
    const { status, json } = await req('/v1/characters/sosimi/orders')
    expect(status).toBe(200)
    expect(json.data.items).toEqual([])
    expect(json.data.hint).toContain('bootstrap')
  })

  test('journal limit 검증 — 초과값은 50으로 정규화', async () => {
    const { json } = await req('/v1/characters/sosimi/journal?limit=9999')
    expect(json.data.items).toEqual([])
  })
})
