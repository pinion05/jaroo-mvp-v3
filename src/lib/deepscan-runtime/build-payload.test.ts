import test from 'node:test'
import assert from 'node:assert/strict'

import type { JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import {
  appendKrRecoveryForecastToPayload,
  buildDeepScanRecoveryForecastBlock,
  buildKrYahooChartSymbolCandidates,
  describeMomentumProvenance,
  extractYahooChartRecoverySeries,
  extractGeneratedOhlcSeries,
  summarizeGeneratedDumpSignals,
} from './build-payload'

function createYahooChartPayload(closes: number[]) {
  const start = Date.UTC(2025, 0, 1) / 1000

  return {
    chart: {
      result: [
        {
          timestamp: closes.map((_, index) => start + (index * 86400)),
          indicators: {
            quote: [
              {
                close: closes,
              },
            ],
          },
        },
      ],
    },
  }
}

function createCanonicalPayload(): JarooDeepScanPayload {
  return {
    input: {
      instrument: {
        name: 'SOOP',
        code: '067160',
        ticker: '067160.KQ',
        market: 'KOSDAQ',
        kind: 'stock',
      },
      holding: {
        shares: '3주',
        averagePrice: '64,784원',
        evaluationAmount: '181,137원',
      },
      sourceContext: { from: 'holding' },
    },
    hero: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      headline: 'SOOP KR DeepScan 60점',
      body: 'body',
      statusText: '관찰',
      score: 60,
      scoreLabel: 'moderate · 60 / 100',
      scoreDelta: '+0',
    },
    committee: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, axes: [] },
    insights: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, sectionLabel: 'KR evidence snapshot', items: [], summaryTags: [] },
    strategy: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      weekSignal: '관찰',
      weekSignalTone: 'warning',
      weekBadgeText: '관찰',
      scenarioLabel: '기본',
      scenarioProbability: '60%',
      scenarioPeriod: '1-2주',
      scenarioCondition: 'cond',
      currentPriceText: '60,379원',
      targetPriceText: '목표가 근거 없음',
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, realizedText: 'text', rows: [] },
    portfolioSimulation: { blockState: 'ok', sourceRefs: [], fallback: null, error: null, beforeScore: 60, afterScore: 65, deltaLabel: 'hold:+5', caption: 'caption' },
    metadata: {
      generatedAt: '2026-04-24T00:00:00.000Z',
      version: 'test',
      degraded: false,
      debugId: 'deepscan:KR:067160',
      inputValidity: { valid: true, raw: {} },
      sourceRefs: [
        {
          type: 'market',
          id: 'current-quote:067160',
          label: 'current quote',
        },
      ],
      blockStatus: {
        hero: 'ok',
        committee: 'ok',
        insights: 'ok',
        strategy: 'ok',
        sellNow: 'ok',
        portfolioSimulation: 'ok',
      },
    },
  }
}

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

test('buildKrYahooChartSymbolCandidates resolves KOSDAQ tickers before KOSPI fallback', () => {
  assert.deepEqual(
    buildKrYahooChartSymbolCandidates({
      instrument: { name: 'SOOP', code: '067160', ticker: '067160.KQ', market: 'KOSDAQ', kind: 'stock' },
      holding: { shares: '3주', averagePrice: '64,784원', evaluationAmount: '181,137원' },
      sourceContext: { from: 'home-handoff' },
    }),
    ['067160.KQ', '067160.KS'],
  )

  assert.deepEqual(
    buildKrYahooChartSymbolCandidates({
      instrument: { name: '파미셀', code: '005690', market: 'KOSPI', kind: 'stock' },
      holding: { shares: '7주', averagePrice: '18,839원', evaluationAmount: '124,491원' },
      sourceContext: { from: 'home-handoff' },
    }),
    ['005690.KS', '005690.KQ'],
  )
})

test('extractYahooChartRecoverySeries converts Yahoo chart closes into recovery series points', () => {
  const series = extractYahooChartRecoverySeries(createYahooChartPayload([70000, 60379, 64784]))

  assert.deepEqual(series, [
    { date: '2025-01-01', close: 70000 },
    { date: '2025-01-02', close: 60379 },
    { date: '2025-01-03', close: 64784 },
  ])
})

test('appendKrRecoveryForecastToPayload adds KR OCR/home recovery forecast for DeepScan UI', async () => {
  const basePayload = createCanonicalPayload()
  const chartPayload = createYahooChartPayload(Array.from({ length: 80 }, (_, index) => [70000, 60379, 64784, 70000][index % 4]))
  const requestedUrls: string[] = []
  const fetcher = async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input))
    return new Response(JSON.stringify(chartPayload), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  const payload = await appendKrRecoveryForecastToPayload(
    basePayload,
    {
      instrument: { name: 'SOOP', code: '067160', ticker: '067160.KQ', market: 'KOSDAQ', kind: 'stock' },
      holding: { shares: '3주', averagePrice: '64,784원', evaluationAmount: '181,137원' },
      sourceContext: { from: 'home-handoff' },
    },
    fetcher as typeof fetch,
  )

  assert.match(requestedUrls[0] ?? '', /067160\.KQ/)
  assert.equal(payload.recoveryForecast?.blockState, 'ok')
  assert.equal(payload.recoveryForecast?.currentPriceText, '60,379원')
  assert.equal(payload.recoveryForecast?.targetPriceText, '64,784원')
  assert.equal(payload.recoveryForecast?.drawdownText, '6.8%')
  assert.match(payload.recoveryForecast?.summaryText ?? '', /평단 64,784원 회복/)
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
