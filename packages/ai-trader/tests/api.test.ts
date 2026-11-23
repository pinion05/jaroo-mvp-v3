// API e2e — 실제 node:http 서버를 띄워 fetch로 전 흐름 검증 (#378 Node 전환, paper-trade 블랙박스 하네스 계승).
// v2 C1 정리 후: 부트스트랩·load·판단 로그 저장/조회·원장 패스스루.
// #375/#376: judgments 필드 가드·손상 JSON 행별 강등 검증 포함.

import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.ts'
import { DEFAULT_CHARACTERS } from '../src/characters.ts'
import { Store } from '../src/journal.ts'
import { loadMigrationsSql } from '../src/migrations.ts'
import { FakePaper, fakeQuotes } from './helpers.ts'

const schemaSql = loadMigrationsSql()

let store: Store
let paper: FakePaper
let server: Server
let baseUrl: string

beforeEach(async () => {
  store = new Store(':memory:', schemaSql)
  store.seedCharacters(DEFAULT_CHARACTERS)
  paper = new FakePaper()
  server = createServer(createApp({ store, paper, quotes: fakeQuotes({}) }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
  store.close()
})

type Json = Record<string, any>

async function req(path: string, init?: RequestInit): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${baseUrl}${path}`, init)
  return { status: res.status, json: (await res.json()) as Json }
}

function postJudgment(body: unknown): Promise<{ status: number; json: Json }> {
  return req('/v1/characters/sosimi/judgments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('라우팅 기본', () => {
  test('unknown route 404 / healthz 폐지(paper-trade 관례 계승)', async () => {
    const notFound = await req('/healthz')
    assert.equal(notFound.status, 404)
    assert.equal(notFound.json.error.code, 'not_found')
  })

  test('캐릭터 목록 — v1 소심이 포함 4인 시드 + 자기 원칙 문구', async () => {
    const { status, json } = await req('/v1/characters')
    assert.equal(status, 200)
    assert.equal(json.data.count, 4)
    const sosimi = json.data.items.find((i: any) => i.slug === 'sosimi')
    assert.equal(sosimi.displayName, '소심이')
    assert.ok(sosimi.principles.length > 0) // §5.2 자기 원칙
    assert.equal(sosimi.paperTradeAccountId, null)
  })

  test('존재하지 않는 캐릭터 404', async () => {
    const { status, json } = await req('/v1/characters/ghost/load', { method: 'POST' })
    assert.equal(status, 404)
    assert.equal(json.error.code, 'character_not_found')
  })
})

describe('bootstrap → load → judgments → orders', () => {
  test('부트스트랩 멱등 후 load 상태 적재', async () => {
    await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    await req('/v1/characters/sosimi/bootstrap', { method: 'POST' })
    assert.equal(paper.createAccountCalls.length, 1)

    const load = await req('/v1/characters/sosimi/load', { method: 'POST' })
    assert.equal(load.status, 201)
    assert.equal(load.json.data.ledger.cashKrw, 1_000_000)
    assert.ok(load.json.data.character.accountId)
    assert.match(load.json.data.loadedAt, /\+09:00$/)
  })

  test('판단 로그 저장(⑤ 실행 계층이 전달) → journal 조회', async () => {
    const post = await postJudgment({
      decision: 'sell',
      symbol: '093320',
      quantity: 4,
      priceKrw: 31_100,
      reasonCode: 'thesis_invalidated',
      fact: { sellRatio: 0.5, heroScore: 38 },
      rationale: '위원회 약화와 내 stop 관점이 일치 — 절반 정리',
      order: { orderId: 'od_9', orderStatus: 'filled' },
    })
    assert.equal(post.status, 201)
    assert.equal(post.json.data.orderId, 'od_9')

    const journal = await req('/v1/characters/sosimi/journal')
    assert.equal(journal.json.data.items.length, 1)
    assert.ok(journal.json.data.items[0].rationale.includes('절반 정리'))
  })

  test('판단 로그 검증 — decision·rationale 필수', async () => {
    const bad = await postJudgment({ decision: 'hold' }) // rationale 누락
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid_rationale')
  })

  test('orderStatus 어휘 — placed(구)는 400, filled는 허용', async () => {
    const legacy = await postJudgment({
      decision: 'hold', rationale: '관망', order: { orderStatus: 'placed' },
    })
    assert.equal(legacy.status, 400)
    assert.equal(legacy.json.error.code, 'invalid_order_status')

    const filled = await postJudgment({
      decision: 'hold', rationale: '관망', order: { orderStatus: 'filled' },
    })
    assert.equal(filled.status, 201)
  })

  test('#375 symbol 가드 — 7자리·자유문자열 400, 6자리·null 허용', async () => {
    const seven = await postJudgment({ decision: 'hold', rationale: '관망', symbol: '0123456' })
    assert.equal(seven.status, 400)
    assert.equal(seven.json.error.code, 'invalid_symbol')

    const free = await postJudgment({ decision: 'hold', rationale: '관망', symbol: '<script>무한대</script>' })
    assert.equal(free.status, 400)

    const ok6 = await postJudgment({ decision: 'hold', rationale: '관망', symbol: '093320' })
    assert.equal(ok6.status, 201)
    const okNull = await postJudgment({ decision: 'hold', rationale: '관망', symbol: null })
    assert.equal(okNull.status, 201)
  })

  test('#375 quantity·priceKrw 가드 — 음수·소수·문자열 400', async () => {
    for (const patch of [
      { quantity: -1 }, { quantity: 1.5 }, { quantity: '9' },
      { priceKrw: -100 }, { priceKrw: 3.14 },
    ]) {
      const bad = await postJudgment({ decision: 'buy', rationale: '진입', symbol: '093320', ...patch })
      assert.equal(bad.status, 400, JSON.stringify(patch))
    }
  })

  test('#375 fact 크기 상한 — 8KB 초과 400', async () => {
    const huge = { blob: 'x'.repeat(9 * 1024) }
    const bad = await postJudgment({ decision: 'hold', rationale: '관망', fact: huge })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid_fact_size')
  })

  test('#375 rationale 길이 — 2000자 초과 400 (filled 유실 방지 B-2 메시지)', async () => {
    const bad = await postJudgment({ decision: 'buy', rationale: '가'.repeat(2_001) })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid_rationale')
    assert.ok(bad.json.error.message.includes('filled'))
  })

  test('#376 손상 fact 행 — journal 조회는 살아있고 해당 행만 unparsable 마커', async () => {
    await postJudgment({ decision: 'hold', rationale: '정상 행' })
    await postJudgment({ decision: 'hold', rationale: '손상될 행' })
    // 외부 결함 시나리오 재현 — 직접 SQL로 fact만 깨뜨린다
    store.db.exec(`UPDATE judgment_logs SET fact = '{"broken' WHERE rationale = '손상될 행'`)

    const journal = await req('/v1/characters/sosimi/journal')
    assert.equal(journal.status, 200)
    const items = journal.json.data.items as Array<{ rationale: string; fact: Record<string, unknown> }>
    assert.equal(items.length, 2) // 조회 전체가 브릭되지 않는다
    const broken = items.find((i) => i.rationale === '손상될 행')
    assert.equal(broken?.fact.unparsable, true)
  })

  test('#376 손상 persona_card — 캐릭터 목록은 생존(전역 500 방지), 해당 캐릭터만 강등 카드', async () => {
    store.db.exec(`UPDATE characters SET persona_card = '{broken' WHERE slug = 'sosimi'`)
    const list = await req('/v1/characters')
    assert.equal(list.status, 200)
    assert.equal(list.json.data.count, 4) // 나머지 3인은 무사
    const sosimi = list.json.data.items.find((i: any) => i.slug === 'sosimi')
    assert.ok(String(sosimi.temperament).includes('손상'))
  })

  test('캐릭터 목록 — 소스 페르소나 3인 추가 (chart-cok·news-cok·finance-cok)', async () => {
    const { json } = await req('/v1/characters')
    const slugs = json.data.items.map((i: any) => i.slug)
    assert.deepEqual(slugs, ['chart-cok', 'finance-cok', 'news-cok', 'sosimi']) // slug 오름차순
    const chart = json.data.items.find((i: any) => i.slug === 'chart-cok')
    assert.equal(chart.displayName, '차트콕')
    assert.ok(chart.principles.length >= 3)
    assert.equal(chart.cashGoalKrw, null)
  })

  test('계좌 매핑 전 orders는 빈 목록 + 힌트', async () => {
    const { status, json } = await req('/v1/characters/sosimi/orders')
    assert.equal(status, 200)
    assert.deepEqual(json.data.items, [])
    assert.ok(json.data.hint.includes('bootstrap'))
  })
})
