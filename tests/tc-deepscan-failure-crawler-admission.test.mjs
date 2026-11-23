import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'

import { createDeepscanKrAdmission } from '../packages/crawler/src/services/deepscan-kr-admission.js'

// TC-DSF-009~013 — 크롤러 KR 딥스캔 어드미션(admission) 실패 모드 결정론적 회귀.
//
// 배경(운영 사고 이력 — git 커밋 메시지·모듈 주석에 기록):
//  - 2026-10-11 사고: 잡 promise가 영원히 settle되지 않는 유기로 슬롯이 영구 점유됨
//    → 커밋 726145c "크롤러 어드미션 와치독으로 유기 잡의 슬롯 영구 점유 방지".
//  - 2026-10-13 08:56 사고: 소스 번들 252s 무음 정체 → 웹 150s 데드라인 504 →
//    재시도가 429 busy로 번짐(커밋 d6b4f7c, deepscan-payload.js 상단 주석).
//  슬롯 한도·429 busy 진단 스냅샷·와치독 회수가 깨지면 사용자에게 "분석 요청에
//  실패했어요" 오류카드(504/429)로 이어진다. 실제 크롤링 없이 admission 모듈만으로 검증한다.

function makeInput(code, extra = {}) {
  return {
    instrument: { code, name: `테스트종목${code}`, market: 'KR' },
    selectedAt: '2026-11-05T09:00:00.000Z',
    sourceContext: { from: 'home-handoff' },
    ...extra,
  }
}

// 점유 중인 잡은 테스트 종료 전에 반드시 settle시켜야 node:test가 pending promise로
// 취소 판정을 하지 않는다 — load를 수동 release하는 deferred 헬퍼로 정리한다.
function manualLoad() {
  let release
  const load = () => new Promise((resolve) => {
    release = () => resolve({ manual: true })
  })
  return { load, release: () => release?.() }
}

function collectLogs() {
  const lines = []
  return {
    log: (message) => lines.push(`log:${message}`),
    warn: (message) => lines.push(`warn:${message}`),
    lines,
  }
}

test('TC-DSF-009 전역 슬롯 초과는 429 busy와 limits·activeJobs 진단 스냅샷을 반환한다', async () => {
  const logs = collectLogs()
  const admission = createDeepscanKrAdmission({
    env: { DEEPSCAN_KR_GLOBAL_JOBS: '1', DEEPSCAN_KR_PER_CODE_JOBS: '1', DEEPSCAN_KR_BUSY_RETRY_AFTER_MS: '2000' },
    log: logs.log,
    warn: logs.warn,
  })

  const first = manualLoad()
  const firstRun = admission.run(makeInput('005930'), first.load)
  firstRun.catch(() => {})
  await sleep(5)

  await assert.rejects(
    admission.run(makeInput('000660'), manualLoad().load),
    (error) => {
      assert.equal(error.name, 'HttpError')
      assert.equal(error.status, 429)
      assert.match(error.message, /busy/)
      assert.equal(error.details?.status, 'busy')
      assert.equal(error.details?.reason, 'global_limit')
      assert.equal(error.details?.retryAfterMs, 2000)
      assert.deepEqual(error.details?.limits, { global: 1, perCode: 1 })
      assert.equal(error.details?.activeJobs?.length, 1, 'busy 응답에 점유 중 잡 스냅샷이 포함된다(웹 로그 진단용)')
      assert.equal(error.details?.activeJobs?.[0]?.code, '005930')
      return true
    },
    '두 번째 잡은 즉시 429 busy로 거절되어야 한다',
  )

  const snapshot = admission.snapshot()
  assert.equal(snapshot.activeJobs.length, 1)

  // 테스트 종료 전에 점유 잡을 settle해 pending promise 없이 정리한다.
  first.release()
  await firstRun
  assert.equal(admission.snapshot().activeJobs.length, 0)
})

test('TC-DSF-010 종목당 슬롯 초과는 per_code_limit busy로 구분되고 타 종목은 통과한다', async () => {
  const admission = createDeepscanKrAdmission({
    env: { DEEPSCAN_KR_GLOBAL_JOBS: '2', DEEPSCAN_KR_PER_CODE_JOBS: '1' },
  })

  const first = manualLoad()
  const firstRun = admission.run(makeInput('005930'), first.load)
  firstRun.catch(() => {})
  await sleep(5)

  // jobKey가 같으면 dedup(공유)이라 busy가 아니다 — holding을 달리해 jobKey를 분리하고,
  // 같은 코드('005930')로 per-code 한도에 걸리게 한다.
  await assert.rejects(
    admission.run(makeInput('005930', { holding: { shares: '99', averagePrice: '70000' } }), manualLoad().load),
    (error) => {
      assert.equal(error.status, 429)
      assert.equal(error.details?.reason, 'per_code_limit', '같은 종목 재요청은 per_code_limit으로 분류된다')
      return true
    },
    '같은 종목 두 번째 잡은 즉시 429 busy로 거절되어야 한다',
  )

  const otherCode = await admission.run(makeInput('000660'), async () => ({ code: '000660' }))
  assert.deepEqual(otherCode, { code: '000660' }, '전역 한도 내 다른 종목은 정상 실행된다')

  // 점유 잡을 settle해 pending promise 없이 테스트를 종료한다.
  first.release()
  await firstRun
  assert.equal(admission.snapshot().activeJobs.length, 0)
})

test('TC-DSF-011 유기 잡은 와치독이 504로 종결하고 슬롯을 회수해 후속 잡이 돌아간다', async () => {
  const logs = collectLogs()
  let ghostResolved = false
  const admission = createDeepscanKrAdmission({
    env: { DEEPSCAN_KR_GLOBAL_JOBS: '1', DEEPSCAN_KR_PER_CODE_JOBS: '1', DEEPSCAN_KR_JOB_MAX_MS: '60' },
    log: logs.log,
    warn: logs.warn,
  })

  // 120ms 후에야 끝나는 "느린" 잡 — 와치독 60ms보다 늦어 유기로 간주된다.
  const slowPromise = admission.run(
    makeInput('005930'),
    async () => {
      await sleep(120)
      ghostResolved = true
      return { slow: true }
    },
  )

  await assert.rejects(
    slowPromise,
    (error) => {
      assert.equal(error.status, 504)
      assert.match(error.message, /timed out/)
      assert.equal(error.details?.status, 'timeout')
      assert.equal(error.details?.retryable, true)
      assert.equal(error.details?.code, '005930')
      return true
    },
    '와치독이 유기 잡을 504 timeout으로 종결해야 한다',
  )

  assert.ok(
    logs.lines.some((line) => line.includes('watchdog timeout') && line.includes('slot reclaimed')),
    '와치독 발동이 운영 로그에 기록되어야 한다',
  )

  // 슬롯이 회수됐으므로 후속 잡은 유기 잡이 끝나기 전에 실행·완료된다.
  const followUp = await admission.run(makeInput('000660'), async () => ({ fast: true }))
  assert.deepEqual(followUp, { fast: true })

  await sleep(130)
  assert.ok(ghostResolved, '유기된 load는 결국 settle된다')
  assert.ok(
    logs.lines.some((line) => line.includes('ghost settled') && line.includes('result discarded')),
    '늦게 끝난 유기 잡의 결과는 폐기 처리된다(이미 회수된 슬롯 재사용 방지)',
  )
  assert.equal(admission.snapshot().activeJobs.length, 0, '모든 슬롯이 최종 회수된다')
})

test('TC-DSF-012 동일 jobKey 잡은 중복 실행 없이 같은 결과를 공유한다', async () => {
  const admission = createDeepscanKrAdmission({
    env: { DEEPSCAN_KR_GLOBAL_JOBS: '2', DEEPSCAN_KR_PER_CODE_JOBS: '2' },
  })

  let loadCalls = 0
  const input = makeInput('035420', { holding: { shares: '10', averagePrice: '50000' } })
  const load = async () => {
    loadCalls += 1
    await sleep(20)
    return { NAVER: true }
  }

  const [a, b] = [admission.run(input, load), admission.run(input, load)]
  const [resultA, resultB] = await Promise.all([a, b])
  assert.equal(loadCalls, 1, '같은 jobKey는 load를 한 번만 실행한다(429 busy 연쇄·비용 중복 방지)')
  assert.deepEqual(resultA, resultB)
})

test('TC-DSF-013 실행 스위치(DEEPSCAN_KR_EXECUTION_DISABLED=1)는 503 unavailable로 막는다', async () => {
  const admission = createDeepscanKrAdmission({
    env: { DEEPSCAN_KR_EXECUTION_DISABLED: '1' },
  })

  await assert.rejects(
    admission.run(makeInput('005930'), async () => ({})),
    (error) => {
      assert.equal(error.status, 503)
      assert.equal(error.details?.status, 'unavailable')
      assert.equal(error.details?.retryable, true, '스위치 복구 후 재시도 가능함을 응답이 표현한다')
      return true
    },
  )
})
