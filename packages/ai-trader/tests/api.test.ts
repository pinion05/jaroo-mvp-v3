// API e2e — app.request() 로 서버 없이 전 흐름 검증 (paper-trade 계승).
// v2 C1 정리 후: 부트스트랩·load·판단 로그 저장/조회·원장 패스스루.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import { DEFAULT_CHARACTERS } from '../src/characters.ts'
import { Store } from '../src/journal.ts'
import { FakePaper, fakeQuotes } from './helpers.ts'

const schemaSql = await Bun.file(new URL('../migrations/0001_init.sql', import.meta.url)).text()

let store: Store
let paper: FakePaper
let app: ReturnType<typeof createApp>

beforeEach(() => {
  store = new Store(':memory:', schemaSql)
  store.seedCharacters(DEFAULT_CHARACTERS)
  paper = new FakePaper()
  app = createApp({ store, paper, quotes: fakeQuotes({}) })
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

  test('캐릭터 목록 — 소심이 1명 시드 + 자기 원칙 문구', async () => {
    const { status, json } = await req('/v1/characters')
    expect(status).toBe(200)
    expect(json.data.items).toHaveLength(1)
    expect(json.data.items[0].slug).toBe('sosimi')
    expect(json.data.items[0].principles.length).toBeGreaterThan(0) // §5.2 자기 원칙
    expect(json.data.items[0].paperTradeAccountId).toBeNull()
  })

  test('존재하지 않는 캐릭터 404', async () => {
    const { status, json } = await req('/v1/characters/ghost/load', { method: 'POST' })
    expect(status).toBe(404)
    expect(json.error.code).toBe('character_not_found')
  })
})

describe('bootstrap → load → judgments → orders', () => {
  test('부트스트랩 멱등 후 load 상태 적재', async () => {
    await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    expect(paper.createAccountCalls).toHaveLength(1)

    const load = await req('/v1/characters/sosimi/load', { method: 'POST' })
    expect(load.status).toBe(201)
    expect(load.json.data.ledger.cashKrw).toBe(1_000_000)
    expect(load.json.data.character.accountId).toBeTruthy()
    expect(load.json.data.loadedAt).toMatch(/\+09:00$/)
  })

  test('판단 로그 저장(⑤ 실행 계층이 전달) → journal 조회', async () => {
    const post = await req('/v1/characters/sosimi/judgments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision: 'sell',
        symbol: '093320',
        quantity: 4,
        priceKrw: 31_100,
        reasonCode: 'thesis_invalidated',
        fact: { sellRatio: 0.5, heroScore: 38 },
        rationale: '위원회 약화와 내 stop 관점이 일치 — 절반 정리',
        order: { orderId: 'od_9', orderStatus: 'placed' },
      }),
    })
    expect(post.status).toBe(201)
    expect(post.json.data.orderId).toBe('od_9')

    const journal = await req('/v1/characters/sosimi/journal')
    expect(journal.json.data.items).toHaveLength(1)
    expect(journal.json.data.items[0].rationale).toContain('절반 정리')
  })

  test('판단 로그 검증 — decision·rationale 필수', async () => {
    const bad = await req('/v1/characters/sosimi/judgments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'hold' }), // rationale 누락
    })
    expect(bad.status).toBe(400)
    expect(bad.json.error.code).toBe('invalid_rationale')
  })

  test('계좌 매핑 전 orders는 빈 목록 + 힌트', async () => {
    const { status, json } = await req('/v1/characters/sosimi/orders')
    expect(status).toBe(200)
    expect(json.data.items).toEqual([])
    expect(json.data.hint).toContain('bootstrap')
  })
})
