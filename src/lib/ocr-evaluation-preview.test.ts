import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvaluationPreviewKey,
  computeEvaluationPreviewAmount,
  fetchCurrentPricesForEvaluationPreview,
  formatEvaluationPreviewAmount,
} from './ocr-evaluation-preview'

type PreviewRow = Parameters<typeof computeEvaluationPreviewAmount>[0]

function krRow(overrides: Partial<PreviewRow> = {}): PreviewRow {
  return {
    quantity: '10',
    evaluationAmount: '',
    resolvedMarketTone: 'kospi',
    resolvedCode: '005930',
    ...overrides,
  }
}

function usRow(overrides: Partial<PreviewRow> = {}): PreviewRow {
  return {
    quantity: '0.5',
    evaluationAmount: '',
    resolvedMarketTone: 'nasdaq',
    resolvedTicker: 'AAPL',
    ...overrides,
  }
}

function createFetchMock(payload: unknown, ok = true) {
  const requestedUrls: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input))
    return new Response(JSON.stringify(payload), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return { fetcher, requestedUrls }
}

test('buildEvaluationPreviewKey는 평가금이 비어 있는 행의 룩업 키만 정렬해 모은다', () => {
  const key = buildEvaluationPreviewKey([
    krRow({ resolvedCode: '226490' }),
    krRow({ resolvedCode: '005930', evaluationAmount: '1,000,000' }),
    usRow({ resolvedTicker: 'aapl' }),
    krRow({ resolvedCode: undefined, resolvedTicker: undefined }),
  ])

  assert.equal(key, '226490,AAPL')
})

test('buildEvaluationPreviewKey는 대상이 없으면 빈 문자열을 반환한다', () => {
  assert.equal(buildEvaluationPreviewKey([krRow({ evaluationAmount: '1,000' })]), '')
})

test('fetchCurrentPricesForEvaluationPreview는 KR 코드와 US 티커를 한 번의 배치 조회로 가져온다', async () => {
  const { fetcher, requestedUrls } = createFetchMock({
    data: {
      items: [
        { market: 'KOSPI', code: '226490', price: 25_610, status: 'ok' },
        { market: 'US', ticker: 'aapl', price: 224.18, status: 'ok' },
        { market: 'KOSPI', code: '999999', price: 1000, status: 'missing' },
      ],
    },
  })

  const prices = await fetchCurrentPricesForEvaluationPreview([krRow({ resolvedCode: '226490' }), usRow()], fetcher)

  assert.equal(requestedUrls.length, 1)
  assert.equal(requestedUrls[0], '/api/quotes/current?codes=226490&tickers=AAPL')
  assert.equal(prices.get('226490'), 25_610)
  assert.equal(prices.get('AAPL'), 224.18)
  assert.equal(prices.has('999999'), false)
})

test('fetchCurrentPricesForEvaluationPreview는 평가금이 있는 행은 조회하지 않는다', async () => {
  const { fetcher, requestedUrls } = createFetchMock({ data: { items: [] } })

  const prices = await fetchCurrentPricesForEvaluationPreview([krRow({ evaluationAmount: '1,000,000' })], fetcher)

  assert.equal(requestedUrls.length, 0)
  assert.equal(prices.size, 0)
})

test('fetchCurrentPricesForEvaluationPreview는 응답 실패 시 조용히 빈 Map을 반환한다', async () => {
  const failure = createFetchMock({ data: { items: [] } }, false)
  assert.equal((await fetchCurrentPricesForEvaluationPreview([krRow()], failure.fetcher)).size, 0)

  const throwingFetcher = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  assert.equal((await fetchCurrentPricesForEvaluationPreview([krRow()], throwingFetcher)).size, 0)
})

test('computeEvaluationPreviewAmount는 현재가×수량을 계산한다', () => {
  const prices = new Map([
    ['226490', 25_610],
    ['AAPL', 224.18],
  ])

  assert.equal(computeEvaluationPreviewAmount(krRow({ resolvedCode: '226490', quantity: '111' }), prices), 25_610 * 111)
  assert.equal(computeEvaluationPreviewAmount(usRow({ quantity: '0.5' }), prices), 224.18 * 0.5)
})

test('computeEvaluationPreviewAmount는 평가금이 있거나 재료가 없으면 null을 반환한다', () => {
  const prices = new Map([
    ['005930', 50_000],
    ['226490', 25_610],
  ])

  assert.equal(computeEvaluationPreviewAmount(krRow({ evaluationAmount: '1,000,000' }), prices), null)
  assert.equal(computeEvaluationPreviewAmount(krRow({ resolvedCode: '999999' }), prices), null)
  assert.equal(computeEvaluationPreviewAmount(krRow({ quantity: '0' }), prices), null)
  assert.equal(computeEvaluationPreviewAmount(krRow({ quantity: 'N/A' }), prices), null)
  assert.equal(computeEvaluationPreviewAmount(krRow(), null), null)
})

test('computeEvaluationPreviewAmount는 대시·NA 형태의 비어 있는 평가금도 프리뷰 대상으로 본다', () => {
  const prices = new Map([['226490', 25_610]])

  assert.equal(computeEvaluationPreviewAmount(krRow({ resolvedCode: '226490', evaluationAmount: '-' }), prices), 25_610 * 10)
  assert.equal(computeEvaluationPreviewAmount(krRow({ resolvedCode: '226490', evaluationAmount: 'N.A.' }), prices), 25_610 * 10)
})

test('formatEvaluationPreviewAmount는 시장에 맞는 통화 표기와 근사 기호를 붙인다', () => {
  assert.equal(formatEvaluationPreviewAmount(2_842_710, 'kospi'), '≈ 2,842,710원')
  assert.equal(formatEvaluationPreviewAmount(112.09, 'nasdaq'), '≈ $112')
})
