// 화이트박스 TC(소스 계약) — "캐시된 딥스캔을 불러올 때 LLM 호출 비용이 발생하는가"
// 실행형 TC(fetch 가로채기)는 deepscan-cache-llm-cost-crawler.test.mjs /
// route.cache-llm-cost.test.ts 3종이 담당하고, 이 파일은 실행이 어려운
// 라우트 게이트(GET 내부 supabase 의존)·컴포넌트 effect의 '구조 계약'을
// 기존 tests/deepscan-paid-run-contract.test.mjs와 같은 방식으로 고정한다.
//
// 검증 계약:
//   TC-GATE-1  /api/deepscan GET — cacheOnly 종결과 스냅샷 캐시 반환 모두
//              crawler 빌더(→ 위원회 LLM 9회) 호출 이전에 배치된다
//   TC-GATE-2  /deepscan 재방문은 run-explicit 폴스루 후 cacheOnly로만 조회
//   TC-GATE-3  history 탭 열람은 저장 payload 시딩(런 없음) + 실행 표식 소거
//   TC-BUG-1   [수정 반영] 팀 요약 발사는 저장 요약 씨드 게이트를 지난다 —
//              payload.teamSummaries와 요청(팀+inputKey)이 일치하면 발사 0회
//   TC-BUG-2   [수정 반영] 트리거 체인은 유지되되 page가 저장 요약·persistTarget을
//              로딩 화면에 전달한다
//   TC-LLM-1   LLM HTTP 경계 목록 — committee-llm.js/crawler는 openrouter.ai fetch,
//              JAROO_LLM_MOCK 게이트 존재(테스트 환경 오염 방지 확인용)
//
// 참고: docs/tc/TC-deepscan-cache-llm-cost.md

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

test('TC-GATE-1: /api/deepscan — cacheOnly·스냅샷 캐시 반환은 crawler 빌더(LLM 런) 이전에 종결한다', () => {
  const route = read('src/app/api/deepscan/route.ts')

  // cacheOnly 읽기 전용 게이트가 존재하고
  assert.match(route, /searchParams\.get\('cacheOnly'\) === '1' && !refreshRequested/)
  // 과금·빌더 파이프라인은 그 이후에만 등장한다
  const cacheOnlyReturnAt = route.indexOf("code: 'snapshot-miss'")
  const snapshotCacheBlockAt = route.indexOf('if (!refreshRequested && snapshotKey)')
  const unpaidPathAt = route.indexOf('if (!hasTossServerConfig())')
  const canonicalBuilderAt = route.indexOf('return createDeepScanCanonicalResponse(')

  assert.ok(cacheOnlyReturnAt > -1, 'cacheOnly snapshot-miss 종결이 있어야 한다')
  assert.ok(snapshotCacheBlockAt > cacheOnlyReturnAt, '스냅샷 캐시 블록은 cacheOnly 종결 뒤여야 한다')
  assert.ok(unpaidPathAt > cacheOnlyReturnAt, '무과금 직행(빌더 호출)은 cacheOnly 종결 뒤여야 한다')
  assert.ok(canonicalBuilderAt > unpaidPathAt, 'canonical 빌더(→crawler LLM)는 게이트 이후여야 한다')

  // 스냅샷 히트 반환은 빌더 없이 캐시된 payload를 그대로 내린다(무LLM 근거)
  assert.match(route, /buildSnapshotCacheAnnotatedPayload\(snapshot\.payload,/)
})

test('TC-GATE-2: /deepscan 재방문은 cacheOnly 조회로만 저장 결과를 연다(run-explicit 폴스루 이후)', () => {
  const page = read('src/app/deepscan/page.tsx')

  // 하이드레이션 시작 결정 — run-explicit만 유료 자동 실행, 나머지(run-readonly)는
  // 폴스루로 pendingCacheOnlyRef=true 후 startRequest(읽기 전용 조회)
  const effectStart = page.indexOf('if (startDecision === \'idle\' || haltVerdict !== \'active\')')
  const effectEnd = page.indexOf('}, [haltVerdict, startDecision, startRequest])')
  assert.ok(effectStart > -1 && effectEnd > effectStart, '시작 결정 effect 블록을 찾을 수 있어야 한다')
  const effectBlock = page.slice(effectStart, effectEnd)

  const explicitBranchAt = effectBlock.indexOf("if (startDecision === 'run-explicit')")
  const cacheOnlyAt = effectBlock.indexOf('pendingCacheOnlyRef.current = true')
  assert.ok(explicitBranchAt > -1, 'run-explicit 분기가 있어야 한다')
  assert.ok(cacheOnlyAt > explicitBranchAt, 'cacheOnly 플래그는 run-explicit 반환 이후 폴스루로 세팅된다(재방문=읽기 전용)')
  assert.match(effectBlock, /clearDeepScanRunIntent\(\)/)

  // 정규 요청 fetch는 refresh/cacheOnly 플래그를 실어 보낸다
  assert.match(page, /cacheOnly: pendingCacheOnlyRef\.current/)
})

test('TC-GATE-3: history 탭 열람은 저장 payload 시딩(런 없음) + 실행 표식 소거', () => {
  const historyPage = read('src/app/mypage/history/page.tsx')

  assert.match(historyPage, /finishSuccess\(\s*buildSnapshotCacheAnnotatedPayload\(detail\.payload,/)
  assert.match(historyPage, /clearDeepScanRunIntent\(\)/)
  assert.doesNotMatch(historyPage, /startRequest/, '기록 열람이 유료 실행을 개시하지 않는다')
})

test('TC-BUG-1: [수정 반영] 팀 요약 발사는 저장 요약 씨드 게이트를 지난다 — 캐시 로드 LLM 0회', () => {
  const screen = read('src/components/deepscan-loading-screen.tsx')

  // 팀 요약 POST는 존재하며(저장 문면 없는 팀만 발사 대상이 된다)
  assert.match(screen, /fetch\('\/api\/deepscan\/team-summary',/)

  // 씨드 effect: 저장된 문장 중 요청(팀+inputKey)이 일치하는 것을 성공 상태로 심는다
  assert.match(screen, /pickSeededTeamSummaries\(storedTeamSummaries, teamSummaryRequests\)/)

  // 발사 effect: 저장 문면이 요청 inputKey와 일치하면 클레임 후 필터로 제외 — 재방문 LLM 0회
  assert.match(screen, /const stored = storedTeamSummaries\?\.\[request\.teamKey\]/)
  assert.match(screen, /return !\(stored && stored\.inputKey === request\.inputKey\)/)

  // 씨드 계산(useMemo)이 발사 effect보다 앞선다 — 렌더 중 상태 조정 패턴(effect 내 setState 금지 준수)
  const seedEffectAt = screen.indexOf('pickSeededTeamSummaries(storedTeamSummaries, teamSummaryRequests)')
  const fireEffectAt = screen.indexOf('claimPendingRequests(teamSummaryRequests)')
  assert.ok(seedEffectAt > -1 && fireEffectAt > seedEffectAt, '씨드 useMemo가 발사 effect보다 앞서 정의되어야 한다')

  // 런 중 받은 문장은 스냅샷/기록에 영속화된다(persist POST)
  assert.match(screen, /fetch\('\/api\/deepscan\/team-summaries-persist',/)
})

test('TC-BUG-2: [수정 반영] 트리거 체인은 유지되되 page가 저장 요약·persist 대상을 전달한다', () => {
  const utils = read('src/components/deepscan-loading-utils.ts')

  // summarizable 판정 — 완성(전원 success) 페이로드면 3팀 모두 참이 된다(체인 유지)
  assert.match(utils, /summarizable: teamBody\.readyCount > 0 && teamBody\.readyCount \+ teamBody\.errorCount === team\.members\.length/)
  // 팀 바디는 멤버 reason(캐시 저장값)을 붙여 만든다 — 캐시 로드에서도 값이 차 있다
  assert.match(utils, /return `\$\{internalOpinionLabel\}: \$\{member\.reason\}`/)

  // 발사 대상 필터도 유지(저장 문면 없는 팀만 살아남는다)
  const screen = read('src/components/deepscan-loading-screen.tsx')
  assert.match(screen, /if \(!teamKey \|\| !card\.summarizable \|\| !card\.body\.trim\(\)\) \{/)

  // page가 payload.teamSummaries(저장 문장)와 persist 대상 식별자를 전달한다
  const page = read('src/app/deepscan/page.tsx')
  assert.match(page, /storedTeamSummaries=\{payload\?\.teamSummaries \?\? null\}/)
  assert.match(page, /persistTarget=\{payload\?\.input\.instrument/)
})

test('TC-LLM-1: LLM HTTP 경계 — committee-llm.js는 openrouter.ai를 fetch하며 mock 게이트가 있다', () => {
  const committeeLlm = read('packages/deepscan-runtime-core/src/committee-llm.js')
  assert.match(committeeLlm, /const OPENROUTER_URL = 'https:\/\/openrouter\.ai\/api\/v1\/chat\/completions'/)
  assert.match(committeeLlm, /await fetch\(OPENROUTER_URL,/)
  assert.match(committeeLlm, /if \(isLlmMockEnabled\(\)\) \{\s*\n\s*return requestCommitteeMockAttempt/)

  // crawler 페이로드의 위원회 진입点도 동일 경계를 지난다
  const payload = read('packages/crawler/src/services/deepscan-payload.js')
  assert.match(payload, /await scoreDeepScanKrCommitteeFromDump\(rawInput, input, evidence, sources\)/)
  assert.match(payload, /committeeLlmEnabled\(rawInput\)/)

  // 웹 측 팀 요약 라우트도 자체 OpenRouter 호출점이다(위원회와 별개)
  const teamSummary = read('src/app/api/deepscan/team-summary/route.ts')
  assert.match(teamSummary, /const OPENROUTER_URL = 'https:\/\/openrouter\.ai\/api\/v1\/chat\/completions'/)
  assert.match(teamSummary, /await fetch\(OPENROUTER_URL,/)
})
