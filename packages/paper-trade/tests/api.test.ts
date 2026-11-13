// API e2e — app.request() 로 서버 없이 전 흐름 검증.
// 시세 개념 없음: 모든 체결가는 요청 body의 priceKrw.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import { DEFAULT_RATES } from '../src/engine.ts'
import { Store } from '../src/store.ts'

let store: Store
let app: ReturnType<typeof createApp>

const schemaSql = await Bun.file(new URL('../migrations/0001_init.sql', import.meta.url)).text()

beforeEach(() => {
  store = new Store(':memory:', schemaSql)
  app = createApp({ store, rates: DEFAULT_RATES })
})

type Json = Record<string, any>

async function post(path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Json }
}

async function get(path: string): Promise<{ status: number; json: Json }> {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Json }
}

describe('healthz 폐지 회귀', () => {
  test('healthz 라우트 없음 — 404', async () => {
    const { status, json } = await get('/healthz')
    expect(status).toBe(404)
    expect(json.error.code).toBe('not_found')
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
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/)
    expect(at.endsWith('Z')).toBe(false)

    // 2) 오프셋 정합성: +09:00 을 달았으면 실제 epoch과 일치해야 함
    //    (UTC 벽시각에 +09:00만 붙인 잘못된 값이면 9시간 어긋나서 걸림)
    const epoch = Date.parse(at)
    expect(epoch).toBeGreaterThanOrEqual(before - 1_000)
    expect(epoch).toBeLessThanOrEqual(after + 1_000)

    // 3) 벽시각이 서울 시간과 일치 (분 단위)
    const seoulWall = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', hour12: false,
    }).format(new Date(epoch)) // "2026-11-10 17:03:54"
    expect(at.startsWith(seoulWall.slice(0, 16).replace(' ', 'T'))).toBe(true)

    // 원장·계좌도 같은 형식
    const ledger = await get(`/v1/accounts/${accountId}/ledger`)
    expect(ledger.json.data.items[0].at).toMatch(/\+09:00$/)
  })
})

describe('계좌', () => {
  test('생성/조회/목록', async () => {
    const created = await post('/v1/accounts', { name: '소심이', initialCashKrw: 10_000_000 })
    expect(created.status).toBe(201)
    expect(created.json.data.name).toBe('소심이')
    expect(created.json.data.cashKrw).toBe(10_000_000)
    const accountId: string = created.json.data.accountId

    const summary = await get(`/v1/accounts/${accountId}`)
    expect(summary.status).toBe(200)
    expect(summary.json.data.investedBasisKrw).toBe(0)
    expect(summary.json.data.positionCount).toBe(0)

    const list = await get('/v1/accounts')
    expect(list.json.data).toHaveLength(1)
  })

  test('잘못된 생성 요청 400', async () => {
    expect((await post('/v1/accounts', { name: '' })).status).toBe(400)
    expect((await post('/v1/accounts', { name: 'x', initialCashKrw: -1 })).status).toBe(400)
    expect((await post('/v1/accounts', { name: 'x', initialCashKrw: 1.5 })).status).toBe(400)
  })

  test('없는 계좌 404', async () => {
    const { status, json } = await get('/v1/accounts/ac_none')
    expect(status).toBe(404)
    expect(json.error.code).toBe('account_not_found')
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
    expect(buy.status).toBe(201)
    expect(buy.json.data.executedPriceKrw).toBe(70_000)
    expect(buy.json.data.feeKrw).toBe(105)
    expect(buy.json.data.cashAfterKrw).toBe(10_000_000 - 700_105)
    expect(buy.json.data.positionAfter).toEqual({ quantity: 10, avgPriceCenti: 7_000_000 })

    // 2) 다른 가격 추가 매수 — 평단 변화 (10주@70,000 + 10주@70,500 → 70,250)
    const buy2 = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'buy', quantity: 10, priceKrw: 70_500,
    })
    expect(buy2.json.data.positionAfter).toEqual({ quantity: 20, avgPriceCenti: 7_025_000 })

    // 3) 포지션 — 시세 없음, 자기 데이터만
    const positions = await get(`/v1/accounts/${accountId}/positions`)
    expect(positions.json.data.items).toHaveLength(1)
    const position = positions.json.data.items[0]
    expect(position.quantity).toBe(20)
    expect(position.avgPriceKrw).toBe(70_250)
    expect(position.basisKrw).toBe(1_405_000)
    expect(position.currentPriceKrw).toBeUndefined() // 시세 노출 없음
    expect(position.pnlKrw).toBeUndefined()

    // 4) 계좌 요약 — 원본/실현 누계
    const summary = await get(`/v1/accounts/${accountId}`)
    expect(summary.json.data.investedBasisKrw).toBe(1_405_000)
    expect(summary.json.data.realizedPnlTotalKrw).toBe(0)
    expect(summary.json.data.feeTotalKrw).toBe(211) // 105 + 106

    // 5) 매도 5주 @70,000 — 평단 70,250보다 낮아 실현 손실
    const sell = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'sell', quantity: 5, priceKrw: 70_000,
    })
    expect(sell.status).toBe(201)
    // gross 350,000 fee 53 tax 525 → net 349,422; basis 351,250 → realized -1,828
    expect(sell.json.data.taxKrw).toBe(525)
    expect(sell.json.data.realizedPnlKrw).toBe(349_422 - 351_250)
    expect(sell.json.data.positionAfter.quantity).toBe(15)

    // 6) 요약에 실현 누계 반영
    const summary2 = await get(`/v1/accounts/${accountId}`)
    expect(summary2.json.data.realizedPnlTotalKrw).toBe(349_422 - 351_250)

    // 7) 체결 내역(매매 입증) 3건 + 원장 4건
    const orders = await get(`/v1/accounts/${accountId}/orders`)
    expect(orders.json.data.items).toHaveLength(3)
    expect(orders.json.data.items.map((o: Json) => o.side)).toEqual(['buy', 'buy', 'sell'])
    const ledger = await get(`/v1/accounts/${accountId}/ledger`)
    expect(ledger.json.data.items).toHaveLength(4)
  })
})

describe('주문 오류', () => {
  test('현금 부족 400', async () => {
    const accountId = (await post('/v1/accounts', { name: '포모형', initialCashKrw: 100_000 })).json.data.accountId
    const { status, json } = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '068270', side: 'buy', quantity: 1, priceKrw: 400_000,
    })
    expect(status).toBe(400)
    expect(json.error.code).toBe('insufficient_cash')
  })

  test('보유 초과 매도 400', async () => {
    const accountId = (await post('/v1/accounts', { name: '데이터형', initialCashKrw: 10_000_000 })).json.data.accountId
    await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 2, priceKrw: 70_000 })
    const { status, json } = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: '005930', side: 'sell', quantity: 3, priceKrw: 70_000,
    })
    expect(status).toBe(400)
    expect(json.error.code).toBe('insufficient_quantity')
  })

  test('가격 누락/무효 400 (invalid_price)', async () => {
    const accountId = (await post('/v1/accounts', { name: 'x', initialCashKrw: 1_000_000 })).json.data.accountId
    const missing = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 1 })
    expect(missing.status).toBe(400)
    expect(missing.json.error.code).toBe('invalid_price')
    const zero = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 1, priceKrw: 0 })
    expect(zero.json.error.code).toBe('invalid_price')
  })

  test('해외 심볼 501 (kr_symbol_only)', async () => {
    const accountId = (await post('/v1/accounts', { name: 'x', initialCashKrw: 1_000_000 })).json.data.accountId
    const { status, json } = await post(`/v1/accounts/${accountId}/orders`, {
      symbol: 'AAPL', side: 'buy', quantity: 1, priceKrw: 200_000,
    })
    expect(status).toBe(501)
    expect(json.error.code).toBe('kr_symbol_only')
  })

  test('전량 매도 후 포지션 소멸', async () => {
    const accountId = (await post('/v1/accounts', { name: '엇박자형', initialCashKrw: 10_000_000 })).json.data.accountId
    await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'buy', quantity: 3, priceKrw: 70_000 })
    const sell = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'sell', quantity: 3, priceKrw: 70_000 })
    expect(sell.status).toBe(201)
    const positions = await get(`/v1/accounts/${accountId}/positions`)
    expect(positions.json.data.items).toHaveLength(0)
    const again = await post(`/v1/accounts/${accountId}/orders`, { symbol: '005930', side: 'sell', quantity: 1, priceKrw: 70_000 })
    expect(again.json.error.code).toBe('insufficient_quantity')
  })
})

describe('cache ZERO 원칙 — 재시작(신규 Store 같은 파일) 후에도 DB가 진실', () => {
  test('같은 DB 파일을 다시 열면 상태가 그대로', async () => {
    const dbPath = `/tmp/paper-trade-test-${Date.now()}.db`
    const store1 = new Store(dbPath, schemaSql)
    const app1 = createApp({ store: store1, rates: DEFAULT_RATES })
    const res = await app1.request('/v1/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '소심이', initialCashKrw: 1_000_000 }),
    })
    const accountId = ((await res.json()) as Json).data.accountId
    await app1.request(`/v1/accounts/${accountId}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: '005930', side: 'buy', quantity: 5, priceKrw: 70_000 }),
    })
    store1.close()

    const store2 = new Store(dbPath, schemaSql)
    const app2 = createApp({ store: store2, rates: DEFAULT_RATES })
    const positions = await app2.request(`/v1/accounts/${accountId}/positions`)
    const body = ((await positions.json()) as Json).data
    expect(body.items).toHaveLength(1)
    expect(body.items[0].quantity).toBe(5)
    store2.close()
  })
})
