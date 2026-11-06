# 딥스캔 실패 포렌식 분석 — 과거 실패 시그니처 수집·분류 및 결정론적 회귀 TC

- 기준: master @ 3f7276f (커밋 금지, 프로덕션 코드 수정 없음 — 본 문서와 `tests/tc-deepscan-failure-*.test.mjs` 3개 파일만 추가)
- 작성: 2026-11-05, 딥스캔 실패 포렌싱 담당 (deepscan-forensics)
- 배경 이슈: **"재현 조건을 모르는 deepscan 분석 오류가 자주 발생"** — 과거 실패의 원인 시그니처를 수집·분류하고, 각 실패 모드를 실패 주입형 회귀 TC로 고정한다
- 신규 TC ID: **TC-DSF-001 ~ TC-DSF-019** (실행 결과: 21/21 PASS — 하단 §5)

---

## 1. 증거 요약

### 1.1 조회 방법과 조회 기간 (운영 로그)

| 항목 | 내용 |
|---|---|
| 조회 수단 | Railway GraphQL `deploymentLogs`/`buildLogs` + Railway CLI(`bunx @railway/cli@latest`, `~/.railway/config.json` 토큰 — 전문 미기록, 마스킹 참조만) |
| 대상 | `jaroo-mvp-v3` 프로젝트(`aa69def2-fb32-…`) 유일 서비스 **`app`**(2bd7e5fc-…, web+crawler 단일 컨테이너, `https://test.jaroo.kr`), 현재 배포 `73ff430d-b609-…` |
| 조회 기간 | **2026-11-02T06:41Z ~ 2026-11-05T09:03Z** (배포 생성 2026-11-02T06:30Z 이후 전 구간, 로그 조회 시각 2026-11-05 19:35~19:42 KST) |
| 보존 한계 | 이전 배포(`4a166923-…`, 2026-10-02 FAILED)의 런타임 로그는 **보존되지 않아 조회 불가**. 10월 사고들(§1.2)은 커밋 메시지·모듈 주석으로만 증명됨 |
| 미조회 영역 명시 | 임무 배경에 있는 "jaroo.kr 운영 web+crawler 두 서비스"는 **이 토큰이 접근 가능한 워크스페이스에 존재하지 않았다**(`me.workspaces.projects` = G-LAMP/tu-capstone/imagraph/jaroo-mvp-v3/jaroo-landing/raddit-reddit/coinpee-board). 배포 watch 스크립트 토큰은 `projects`·`deployments` 목록 조회 모두 `Not Authorized`(deployment 단위만 가능). 따라서 본 분석의 운영 로그는 `jaroo-mvp-v3/app`(test.jaroo.kr) 배포가 전부이며, jaroo.kr 본 운영 프로젝트가 별도 계정/워크스페이스에 있다면 그쪽 로그는 미조회임 |

### 1.2 운영 로그에서 발견된 딥스캔 실패 시그니처 (개수·종류)

조회 창(11-02~11-05) 4일간 전체 로그를 18개 필터로 수집(`error`/`timed`/`timeout`/`deadline`/`watchdog`/`ghost`/`invalid`/`empty`/`refund`/`402`/`insufficient`/`ECONN`/`busy`/`failed`/`warn`/`OPENROUTER`/`DataInspection`/`abort`)한 결과:

| 시그니처 | 건수 | 종류·의미 |
|---|---|---|
| `[committee-llm] member=… status=error kind=llm-upstream-error attempts=1` | **252건** | 9개 위원 LLM 호출이 **매일 전멸**. 11-02~11-05 매일 63건(7종목 × 9위원). elapsed 53~846ms(즉시 실패), attempts=1(비재시도 분류 = HTTP 400/401/403 또는 콘텐츠 정책 메시지) |
| `[committee-llm] soft-deadline snapshot status=error completed=0/9 pending=0 errors=9` | 28건 | 위원 0/9 전멸 스냅샷 — 매일 7종목(워치 일일 배치)마다 1건 |
| `[committee-llm] final status=error completed=0/9 errors=9` | 28건 | 배치 종료 시까지 전멸 유지(백그라운드 완주 구간에서도 회복 없음) |
| `[committee-llm] start … model=deepseek/deepseek-v4-flash softDeadlineMs=5000` | 28건 | 워치 일일 배치(09:00~09:03 UTC = 18:00~18:03 KST)에서 **위원회 LLM이 실행되고 있음** |
| `[deepscan] canonical fetch ok … httpStatus=200` | 28건 | 웹→크롤러 canonical 수집은 전부 성공(19~23초, busyWaitedMs=0) — 위원 전멸에도 200 OK 저하 payload로 응답 |
| `deepscan-kr job complete durationMs=…` | 28건 | 어드미션 관점 정상 종결 |
| `[watch-daily-batch] done … failed=0` | 4건 | 배치 자체는 실패 0으로 기록 — **위원 전멸은 배치 지표에 잡히지 않음** |
| (참고) `dart-corpcode-prefetch start timeoutMs=600000` | 4건 | 무관(공시 프리페치) |

**창 내에서 0건이었던 시그니처**(해당 기간엔 미발생): `builder failed`(웹 빌더 오류), `credit refund` 환불 계열, 실제 402 credit 부족, `insufficient`, `watchdog timeout`, `ghost settled`, `timed out`/504, `llm-invalid-json`·`llm-empty-content`·`llm-null-content`·`llm-invalid-schema`·`llm-timeout-or-network`·`runtime-missing-dump`·`DataInspectionFailed`·`OPENROUTER_API_KEY is not configured`, `ECONNRESET/REFUSED`. ※ `402` 문자열 2건은 `4024ms`/`4402ms` 소요시간 부분일치 오탐.

즉 **조회 창 내 유일하게 반복된 딥스캔 실패 시그니처는 "위원회 LLM 전멸(llm-upstream-error 0/9)"이며, 이는 4일 연속 100% 재현되는 결정론적 실패다.**

### 1.3 로컬 버그헌트 리포트 (딥스캔 관련 발췌)

원문: `/home/pinion/jaroo-bughunt-report-1029.md`(R1, 40건), `/home/pinion/jaroo-bughunt-report-1030-high.md`(R2), `/home/pinion/jaroo-bughunt-report-FINAL.md`(5라운드 유니크 78건, 커밋 e0c4dfd 기준). `~/jaroo-audit-1027/`(딥스캔 UI 화면 캡처 영상·스크립트)과 `~/jaroo-fix/`(wt-* 워크트리)는 UI 검증·수정 작업 흔적이며 별도 실패 로그는 없었다.

| 재현(라운드) | 위치 | 요지 | 매트릭스 행 |
|---|---|---|---|
| 3/5 | `src/lib/deepscan-runtime/build-payload.ts:1484` | `buildHeroScore` 고정 분모 100 — 위원 일부 실패 시 히어로 점수 계통 축소(만점 78점까지) | FM-2 파생 |
| 3/5 | `build-payload.ts:549` | US 원금회수 목표가 통화 무시 → KRW 평단에 '$75,000·+99.9%' 붕괴 예측 | FM-11(데이터 정합) |
| 3/5 | `src/app/deepscan/page.tsx:486` | `pendingRefreshRef` 잔존 → abort·예외 종결 시 다음 fetch가 유료 재스캔 → **크레딧 이중 소진** | FM-9 |
| 3/5 | `src/app/api/deepscan/team-summary/route.ts:244` | 크레딧 게이트 우회 무료 LLM 무제한 + OpenRouter 오류 원문 노출 | FM-8 파생 |
| 3/5 | `packages/deepscan-runtime-core/src/recovery-forecast.js:1044` | 2모델 합의 시 confidence 항상 low — "편차가 큽니다" 거짓 안내 | FM-11 |
| 5/5 | `packages/crawler/src/crawlers/current-quotes.js:262` | WiseReport ETF NAV 폴백 fetch 타임아웃 부재 → quotes·위원회 무기한 블록 | FM-3 |
| 3/5 | `crawler/api-clients.js:254` | 타임아웃 타이머가 레이트리밋 대기·429 sleep 전에 시작 → 실질 타임아웃 단축 | FM-3 |
| 1/1(high) | `src/components/deepscan-loading-screen.tsx:241·293` | 팀 요약 이펙트 cleanup abort + requestKey 재요청 가드 → **'요약 중' 영구 교착** (커밋 ca72da8으로 본건 해소, 변형 3건은 별도) | FM-9 |
| 2/5 | `crawler/current-quotes.js:653` | `Number(row['종가'])` null→0 → 거래정지 종목 `price:0 status:'ok'` → 평단격차 −100% 오염 | FM-11 |
| 2/5 | `us-dump-contract-runtime.ts:68` | US dump `execFileAsync('python3')` timeout 없음 → 크롤러 지연 시 US DeepScan 수 분 hang(KR 45s/US 30s 데드라인 불일치) | FM-3 |
| 1/2 | `packages/crawler/src/services/supabase-crawler-cache.js:445` | `bypassCache:true`가 읽기만 우회하고 재수집 결과를 쓰지 않음 → 캐시 무효화 불가 | FM-11 |
| 1/1 | `us-etf-profile.js:89` | getcrumb text/plain을 `response.json()` 파싱 → 항상 SyntaxError | FM-11 |
| 2/5 | `src/app/etf/page.tsx:489` | ETF 위원 폴링 20회 한도 초과 시 조용히 중단 → pending 카드 영구 스피너(딥스캔은 종결 처리) | FM-9 |

### 1.4 git 커밋 이력에 기록된 과거 사고 (운영 로그 보존 한계의 보완 증거)

| 커밋 | 날짜 | 사고(커밋 메시지·모듈 주석 발췌) |
|---|---|---|
| `726145c` | (10-11 언급) | "크롤러 어드미션 와치독으로 유기 잡의 슬롯 영구 점유 방지" — 2026-10-11 사고: 잡 promise 미-settle → **2일 장애**(`deepscan-kr-admission.js` 주석) |
| `d6b4f7c` | 2026-10-13 | "소스별 하드 데드라인·바디 포함 타임아웃으로 504/429 연쇄 차단" — 2026-10-13 08:56:20 사고: 소스 번들 252s 무음 정체 → 웹 150s 504 → **재시도가 429 busy로 전이**(`deepscan-payload.js` 상단 주석) |
| `6a6feaf` | — | "전역 타임아웃 상향 — 콜드 딥스캔 45s 초과 실패 원인 해소" |
| `ca72da8` | — | "팀 요약 fetch를 스테이지 갱신에도 취소하지 않게 해 '요약 중' 영구 갇힘 해소" |
| `e64d0f4` | — | "팀 요약 모델 qwen3.8-flash 전환 대응 — Cerebras 고정 제거" (업스트림 모델 교체가 실패를 만든 선례) |
| `74fdb0b` | 2026-05-18 | "Keep KR DeepScan on the reachable fast model" — 모델 접속성 문제로 기본 모델 교체 선례 |
| `aaa7a89` | — | "FnGuide 캡처 실패 시 네이버 일봉+입력 평단으로 원금회수 예측 계산" |
| `fc572c5`·`ea98e03` | — | 거래정지(halt) 공시 API 타임아웃 6s→12s·재시도, halt 90일 창 KST 고정(halt는 거래정지 전용 화면으로 별개 계약) |
| `ffeb1bb` | 2026-10-30 | "워치 일일 배치에서 9인 위원회 LLM 호출 스킵(일 최대 450회 절감)" — §4 유력 가설의 핵심 참조 |
| `0539d13`·`839ab84` | 2026-10-30 | 402 크레딧 부족 전용 화면, `JAROO_LLM_MOCK=1` 결정적 모의(dev) |

---

## 2. 코드 레벨 실패 분류 지도 (어떤 계층에서 어떻게 분류·표면화되는가)

```
[프론트] deepscan/page.tsx
  ├─ 402 insufficient-credits → DeepScanCreditShortageScreen 전용 화면 (오류카드 아님)
  ├─ haltVerdict 'halted'    → 거래정지 전용 화면 (별개 계약, 오류 아님)
  └─ 그 외 fetchState='error' → DeepScanLoadingScreen 오류카드
        헤더 "분석 요청에 실패했어요" / 배지 "분석 요청 실패"(기본 "오류")
        본문 = 서버 error.message(한국어 안내) 폴백 "분석 데이터 요청에 실패했습니다…"
        payload 계약 불일치(null) → "DeepScan 데이터를 표시할 수 없어요…"
      ↑ DeepScanApiError{code,status,creditBalance,creditCost} (deepscan-canonical.ts)

[웹 API] /api/deepscan (route.ts)
  ├─ 게이트: 401 auth-required / 402 insufficient-credits(balance·cost 포함) / 503 entitlement-unavailable
  └─ createDeepScanCanonicalResponse: 빌더 throw 시
       CrawlerDeepScanRequestError.status 전파(그 외 400) + §6-6 선차감 크레딧 환불
       환불 성공 → "딥스캔 분석이 실패했어요. 크레딧은 차감되지 않았어요…"
       환불 실패 → console.error('[deepscan] credit refund failed — 수동 정산 필요')
       공통 → console.error('[deepscan] builder failed') + "딥스캔에 일시적인 문제가 생겼어요…" (원문 비노출)

[웹→크롤러] build-payload.ts
  fetchWithDeadline: 타임아웃 → CrawlerDeepScanRequestError(504 'timed out after Nms')
                     네트워크 reject → 502 / 응답 읽기 실패 → 502
  readJsonPayload:   빈 본문 'returned an empty response'·invalid JSON 'returned invalid JSON' → 502/상태
  429 busy:          retry-after 클램프(≤15s) 후 DEEPSCAN_KR_BUSY_MAX_WAIT_MS(30s)까지 재시도
  최종 실패:         '[deepscan] crawler upstream error details'(429 limits/activeJobs·504 잔존 잡) 로그 후 상태 전파
  상수: KR fetch 150s · busy max wait 30s · busy 기본 2s · US slim 90s

[크롤러 어드미션] deepscan-kr-admission.js
  전역 1·종목당 1 슬롯 → 초과 시 HttpError 429 'KR DeepScan crawler is busy'
    details: {status:'busy', reason:'global_limit'|'per_code_limit', retryAfterMs:2000, limits, activeJobs}
  동일 jobKey dedup(같은 promise 공유) / DEEPSCAN_KR_EXECUTION_DISABLED=1 → 503 unavailable(retryable)
  와치독 DEEPSCAN_KR_JOB_MAX_MS(기본 300s) → 504 'KR DeepScan job timed out' + 슬롯 회수
    늦게 settle한 잡은 'ghost settled … result discarded' 폐기

[크롤러 소스] deepscan-payload.js
  소스별 하드 데드라인(기본 100s, current-quotes 15s·ETF 스냅샷 4.5s·공시 4.5s 등)
  위원 전원/일부 실패에도 payload는 200 OK 저하 계약:
    fallback.reason='kr-committee-member-errors' ("일부 국내 위원 응답 실패 N건")
    hero: "<종목명> 국내 DeepScan 위원회 재시도 필요" · score 0 · scoreLabel 'N/A' · statusText '부분 오류'
    metadata.llmCommittee: {requestId, status:'error'|'partial'|'complete', completed, errors}
  요청 단위 스킵: ?committeeLlm=off → committeeLlmEnabled() false (워치 배치 전용)

[LLM 위원회] committee-llm.js — CommitteeLlmError.errorKind 분류
  llm-timeout-or-network (fetch reject, AbortSignal.timeout 45s)   → 재시도 o (기본 3회, +2s 간격)
  llm-upstream-error    (HTTP 오류/응답 내 error 객체)             → DataInspectionFailed·콘텐츠 정책·400/401/403은 비재시도
  llm-invalid-json / llm-empty-content / llm-null-content / llm-invalid-schema → 재시도 o
  runtime-missing-dump (덤프 생성 누락) → 재시도 x, attempts 0
  llm-unknown          (OPENROUTER_API_KEY 미설정 등 일반 Error 래핑)
  기록: stdout `[committee-llm] … status=error kind=…` 1줄 + 파일 로그
        .omx/context/committee-debug-logs/{member}-attempt-{n}-failure.json·{member}-failure.json·_summary-{key}.json
        (컨테이너 내부 경로 — 배포 재시작 시 휘발, stdout 요약에 error 원문·status는 미포함)
```

---

## 3. 실패 모드 매트릭스

| 실패 모드 | 사용자 표면(오류카드 배지 등) | 발생 계층 | 원인 가설 | 빈도/시점 증거 | 재현 방법 | 현재 기록 위치 |
|---|---|---|---|---|---|---|
| **FM-1 위원회 LLM upstream 전멸(4xx·정책 비재시도)** | **오류카드 아님** — 200 OK 저하 payload: hero "위원회 재시도 필요"·score 0·'N/A', fallback "일부 국내 위원 응답 실패 9건", `metadata.llmCommittee.status='error'` | 크롤러 LLM 위원회 | OpenRouter 400/401/403(키·모델·엔드포인트·정책) + 워치 배치에 `committeeLlm=off` 미적용(배포 빌드가 `ffeb1bb` 이전이거나 배선 무효) — §4 | **252건(9위원×7종목×4일), 11-02~11-05 매일 18:00~18:03 KST, 100% 재현** | fetch 스텁이 `error:{message:'DataInspectionFailed',code:400}` 반환 (TC-DSF-003·004·008) | stdout `[committee-llm] kind=llm-upstream-error`(원문·status 미포함), `.omx/.../{member}-failure.json`, payload `metadata.llmCommittee`, `_summary-{ticker}.json` |
| FM-2 위원 응답 형식 불량(empty/null/invalid JSON/invalid schema) | 위원 일부 실패 → 동일 저하 payload(위원 수만큼 errors 증가, heroScore 고정분모 왜곡 이력 — 버그헌트 3/5) | LLM 위원회 파서 | 모델 출력 불안정·json_schema 미준수 | 조회 창 0건 / 버그헌트·TC로 상시 방어 | fetch 스텁으로 각 형태 주입 (TC-DSF-001·002·002b·006) | 위와 동일 |
| FM-3 소스 지연·무응답 → 웹 504 | 빨간 오류카드 "분석 요청에 실패했어요"(환불 안내 동반), 재시도 버튼 | 크롤러 소스 → 웹 fetchWithDeadline | WiseReport 무타임아웃(버그헌트 5/5), 소스 번들 무음 정체 | 2026-10-13 08:56 사고(주석), 조회 창 0건 | hang fetch 스텁 + `fetchTimeoutMs` (TC-DSF-016으로 상수·변환 계약 고정) | `[deepscan] canonical fetch failed … httpStatus=504` + `crawler upstream error details` |
| FM-4 어드미션 슬롯 고갈 429 busy | 오류카드(429 전파). 웹은 30s까지 busy 재시도 후 실패 | 크롤러 어드미션 | 전역 1·종목당 1 슬롯 + 유기 잡 점유 | 2026-10-11 사고(2일 장애, 커밋 726145c), 조회 창 0건(waitedMs=0 항상) | 슬롯 1 상태에서 제2 잡 진입 (TC-DSF-009·010) | busy details(limits·activeJobs·retryAfterMs) → 웹 `[deepscan] crawler upstream error details` 로그 |
| FM-5 잡 유기 → 와치독 504+슬롯 회수 | 504 오류카드(최대 5분 내 자동 회복 — 와치독이 없던 시절엔 2일 장애) | 크롤러 어드미션 | load promise 미-settle(소스 hang) | 10-11 사고 이후 방어됨, 조회 창 0건 | 60ms 와치독 + 120ms 느린 load (TC-DSF-011) | warn `watchdog timeout … slot reclaimed`, `ghost settled … result discarded` |
| FM-6 크레딧 부족(402) | **크레딧 부족 전용 화면**(오류 아님 — "크레딧이 살짝 모자라요", 필요/잔여 수치, 충전 CTA) | 웹 게이트 | 결제·크레딧 소진 | 조회 창 0건 | 402 본문 스텁 + `buildCreditShortageFacts` (TC-DSF-015·018) | 응답 본문 `error.code='insufficient-credits'`+balance/cost (서버 로그 별도 없음) |
| FM-7 게이트 장애(401/503) | 401: 로그인 안내 오류카드 / 503: "결제 상태를 확인할 수 없어요" | 웹 게이트 | 미로그인, Supabase/엔타이틀먼트 RPC 장애 | 조회 창 0건 | 계약 고정 (TC-DSF-015) | 응답 본문 error.code |
| FM-8 빌더 실패(크롤러 4xx/5xx 비busy) | 오류카드 + "크레딧은 차감되지 않았어요" 환불 안내(선차감 실패 시) | 웹 /api/deepscan | 크롤러 400 input-invalid, 내부 오류 등 | 조회 창 0건 | CrawlerDeepScanRequestError 스텁 (TC-DSF-014) | `[deepscan] builder failed`·`credit refund failed — 수동 정산 필요`(환불 실패만) |
| FM-9 프론트 상태 교찁(과거 버그 계열) | '요약 중' 영구 스피너, 크레딧 이중 소진, pending 카드 영구 로딩 | 프론트 이펙트/폴링 | cleanup abort + ref 가드 조합, 폴링 한도 무종결 | 본건은 ca72da8 해소, 변형 3건 버그헌트 미수정 | 정적 계약 + 이 영역 e2e(deepscan 담당) | 화면·스토어 상태(서버 로그 없음) |
| FM-10 거래정지(halt) 화면 | halt 전용 화면(오류 아님 — 공시·심각도 게이지) | 웹 halt 판정(10s fail-open) | 정지 종목 진입 | 별개 계약(임무 명시: halt는 별개) | `resolveDeepScanHaltVerdict` 기존 테스트 존재 | halt 라우트·기존 deepscan-halt 테스트 |
| FM-11 데이터 정합 오염(실패는 아니나 "잘못된 분석") | 오류 없이 그릇된 결과(옛 종가·종가0·통화 붕괴·2모델 low) | 크롤러/런타임 코어 | 캐시 키·타임아웃·통화·UTC/KST 실수 집중(버그헌트 FINAL: 데이터/크롤러 26건 최다) | 상시(운영 로그에 안 보임 — 침묵 실패) | 각 버그별 기존/신규 코어 테스트 | 대부분 무기록(침묵) — 모니터링 권고 §6 |

---

## 4. 재현 조건 가설

### 4.1 가장 유력 — FM-1 "위원회 LLM 전멸"의 정확한 파라미터 조합

**관측된 재현 조건(확정)**:
- 시점: 매일 **18:00~18:03 KST**(09:00~09:03 UTC) — 워치 일일 배치(`watch-daily-batch` 18시 스케줄)가 7개 관심종목을 순차 실행하는 구간
- 입력: KR 주식 canonical 요청(코드 272210/403870/010170/047040/056360/100840/085620), `model=deepseek/deepseek-v4-flash`, `concurrency=9`, `softDeadlineMs=5000`
- 실패 형태: 9위원 전부 `attempts=1`에 53~846ms 만에 종료, `kind=llm-upstream-error`, 재시도 없음 → **OpenRouter가 즉시 4xx(400/401/403) 또는 콘텐츠 정책 메시지를 반환**하는 것만이 이 분류에 해당(`isNonRetryableOpenRouterError`)
- 배타적 근거: `OPENROUTER_API_KEY is not configured.`라면 errorKind가 `llm-unknown`이 되어야 하므로 **키는 설정돼 있음**. 네트워크 실패라면 `llm-timeout-or-network` + 재시도 4회였을 것. 모델 미존재 가설은 약화 — `deepseek/deepseek-v4-flash`는 2026-11-05 OpenRouter 공개 카탈로그(모델 목록 GET, LLM 호출 아님)에서 존재 확인

**두 갈래 원인 가설**:

1. **[가설 A — 배선 결함, 가장 유력]** 워치 배치는 커밋 `ffeb1bb`(2026-10-30)부터 `skipCommitteeLlm:true` → 크롤러 `?committeeLlm=off`로 위원 LLM을 스킵해야 하는데, **운영 배포(11-02 06:30Z 빌드)에서는 위원이 실제로 호출되고 있다**(28회 start 로그). 즉 배포 빌드가 `ffeb1bb` 이전 커밋에서 만들어졌거나, 배선이 배포 환경에서 무효화됐다. 위원 호출 자체가 "일어나지 않아야 할 호출"이므로, 이 실패는 배포 버전 불일치로 인한 **불필요 호출 63회/일 × 전멸**로 해석된다. master에는 배선이 존재하며 TC-DSF-017로 잠갔다 — 다음 배포 후에도 start 로그가 계속되면 배선 외 요인(빌드 캐시, GitHub↔로컬 master 괴리)이다.
2. **[가설 B — OpenRouter 4xx]** 배포 환경의 `OPENROUTER_API_KEY`가 무효화(만료·크레딧 소진·401)되었거나, 해당 모델 엔드포인트가 `400`(예: `require_parameters`+json_schema 조합 거부, `DataInspectionFailed`류 정책)을 반환한다. elapsed 53ms 건도 있어 거부가 업스트림 프런트에서 즉시 일어나는 형태와 일치. 11-02 배포 직전까지 동일 코드가 성공했다는 로그는 없어(이전 배포 로그 소실) 11-02 이후 "항상 실패"인지 "그 날부터 실패"인지는 단정 불가.

**검증 절차 제안(운영, 읽기 전용)**: (a) 배포 컨테이너에서 OpenRouter 키 헬스체크 1토큰 호출 — 401/400 원문 확인, (b) `.omx/context/committee-debug-logs/*-failure.json`의 `upstream_result.error` 원문 열람, (c) 배포 커밋 해시 확인(현재 로그엔 기록 없음 — §6 권고 1).

### 4.2 과거 실패의 재현 조건(커밋·리포트로 확정된 것들)

| 실패 | 정확한 재현 조건 | 현재 상태 |
|---|---|---|
| 2026-10-11 2일 장애 | 소스 hang으로 canonical load promise가 영원히 미-settle + 글로벌 슬롯 1 → 이후 모든 요청 429 busy | 방어됨(와치독 300s, TC-DSF-011) |
| 2026-10-13 08:56:20 | 소스 번들 252s 무음 정체 → 웹 150s 데드라인 504 → **유저 재시도가 429 busy와 충돌** | 방어됨(소스별 100s 데드라인, TC-DSF-016) |
| 콜드 딥스캔 45s 실패 | 첫 요청(캐시 없음)이 구 45s 전역 타임아웃 초과 | 상향됨(KR 150s) |
| '요약 중' 영구 교착 | 로딩 화면 팀 요약 이펙트 cleanup abort + 동일 requestKey 재요청 가드 | 해소(ca72da8), 변형 주의 |
| FnGuide 캡처 실패 | FnGuide 캡처 불가 종목 → 원금회수 예측 실패 | 폴백 추가(aaa7a89) |

---

## 5. 회귀 TC 목록·결과

- 파일(신규 3개): `tests/tc-deepscan-failure-llm-committee.test.mjs`, `tests/tc-deepscan-failure-crawler-admission.test.mjs`, `tests/tc-deepscan-failure-web-gateway.test.mjs`
- 실행: `node --test tests/tc-deepscan-failure-*.test.mjs` — **21/21 PASS** (2026-11-05). 기존 `.mjs` 스위트와 합동 실행(`node --test tests/*.test.mjs`)도 **176/176 PASS**로 간섭 없음. eslint 통과
- 방식: 실패 주입 — `globalThis.fetch` 스텁(실호출 LLM 0회), 어드미션 deferred load, TS 계층은 저장소 관례대로 정적 계약 검증

| TC ID | 사전조건 | 시나리오(실패 주입) | 기대결과 | 파일 | 결과 |
|---|---|---|---|---|---|
| TC-DSF-001 | fetch 스텁, API 키 더미, 임시 logDir | 1차 시도 invalid JSON → 2차 정상 JSON | `attempts=2` 성공, `errorKind=null`, 1차 실패가 `valuation-attempt-1-failure.json`에 `llm-invalid-json` 기록 | llm-committee | PASS |
| TC-DSF-002 | 위와 동일 | 전 시도 empty content | retryCount 소진 후 `llm-empty-content`, attempts=4, 비재시도 표기 | llm-committee | PASS |
| TC-DSF-002b | 위와 동일 | content=`"null"` 텍스트 | `llm-null-content` 분류(empty와 구분) | llm-committee | PASS |
| TC-DSF-003 | 위와 동일 | 응답 내 `error:{message:'DataInspectionFailed',code:400}` | `llm-upstream-error`, attempts=1(비재시도), fetch 재호출 0회 | llm-committee | PASS |
| TC-DSF-004 | 위와 동일 | `error:{message:'Provider overloaded',code:503}` | 재시도 소진(4회) 후 `llm-upstream-error` | llm-committee | PASS |
| TC-DSF-005 | 위와 동일 | 1차 fetch reject(abort 메시지) → 2차 정상 | `llm-timeout-or-network` 기록 후 재시도 성공 | llm-committee | PASS |
| TC-DSF-006 | 위와 동일 | 1차 JSON이 필수 reason 누락 | `llm-invalid-schema` 기록 후 재시도 성공 | llm-committee | PASS |
| TC-DSF-007 | memberKeys 2개 중 덤프 1개 누락 | `runtime-missing-dump` 유발 | errors에 attempts=0·finalStatus='error', results는 성공 위원만 | llm-committee | PASS |
| TC-DSF-008 | 위원 3명 전원 비재시도 실패 주입 | 전멸 유발 | results 0·errors 3건(운영 0/9 시그니처 동형) + `_summary-*.json`에 errorKind 보존 | llm-committee | PASS |
| TC-DSF-008b | — | 기본 모델 상수 고정 | `deepseek/deepseek-v4-flash` 불변(운영 관측값과 일치) | llm-committee | PASS |
| TC-DSF-009 | 글로벌 슬롯 1, 제1잡 점유 중 | 제2잡(타 코드) 진입 | 429 busy, details {status:'busy', reason:'global_limit', retryAfterMs:2000, limits, activeJobs} | crawler-admission | PASS |
| TC-DSF-010 | 글로벌 2·종목당 1, 같은 코드 점유 중 | 같은 코드(holding 다른 jobKey) 재진입 + 타 코드 진입 | `per_code_limit` busy / 타 코드 정상 실행 | crawler-admission | PASS |
| TC-DSF-011 | 와치독 60ms, load 120ms | 유기 유발 | 504 timeout+재시도 가능, warn 'watchdog timeout … slot reclaimed', 후속 잡 정상, 늦은 결과 'ghost settled … discarded' 폐기, 슬롯 최종 0 | crawler-admission | PASS |
| TC-DSF-012 | 슬롯 여유 | 동일 jobKey 2회 동시 run | load 1회만 실행, 같은 결과 공유(dedup) | crawler-admission | PASS |
| TC-DSF-013 | DEEPSCAN_KR_EXECUTION_DISABLED=1 | run 시도 | 503 unavailable, retryable=true | crawler-admission | PASS |
| TC-DSF-014 | —(정적 계약) | route.ts 실패 경로 | CrawlerDeepScanRequestError.status 전파(외 400), §6-6 환불 문구·수동 정산 로그, 일시 문구, 원문 비노출 | web-gateway | PASS |
| TC-DSF-015 | —(정적 계약) | 게이트 3종 + 크레딧 부족 헬퍼 | 401/402(balance·cost)/503 분기, `buildCreditShortageFacts` 문구 | web-gateway | PASS |
| TC-DSF-016 | —(정적 계약) | build-payload.ts 파라미터 | KR 150s·busy 30s/2s·US 90s, 504/502 변환, invalid JSON 분류, busy 클램프 15s, 업스트림 details 로그 | web-gateway | PASS |
| TC-DSF-017 | —(정적 계약) | committeeLlm=off 배선 | daily-batch `skipCommitteeLlm:true` → URL `committeeLlm=off` → crawler 파싱 → `committeeLlmEnabled` off 우선 → `llmAttempted` 게이트 (§4 가설 A 재발 방지 핀) | web-gateway | PASS |
| TC-DSF-018 | —(정적 계약) | 프론트 오류 표면 | 402 전용 화면(errorCredit cost/balance), 오류카드 배지·헤더·본문 폴백, DeepScanApiError 4속성, 계약 불일치 finishError | web-gateway | PASS |
| TC-DSF-019 | —(정적 계약) | 위원 전멸 payload 저하 계약 | `kr-committee-member-errors`, hero "재시도 필요"·score 0, `metadata.llmCommittee.status`, partial 폴링 경로 | web-gateway | PASS |

> 실제 결함이 밝혀지면 FAIL 보존 + 원인 기록 방침은 TC-MASTER.md의 기존 운용(예: TC-CORE-029)과 동일하게 적용한다. 현 시점 신규 TC는 전부 통과하므로 FAIL 보존 항목 없음.

---

## 6. 권고 (모니터링·재현도구 개선)

1. **배포 커밋 해시 기록(최우선)** — Dockerfile은 `/buildtime`만 남기고, Railway 로그·메타에 커밋 해시가 없어 "운영에서 무엇이 돌고 있는가"를 로그만으로 판정 불가했다(§4 가설 A의 직접 검증이 막힌 이유). 빌드 시 `git rev-parse HEAD`를 stdout 1줄/`/app/BUILD_INFO`로 남기자.
2. **위원 LLM 실패의 stdout 요약에 원문 추가** — 현재 `[committee-llm] status=error kind=…`만 stdout으로 나가고 HTTP status·error 원문은 컨테이너 내부 `.omx` 파일에만 존재(휘발). `{kind, status, message-slice}`를 stdout 한 줄에 추가하면 이번 포렌식의 1차 병목이었던 "재현 조건 불명"이 해소된다.
3. **OpenRouter 키·모델 헬스체크** — 주기적(예: 배치 직전) 최소 호출 1회로 401/400/모델 접속성을 점검하고 이상 시 알림. `e64d0f4`·`74fdb0b`가 보여주듯 모델 교체·접속성은 반복된 실패원.
4. **워치 배치 위원 전멸 알림** — `[watch-daily-batch] done … failed=0`으로 위원 0/9가 지표에 안 잡힘. `metadata.llmCommittee.errors>0` 비율을 배치 요약에 넣고 임계 초과 시 Telegram 관제 알림.
5. **Railway 로그 보존 연장 또는 주기 수집** — deployment 교체 시 이전 배포 로그가 소실되어 11-02 이전 상태를 검증할 수 없었다. 크론으로 `[committee-llm]`·`[deepscan] builder failed`·`credit refund` 시그니처를 매일 수집·적재하면 "재현 조건을 모르는 오류"의 시계열 증거가 쌓인다.
6. **환불·402 감시** — `[deepscan] credit refund failed — 수동 정산 필요`와 402 발생 카운트는 현재 로그조차 남지 않는다(402는 응답 본문뿐). 카운터+알림 권장.
7. **침묵 실패(FM-11) 정합 검증** — 옛 종가 고정(selectedAt)·종가 null→0·2모델 low_confidence 등은 오류 로그가 전혀 없어 모니터링에 안 잡힌다. 버그헌트 발견분의 회귀 테스트는 각 영역 TC에 존재하며, 스냅샷 가격 basis와 현재가 드리프트 임계 초과 알림을 추가하면 "오류 없는 그릇된 분석"도 탐지 가능.
8. **TC-DSF-017을 배포 검증 절차에 연결** — 다음 배포 후 운영 로그에서 `[committee-llm] start`가 배치 시간대에 사라지면 가설 A 확정, 계속되면 가설 B(키/모델)로 전환해 §4.1 검증 절차를 수행한다.
