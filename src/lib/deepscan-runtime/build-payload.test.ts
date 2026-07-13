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
  assert.match(block.summaryText, /평단 \$121\.00 회복/)
  assert.match(block.expectedRecoveryDaysText, /거래일|이미 도달/)
  assert.notEqual(block.recoveryProbabilityText, 'N/A')
  assert.equal(block.currentPriceText, '$100.00')
  assert.equal(block.targetPriceText, '$121.00')
  assert.equal(block.modelRows.length, 3)
  assert.match(block.disclaimer, /투자 권유/)
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
      (() => new Promise<Response>(() => undefined)) as typeof fetch,
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
