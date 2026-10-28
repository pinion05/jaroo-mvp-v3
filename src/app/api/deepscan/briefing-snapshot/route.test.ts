import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

import {
  BriefingSnapshotTimeoutError,
  buildBriefingSnapshotData,
  buildUsBriefingSnapshotData,
  clearBriefingSnapshotCache,
  handleBriefingSnapshotRequest,
} from './route'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const stockBasic = {
  closePrice: '9,720',
  localTradedAt: '2026-05-29T12:12:19+09:00',
  marketStatus: 'OPEN',
  stockExchangeName: 'KOSPI',
}

const dailyRows = [
  { localTradedAt: '2026-05-27', closePrice: '11,100', openPrice: '13,680', highPrice: '13,910', lowPrice: '11,100', accumulatedTradingVolume: 4150667, fluctuationsRatio: '-16.23' },
  { localTradedAt: '2026-05-28', closePrice: '10,190', openPrice: '10,900', highPrice: '11,260', lowPrice: '9,820', accumulatedTradingVolume: 2187544, fluctuationsRatio: '-8.20' },
  { localTradedAt: '2026-05-29', closePrice: '9,720', openPrice: '10,000', highPrice: '10,270', lowPrice: '9,100', accumulatedTradingVolume: 1385508, fluctuationsRatio: '-4.61' },
]

const indexBasic = {
  closePrice: '8,390.68',
  fluctuationsRatio: '2.43',
  localTradedAt: '2026-05-29T12:11:00+09:00',
}

const usOhlcPayload = {
  ok: true,
  data: {
    ticker: 'TSLA',
    provider: 'polygon',
    source: 'polygon-v2-aggs-ticker-range-day',
    series: [
      { date: '2026-06-03', open: 418.7, high: 433.6, low: 416, close: 423.7, volume: 44500733.868013 },
      { date: '2026-06-02', open: 429, high: 430, low: 410, close: 420, volume: 39000000 },
      { date: '2026-06-01', open: 410, high: 425, low: 405, close: 412, volume: 35000000 },
    ],
  },
}

function createBriefingFetcher(overrides: Partial<Record<'daily' | 'stockBasic' | 'kospi' | 'kosdaq', Response | Error>> = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = url.includes('/price?')
      ? 'daily'
      : url.includes('/stock/') && url.includes('/basic')
        ? 'stockBasic'
        : url.includes('/index/KOSPI/')
          ? 'kospi'
          : url.includes('/index/KOSDAQ/')
            ? 'kosdaq'
            : null

    if (!key) {
      return jsonResponse({ error: 'unexpected url' }, 404)
    }

    const override = overrides[key]
    if (override instanceof Error) {
      throw override
    }
    if (override) {
      return override
    }

    if (key === 'daily') {
      return jsonResponse(dailyRows)
    }
    if (key === 'stockBasic') {
      return jsonResponse(stockBasic)
    }
    return jsonResponse(indexBasic)
  }) as typeof fetch
}

function createUsBriefingFetcher(overrides: { ohlc?: Response | Error; indicators?: Response | Error } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/source/polygon-yahoo/us/market/indicators')) {
      if (overrides.indicators instanceof Error) {
        throw overrides.indicators
      }
      return overrides.indicators ?? jsonResponse({
        ok: true,
        data: {
          sp500: { ticker: 'I:SPX', close: 7581.59, changePct: -0.5 },
          nasdaq: { ticker: 'I:IXIC', close: 25984.62, changePct: -0.77 },
        },
      })
    }
    if (!url.includes('/api/source/polygon/us/stocks/TSLA/ohlc')) {
      return jsonResponse({ error: 'unexpected url' }, 404)
    }

    if (overrides.ohlc instanceof Error) {
      throw overrides.ohlc
    }
    return overrides.ohlc ?? jsonResponse(usOhlcPayload)
  }) as typeof fetch
}

test('briefing snapshot route rejects invalid KR code', async () => {
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=abc'),
    { fetcher: createBriefingFetcher(), cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'invalid-target')
})

test('briefing snapshot accepts US ticker and maps Polygon OHLC into daily chart rows', async () => {
  clearBriefingSnapshotCache()
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?ticker=TSLA&market=US'),
    { fetcher: createUsBriefingFetcher(), cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.ticker, 'TSLA')
  assert.equal(body.data.quote.exchange, 'US')
  assert.equal(body.data.quote.currentPrice, 423.7)
  assert.equal(body.data.quote.currency, 'USD')
  assert.equal(body.data.daily.length, 3)
  assert.deepEqual(body.data.daily.map((row: { date: string }) => row.date), ['2026-06-01', '2026-06-02', '2026-06-03'])
  assert.equal(body.data.sourceStatus.daily, 'ok')
  // '오늘 시장 속에서는?' 행 — 미국 시장 지수가 sp500/nasdaq 키로 실린다
  assert.equal(body.data.market?.sp500?.changePct, -0.5)
  assert.equal(body.data.market?.nasdaq?.changePct, -0.77)
  assert.ok(body.data.sources?.includes('us-market-indicators'))
})

test('buildUsBriefingSnapshotData exposes latest US OHLC quote and previous close', async () => {
  const snapshot = await buildUsBriefingSnapshotData('TSLA', { fetcher: createUsBriefingFetcher(), timeoutMs: 100, cacheTtlMs: 0 })

  assert.equal(snapshot.quote?.currentPrice, 423.7)
  assert.equal(snapshot.quote?.previousClose, 420)
  assert.equal(snapshot.quote?.source, 'polygon-v2-aggs-ticker-range-day')
})

// 원금회수 예측 테스트용 — 1년치(260거래일) 일봉 합성 계열. 약 30거래일 주기로
// 9,800~13,200를 오르내리는 파형이라 마지막 저점(≈9,830)에서 평단 12,500까지의
// 회복이 유사 패턴·몬테카를로 양쪽에서 잡힌다(need ≈ 0.7σ, 도달 확률 ~40%).
const recoveryYearRows = Array.from({ length: 260 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 0, 1 + index))
  const iso = date.toISOString().slice(0, 10)
  const close = Math.round(11500 + Math.sin(index / 5 + 3) * 1700)
  return {
    localTradedAt: iso,
    closePrice: String(close),
    openPrice: String(close + 80),
    highPrice: String(close + 200),
    lowPrice: String(close - 180),
    accumulatedTradingVolume: 100000 + index * 10,
    fluctuationsRatio: '0',
  }
})

function createRecoveryBriefingFetcher() {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/price?')) {
      // 네이버 일별 시세와 동일하게 최신 우선으로 내려준다(fetchDailyRows가 reverse로 정렬).
      return jsonResponse([...recoveryYearRows].reverse())
    }
    if (url.includes('/stock/') && url.includes('/basic')) {
      return jsonResponse(stockBasic)
    }
    if (url.includes('/index/')) {
      return jsonResponse(indexBasic)
    }
    return jsonResponse({ error: 'unexpected url' }, 404)
  }) as typeof fetch
}

test('briefing snapshot attaches recovery forecast for a loss position when averagePrice is provided', async () => {
  clearBriefingSnapshotCache()
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720&averagePrice=12500'),
    { fetcher: createRecoveryBriefingFetcher(), cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  const recovery = body.data.recoveryForecast
  assert.ok(recovery, 'recoveryForecast must be attached for a loss position')
  assert.match(recovery.expectedRecoveryDaysText, /거래일/)
  assert.equal(typeof recovery.recoveryProbabilityPct, 'number')
  assert.match(recovery.summaryText, /본전에 도달/)
  assert.equal(recovery.modelRows.length, 3)
  assert.deepEqual(recovery.modelRows.map((row: { label: string }) => row.label), ['비슷하게 빠졌던 과거 사례', '평소처럼 움직일 때', '갑자기 급등락할 때'])
  // 차트 재료(1년 종가 계열 + 유사 패턴 샘플)도 함께 내려간다.
  assert.equal(recovery.targetPrice, 12500)
  assert.ok(Array.isArray(recovery.priceHistory))
  assert.equal(recovery.priceHistory.length, 252)
  assert.ok(recovery.priceHistory.every((point: { close: number }) => Number.isFinite(point.close)))
  assert.ok(Array.isArray(recovery.similarPatternSamples))
  assert.ok(recovery.similarPatternSamples.length >= 1, '파형 계열에서 유사 패턴 샘플이 잡혀야 한다')
})

test('briefing snapshot omits recovery forecast without averagePrice and for a profit position', async () => {
  clearBriefingSnapshotCache()
  const withoutAverage = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    { fetcher: createRecoveryBriefingFetcher(), cacheTtlMs: 0 },
  )
  const withoutBody = await withoutAverage.json()
  assert.equal(withoutBody.data.recoveryForecast, null)

  clearBriefingSnapshotCache()
  const profit = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720&averagePrice=5000'),
    { fetcher: createRecoveryBriefingFetcher(), cacheTtlMs: 0 },
  )
  const profitBody = await profit.json()
  assert.equal(profitBody.data.recoveryForecast, null, '수익 구간(평단 이상)에서는 예측을 붙이지 않는다')
})

test('US briefing tolerates market-indicators failure (market {} 폴백)', async () => {
  clearBriefingSnapshotCache()
  const snapshot = await buildUsBriefingSnapshotData('TSLA', {
    fetcher: createUsBriefingFetcher({ indicators: new Error('indicators down') }),
    timeoutMs: 100,
    cacheTtlMs: 0,
  })

  assert.equal(snapshot.quote?.currentPrice, 423.7)
  assert.deepEqual(snapshot.market ?? {}, {})
  assert.equal(snapshot.sources?.includes('us-market-indicators'), false)
})

test('briefing snapshot returns partial response when daily source fails but basic quote is available', async () => {
  clearBriefingSnapshotCache()
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    { fetcher: createBriefingFetcher({ daily: jsonResponse({ error: 'temporary' }, 500) }), cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.quote.currentPrice, 9720)
  assert.deepEqual(body.data.daily, [])
  assert.equal(body.data.sourceStatus.daily, 'error')
  assert.equal(body.data.sourceStatus.stockBasic, 'ok')
})

test('briefing snapshot hides upstream URLs in error responses', async () => {
  clearBriefingSnapshotCache()
  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    {
      fetcher: createBriefingFetcher({
        daily: jsonResponse({ error: 'down' }, 500),
        stockBasic: jsonResponse({ error: 'down' }, 500),
      }),
      cacheTtlMs: 0,
    },
  )
  const body = await response.json()

  assert.equal(response.status, 502)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'upstream-error')
  assert.equal(body.error.message, 'briefing snapshot failed')
  assert.doesNotMatch(body.error.message, /naver|http|stock/u)
})

test('briefing snapshot maps upstream timeout to 504 rather than client abort', async () => {
  clearBriefingSnapshotCache()
  const signalAwareFetcher = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch

  const response = await handleBriefingSnapshotRequest(
    new NextRequest('http://localhost/api/deepscan/briefing-snapshot?code=003720'),
    { fetcher: signalAwareFetcher, timeoutMs: 5, cacheTtlMs: 0 },
  )
  const body = await response.json()

  assert.equal(response.status, 504)
  assert.equal(body.error.code, 'upstream-timeout')
})

test('buildBriefingSnapshotData exposes timeout errors for direct service callers', async () => {
  const signalAwareFetcher = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch

  await assert.rejects(
    () => buildBriefingSnapshotData('003720', { fetcher: signalAwareFetcher, timeoutMs: 5 }),
    BriefingSnapshotTimeoutError,
  )
})
