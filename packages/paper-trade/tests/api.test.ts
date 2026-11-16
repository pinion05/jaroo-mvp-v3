// API e2e — 실제 node:http 서버(127.0.0.1 임시 포트)를 띄워 fetch로 전 흐름 검증.
// 시세 개념 없음: 모든 체결가는 요청 body의 priceKrw.

import { after, afterEach, beforeEach, describe, test } from 'node:test'
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.ts'
import { DEFAULT_RATES } from '../src/engine.ts'
import { Store } from '../src/store.ts'

const schemaSql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')

let store: Store
let server: Server
let port: number

// 재시작 정합성 테스트용 파일 DB 디렉터리 — after(파일 전체 후크)에서 정리.
// (Node 22의 node:test에는 afterAll이 없다 — 23.2+ 추가. after가 동일 역할.)
const tmpDir = mkdtempSync(join(tmpdir(), 'paper-trade-api-test-'))
after(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** Store→앱→서버를 127.0.0.1의 임시 포트로 띄운다. */
async function startServer(s: Store): Promise<{ server: Server; port: number }> {
  const sv = createServer(createApp({ store: s, rates: DEFAULT_RATES }))
  await new Promise<void>((resolve) => sv.listen(0, '127.0.0.1', resolve))
  return { server: sv, port: (sv.address() as AddressInfo).port }
}

/** server.close 완료 대기. fetch(undici)의 keep-alive 소켓이 남아 close 콜백을
 *  지연시키지 않도록 closeAllConnections로 열린 커넥션을 정리한다. */
async function stopServer(sv: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    sv.close((error) => (error ? reject(error) : resolve()))
    sv.closeAllConnections()
  })
}

beforeEach(async () => {
  store = new Store(':memory:', schemaSql)
  const started = await startServer(store)
  server = started.server
  port = started.port
})

afterEach(async () => {
  await stopServer(server)
  store.close()
})

type Json = Record<string, any>

async function request(targetPort: number, path: string, init?: RequestInit): Promise<{ status: number; json: Json }> {
  const res = await fetch(`http://127.0.0.1:${targetPort}${path}`, init)
  return { status: res.status, json: (await res.json()) as Json }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Json }> {
  return request(port, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function get(path: string): Promise<{ status: number; json: Json }> {
  return request(port, path)
}

describe('healthz 폐지 회귀', () => {
  test('healthz 라우트 없음 — 404', async () => {
    const { status, json } = await get('/healthz')
    strictEqual(status, 404)
    strictEqual(json.error.code, 'not_found')
  })
})

describe('타임스탬프 — 한국 표준시(KST) 기록', () => {
  test('체결·원장·계좌 생성 시각이 KST(+09:00) ISO8601', async () => {
    const before = Date.now()
    const accountId = (await post('/v1/accounts', { name: '시간이', initialCashKrw: 1_000_000 })).json.data.accountId
    const buy = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'buy', quantity: 1, priceKrw: 70_000,
    })
    const after = Date.now()

    // 1) 형식: +09:00 오프셋 포함 (Z(UTC) 아니어야 함)
    const at: string = buy.json.data.at
    match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/)
    strictEqual(at.endsWith('Z'), false)

    // 2) 오프셋 정합성: +09:00 을 달았으면 실제 epoch과 일치해야 함
    //    (UTC 벽시각에 +09:00만 붙인 잘못된 값이면 9시간 어긋나서 걸림)
    const epoch = Date.parse(at)
    ok(epoch >= before - 1_000)
    ok(epoch <= after + 1_000)

    // 3) 벽시각이 서울 시간과 일치 (분 단위)
    const seoulWall = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', hour12: false,
    }).format(new Date(epoch)) // "2026-11-10 17:03:54"
    strictEqual(at.startsWith(seoulWall.slice(0, 16).replace(' ', 'T')), true)

    // 원장·계좌도 같은 형식
    const ledger = await get(`/v1/accounts/${accountId}/ledger`)
    match(ledger.json.data.items[0].at, /\+09:00$/)
  })
})

describe('계좌', () => {
  test('생성/조회/목록', async () => {
    const created = await post('/v1/accounts', { name: '소심이', initialCashKrw: 10_000_000 })
    strictEqual(created.status, 201)
    strictEqual(created.json.data.name, '소심이')
    strictEqual(created.json.data.cashKrw, 10_000_000)
    const accountId: string = created.json.data.accountId

    const summary = await get(`/v1/accounts/${accountId}`)
    strictEqual(summary.status, 200)
    strictEqual(summary.json.data.investedBasisKrw, 0)
    strictEqual(summary.json.data.positionCount, 0)

    const list = await get('/v1/accounts')
    strictEqual(list.json.data.length, 1)
  })

  test('잘못된 생성 요청 400', async () => {
    strictEqual((await post('/v1/accounts', { name: '' })).status, 400)
    strictEqual((await post('/v1/accounts', { name: 'x', initialCashKrw: -1 })).status, 400)
    strictEqual((await post('/v1/accounts', { name: 'x', initialCashKrw: 1.5 })).status, 400)
  })

  test('없는 계좌 404', async () => {
    const { status, json } = await get('/v1/accounts/ac_none')
    strictEqual(status, 404)
    strictEqual(json.error.code, 'account_not_found')
  })
})

describe('매매 사이클 — caller가 가격을 제시', () => {
  test('전체 흐름: 매수→포지션→매도→실현손익→원장', async () => {
    const accountId = (await post('/v1/accounts', { name: '소심이', initialCashKrw: 10_000_000 })).json.data.accountId

    // 1) 매수 10주 — caller가 70,000원 제시
    const buy = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'buy', quantity: 10, priceKrw: 70_000,
      name: '삼성전자', market: 'KOSPI',
    })
    strictEqual(buy.status, 201)
    strictEqual(buy.json.data.executedPriceKrw, 70_000)
    strictEqual(buy.json.data.feeKrw, 105)
    strictEqual(buy.json.data.cashAfterKrw, 10_000_000 - 700_105)
    deepStrictEqual(buy.json.data.positionAfter, { quantity: 10, avgPriceCenti: 7_000_000 })

    // 2) 다른 가격 추가 매수 — 평단 변화 (10주@70,000 + 10주@70,500 → 70,250)
    const buy2 = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'buy', quantity: 10, priceKrw: 70_500,
    })
    deepStrictEqual(buy2.json.data.positionAfter, { quantity: 20, avgPriceCenti: 7_025_000 })

    // 3) 포지션 — 시세 없음, 자기 데이터만
    const positions = await get(`/v1/accounts/${accountId}/positions`)
    strictEqual(positions.json.data.items.length, 1)
    const position = positions.json.data.items[0]
    strictEqual(position.quantity, 20)
    strictEqual(position.avgPriceKrw, 70_250)
    strictEqual(position.basisKrw, 1_405_000)
    strictEqual(position.currentPriceKrw, undefined) // 시세 노출 없음
    strictEqual(position.pnlKrw, undefined)

    // 4) 계좌 요약 — 원본/실현 누계
    const summary = await get(`/v1/accounts/${accountId}`)
    strictEqual(summary.json.data.investedBasisKrw, 1_405_000)
    strictEqual(summary.json.data.realizedPnlTotalKrw, 0)
    strictEqual(summary.json.data.feeTotalKrw, 211) // 105 + 106

    // 5) 매도 5주 @70,000 — 평단 70,250보다 낮아 실현 손실
    const sell = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'sell', quantity: 5, priceKrw: 70_000,
    })
    strictEqual(sell.status, 201)
    // gross 350,000 fee 53 tax 525 → net 349,422; basis 351,250 → realized -1,828
    strictEqual(sell.json.data.taxKrw, 525)
    strictEqual(sell.json.data.realizedPnlKrw, 349_422 - 351_250)
    strictEqual(sell.json.data.positionAfter.quantity, 15)

    // 6) 요약에 실현 누계 반영
    const summary2 = await get(`/v1/accounts/${accountId}`)
    strictEqual(summary2.json.data.realizedPnlTotalKrw, 349_422 - 351_250)

    // 7) 체결 내역(매매 입증) 3건 + 원장 4건
    const orders = await get(`/v1/accounts/${accountId}/orders`)
    strictEqual(orders.json.data.items.length, 3)
    deepStrictEqual(orders.json.data.items.map((o: Json) => o.side), ['buy', 'buy', 'sell'])
    const ledger = await get(`/v1/accounts/${accountId}/ledger`)
    strictEqual(ledger.json.data.items.length, 4)
  })
})

describe('주문 오류', () => {
  test('현금 부족 400', async () => {
    const accountId = (await post('/v1/accounts', { name: '포모형', initialCashKrw: 100_000 })).json.data.accountId
    const { status, json } = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '068270', side: 'buy', quantity: 1, priceKrw: 400_000,
    })
    strictEqual(status, 400)
    strictEqual(json.error.code, 'insufficient_cash')
  })

  test('보유 초과 매도 400', async () => {
    const accountId = (await post('/v1/accounts', { name: '데이터형', initialCashKrw: 10_000_000 })).json.data.accountId
    await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 2, priceKrw: 70_000 })
    const { status, json } = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'sell', quantity: 3, priceKrw: 70_000,
    })
    strictEqual(status, 400)
    strictEqual(json.error.code, 'insufficient_quantity')
  })

  test('가격 누락/무효 400 (invalid_price)', async () => {
    const accountId = (await post('/v1/accounts', { name: 'x', initialCashKrw: 1_000_000 })).json.data.accountId
    const missing = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 1 })
    strictEqual(missing.status, 400)
    strictEqual(missing.json.error.code, 'invalid_price')
    const zero = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 1, priceKrw: 0 })
    strictEqual(zero.json.error.code, 'invalid_price')
  })

  test('해외 심볼 501 (kr_symbol_only)', async () => {
    const accountId = (await post('/v1/accounts', { name: 'x', initialCashKrw: 1_000_000 })).json.data.accountId
    const { status, json } = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: 'AAPL', side: 'buy', quantity: 1, priceKrw: 200_000,
    })
    strictEqual(status, 501)
    strictEqual(json.error.code, 'kr_symbol_only')
  })

  test('전량 매도 후 포지션 소멸', async () => {
    const accountId = (await post('/v1/accounts', { name: '엇박자형', initialCashKrw: 10_000_000 })).json.data.accountId
    await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 3, priceKrw: 70_000 })
    const sell = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'sell', quantity: 3, priceKrw: 70_000 })
    strictEqual(sell.status, 201)
    const positions = await get(`/v1/accounts/${accountId}/positions`)
    strictEqual(positions.json.data.items.length, 0)
    const again = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'sell', quantity: 1, priceKrw: 70_000 })
    strictEqual(again.json.error.code, 'insufficient_quantity')
  })
})

describe('cache ZERO 원칙 — 재시작(신규 Store 같은 파일) 후에도 DB가 진실', () => {
  test('같은 DB 파일을 다시 열면 상태가 그대로', async () => {
    const dbPath = join(tmpDir, 'restart.db')
    const store1 = new Store(dbPath, schemaSql)
    const s1 = await startServer(store1)
    const accountId = (await request(s1.port, '/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '소심이', initialCashKrw: 1_000_000 }),
    })).json.data.accountId
    await request(s1.port, `/v1/accounts/${accountId}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: '005930', side: 'buy', quantity: 5, priceKrw: 70_000 }),
    })
    await stopServer(s1.server)
    store1.close()

    const store2 = new Store(dbPath, schemaSql)
    const s2 = await startServer(store2)
    const positions = await request(s2.port, `/v1/accounts/${accountId}/positions`)
    const body = positions.json.data
    strictEqual(body.items.length, 1)
    strictEqual(body.items[0].quantity, 5)
    await stopServer(s2.server)
    store2.close()
  })
})
