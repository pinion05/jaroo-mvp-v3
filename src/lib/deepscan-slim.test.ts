import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeepScanSlimSummaryKey,
  clearCachedDeepScanSlimSummary,
  fetchDeepScanSlimSummary,
  normalizeDeepScanSlimPayload,
  prefetchAndPersistDeepScanSlimSummary,
  readCachedDeepScanSlimSummary,
  resolveDeepScanSlimRequest,
} from './deepscan-slim'

test('KR slim payload를 deepscan summary로 정규화한다', () => {
  const summary = normalizeDeepScanSlimPayload({
    company: { code: '005930', name: '삼성전자' },
    pages: {
      'investment-indicators': {
        metrics: [
          {
            rows: [
              { '항목': 'ROE', '2025/12 (IFRS연결) 연간컨센서스': '10.85' },
              { '항목': '영업이익률', '2025/12 (IFRS연결) 연간컨센서스': '13.07' },
            ],
          },
        ],
      },
      opinion: {
        reportSummaries: [
          {
            '일자': '2026/04/08',
            '종목명 - 리포트 요약': '삼성전자A005930-메모리 업황 개선 지속',
            '제공처/작성자': '테스트증권 홍길동',
          },
        ],
      },
    },
  }, { market: 'KR', identifier: '005930' })

  assert.equal(summary.header.name, '삼성전자')
  assert.equal(summary.metrics.some((metric) => metric.label === 'ROE' && metric.value === '10.85'), true)
  assert.equal(summary.highlights[0]?.title.includes('메모리 업황 개선 지속'), true)
})

test('US slim payload를 deepscan summary로 정규화한다', () => {
  const summary = normalizeDeepScanSlimPayload({
    company: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ' },
    pages: {
      snap: {
        priceVolume: {
          rows: [{ date: '2026-04-13', close: 259.2 }],
        },
        news: [
          {
            publishedAt: '2026-04-10T00:00:00.000Z',
            titles: { ko: '애플 1분기 출하량 1위', en: 'Apple leads shipments' },
          },
        ],
      },
      analysis: {
        metrics: [
          { ticker: 'AAPL-US', per: 34.1, pbr: 51.0, roe: 171.4, epsGw: 22.7 },
        ],
      },
    },
  }, { market: 'US', identifier: 'AAPL' })

  assert.equal(summary.header.name, 'Apple')
  assert.equal(summary.header.currentPriceText, '$259.20')
  assert.equal(summary.metrics.some((metric) => metric.label === 'PER' && metric.value === '34.1'), true)
  assert.equal(summary.highlights[0]?.title, '애플 1분기 출하량 1위')
})

test('holding에서 deepscan slim 요청과 key를 만든다', () => {
  const krRequest = resolveDeepScanSlimRequest({ code: '005930', identifierCode: '005930', identifierTicker: undefined } as never)
  const usRequest = resolveDeepScanSlimRequest({ code: undefined, identifierCode: undefined, identifierTicker: 'aapl' } as never)

  assert.deepEqual(krRequest, { market: 'KR', identifier: '005930' })
  assert.deepEqual(usRequest, { market: 'US', identifier: 'AAPL' })
  assert.equal(buildDeepScanSlimSummaryKey(usRequest!), 'US:AAPL')
})

test('deepscan slim summary를 fetch 후 메모리 캐시에 저장한다', async () => {
  clearCachedDeepScanSlimSummary()
  const requestedUrls: string[] = []

  const summary = await fetchDeepScanSlimSummary(
    { market: 'KR', identifier: '005930' },
    async (url) => {
      requestedUrls.push(String(url))
      return new Response(JSON.stringify({
      company: { code: '005930', name: '삼성전자' },
      pages: {
        'investment-indicators': { metrics: [{ rows: [{ '항목': 'ROE', latest: '10.85' }] }] },
        opinion: { reportSummaries: [] },
      },
    }), { status: 200 })
    },
  )

  assert.equal(summary?.header.identifier, '005930')
  assert.equal(requestedUrls[0], '/api/deepscan/slim?market=KR&code=005930&version=v1.2')

  const cached = await prefetchAndPersistDeepScanSlimSummary(
    { code: '005930', identifierCode: '005930', identifierTicker: undefined } as never,
    async (url) => {
      requestedUrls.push(String(url))
      return new Response(JSON.stringify({
      company: { code: '005930', name: '삼성전자' },
      pages: {
        'investment-indicators': { metrics: [{ rows: [{ '항목': 'ROE', latest: '10.85' }] }] },
        opinion: { reportSummaries: [] },
      },
    }), { status: 200 })
    },
  )

  assert.equal(cached?.key, 'KR:005930')
  assert.equal(requestedUrls[1], '/api/deepscan/slim?market=KR&code=005930&version=v1.2')
  assert.equal(readCachedDeepScanSlimSummary()?.summary.header.name, '삼성전자')

  clearCachedDeepScanSlimSummary()
})
