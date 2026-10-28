import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeepScanRecoveryForecastBlock,
  buildKrDeepScanCrawlerCanonicalUrl,
  buildKrDeepScanPayloadViaCrawler,
  CrawlerDeepScanRequestError,
  describeMomentumProvenance,
  extractGeneratedOhlcSeries,
  extractKrCodeFromTicker,
  formatProbability,
  prepareDeepScanRawInputForBuilder,
  resolveDeepScanPayloadBuilderRoute,
  summarizeGeneratedDumpSignals,
  type DeepScanRawInput,
} from './build-payload'

test('summarizeGeneratedDumpSignals surfaces Polygon OHLC and direct ownership flow summaries', () => {
  const summary = summarizeGeneratedDumpSignals({
    members: {
      momentum: {
        facts: {
          ohlcSeries: {
            value: [
              { date: '2026-04-20', close: 273.05 },
              { date: '2026-04-17', close: 270.23 },
            ],
            quality: { availability: 'present', derivationKind: 'direct', reasonCode: ['polygon_primary_ohlc'] },
          },
        },
      },
      'ownership-flow': {
        facts: {
          directOwnershipFlow: {
            value: {
              source: 'sec-submissions',
              signal: {
                summary: '최근 180일 ownership/flow 공시 3건',
                direction: 'mixed-direct-flow',
              },
              counts: {
                totalDirectEvents: 3,
              },
              latestDates: {
                latestEvent: '2026-04-20',
              },
            },
            quality: { availability: 'present', derivationKind: 'direct' },
          },
        },
      },
    },
  })

  assert.deepEqual(summary, {
    momentum: {
      availability: 'present',
      pointCount: 2,
      latestDate: '2026-04-20',
      latestClose: 273.05,
      primarySource: 'polygon',
    },
    ownershipFlow: {
      availability: 'present',
      summary: '최근 180일 ownership/flow 공시 3건',
      direction: 'mixed-direct-flow',
      eventCount: 3,
      latestEventDate: '2026-04-20',
      primarySource: 'sec-submissions',
    },
  })
})

test('summarizeGeneratedDumpSignals preserves missing availability when direct facts are absent', () => {
  const summary = summarizeGeneratedDumpSignals({
    members: {
      momentum: {
        facts: {
          ohlcSeries: {
            value: null,
            quality: { availability: 'missing' },
          },
        },
      },
      'ownership-flow': {
        facts: {
          directOwnershipFlow: {
            value: null,
            quality: { availability: 'missing' },
          },
        },
      },
    },
  })

  assert.equal(summary.momentum?.availability, 'missing')
  assert.equal(summary.momentum?.pointCount, 0)
  assert.equal(summary.ownershipFlow?.availability, 'missing')
  assert.equal(summary.ownershipFlow?.eventCount, 0)
})

test('extractGeneratedOhlcSeries normalizes runtime OHLC facts for recovery forecasting', () => {
  const series = extractGeneratedOhlcSeries({
    members: {
      momentum: {
        facts: {
          ohlcSeries: {
            value: [
              { date: '2026-04-20', close: 273.05 },
              { tradeDate: '2026-04-17', closePrice: 270.23 },
              { date: 'bad-row', close: null },
            ],
            quality: { availability: 'present' },
          },
        },
      },
    },
  })

  assert.deepEqual(series, [
    { date: '2026-04-20', close: 273.05 },
    { date: '2026-04-17', close: 270.23 },
  ])
})

test('formatProbability trims trailing .0 from integer probabilities without breaking decimals', () => {
  assert.equal(formatProbability(100), '100%')
  assert.equal(formatProbability(0), '0%')
  assert.equal(formatProbability(61.1), '61.1%')
  assert.equal(formatProbability(84.1), '84.1%')
  assert.equal(formatProbability(null), 'N/A')
  assert.equal(formatProbability(undefined), 'N/A')
  assert.equal(formatProbability(Number.NaN), 'N/A')
})

test('buildDeepScanRecoveryForecastBlock returns a deepscan-ready 원금회수 block from holding and OHLC context', () => {
  const block = buildDeepScanRecoveryForecastBlock({
    rawInput: {
      instrument: { name: 'Tesla', ticker: 'TSLA', market: 'US', kind: 'stock' },
      holding: { shares: '3', averagePrice: '121' },
      sourceContext: { from: 'holding' },
    },
    currentPrice: 100,
    currency: 'USD',
    primarySeries: [
      { date: '2026-01-01', close: 121 },
      { date: '2026-01-02', close: 100 },
      { date: '2026-01-03', close: 121 },
      { date: '2026-01-04', close: 130 },
      { date: '2026-01-05', close: 121 },
      { date: '2026-01-06', close: 100 },
      { date: '2026-01-07', close: 121 },
      { date: '2026-01-08', close: 130 },
      { date: '2026-01-09', close: 100 },
      { date: '2026-01-10', close: 121 },
    ],
    sourceRefs: [],
    sourceId: 'test-ohlc:TSLA',
    sourceLabel: 'test OHLC',
  })

  assert.ok(block)
  assert.equal(block.blockState, 'ok')
  assert.match(block.summaryText, /도달한 사례만/)
  assert.match(block.expectedRecoveryDaysText, /거래일|이미 도달/)
  assert.notEqual(block.recoveryProbabilityText, 'N/A')
  assert.equal(block.currentPriceText, '$100.00')
  assert.equal(block.targetPriceText, '$121.00')
  assert.equal(block.modelRows.length, 3)
  assert.match(block.disclaimer, /투자 권유/)
  // 수치 원본·차트 재료(히어로 게이지·1년 차트 렌더링용)가 함께 내려간다.
  assert.equal(block.currentPrice, 100)
  assert.equal(block.targetPrice, 121)
  assert.equal(block.confidenceLevel === null || ['high', 'medium', 'low'].includes(block.confidenceLevel ?? ''), true)
  assert.ok(Array.isArray(block.priceHistory) && block.priceHistory.length === 10)
  assert.deepEqual(block.priceHistory?.[0], { date: '2026-01-01', close: 121 })
})

test('describeMomentumProvenance는 provider별 OHLC 문구를 맞춘다', () => {
  assert.deepEqual(describeMomentumProvenance('polygon', 252), {
    insightTitle: 'Polygon OHLC 252개 봉을 반영했어요.',
    sourceRefLabel: 'Polygon OHLC 252 bars',
    heroBodyText: 'Polygon OHLC 252개 반영',
  })

  assert.deepEqual(describeMomentumProvenance('fmp', 120), {
    insightTitle: 'FMP OHLC 120개 봉을 반영했어요.',
    sourceRefLabel: 'FMP OHLC 120 bars',
    heroBodyText: 'FMP OHLC 120개 반영',
  })

  assert.deepEqual(describeMomentumProvenance('unknown', 80), {
    insightTitle: 'OHLC 80개 봉을 반영했어요.',
    sourceRefLabel: 'OHLC 80 bars',
    heroBodyText: 'OHLC 80개 반영',
  })
})

test('DeepScan runtime routes explicit KR ticker-only requests to the KR builder input', () => {
  const rawInput: DeepScanRawInput = {
    instrument: {
      name: '삼성전자',
      ticker: '005930.KS',
      market: 'KR',
      kind: 'stock',
    },
    holding: {
      shares: '10주',
      averagePrice: '70,000원',
    },
    sourceContext: {
      from: 'holding',
    },
  }

  assert.equal(resolveDeepScanPayloadBuilderRoute(rawInput), 'kr')
  assert.equal(extractKrCodeFromTicker(rawInput.instrument.ticker), '005930')
  assert.deepEqual(prepareDeepScanRawInputForBuilder(rawInput).instrument, {
    name: '삼성전자',
    code: '005930',
    ticker: '005930.KS',
    market: 'KR',
    kind: 'stock',
  })
})

test('DeepScan runtime preserves US ticker-only routing for non-KR tickers', () => {
  assert.equal(
    resolveDeepScanPayloadBuilderRoute({
      instrument: {
        name: 'Apple',
        ticker: 'AAPL',
        kind: 'stock',
      },
      sourceContext: {
        from: 'holding',
      },
    }),
    'us',
  )
})

test('DeepScan runtime preserves US ETF routing for ticker-only requests', () => {
  const rawInput: DeepScanRawInput = {
    instrument: {
      name: 'SPDR S&P 500 ETF Trust',
      ticker: 'SPY',
      market: 'US',
      kind: 'etf',
    },
    holding: {
      shares: '10주',
      averagePrice: '$450',
      averagePriceCurrency: 'USD',
    },
    sourceContext: {
      from: 'holding',
    },
  }

  assert.equal(resolveDeepScanPayloadBuilderRoute(rawInput), 'us')
  assert.equal(prepareDeepScanRawInputForBuilder(rawInput).instrument.kind, 'etf')
})


test('DeepScan runtime infers KR builder input from KR-like ticker without explicit market', () => {
  const rawInput: DeepScanRawInput = {
    instrument: {
      name: '카카오',
      ticker: '035720.KQ',
      kind: 'stock',
    },
    sourceContext: {
      from: 'holding',
    },
  }

  assert.equal(resolveDeepScanPayloadBuilderRoute(rawInput), 'kr')
  assert.equal(prepareDeepScanRawInputForBuilder(rawInput).instrument.code, '035720')
})



test('KR DeepScan crawler canonical URL preserves ETF kind query parameter', () => {
  const url = buildKrDeepScanCrawlerCanonicalUrl({
    instrument: {
      name: 'KODEX 코스피',
      code: '226490',
      market: 'ETF',
      kind: 'etf',
    },
    holding: {
      shares: '35',
      averagePrice: '58828.75',
      averagePriceCurrency: 'KRW',
      currentPrice: '64100',
      currentPriceCurrency: 'KRW',
      currentProfitRate: '-2.4%',
      usdKrwRate: '1380',
    },
    sourceContext: {
      from: 'holding',
    },
  })

  assert.match(url, /market=ETF/)
  assert.match(url, /kind=etf/)
  assert.match(url, /averagePriceCurrency=KRW/)
  assert.match(url, /currentPrice=64100/)
  assert.match(url, /currentPriceCurrency=KRW/)
  assert.match(url, /currentProfitRate=-2.4%25/)
  assert.match(url, /usdKrwRate=1380/)
})

test('KR DeepScan crawler canonical URL preserves ETN market as etn kind even with legacy etf kind', () => {
  const url = buildKrDeepScanCrawlerCanonicalUrl({
    instrument: {
      name: '삼성 인버스 코스피 200 선물 ETN',
      code: '530036',
      market: 'ETN',
      kind: 'etf',
    },
    sourceContext: {
      from: 'holding',
    },
  })

  assert.match(url, /market=ETN/)
  assert.match(url, /kind=etn/)
})

test('KR DeepScan crawler canonical URL은 market KOSPI 표기에서도 명시 kind etn을 유지한다', () => {
  // 유니버스 교정 후 ETN 행은 market KOSPI/KOSDAQ + kind etn으로 내려온다 —
  // 크롤러 이름 정규식 추론에 의존하지 않고 kind=etn이 전달돼야 한다.
  const url = buildKrDeepScanCrawlerCanonicalUrl({
    instrument: {
      name: '삼성 인버스 코스피 200 선물 ETN',
      code: '530092',
      market: 'KOSPI',
      kind: 'etn',
    },
    sourceContext: {
      from: 'holding',
    },
  })

  assert.match(url, /market=KOSPI/)
  assert.match(url, /kind=etn/)
})

test('buildRawInputFromSearchParams 화이트리스트는 kind=etn을 드롭하지 않는다', async () => {
  const { buildRawInputFromSearchParams } = await import('./build-payload')

  const rawInput = buildRawInputFromSearchParams(
    new URLSearchParams('code=530092&name=삼성%20인버스%20ETN&market=KOSPI&kind=etn'),
  )

  // kind 런타임 화이트리스트(745) 회귀 방어 — 여기서 드롭되면 스냅샷 raw input·
  // history target_input에서 상품 유형이 조용히 소실된다.
  assert.equal(rawInput.instrument.kind, 'etn')

  const legacyInput = buildRawInputFromSearchParams(new URLSearchParams('code=005930&kind=bond'))
  assert.equal(legacyInput.instrument.kind, undefined)
})

test('KR DeepScan crawler proxy waits and retries busy admission responses', async () => {
  const rawInput: DeepScanRawInput = {
    instrument: {
      name: '삼영화학공업',
      code: '003720',
      market: 'KR',
      kind: 'stock',
    },
    sourceContext: {
      from: 'holding',
    },
  }
  const requestedUrls: string[] = []
  const waits: number[] = []
  let callCount = 0

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async (input) => {
      requestedUrls.push(String(input))
      callCount += 1

      if (callCount === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: {
            message: 'KR DeepScan crawler is busy',
            details: {
              status: 'busy',
              retryAfterMs: 25,
            },
          },
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        metadata: { debugId: 'deepscan:KR:003720' },
        hero: { headline: '삼영화학공업 국내 DeepScan 76점' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch,
    {
      maxBusyWaitMs: 100,
      sleep: async (durationMs) => {
        waits.push(durationMs)
      },
    },
  )

  assert.equal(callCount, 2)
  assert.equal(requestedUrls[0], requestedUrls[1])
  assert.deepEqual(waits, [25])
  assert.equal(payload.metadata.debugId, 'deepscan:KR:003720')
})

test('KR DeepScan crawler proxy times out an unresponsive upstream fetch', async () => {
  const rawInput: DeepScanRawInput = {
    instrument: {
      name: '삼영화학공업',
      code: '003720',
      market: 'KR',
      kind: 'stock',
    },
    sourceContext: {
      from: 'holding',
    },
  }

  await assert.rejects(
    () => buildKrDeepScanPayloadViaCrawler(
      rawInput,
      // 응답 없는 upstream 흉내 — 단, 영원히 정착하지 않는 promise만 남기면
      // 유일한 깨어남이 unref 데드라인 타이머(fetchWithDeadline)인 시점에 이벤트
      // 루프가 먼저 drain되어 node:test가 파일 루트를 'Promise resolution is
      // still pending'로 취소시키는 플레이크가 있다(나머지 테스트까지 취소됨).
      // abort 신호에 즉시 거절하고, ref 타이머 안전판을 둬 루프가 못 죽게 한다.
      ((_input, init) => new Promise<Response>((_, reject) => {
        const fallback = setTimeout(() => reject(new Error('upstream unresponsive')), 50)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(fallback)
          reject(new Error('aborted'))
        })
      })) as typeof fetch,
      { fetchTimeoutMs: 1 },
    ),
    (error) => error instanceof CrawlerDeepScanRequestError
      && error.status === 504
      && /timed out/.test(error.message),
  )
})

test('KR DeepScan crawler proxy maps invalid upstream JSON to a typed gateway error', async () => {
  const rawInput: DeepScanRawInput = {
    instrument: {
      name: '삼영화학공업',
      code: '003720',
      market: 'KR',
      kind: 'stock',
    },
    sourceContext: {
      from: 'holding',
    },
  }

  await assert.rejects(
    () => buildKrDeepScanPayloadViaCrawler(
      rawInput,
      (async () => new Response('not-json', { status: 200 })) as typeof fetch,
      { fetchTimeoutMs: 100 },
    ),
    (error) => error instanceof CrawlerDeepScanRequestError
      && error.status === 502
      && /invalid JSON/.test(error.message),
  )
})

test('buildKrDeepScanPayloadViaCrawler shapes crawler recoveryForecastRaw into a KR recoveryForecast block and strips the raw envelope', async () => {
  const availableForecast = {
    status: 'available',
    reason: null,
    models: {
      similarPattern: { label: '유사 패턴', medianRecoveryDays: 96, recoveryProbabilityPct: 60.3, sampleSize: 63 },
      gbm: { label: 'GBM', medianRecoveryDays: 57, recoveryProbabilityPct: 58.2 },
      jumpDiffusion: { label: 'Jump-Diffusion', medianRecoveryDays: 60, recoveryProbabilityPct: 63.9 },
    },
    consensus: {
      expectedRecoveryDays: 74,
      recoveryProbabilityPct: 61.1,
      confidence: { level: 'medium', deviationRatio: 0.549, averageMedianDays: 71, minMedianDays: 57, maxMedianDays: 96, reason: null },
      weights: { similarPattern: 0.4, gbm: 0.3, jumpDiffusion: 0.3 },
      disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
    },
  }
  const crawlerPayload = {
    recoveryForecastRaw: { forecast: availableForecast, currentPrice: 20050, targetPrice: 28000 },
  }
  const rawInput: DeepScanRawInput = {
    instrument: { name: '코칩', code: '126730', market: 'KR', kind: 'stock' },
    sourceContext: { from: 'holding' },
  }

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(crawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    { fetchTimeoutMs: 1000 },
  ) as Record<string, unknown>

  assert.equal(payload.recoveryForecastRaw, undefined, 'raw envelope must be stripped after shaping')
  const block = payload.recoveryForecast as Record<string, unknown>
  assert.ok(block, 'shaped recoveryForecast block must be attached')
  assert.equal(block.blockState, 'ok')
  assert.equal(block.statusText, '원금회수 예측')
  assert.equal(block.confidenceText, '보통')
  const modelRows = block.modelRows as Array<{ label: string }>
  assert.equal(modelRows.length, 3)
  assert.deepEqual(modelRows.map((row) => row.label), ['유사 패턴', '일반 주가 변동', '급등락 반영'])
  assert.match(String(block.summaryText), /도달한 사례만/)
  assert.match(String(block.summaryText), /74/)
  assert.match(String(block.currentPriceText), /20/)
  assert.match(String(block.drawdownText), /28\.4/)
  assert.match(String(block.disclaimer), /투자 권유/)
  assert.match(String(block.disclaimer), /예측 정확도나 회복 보장/)
})

test('buildKrDeepScanPayloadViaCrawler recomputes optimistic crawler recovery output from injected daily history', async () => {
  const optimisticCrawlerPayload = {
    recoveryForecastRaw: {
      forecast: {
        status: 'available',
        models: {
          gbm: { medianRecoveryDays: 15, recoveryProbabilityPct: 100 },
          jumpDiffusion: { medianRecoveryDays: 13, recoveryProbabilityPct: 100 },
        },
        consensus: {
          expectedRecoveryDays: 14,
          recoveryProbabilityPct: 100,
          confidence: { level: 'medium' },
        },
      },
      currentPrice: 100,
      targetPrice: 150,
    },
  }
  const dailySeries = Array.from({ length: 260 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close: 100 + Math.sin(index) * 2,
  }))
  const rawInput: DeepScanRawInput = {
    instrument: { name: '테스트', code: '100840', market: 'KR', kind: 'stock' },
    sourceContext: { from: 'holding' },
  }
  let loadedCode = ''

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(optimisticCrawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    {
      fetchTimeoutMs: 1000,
      recoveryPriceHistoryLoader: async (code) => {
        loadedCode = code
        return dailySeries
      },
    },
  ) as Record<string, unknown>

  assert.equal(loadedCode, '100840')
  assert.equal(payload.recoveryForecastRaw, undefined)
  const block = payload.recoveryForecast as Record<string, unknown>
  const sourceRefs = block.sourceRefs as Array<Record<string, unknown>>
  assert.ok(sourceRefs.some((source) => source.id === 'naver-daily-price-history'))
  const rows = block.modelRows as Array<Record<string, unknown>>
  assert.notEqual(rows[1]?.recoveryDaysText, '15일')
  assert.notEqual(rows[1]?.probabilityText, '100%')
  // 주입된 일봉 계열이 차트 재료(priceHistory, 최대 252포인트)로 내려간다.
  const priceHistory = block.priceHistory as Array<{ date: string | null; close: number }>
  assert.ok(Array.isArray(priceHistory))
  assert.equal(priceHistory.length, 252)
  assert.equal(block.currentPrice, 100)
  assert.equal(block.targetPrice, 150)
  assert.equal(typeof block.recoveryProbabilityPct, 'number')
  assert.ok(['high', 'medium', 'low'].includes(String(block.confidenceLevel)))
})

test('buildKrDeepScanPayloadViaCrawler blocks recovery output when daily history loading fails', async () => {
  const optimisticCrawlerPayload = {
    recoveryForecastRaw: {
      forecast: {
        status: 'available',
        models: {
          gbm: { medianRecoveryDays: 15, recoveryProbabilityPct: 100 },
          jumpDiffusion: { medianRecoveryDays: 13, recoveryProbabilityPct: 100 },
        },
        consensus: {
          expectedRecoveryDays: 14,
          recoveryProbabilityPct: 100,
          confidence: { level: 'medium' },
        },
      },
      currentPrice: 25150,
      targetPrice: 49256.7334,
    },
  }
  const rawInput: DeepScanRawInput = {
    instrument: { name: 'SNT에너지', code: '100840', market: 'KR', kind: 'stock' },
    sourceContext: { from: 'holding' },
  }

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(optimisticCrawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    {
      fetchTimeoutMs: 1000,
      recoveryPriceHistoryLoader: async () => {
        throw new Error('Naver unavailable')
      },
    },
  ) as Record<string, unknown>

  const block = payload.recoveryForecast as Record<string, unknown>
  assert.equal(block.blockState, 'blocked')
  assert.match(String((block.error as Record<string, unknown>)?.message), /일봉/)
})

test('buildKrDeepScanPayloadViaCrawler는 FnGuide 실패(null CP/TP) 시 네이버 일봉+입력 평단으로 회복예측을 계산한다', async () => {
  const crawlerPayload = {
    input: {
      instrument: { name: '테스트', code: '100840', market: 'KR', kind: 'stock' },
      holding: { shares: '10', averagePrice: '150' },
      sourceContext: { from: 'holding' },
    },
    recoveryForecastRaw: {
      forecast: {
        status: 'unavailable',
        reason: '과거 주가 데이터가 부족해 원금회수 예측을 계산할 수 없습니다.',
        models: {},
        consensus: null,
      },
      currentPrice: null,
      targetPrice: null,
    },
  }
  const dailySeries = Array.from({ length: 260 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close: 100 + Math.sin(index) * 2,
  }))
  const rawInput: DeepScanRawInput = {
    instrument: { name: '테스트', code: '100840', market: 'KR', kind: 'stock' },
    holding: { shares: '10', averagePrice: '150' },
    sourceContext: { from: 'holding' },
  }

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(crawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    {
      fetchTimeoutMs: 1000,
      recoveryPriceHistoryLoader: async () => dailySeries,
    },
  ) as Record<string, unknown>

  const block = payload.recoveryForecast as Record<string, unknown>
  assert.ok(block, 'recoveryForecast 블록이 존재해야 한다')
  assert.notEqual(block.blockState, 'blocked')
  assert.equal(block.targetPrice, 150)
  assert.equal(block.currentPrice, dailySeries[259].close)
  const sourceRefs = block.sourceRefs as Array<Record<string, unknown>>
  assert.ok(sourceRefs.some((source) => source.id === 'naver-daily-price-history'))
})

test('buildKrDeepScanPayloadViaCrawler는 recoveryForecastRaw 키 자체가 없어도 네이버 일봉으로 블록을 만든다', async () => {
  const crawlerPayload = {
    input: {
      instrument: { name: '테스트', code: '100840', market: 'KR', kind: 'stock' },
      holding: { shares: '5', averagePrice: '300,000원' },
      sourceContext: { from: 'holding' },
    },
  }
  const dailySeries = Array.from({ length: 260 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close: 240000 + Math.sin(index) * 4000,
  }))
  const rawInput: DeepScanRawInput = {
    instrument: { name: '테스트', code: '100840', market: 'KR', kind: 'stock' },
    holding: { shares: '5', averagePrice: '300,000원' },
    sourceContext: { from: 'holding' },
  }

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(crawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    {
      fetchTimeoutMs: 1000,
      recoveryPriceHistoryLoader: async () => dailySeries,
    },
  ) as Record<string, unknown>

  const block = payload.recoveryForecast as Record<string, unknown>
  assert.ok(block, 'recoveryForecast 블록이 존재해야 한다')
  assert.notEqual(block.blockState, 'blocked')
  assert.equal(block.targetPrice, 300000)
  assert.equal(block.currentPrice, dailySeries[259].close)
})

test('buildKrDeepScanPayloadViaCrawler preserves low-confidence similar-pattern evidence when recovery days are unavailable', async () => {
  const crawlerPayload = {
    recoveryForecastRaw: {
      forecast: {
        status: 'low_confidence',
        reason: '하나 이상의 하위 모델이 낮은 신뢰도로 계산되었습니다.',
        models: {
          gbm: { medianRecoveryDays: 15, recoveryProbabilityPct: 100 },
          jumpDiffusion: { medianRecoveryDays: 13, recoveryProbabilityPct: 100 },
        },
        consensus: {
          expectedRecoveryDays: 14,
          recoveryProbabilityPct: 100,
          confidence: { level: 'medium' },
          disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다.',
        },
        modelDetails: {
          similarPattern: {
            status: 'low_confidence',
            reason: '유사 패턴 샘플 수가 충분하지 않습니다.',
            medianRecoveryDays: null,
            recoveryProbabilityPct: 0,
            sampleCount: 1,
            recoveredSampleCount: 0,
          },
        },
      },
      currentPrice: 25150,
      targetPrice: 49256.7334,
    },
  }
  const rawInput: DeepScanRawInput = {
    instrument: { name: 'SNT에너지', code: '100840', market: 'KR', kind: 'stock' },
    sourceContext: { from: 'holding' },
  }

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(crawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    { fetchTimeoutMs: 1000 },
  ) as Record<string, unknown>

  const block = payload.recoveryForecast as Record<string, unknown>
  const rows = block.modelRows as Array<Record<string, unknown>>
  assert.deepEqual(rows[0], {
    label: '유사 패턴',
    recoveryDaysText: 'N/A',
    probabilityText: '0%',
    sampleText: '1건',
  })
})

test('buildKrDeepScanPayloadViaCrawler leaves payload without recoveryForecast when crawler raw envelope is unavailable', async () => {
  const crawlerPayload = {
    recoveryForecastRaw: {
      forecast: { status: 'unavailable', reason: '과거 주가 데이터가 부족합니다.', models: {}, consensus: null },
      currentPrice: 20050,
      targetPrice: 28000,
    },
  }
  const rawInput: DeepScanRawInput = {
    instrument: { name: '코칩', code: '126730', market: 'KR', kind: 'stock' },
    sourceContext: { from: 'holding' },
  }

  const payload = await buildKrDeepScanPayloadViaCrawler(
    rawInput,
    (async () => new Response(JSON.stringify(crawlerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
    { fetchTimeoutMs: 1000 },
  ) as Record<string, unknown>

  assert.equal(payload.recoveryForecastRaw, undefined)
  const block = payload.recoveryForecast as Record<string, unknown>
  assert.ok(block, 'unavailable forecast still attaches a recovery block (consistent with US path)')
  assert.equal(block.blockState, 'blocked')
  assert.equal(block.statusText, '예측 보류')
})
