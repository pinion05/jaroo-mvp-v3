// 화이트박스 TC — "캐시된 딥스캔을 불러올 때 LLM 호출 비용이 발생하는가" (2026-11-13)
// 대상 경로 (d): crawler 내부 — packages/crawler/src/services/deepscan-payload.js
//
// LLM HTTP 층 가로채기: globalThis.fetch를 스텁으로 교체해 OpenRouter 호출만
// 카운트한다. 실제 네트워크·API 키 사용은 절대 없다(응답은 전부 스텁).
//
// 검증 계약:
//   TC-DLLM-1  캐시 미스 신규 런(buildJarooDeepScanPayload) = 위원회 LLM 정확히 9회
//   TC-DLLM-2  crawler 딥스캔 페이로드 경로에는 위원회 'LLM 결과' 캐시가 없다
//              (동일 입력 재호출 = 9회 추가, 누적 18회)
//   TC-DLLM-3  committeeLlm=off 요청 토글 = LLM 0회
//   TC-DLLM-4  crawler 캐시(supabase-crawler-cache)는 '데이터 소스' 캐시다 —
//              fresh 히트 시 loader(크롤)를 부르지 않으며 LLM과 무관하다//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildJarooDeepScanPayload, loadWiseReportKrSlimSource } from '../packages/crawler/src/services/deepscan-payload.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** OpenRouter 카운팅 스텁 — committee-llm.js requestCommitteeAttempt가 파싱·검증을
 *  통과하는 형태({choices:[{message:{content}}]})를 반환한다. */
function createLlmCountingFetchStub() {
  const calls = []
  const stub = async (input, init = {}) => {
    const url = String(input)
    if (!url.includes('openrouter.ai')) {
      throw new Error(`unexpected non-LLM upstream fetch in test: ${url}`)
    }
    calls.push({
      url,
      auth: init?.headers?.Authorization ?? null,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({ score: 62, reason: '화이트박스 테스트 위원 근거 문장입니다.', confidence: 'medium' }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return { calls, stub }
}

/** sources를 주입해 크롤 네트워크(와이즈리포트·DART·시세)를 전부 고정한다 —
 *  resolveKrSourceBundle이 rawInput.sources를 그대로 쓰기 때문(화이트박스 고정). */
function createKrRawInput(overrides = {}) {
  return {
    instrument: { name: '화이트박스전자', code: '005930', market: 'KR' },
    holding: { shares: '10', averagePrice: '70000' },
    selectedAt: '2026-11-13T09:00:00.000Z',
    sourceContext: { from: 'holding' },
    sources: {},
    ...overrides,
  }
}

const ENV_KEYS = ['OPENROUTER_API_KEY', 'JAROO_LLM_MOCK', 'DEEPSCAN_KR_LLM_ENABLE', 'DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS']

function withLlmEnv(run) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  return async (testFn) => {
    // 실 호출 방지 조건: mock 끔 + 키는 테스트용 가짜 값(스텁이 응답하므로 네트워크 0)
    delete process.env.JAROO_LLM_MOCK
    delete process.env.DEEPSCAN_KR_LLM_ENABLE
    process.env.OPENROUTER_API_KEY = 'wb-test-key-no-real-call'
    try {
      return await testFn()
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      globalThis.fetch = originalFetch
    }
  }
}

test('TC-DLLM-1: 캐시 미스 신규 런 — buildJarooDeepScanPayload는 위원회 LLM을 정확히 9회 호출한다', async () => {
  const guard = withLlmEnv()
  await guard(async () => {
    const { calls, stub } = createLlmCountingFetchStub()
    globalThis.fetch = stub

    const payload = await buildJarooDeepScanPayload(createKrRawInput())

    // 9멤버 위원회(KR_MEMBER_SPECS 9키) × 1시도(스텁 즉시 성공) = 9
    assert.equal(calls.length, 9, `OpenRouter 호출 수는 9여야 한다 (실제 ${calls.length})`)
    for (const call of calls) {
      assert.equal(call.auth, 'Bearer wb-test-key-no-real-call')
      assert.equal(call.body.model, 'deepseek/deepseek-v4-flash')
    }
    // 위원회 전원 성공 — 페이로드 메타에도 남는다
    assert.equal(payload.metadata.llmCommittee.status, 'complete')
    assert.equal(payload.metadata.llmCommittee.completed, 9)
    assert.equal(payload.metadata.llmCommittee.errors, 0)
  })
})

test('TC-DLLM-2: crawler 딥스캔 페이로드 경로엔 위원회 LLM 결과 캐시가 없다 — 재호출 = 9회 추가(누적 18)', async () => {
  const guard = withLlmEnv()
  await guard(async () => {
    const { calls, stub } = createLlmCountingFetchStub()
    globalThis.fetch = stub

    await buildJarooDeepScanPayload(createKrRawInput())
    assert.equal(calls.length, 9, '1차 런 = 9')

    // 동일 입력 재호출 — crawler 캐시(wisereport slim)는 데이터 소스에만 있고
    // 위원회 LLM 결과 캐시는 없으므로 9멤버가 그대로 재계산된다.
    await buildJarooDeepScanPayload(createKrRawInput())
    assert.equal(calls.length, 18, `재호출 후에도 9회 더 불려야 한다(누적 18, 실제 ${calls.length})`)
  })
})

test('TC-DLLM-3: committeeLlm=off — 요청 토글로 위원회 LLM 0회(워치 배치 계약)', async () => {
  const guard = withLlmEnv()
  await guard(async () => {
    const { calls, stub } = createLlmCountingFetchStub()
    globalThis.fetch = stub

    const payload = await buildJarooDeepScanPayload(createKrRawInput({ committeeLlm: 'off' }))

    assert.equal(calls.length, 0, 'LLM 호출은 0회여야 한다')
    assert.equal(payload.metadata.llmCommittee, undefined, '위원회 실행 기록이 없어야 한다')
    // 규칙 점수(deterministic) 축은 그대로 만들어진다
    assert.ok(Array.isArray(payload.committee.axes) && payload.committee.axes.length > 0)
  })
})

test('TC-DLLM-4: crawler 캐시는 데이터 소스 캐시 — fresh 히트 시 loader(크롤) 0회, LLM과 무관', async () => {
  const input = {
    instrument: { name: '화이트박스전자', code: '005930', market: 'KR' },
    holding: { shares: '10', averagePrice: '70000' },
    selectedAt: '2026-11-13T09:00:00.000Z',
    sourceContext: { from: 'holding' },
  }
  const freshRow = {
    id: 'wb-row-1',
    status: 'fresh',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    stale_after: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    payload: { code: '005930', company: { code: '005930', name: '화이트박스전자' }, pages: {} },
  }
  let loaderCalls = 0
  const cacheClient = {
    readPayload: async () => freshRow,
    upsertPayload: async () => {},
    recordEvent: async () => {},
  }

  const value = await loadWiseReportKrSlimSource(input, {
    cacheClient,
    loadSlim: async () => {
      loaderCalls += 1
      return {}
    },
  })

  assert.equal(loaderCalls, 0, 'fresh 캐시 히트면 크롤 loader를 부르지 않는다')
  assert.deepEqual(value, freshRow.payload, '캐시된 소스 데이터가 그대로 반환된다')
})
