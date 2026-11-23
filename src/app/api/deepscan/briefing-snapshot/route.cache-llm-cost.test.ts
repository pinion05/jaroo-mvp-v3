// 화이트박스 TC — "캐시된 딥스캔(로딩 브리핑)을 불러올 때 LLM 호출 비용이 발생하는가"
// 대상 경로 (a): src/app/api/deepscan/briefing-snapshot/route.ts — 인메모리 결과 캐시
//
// fetcher DI(handleBriefingSnapshotRequest options.fetcher)로 업스트림 HTTP 층을
// 가로채 URL 로그를 남긴다. 실제 네트워크·OpenRouter 호출은 없다.
//
// 검증 계약:
//   TC-BRF-1  briefing-snapshot은 업스트림(Naver 주가)만 호출 — openrouter.ai URL 0회
//   TC-BRF-2  인메모리 캐시 히트(동일 code, TTL 내 재요청) = 업스트림 fetch 0회
//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md

import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

import { clearBriefingSnapshotCache, handleBriefingSnapshotRequest } from './route'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** URL 기록 업스트림 스텁 — Naver 계열만 응답하고 호출 URL을 전부 남긴다. */
function createUpstreamRecorder() {
  const urls: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/index/')) {
      return jsonResponse({ closePrice: '2,500', fluctuationsRatio: '0.42', localTradedAt: '2026-11-13T09:30:00+09:00' })
    }
    if (url.includes('/basic')) {
      return jsonResponse({
        closePrice: '50,000',
        localTradedAt: '2026-11-13T09:30:00+09:00',
        marketStatus: 'CLOSE',
        stockExchangeName: 'KOSPI',
      })
    }
    return jsonResponse([
      { localTradedAt: '2026-11-11', closePrice: '49,500', openPrice: '49,000', highPrice: '50,100', lowPrice: '48,900', accumulatedTradingVolume: 1_000_000, fluctuationsRatio: '-0.8' },
      { localTradedAt: '2026-11-12', closePrice: '50,000', openPrice: '49,800', highPrice: '50,400', lowPrice: '49,600', accumulatedTradingVolume: 1_100_000, fluctuationsRatio: '1.0' },
    ])
  }) as typeof fetch
  return { urls, fetcher }
}

function createBriefingRequest(code: string) {
  return new NextRequest(`http://localhost/api/deepscan/briefing-snapshot?code=${code}`)
}

test('TC-BRF-1: briefing-snapshot 업스트림은 Naver 주가뿐 — openrouter.ai(LLM) 호출 0회', async () => {
  clearBriefingSnapshotCache()
  const { urls, fetcher } = createUpstreamRecorder()

  const response = await handleBriefingSnapshotRequest(createBriefingRequest('005930'), { fetcher, cacheTtlMs: 15_000 })

  assert.equal(response.status, 200)
  assert.ok(urls.length > 0, 'Naver 업스트림은 호출된다(캐시 미스 프라이밍)')
  assert.ok(
    urls.every((url) => url.startsWith('https://m.stock.naver.com/api')),
    `업스트림 URL은 전부 Naver여야 한다: ${urls.join(', ')}`,
  )
  assert.ok(urls.every((url) => !url.includes('openrouter.ai')), 'LLM(openrouter.ai) 호출은 0회여야 한다')
})

test('TC-BRF-2: 인메모리 캐시 히트(동일 code 재요청) — 업스트림 fetch 0회', async () => {
  clearBriefingSnapshotCache()
  const { urls, fetcher } = createUpstreamRecorder()

  const first = await handleBriefingSnapshotRequest(createBriefingRequest('005930'), { fetcher, cacheTtlMs: 15_000 })
  assert.equal(first.status, 200)
  const callsAfterFirst = urls.length
  assert.ok(callsAfterFirst > 0)

  // 캐시 히트 로드 — 같은 code를 TTL 안에 다시 요청한다(재방문 로딩 브리핑 경로)
  const second = await handleBriefingSnapshotRequest(createBriefingRequest('005930'), { fetcher, cacheTtlMs: 15_000 })
  assert.equal(second.status, 200)
  assert.equal(urls.length, callsAfterFirst, '캐시 히트 시 업스트림 fetch는 0회(추가 호출 없음)여야 한다')

  const body = (await second.json()) as { ok: boolean }
  assert.equal(body.ok, true)

  // 전 과정에서 LLM 엔드포인트는 단 한 번도 불리지 않았다
  assert.ok(urls.every((url) => !url.includes('openrouter.ai')))
})
