import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

// 유료 실행 계약 회귀 (2026-11-09 운영 블랙박스 실측 docs/tc/TC-blackbox-prod-deepscan.md §5-A/B,
// 블랙박스 근거 PR #351):
//   "딥스캔 유료 실행(10cr)은 명시적 사용자 액션 + 확인 뒤에만 발생한다."
// A) 기록 "다시 보기" 탭 → 저장된 리포트 열람(무료). 유료 재실행은 확인 절차 뒤에만.
// B) /deepscan 재방문만으로 직전 종목 자동 재실행·과금 금지. 저장된 결과 우선 노출 + 명시적 재실행 버튼.

test('계약(서버): cacheOnly 재열람은 스냅샷 미스 시 과금 경로에 진입하지 않는다', () => {
  const route = read('src/app/api/deepscan/route.ts')

  // cacheOnly 플래그 해석 — refresh=1(명시적 재분석)이 함께 오면 읽기 전용이 아니다
  assert.match(route, /searchParams\.get\('cacheOnly'\) === '1' && !refreshRequested/)

  // snapshot-miss 응답 계약 — code로 UI가 전용 화면으로 분기한다
  assert.match(route, /code: 'snapshot-miss'/)
  assert.match(route, /저장된 최신 딥스캔 결과가 없어요/)

  // 과금 게이트(authorizeDeepScanRun)와 무과금 직행 경로 어디에도 도달하지 않고
  // cacheOnly 블록이 return으로 종결한다 — 블록 순서를 강제한다.
  const cacheOnlyReturnAt = route.indexOf("code: 'snapshot-miss'")
  const gateCallAt = route.indexOf('const { authorizeDeepScanRun } = await import(\'@/lib/payments/deepscan-entitlement\')')
  const unpaidPathAt = route.indexOf('if (!hasTossServerConfig())')
  assert.ok(cacheOnlyReturnAt > -1, 'cacheOnly snapshot-miss 응답이 있어야 한다')
  assert.ok(gateCallAt > cacheOnlyReturnAt, '과금 게이트는 cacheOnly 종결 이후에만 등장할 수 있다')
  assert.ok(unpaidPathAt > cacheOnlyReturnAt, '무과금 직행 경로도 cacheOnly 종결 이후에만 등장할 수 있다')
})

test('계약(서버): snapshot-miss 안내에 크레딧 사용 사실이 명시된다', () => {
  const route = read('src/app/api/deepscan/route.ts')
  // 402와 동일하게 필요 크레딧을 실어 UI가 안내 문구를 구성하게 한다
  assert.match(route, /cost: DEEPSCAN_CREDIT_COST/)
})

test('계약(클라이언트): /deepscan 자동 시작은 명시적 실행 의도가 있을 때만 유료 경로를 탄다', () => {
  const page = read('src/app/deepscan/page.tsx')

  // 시작 결정은 순수 함수(explicitRunIntent 입력 포함)로 — 상태 시뮬레이션 테스트 대상
  assert.match(page, /resolveDeepScanStartAfterHydration\(\{/)
  assert.match(page, /explicitRunIntent,/)

  // 명시적 의도 없는 방문은 읽기 전용(cacheOnly) 조회로만 저장된 결과를 연다
  assert.match(page, /pendingCacheOnlyRef\.current = true/)
  assert.match(page, /cacheOnly: pendingCacheOnlyRef\.current/)

  // 명시적 의도가 있으면 표식을 소멸(원샷)하고 자동 실행한다
  assert.match(page, /clearDeepScanRunIntent\(\)/)
  assert.match(page, /startDecision === 'run-explicit'/)

  // 방문 시점 표식 판정은 마운트(초기 상태) 1회 — 이후 상태는 변하지 않는다
  assert.match(page, /useState\(\(\) => readDeepScanRunIntent\(\)\)/)
})

test('계약(클라이언트): 스냅샷 미스는 과금 없는 전용 화면으로 종결하고, 재실행은 확인 절차를 거친다', () => {
  const page = read('src/app/deepscan/page.tsx')

  assert.match(page, /const isSavedResultMissing = fetchState === 'error' && errorCode === 'snapshot-miss'/)
  // 전용 화면이 존재한다(오류카드·로딩 타이머가 아님)
  assert.match(page, /최신 분석 결과가 아직 없어요/)
  // 크레딧 사용을 버튼 문구에 명시한다
  assert.match(page, /다시 분석하기 \(\{DEEPSCAN_CREDIT_COST\}크레딧 사용\)/)
  // 재실행 핸들러는 확인 대화상자를 거친다(기존 handleExplicitRefresh 재사용)
  assert.match(page, /window\.confirm\('다시 분석할까요\? 딥스캔 크레딧이 사용돼요\.'\)/)
  // 방문만으로 크레딧이 쓰이지 않음을 안내한다
  assert.match(page, /페이지를 열기만 해서는 크레딧이 쓰이지 않아요/)
})

test('계약(기록 §5-A): 기록 항목 탭은 저장된 리포트(payload)를 무료 열람한다', () => {
  const historyPage = read('src/app/mypage/history/page.tsx')

  // 기록 단건 API에서 저장된 payload를 가져와 스토어에 심는다 — 재실행 아님
  assert.match(historyPage, /\/api\/deepscan\/history\/\$\{encodeURIComponent\(id\)\}/)
  assert.match(historyPage, /isCanonicalPayload\(payload\)/)
  assert.match(historyPage, /buildSnapshotCacheAnnotatedPayload\(/)
  assert.match(historyPage, /finishSuccess\(/)

  // 기록 열람은 유료 실행 의도가 아니므로 실행 표식을 소거한다
  assert.match(historyPage, /clearDeepScanRunIntent\(\)/)

  // startRequest(유료 실행 개시)를 호출하지 않는다
  assert.doesNotMatch(historyPage, /startRequest/)

  // 안내문구가 실제 동작(저장 결과 열람)과 일치한다
  assert.match(historyPage, /탭하면 저장된 분석 결과를 열어요/)
  assert.doesNotMatch(historyPage, /탭하면 최신 분석으로 다시 열어요/)
})

test('계약(홈 진입로 §5-B): 유료 실행 표식은 "딥스캔 분석" 클릭에서만 남는다', () => {
  const home = read('src/components/home/jaroo-home-screen.tsx')

  // 핸드오프에서 표식을 남긴다 — 단 딥스캔 라우트로 향할 때만
  assert.match(home, /markDeepScanRunIntent\(\)/)
  assert.match(home, /if \(actionHref === '\/deepscan'\) \{/)
})

test('계약(정상 진입로 보호): 홈 종목카드 → 딥스캔 핸드오프는 그대로 자동 실행된다', () => {
  const page = read('src/app/deepscan/page.tsx')
  // run-explicit 결정은 startRequest를 호출한다(홈 카드 클릭 → 분석 자동 시작 유지)
  const explicitBranch = page.slice(
    page.indexOf("startDecision === 'run-explicit'"),
    page.indexOf('pendingCacheOnlyRef.current = true'),
  )
  assert.ok(explicitBranch.includes('startRequest()'), '명시적 진입 분기는 자동 실행을 유지해야 한다')
  // 스냅샷 히트 재열람(무료) 경로도 그대로 존재한다 — provenance 바 + 재분석 CTA
  assert.match(page, /SnapshotProvenanceBar/)
})
