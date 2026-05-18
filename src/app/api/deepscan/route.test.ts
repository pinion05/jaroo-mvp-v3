import test from 'node:test'
import assert from 'node:assert/strict'

import { NextRequest } from 'next/server'

import { GET, buildDeepScanCanonicalInput, createDeepScanCanonicalResponse } from './route'

test('buildDeepScanCanonicalInput는 허용 query만 explicit raw input으로 정리한다', () => {
  assert.deepEqual(
    buildDeepScanCanonicalInput(
      new URLSearchParams(
        'market=KR&code=005930&ticker=005930.KS&name=삼성전자&shares=10주&averagePrice=70000원&evaluationAmount=750000원&selectedAt=2026-04-15T15%3A00%3A00.000Z&from=home-handoff&debug=true',
      ),
    ),
    {
      instrument: {
        name: '삼성전자',
        code: '005930',
        ticker: '005930.KS',
        market: 'KR',
        kind: 'stock',
      },
      holding: {
        shares: '10주',
        averagePrice: '70000원',
        evaluationAmount: '750000원',
      },
      selectedAt: '2026-04-15T15:00:00.000Z',
      sourceContext: {
        from: 'home-handoff',
      },
    },
  )
})

test('createDeepScanCanonicalResponse는 internal builder payload를 그대로 JSON으로 반환한다', async () => {
  const response = await createDeepScanCanonicalResponse(
    new URLSearchParams('market=US&ticker=NVDA&name=NVIDIA'),
    async () => ({
      input: {
        instrument: {
          name: 'NVIDIA',
          ticker: 'NVDA',
          market: 'US',
          kind: 'stock',
        },
        sourceContext: { from: 'holding' },
      },
      hero: {
        blockState: 'ok',
        sourceRefs: [],
        fallback: null,
        error: null,
        headline: 'NVIDIA US DeepScan 70점',
        body: 'body',
        statusText: '우세',
        score: 70,
        scoreLabel: 'strong · 70 / 100',
        scoreDelta: '+0',
      },
      committee: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, axes: [] },
      insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: '이번 주 체크포인트', items: [], summaryTags: [] },
      strategy: {
        blockState: 'ok', sourceRefs: [], fallback: null, error: null,
        weekSignal: '보유 유지', weekSignalTone: 'positive', weekBadgeText: '위원회 70점',
        scenarioLabel: '기본 시나리오', scenarioProbability: '70%', scenarioPeriod: '약 3개월', scenarioCondition: 'cond',
        currentPriceText: '$100.00', targetPriceText: '$110.00', scenarioDetails: [], otherScenarios: [], otherScenarioTags: [],
      },
      sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, realizedText: 'text', rows: [] },
      portfolioSimulation: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, beforeScore: 70, afterScore: 76, deltaLabel: 'hold:+6', caption: 'caption' },
      metadata: {
        generatedAt: '2026-04-17T00:00:00.000Z',
        version: 'test',
        degraded: false,
        debugId: 'deepscan:US:NVDA',
        inputValidity: { valid: true, raw: {} },
        sourceRefs: [],
        blockStatus: { hero: 'ok', committee: 'ok', insights: 'ok', strategy: 'ok', sellNow: 'ok', portfolioSimulation: 'ok' },
      },
    }),
  )

  assert.equal(response.status, 200)
  assert.equal((await response.json()).metadata.debugId, 'deepscan:US:NVDA')
})

test('createDeepScanCanonicalResponse는 internal builder 예외를 local JSON error로 변환한다', async () => {
  const response = await createDeepScanCanonicalResponse(
    new URLSearchParams('market=KR&code=005930'),
    async () => {
      throw new Error('builder down')
    },
  )

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    ok: false,
    data: null,
    count: 0,
    error: {
      message: 'builder down',
    },
  })
})

test('GET은 internal DeepScan builder response를 노출한다', async () => {
  const originalFetch = global.fetch
  const originalCrawlerBaseUrl = process.env.JAROO_CRAWLER_BASE_URL

  process.env.JAROO_CRAWLER_BASE_URL = 'http://crawler.test'
  global.fetch = (async (input) => {
    assert.equal(
      String(input),
      'http://crawler.test/api/source/wisereport-fnguide-krx-polygon-fmp-deepscan-package/deepscan/canonical?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90&from=system',
    )

    return new Response(JSON.stringify({
      metadata: {
        debugId: 'deepscan:KR:005930',
      },
      hero: {
        headline: '삼성전자 국내 DeepScan 70점',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const response = await GET(new NextRequest('http://localhost/api/deepscan?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90'))
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(typeof body.metadata?.debugId, 'string')
    assert.ok(body.hero?.headline)
  } finally {
    global.fetch = originalFetch
    if (originalCrawlerBaseUrl === undefined) {
      delete process.env.JAROO_CRAWLER_BASE_URL
    } else {
      process.env.JAROO_CRAWLER_BASE_URL = originalCrawlerBaseUrl
    }
  }
})

test('GET은 KR crawler admission failure status를 보존한다', async () => {
  const originalFetch = global.fetch
  const originalCrawlerBaseUrl = process.env.JAROO_CRAWLER_BASE_URL
  const originalBusyMaxWaitMs = process.env.DEEPSCAN_KR_BUSY_MAX_WAIT_MS

  process.env.JAROO_CRAWLER_BASE_URL = 'http://crawler.test'
  process.env.DEEPSCAN_KR_BUSY_MAX_WAIT_MS = '1'
  global.fetch = (async () => new Response(JSON.stringify({
    ok: false,
    error: {
      message: 'KR DeepScan crawler is busy',
      details: {
        status: 'busy',
        retryAfterMs: 1,
      },
    },
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch

  try {
    const response = await GET(new NextRequest('http://localhost/api/deepscan?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90'))
    const body = await response.json()

    assert.equal(response.status, 429)
    assert.equal(body.error.message, 'KR DeepScan crawler is busy')
  } finally {
    global.fetch = originalFetch
    if (originalCrawlerBaseUrl === undefined) {
      delete process.env.JAROO_CRAWLER_BASE_URL
    } else {
      process.env.JAROO_CRAWLER_BASE_URL = originalCrawlerBaseUrl
    }
    if (originalBusyMaxWaitMs === undefined) {
      delete process.env.DEEPSCAN_KR_BUSY_MAX_WAIT_MS
    } else {
      process.env.DEEPSCAN_KR_BUSY_MAX_WAIT_MS = originalBusyMaxWaitMs
    }
  }
})
