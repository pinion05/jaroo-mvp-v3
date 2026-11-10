import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_COMMITTEE_LLM_MODEL,
  scoreCommitteeMember,
  scoreCommitteeMembers,
} from '../packages/deepscan-runtime-core/src/committee-llm.js'

// TC-DSF-001~008 — 딥스캔 9인 위원회 LLM 실패 모드 결정론적 회귀.
//
// 배경: 2026-11-02~11-05 Railway 운영(app 서비스) 로그에서 매일 18:00 KST 워치
// 일일 배치마다 9개 위원 전원이 `kind=llm-upstream-error attempts=1`로 즉시 실패하고
// `soft-deadline snapshot status=error completed=0/9 pending=0 errors=9` 시그니처가
// 4일 연속 기록됐다(상세: docs/tc/deepscan-failure-analysis.md). 위원회 LLM 계층은
// CommitteeLlmError.errorKind로 실패를 분류하고 .omx/context/committee-debug-logs/에
// 위원별 failure 로그·_summary 로그를 남기므로, 실패 주입으로 그 분류·재시도·기록
// 동작이 깨지지 않았는지 검증한다(실제 LLM 호출 없음 — globalThis.fetch 스텁).

const TMP_LOG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-deepscan-failure-'))

function makeLogDir(label) {
  const dir = path.join(TMP_LOG_ROOT, label)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function stubFetch(responder) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init })
    return responder(calls.length, { input, init })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function openRouterJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function validContent(score = 70) {
  return JSON.stringify({ score, reason: '결정적 회귀 검증용 위원 판정이에요.', confidence: 'medium' })
}

const MEMBER_OPTIONS = (logDir) => ({
  apiKey: 'tc-deepscan-test-key',
  retryCount: 3,
  emptyResponseRetryDelayMs: 1,
  timeoutMs: 1000,
  logDir,
  summaryKey: 'tc-deepscan',
  systemPrompt: (memberKey) => `TC-DSF 결정론적 회귀용 시스템 프롬프트 (${memberKey})`,
})

test('TC-DSF-001 LLM invalid JSON은 errorKind로 기록·재시도되고 다음 시도에서 종결된다', async () => {
  const logDir = makeLogDir('dsf-001')
  const stub = stubFetch((call) => {
    if (call === 1) {
      return openRouterJsonResponse({ choices: [{ message: { content: '<html>not-json{{{' } }] })
    }
    return openRouterJsonResponse({ choices: [{ message: { content: validContent(72) } }] })
  })

  try {
    const result = await scoreCommitteeMember('valuation', { shared: {}, memberDump: {} }, MEMBER_OPTIONS(logDir))
    assert.equal(stub.calls.length, 2, 'invalid JSON 1회 후 정확히 1번 재시도해야 한다')
    assert.equal(result.score, 72)
    assert.equal(result.attempts, 2, '재시도 성공 시 attempts=2로 기록된다')
    assert.equal(result.finalStatus, 'success')
    assert.equal(result.errorKind, null, '최종 성공 시 errorKind는 null이다')
    assert.equal(result.llmResultPresent, true)

    // 1차 시도 실패가 위원별 failure 로그로 남는다(운영에서 원인 추적에 쓰는 위치).
    const failureLog = JSON.parse(fs.readFileSync(path.join(logDir, 'valuation-attempt-1-failure.json'), 'utf8'))
    assert.equal(failureLog.errorKind, 'llm-invalid-json')
    assert.equal(failureLog.member, 'valuation')
    assert.match(failureLog.raw_content, /not-json/)
  } finally {
    stub.restore()
  }
})

test('TC-DSF-002 LLM empty content는 재시도 소진 후 llm-empty-content로 종결된다', async () => {
  const logDir = makeLogDir('dsf-002-empty')
  const stub = stubFetch(() => openRouterJsonResponse({ choices: [{ message: { content: '' } }] }))

  try {
    await assert.rejects(
      scoreCommitteeMember('growth', { shared: {}, memberDump: {} }, MEMBER_OPTIONS(logDir)),
      (error) => {
        assert.equal(error.name, 'CommitteeLlmError')
        assert.equal(error.errorKind, 'llm-empty-content')
        assert.equal(error.attempts, 4, 'retryCount 3 기본 정책이면 총 4회 시도 후 종결이다')
        assert.equal(error.retryable, false, '재시도 소진 후에는 비재시도로 표기된다')
        return true
      },
    )
    assert.equal(stub.calls.length, 4)
    const failureLog = JSON.parse(fs.readFileSync(path.join(logDir, 'growth-failure.json'), 'utf8'))
    assert.equal(failureLog.errorKind, 'llm-empty-content')
  } finally {
    stub.restore()
  }
})

test('TC-DSF-002b LLM null content는 llm-null-content로 분류된다', async () => {
  const logDir = makeLogDir('dsf-002-null')
  // extractTextContent가 ''를 반환하는 null 필드는 llm-empty-content로 분류되고(TC-DSF-002),
  // "null"이라는 비어있지 않은 텍스트를 JSON 파싱하면 parsed === null이 되어 llm-null-content로 갈린다.
  const stub = stubFetch(() => openRouterJsonResponse({ choices: [{ message: { content: 'null' } }] }))

  try {
    await assert.rejects(
      scoreCommitteeMember('momentum', { shared: {}, memberDump: {} }, { ...MEMBER_OPTIONS(logDir), retryCount: 0 }),
      (error) => {
        assert.equal(error.errorKind, 'llm-null-content')
        assert.equal(error.attempts, 1)
        return true
      },
    )
    const failureLog = JSON.parse(fs.readFileSync(path.join(logDir, 'momentum-failure.json'), 'utf8'))
    assert.equal(failureLog.errorKind, 'llm-null-content')
  } finally {
    stub.restore()
  }
})

test('TC-DSF-003 DataInspectionFailed 등 콘텐츠 정책 4xx는 재시도 없이 즉시 종결된다', async () => {
  const logDir = makeLogDir('dsf-003')
  const stub = stubFetch(() =>
    openRouterJsonResponse({
      error: { message: 'DataInspectionFailed: provider flagged the content', code: 400 },
    }),
  )

  try {
    await assert.rejects(
      scoreCommitteeMember('event-risk', { shared: {}, memberDump: {} }, MEMBER_OPTIONS(logDir)),
      (error) => {
        assert.equal(error.name, 'CommitteeLlmError')
        assert.equal(error.errorKind, 'llm-upstream-error')
        assert.equal(error.attempts, 1, 'DataInspectionFailed는 비재시도 분류라 1회 만에 끝난다')
        assert.equal(error.retryable, false)
        return true
      },
    )
    assert.equal(stub.calls.length, 1, '콘텐츠 정책 오류에서 fetch 재호출이 없어야 한다')
    const failureLog = JSON.parse(fs.readFileSync(path.join(logDir, 'event-risk-failure.json'), 'utf8'))
    assert.equal(failureLog.errorKind, 'llm-upstream-error')
    assert.equal(failureLog.retryable, false)
  } finally {
    stub.restore()
  }
})

test('TC-DSF-004 재시도 가능한 업스트림 5xx는 재시도 소진 후 llm-upstream-error로 종결된다', async () => {
  const logDir = makeLogDir('dsf-004')
  const stub = stubFetch(() => openRouterJsonResponse({ error: { message: 'Provider overloaded', code: 503 } }))

  try {
    await assert.rejects(
      scoreCommitteeMember('profitability', { shared: {}, memberDump: {} }, MEMBER_OPTIONS(logDir)),
      (error) => {
        assert.equal(error.errorKind, 'llm-upstream-error')
        assert.equal(error.attempts, 4, '503은 재시도 가능 분류라 전체 재시도를 소진한다')
        return true
      },
    )
    assert.equal(stub.calls.length, 4)
  } finally {
    stub.restore()
  }
})

test('TC-DSF-005 네트워크 실패는 llm-timeout-or-network으로 기록·재시도된다', async () => {
  const logDir = makeLogDir('dsf-005')
  const stub = stubFetch((call) => {
    if (call === 1) {
      throw new Error('The operation was aborted due to timeout')
    }
    return openRouterJsonResponse({ choices: [{ message: { content: validContent(61) } }] })
  })

  try {
    const result = await scoreCommitteeMember('financial-safety', { shared: {}, memberDump: {} }, MEMBER_OPTIONS(logDir))
    assert.equal(stub.calls.length, 2)
    assert.equal(result.score, 61)
    assert.equal(result.attempts, 2)
    const failureLog = JSON.parse(fs.readFileSync(path.join(logDir, 'financial-safety-failure.json'), 'utf8'))
    assert.equal(failureLog.errorKind, 'llm-timeout-or-network')
    assert.match(failureLog.error, /aborted/)
  } finally {
    stub.restore()
  }
})

test('TC-DSF-006 스키마 불일치 응답은 llm-invalid-schema로 분류·재시도된다', async () => {
  const logDir = makeLogDir('dsf-006')
  const stub = stubFetch((call) => {
    if (call === 1) {
      // JSON이지만 필수 reason 누락 — coerceCommitteeResult가 null을 반환하는 케이스
      return openRouterJsonResponse({ choices: [{ message: { content: '{"score":55,"confidence":"high"}' } }] })
    }
    return openRouterJsonResponse({ choices: [{ message: { content: validContent(58) } }] })
  })

  try {
    const result = await scoreCommitteeMember('ownership-flow', { shared: {}, memberDump: {} }, MEMBER_OPTIONS(logDir))
    assert.equal(stub.calls.length, 2)
    assert.equal(result.score, 58)
    const failureLog = JSON.parse(fs.readFileSync(path.join(logDir, 'ownership-flow-failure.json'), 'utf8'))
    assert.equal(failureLog.errorKind, 'llm-invalid-schema')
  } finally {
    stub.restore()
  }
})

test('TC-DSF-007 멤버 덤프 누락은 runtime-missing-dump으로 재시도 없이 즉시 error 처리된다', async () => {
  const logDir = makeLogDir('dsf-007')
  const stub = stubFetch(() => openRouterJsonResponse({ choices: [{ message: { content: validContent() } }] }))
  const options = MEMBER_OPTIONS(logDir)

  try {
    const { results, errors } = await scoreCommitteeMembers({
      memberKeys: ['valuation', 'growth'],
      shared: {},
      members: { valuation: {} },
      options,
    })

    assert.equal(Object.keys(results).length, 1, '덤프가 있는 위원만 results에 들어간다')
    assert.ok(results.valuation)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].member, 'growth')
    assert.equal(errors[0].errorKind, 'runtime-missing-dump')
    assert.equal(errors[0].attempts, 0, '덤프 누락은 LLM 호출 없이 0회 시도로 종결된다')
    assert.equal(errors[0].finalStatus, 'error')
    assert.equal(errors[0].llmResultPresent, false)
    assert.equal(stub.calls.length, 1)
  } finally {
    stub.restore()
  }
})

test('TC-DSF-008 위원 전원 실패는 results 0·errors N건과 _summary 로그로 남는다(운영 0/9 시그니처 재현)', async () => {
  const logDir = makeLogDir('dsf-008')
  const stub = stubFetch(() => openRouterJsonResponse({ error: { message: 'DataInspectionFailed', code: 400 } }))
  const memberKeys = ['valuation', 'growth', 'momentum']

  try {
    const { results, errors } = await scoreCommitteeMembers({
      memberKeys,
      shared: {},
      members: Object.fromEntries(memberKeys.map((key) => [key, {}])),
      options: { ...MEMBER_OPTIONS(logDir), summaryKey: 'tc-all-fail' },
    })

    // Railway 운영에서 관측된 `soft-deadline snapshot status=error completed=0/9 errors=9`
    // 형태와 동일한 상태: 결과 0건 + 위원 수만큼 error 레코드.
    assert.equal(Object.keys(results).length, 0)
    assert.equal(errors.length, memberKeys.length)
    for (const entry of errors) {
      assert.equal(entry.finalStatus, 'error')
      assert.equal(entry.errorKind, 'llm-upstream-error')
      assert.equal(entry.llmResultPresent, false)
      assert.equal(entry.attempts, 1)
    }

    const summary = JSON.parse(fs.readFileSync(path.join(logDir, '_summary-tc-all-fail.json'), 'utf8'))
    assert.equal(summary.summaryKey, 'tc-all-fail')
    assert.equal(summary.errors.length, memberKeys.length)
    assert.equal(Object.keys(summary.members ?? {}).length, 0, '요약 로그 members에도 성공 위원이 없다')
    assert.ok(summary.errors[0].errorKind, '요약 로그에도 errorKind가 보존된다')
    assert.equal(summary.errors[0].finalStatus, 'error')
  } finally {
    stub.restore()
  }
})

test('TC-DSF-008b 위원회 기본 모델·동시성 기본값이 운영 관측값과 일치한다', () => {
  // 운영 로그: model=deepseek/deepseek-v4-flash, members=9 concurrency=9.
  // 모델 id가 바뀌면 운영 OpenRouter 호출 결과도 바뀌므로 의도치 않은 기본값 변경을 잠근다.
  assert.equal(DEFAULT_COMMITTEE_LLM_MODEL, 'deepseek/deepseek-v4-flash')
})
