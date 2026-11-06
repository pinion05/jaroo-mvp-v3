import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// TC-DSF-014~019 — 딥스캔 웹 게이트웨이·프론트 표면 실패 계약 회귀.
//
// 웹 계층(route.ts·build-payload.ts·deepscan-canonical.ts)과 프론트 표면은 TypeScript라
// node --test(.mjs)에서 직접 실행할 수 없어, 저장소 기존 .mjs 테스트 관례(정적 계약 검증)로
// 실패 전파 경로가 제거되지 않았는지 잠근다. 행동 검증(LLM 위원회·어드미션)은
// tc-deepscan-failure-llm-committee / -crawler-admission 참고.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('TC-DSF-014 /api/deepscan 실패 응답은 크롤러 상태 코드 전파·환불 안내·한국어 문구를 유지한다', () => {
  const source = read('src/app/api/deepscan/route.ts')

  // CrawlerDeepScanRequestError.status(504 timeout·502 network·429 busy) 전파, 그 외 400
  assert.match(source, /error instanceof CrawlerDeepScanRequestError \? error\.status : 400/)

  // §6-6: 유저에게 아무것도 전달되지 않은 실패 — 선차감 크레딧 환불 + 한국어 안내
  assert.match(source, /refundDeepScanCredits\(charge\.userId, charge\.amount/)
  assert.match(source, /크레딧은 차감되지 않았어요/)
  // 환불 RPC 실패는 반드시 추적 가능한 로그를 남긴다(수동 정산)
  assert.match(source, /\[deepscan\] credit refund call rejected — 수동 정산 필요/)
  assert.match(source, /\[deepscan\] credit refund failed — 수동 정산 필요/)

  // 환불 없는 실패는 일시 문구로 통일 — 인프라 원문(영문 진단)은 로그로만
  assert.match(source, /딥스캔에 일시적인 문제가 생겼어요\./)
  assert.match(source, /console\.error\('\[deepscan\] builder failed'/)
  // 원문 노출 금지: 응답 본문에 error.message 원문을 실어 보내지 않는다
  assert.doesNotMatch(source, /error: \{\s*message: error\.message/)
})

test('TC-DSF-015 크레딧 부족(402)·미로그인(401)·엔타이틀먼트 장애(503) 게이트 분기가 유지된다', () => {
  const source = read('src/app/api/deepscan/route.ts')

  assert.match(source, /code: 'auth-required'/)
  assert.match(source, /status: 401/)
  assert.match(source, /code: 'insufficient-credits'/)
  assert.match(source, /status: 402/)
  // 402 본문은 크레딧 부족 전용 화면이 쓰는 필요/잔여 수치를 반드시 포함한다
  assert.match(source, /balance: gate\.balance/)
  assert.match(source, /cost: gate\.cost/)
  assert.match(source, /code: 'entitlement-unavailable'/)
  assert.match(source, /status: 503/)

  // 402 상세를 한국어 안내로 바꾸는 헬퍼(전용 화면 문구 계산)
  const shortage = read('src/lib/deepscan-credit-shortage.ts')
  assert.match(shortage, /export function buildCreditShortageFacts/)
  assert.match(shortage, /headline: '크레딧이 살짝 모자라요'/)
  assert.match(shortage, /종목이나 데이터에 문제가 생긴 게 아니니 걱정하지 않으셔도 돼요/)
})

test('TC-DSF-016 크롤러 요청 계층의 타임아웃·429 busy 재시도·invalid JSON 분류 파라미터가 유지된다', () => {
  const source = read('src/lib/deepscan-runtime/build-payload.ts')

  // 타임아웃 상수 — 2026-10-13 사고(504→429 연쇄) 이후 상향된 값(커밋 6a6feaf·d6b4f7c)
  assert.match(source, /DEFAULT_KR_DEEPSCAN_FETCH_TIMEOUT_MS = 150_000/)
  assert.match(source, /DEFAULT_KR_DEEPSCAN_BUSY_MAX_WAIT_MS = 30_000/)
  assert.match(source, /DEFAULT_KR_DEEPSCAN_BUSY_RETRY_AFTER_MS = 2_000/)
  assert.match(source, /DEFAULT_US_SLIM_FETCH_TIMEOUT_MS = 90_000/)

  // 타임아웃은 CrawlerDeepScanRequestError(504)로 변환되어 오류카드 계약과 연결된다
  assert.match(source, /new CrawlerDeepScanRequestError\(`\$\{context\} timed out after \$\{timeoutMs\}ms`, 504\)/)
  // 네트워크 실패는 502 — fetchWithDeadline의 catch 분기(read 실패 502와 별개)
  assert.match(source, /error instanceof Error \? `\$\{context\} failed: \$\{error\.message\}` : `\$\{context\} failed`,\s*\n\s*502/)
  // 빈 본문·invalid JSON은 502로 분류(운영 로그 시그니처: returned invalid JSON)
  assert.match(source, /returned invalid JSON/)
  assert.match(source, /returned an empty response/)

  // 429 busy는 retry-after를 클램프해 maxBusyWaitMs까지 재시도한다
  assert.match(source, /function isCrawlerBusyResponse/)
  assert.match(source, /details\.status === 'busy'/)
  assert.match(source, /Math\.min\(Math\.floor\(parsed\), 15_000\)/)
  assert.match(source, /if \(isCrawlerBusyResponse\(response, payload\) && waitedMs < maxBusyWaitMs\)/)

  // 실패 시 운영자 진단 신호(429 limits/activeJobs·504 잔존 잡)를 웹 로그에 남긴다
  assert.match(source, /\[deepscan\] crawler upstream error details/)
  assert.match(source, /\[deepscan\] canonical fetch failed/)
})

test('TC-DSF-017 워치 일일 배치는 9인 위원회 LLM 스킵(committeeLlm=off) 배선을 유지한다', () => {
  // 운영 이슈: 2026-11-02~11-05 Railway app 배포에서 워치 배치마다 9개 위원 LLM이
  // 전부 llm-upstream-error로 실패(0/9). 배포 빌드에 이 배선이 빠졌거나 무효화된 것이
  // 유력 가설이므로, master 계약을 이 TC로 잠가 재발을 즉시 검출한다.
  const batch = read('src/lib/watch/daily-batch.ts')
  assert.match(batch, /buildKrDeepScanPayloadViaCrawler\(rawInput, fetch, \{ skipCommitteeLlm: true \}\)/)

  const webPayload = read('src/lib/deepscan-runtime/build-payload.ts')
  // skipCommitteeLlm → crawler URL에 committeeLlm=off 명시
  assert.match(webPayload, /if \(options\?\.skipCommitteeLlm\) \{\s*\n\s*searchParams\.set\('committeeLlm', 'off'\)/)

  const crawlerServer = read('packages/crawler/src/server.js')
  assert.match(crawlerServer, /parseSingleQueryValue\(req\.query\.committeeLlm\)/)
  assert.match(crawlerServer, /\.\.\.\(committeeLlm \? \{ committeeLlm \} : \{\}\)/)

  const crawlerPayload = read('packages/crawler/src/services/deepscan-payload.js')
  // 요청 단위 off 토글이 환경 판정보다 우선한다
  assert.match(crawlerPayload, /function committeeLlmEnabled\(rawInput\)/)
  assert.match(crawlerPayload, /\['0', 'false', 'off', 'no'\]\.includes\(requestToggle \?\? ''\)/)
  assert.match(crawlerPayload, /const llmAttempted = isKrInput\(input\) && committeeLlmEnabled\(rawInput\)/)
})

test('TC-DSF-018 프론트는 402를 전용 화면으로, 그 외 실패를 오류카드 배지로 구분 표면화한다', () => {
  const page = read('src/app/deepscan/page.tsx')
  // 402 분기 — 오류카드 대신 크레딧 부족 전용 화면
  assert.match(page, /const isCreditShortage = fetchState === 'error' && errorCode === 'insufficient-credits'/)
  assert.match(page, /<DeepScanCreditShortageScreen/)
  assert.match(page, /errorCredit\?\.cost \?\? null/)
  assert.match(page, /errorCredit\?\.balance \?\? null/)
  // 오류카드에는 서버 한국어 문구(errorMessage)가 그대로 실린다
  assert.match(page, /body: errorMessage \?\? '분석 데이터 요청에 실패했습니다\./)

  const canonical = read('src/lib/deepscan-canonical.ts')
  // DeepScanApiError가 code·status·크레딧 상세를 화면 계층까지 전달한다
  assert.match(canonical, /class DeepScanApiError/)
  assert.match(canonical, /readonly code/)
  assert.match(canonical, /readonly status/)
  assert.match(canonical, /readonly creditBalance/)
  assert.match(canonical, /readonly creditCost/)
  assert.match(canonical, /String\(errorBody\.code \?\? 'unknown'\)/)
  // payload 계약 불일치는 null 반환 → "표시할 수 없어요" 종결(finishError) 경로
  assert.match(canonical, /isCanonicalPayload\(payload\) \? payload : null/)
  assert.match(page, /finishError\('DeepScan 데이터를 표시할 수 없어요\./)

  const loadingScreen = read('src/components/deepscan-loading-screen.tsx')
  assert.match(loadingScreen, /isError \? '분석 요청에 실패했어요' : progressLabel/)
  assert.match(loadingScreen, /\? errorNotice\.badge : '분석 요청 실패'/)
  assert.match(loadingScreen, /DeepScan 데이터를 표시할 수 없어요/)
})

test('TC-DSF-019 위원 전원 실패 payload는 200 OK 저하 계약(kr-committee-member-errors)을 유지한다', () => {
  const source = read('packages/crawler/src/services/deepscan-payload.js')

  // 전원 실패(llmCommitteePartialError)여도 응답은 200으로 내려가고 저하 표기를 남긴다 —
  // 사용자 표면은 빨간 오류카드가 아니라 hero "재시도 필요"·점수 0이다(운영 관측과 일치).
  assert.match(source, /reason: llmCommitteePartialError\s*\n\s*\? 'kr-committee-member-errors'/)
  assert.match(source, /일부 국내 위원 응답 실패 \$\{llmCommitteeErrors\.length\}건/)
  assert.match(source, /국내 DeepScan 위원회 재시도 필요/)
  assert.match(source, /score: llmCommitteeBlocked \|\| llmCommitteePartialError \? 0 : scored\.hero\.score/)
  // 위원 메타(status=error·errors 건수)가 payload에 실려 프론트 폴링 분기가 가능하다
  assert.match(source, /status: llmCommittee\.status \?\? \(llmCommitteePending\.length > 0 \? 'partial' : llmCommitteeErrors\.length > 0 \? 'error' : 'complete'\)/)

  // 프론트는 partial일 때 committee-status 폴링으로 복구를 시도한다
  const page = read('src/app/deepscan/page.tsx')
  assert.match(page, /const needsPartialPolling = llmCommittee\?\.status === 'partial'/)
  assert.match(page, /\/api\/deepscan\/committee-status\?requestId=/)
})
