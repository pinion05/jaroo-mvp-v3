import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

import {
  buildHaltDisclosuresUpstreamUrl,
  classifyHaltFilings,
  clearHaltDisclosuresCache,
  handleHaltDisclosuresRequest,
} from './route'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function haltRequest(code?: string) {
  const query = code ? `?code=${code}` : ''
  return new NextRequest(`http://localhost/api/deepscan/halt${query}`)
}

function crawlerFilingsPayload() {
  return {
    ok: true,
    data: {
      filings: [
        {
          reportName: '반기보고서 (2026.06)',
          receiptDate: '2026-08-14',
          disclosureTypeLabel: '정기공시',
          documentUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=3',
        },
        {
          reportName: '주권매매거래정지',
          receiptDate: '2026-09-19',
          disclosureTypeLabel: '거래소공시',
          documentUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1',
        },
        {
          reportName: '자본잠식 상각 등 자본변동',
          receiptDate: '2026-09-18',
          disclosureTypeLabel: '주요사항보고',
          documentUrl: null,
        },
      ],
    },
  }
}

test('classifyHaltFilings — 위험 키워드 분류·날짜 내림차순·요약 산출', () => {
  const data = classifyHaltFilings(crawlerFilingsPayload(), '030350')

  assert.equal(data.code, '030350')
  assert.equal(data.windowDays, 90)
  assert.equal(data.filings.length, 3)
  // receiptDate 내림차순
  assert.equal(data.filings[0].reportName, '주권매매거래정지')
  assert.equal(data.filings[0].severity, 'high')
  assert.equal(data.filings[1].reportName, '자본잠식 상각 등 자본변동')

  assert.equal(data.summary.totalCount, 3)
  assert.equal(data.summary.maxSeverity, 'high')
  assert.equal(data.summary.severityLevel, 3)
  // 주권매매거래정지(trading-halt) + 자본잠식(financial-distress) 모두 high
  assert.equal(data.summary.riskCount, 2)
  assert.ok(data.summary.signals.length >= 2)
  assert.equal(data.summary.signals[0].label, '매매거래정지')
  assert.equal(data.summary.signals[0].count, 1)
  assert.equal(data.summary.signals[1].label, '부도/회생/자본잠식')
})

test('classifyHaltFilings — 상폐 키워드는 critical 4단계로 승격한다', () => {
  const payload = {
    ok: true,
    data: {
      filings: [
        { reportName: '상장폐지결정 및 정리매매 기간 안내', receiptDate: '2026-09-20', disclosureTypeLabel: '거래소공시', documentUrl: null },
      ],
    },
  }

  const data = classifyHaltFilings(payload, '030350')
  assert.equal(data.summary.maxSeverity, 'critical')
  assert.equal(data.summary.severityLevel, 4)
  assert.equal(data.summary.riskCount, 1)
})

test('classifyHaltFilings — 공시 없음은 1단계(관심)', () => {
  const data = classifyHaltFilings({ ok: true, data: { filings: [] } }, '030350')
  assert.equal(data.summary.totalCount, 0)
  assert.equal(data.summary.maxSeverity, 'low')
  assert.equal(data.summary.severityLevel, 1)
  assert.deepEqual(data.summary.signals, [])
})

test('classifyHaltFilings — reportName 없는 행은 건너뛴다', () => {
  const data = classifyHaltFilings({
    ok: true,
    data: { filings: [{ receiptDate: '2026-09-01' }, { reportName: '   ', receiptDate: '2026-09-02' }] },
  }, '030350')
  assert.equal(data.filings.length, 0)
})

test('buildHaltDisclosuresUpstreamUrl — 90일 창·페이지 크기·내림차순 쿼리', () => {
  const url = buildHaltDisclosuresUpstreamUrl('http://crawler:3040', '030350', new Date('2026-09-23T00:00:00+09:00').getTime())
  assert.ok(url.startsWith('http://crawler:3040/api/source/opendart/kr/stocks/030350/disclosures?'))
  assert.match(url, /from=2026-06-25/u)
  assert.match(url, /to=2026-09-23/u)
  assert.match(url, /pageCount=50/u)
  assert.match(url, /sort=date/u)
  assert.match(url, /sortMth=desc/u)
})

test('handleHaltDisclosuresRequest — 잘못된 code는 400', async () => {
  clearHaltDisclosuresCache()

  const invalid = await handleHaltDisclosuresRequest(haltRequest('12345'), { cacheTtlMs: 0 })
  assert.equal(invalid.status, 400)

  const missing = await handleHaltDisclosuresRequest(haltRequest(), { cacheTtlMs: 0 })
  assert.equal(missing.status, 400)
})

test('handleHaltDisclosuresRequest — 업스트림 성공 응답 분류', async () => {
  clearHaltDisclosuresCache()

  let fetchedUrl = ''
  const fetcher: typeof fetch = async (input) => {
    fetchedUrl = String(input)
    return jsonResponse(crawlerFilingsPayload())
  }

  const response = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher,
    cacheTtlMs: 0,
  })

  assert.equal(response.status, 200)
  assert.ok(fetchedUrl.includes('/kr/stocks/030350/disclosures'))
  const body = (await response.json()) as { ok: boolean; data: { summary: { severityLevel: number } } }
  assert.equal(body.ok, true)
  assert.equal(body.data.summary.severityLevel, 3)
})

test('handleHaltDisclosuresRequest — TTL 내 재요청은 업스트림을 다시 치지 않는다', async () => {
  clearHaltDisclosuresCache()

  let fetchCount = 0
  const fetcher: typeof fetch = async () => {
    fetchCount += 1
    return jsonResponse(crawlerFilingsPayload())
  }
  const now = { value: 1_000 }

  const first = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher,
    cacheTtlMs: 60_000,
    now: () => now.value,
  })
  const second = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher,
    cacheTtlMs: 60_000,
    now: () => now.value,
  })

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(fetchCount, 1)

  // TTL 경과 후에는 다시 조회한다
  now.value += 61_000
  const third = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher,
    cacheTtlMs: 60_000,
    now: () => now.value,
  })
  assert.equal(third.status, 200)
  assert.equal(fetchCount, 2)
})

test('handleHaltDisclosuresRequest — 업스트림 실패는 1회 재시도 후 502 한국어 안내', async () => {
  clearHaltDisclosuresCache()

  let fetchCount = 0
  const fetcher: typeof fetch = async () => {
    fetchCount += 1
    return jsonResponse({ ok: false }, 500)
  }
  const response = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher,
    cacheTtlMs: 0,
    retryDelayMs: 0,
  })

  assert.equal(response.status, 502)
  assert.equal(fetchCount, 2)
  const body = (await response.json()) as { ok: boolean; error: { message: string } }
  assert.equal(body.ok, false)
  assert.equal(body.error.message, '거래정지 공시 정보를 불러오지 못했어요.')
})

// 타임아웃까지 대기하다 abort 시그널을 존중해 거부하는 업스트림 fetch 목.
function hangingFetcher(onCall?: (call: number) => void): typeof fetch {
  let call = 0
  return ((input, init) => {
    call += 1
    onCall?.(call)
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve(jsonResponse(crawlerFilingsPayload()))
      }, 400)
      const signal = (init as RequestInit | undefined)?.signal
      const onAbort = () => {
        cleanup()
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      }
      const cleanup = () => {
        clearTimeout(timer)
        if (signal instanceof AbortSignal) {
          signal.removeEventListener('abort', onAbort)
        }
      }
      if (signal instanceof AbortSignal) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }) as typeof fetch
}

test('handleHaltDisclosuresRequest — 첫 시도 타임아웃, 재시도 성공이면 200', async () => {
  clearHaltDisclosuresCache()

  // 1차: 타임아웃(100ms)보다 오래 걸려 중단 → 2차: 즉시 성공
  let firstCallDone = false
  const fetcher: typeof fetch = (input, init) => {
    if (firstCallDone) {
      return Promise.resolve(jsonResponse(crawlerFilingsPayload()))
    }
    firstCallDone = true
    return hangingFetcher()(input, init)
  }

  const response = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher,
    cacheTtlMs: 0,
    timeoutMs: 100,
    retryDelayMs: 0,
  })

  assert.equal(response.status, 200)
  const body = (await response.json()) as { ok: boolean; data: { summary: { totalCount: number } } }
  assert.equal(body.ok, true)
  assert.equal(body.data.summary.totalCount, 3)
})

test('handleHaltDisclosuresRequest — 두 시도 모두 타임아웃이면 504', async () => {
  clearHaltDisclosuresCache()

  let fetchCount = 0
  const response = await handleHaltDisclosuresRequest(haltRequest('030350'), {
    fetcher: hangingFetcher(() => {
      fetchCount += 1
    }),
    cacheTtlMs: 0,
    timeoutMs: 100,
    retryDelayMs: 0,
  })

  assert.equal(response.status, 504)
  assert.equal(fetchCount, 2)
  const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } }
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'upstream-timeout')
  assert.equal(body.error.message, '거래정지 공시 정보 요청이 시간 초과됐어요.')
})
