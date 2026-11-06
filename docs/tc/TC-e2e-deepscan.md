# 딥스캔 여정 E2E TC — 시딩 기반 여정 + 실호출 풀 여정(실행 결과 매트릭스)

- **코드 기준**: master @ `3f7276f` (커밋 없음, 프로덕션 코드 미수정 — 본 문서와 `scripts/e2e-deepscan-journey.cjs` 1개 파일만 추가)
- **실행일**: 2026-11-05
- **실행 명령**: `node scripts/e2e-deepscan-journey.cjs` (개별: `seeded` / `live`, 목록: `--list`)
- **대상 스택**: jaroo dev 스택 — 웹 `http://127.0.0.1:3002` / 크롤러 `http://127.0.0.1:3040` (환경변수 `JAROO_BASE_URL`·`JAROO_CRAWLER_URL`로 변경 가능)
- **브라우저**: `agent-browser` 0.27.0, 세션 `jaroo-e2e-deepscan` (타 에이전트와 분리)
- **환경 변수 실측**: `.env.local` = `OPENROUTER_API_KEY`·`OCR_MODEL`·`SUPABASE_URL`·`SUPABASE_ANON_KEY` 만 설정. `DART/polygon/fmp/finnhub/KRX_ID/KRX_PW` 미설정(§7 데이터 소스 저하 근거), `.env.cookie`(WiseReport 쿠키) 없음
- **계측 채널**: 크롤러 콘솔 로그 `/tmp/jaroo-dev-stack.log`(Lead 관리, **읽기 전용** 사용), 위원 디버그 아티팩트 `packages/crawler/.omx/context/committee-debug-logs/kr-committee-*`, `GET /api/source/deepscan/kr/committee-status`
- **요약**: 총 **2여정** — TC-E2ED-001 **FAIL(환경 제약)**: `/deepscan`은 미들웨어 Supabase 인증 게이트로 막혀 있어 세션 시딩만으로 화면 여정 진입 불가(게스트 게이트 구간·위생은 PASS). TC-E2ED-002 **PASS(페이로드 4/4 생성)**: 크롤러 API 직접 호출 통합 E2E로 삼성전자·KB금융·셀트리온·LG화학 4종목 실호출 완주. 단 **모든 회차에서 위원회가 5초 소프트 데드라인에 잘려 partial(1~4/9)로 반환 → degraded=true** — §6에 결정론적 재현 조건 확정(본 TC의 핵심 산출물)

---

## 0. 조사 결과 — /deepscan UI 경로의 서버 인증 요구 (지시서 확인 사항)

지시서의 "웹 UI(/deepscan) 시작 플로우가 실제 Supabase 인증 쿠키를 요구하는지, 아니면 시딩으로 진행 가능한지" 조사 결과:

| 항목 | 결과 |
|---|---|
| `/deepscan` 페이지 접근 | **Supabase 인증 세션(쿠키) 필수** — `src/lib/supabase/proxy.ts`의 `PROTECTED_APP_PATHS = ['/mypage', '/deepscan', '/payments']` 가 게스트를 `307 → /login?next=%2Fdeepscan` 으로 리다이렉트(브라우저 실측 및 HTTP 실측 일치) |
| 시딩만으로 우회 가능 여부 | **불가** — 미들웨어는 `supabase.auth.getUser()`가 유저를 반환해야 통과. `sessionStorage` 시딩(applied-home-portfolio·deepscan-target)은 이 검증에 영향을 줄 수 없고, 실제 세션 쿠키 위조는 실제 Supabase 프로젝트(`hrfpnawmlcoaygipulpm.supabase.co`) 로그인 없이는 성립하지 않음. 회원가입/로그인 여정은 금지 규칙이라 대체 불가 |
| `/api/deepscan` 웹 API 라우트 | **인증 게이트 밖** — `isProtectedAppPath('/api/deepscan') = false`. dev(`TOSS_SECRET_KEY` 미설정)에서는 무과금 직행(`src/app/api/deepscan/route.ts`의 `hasTossServerConfig()` 분기)으로 인증 없이 파이프라인 실행 가능. 다만 브라우저가 `/deepscan`에 진입 자체가 불가해 브라우저 발사 방식은 사용 불가 |
| `/debug/deepscan` | 200으로 개방돼 있으나 폼 제출이 `router.push('/deepscan')`이라 결국 같은 게이트에 걸림 — 우회로 불가 |
| **판정** | 지시서의 대체 시나리오 성립: **TC-E2ED-002를 크롤러 API 직접 호출 통합 E2E로 대체**하고 그 사실을 본 문서에 명시함. TC-E2ED-001은 세션 시딩으로 검증 가능한 구간(게스트 게이트 유도 여정)을 검증하고 화면 여정은 BLOCKED(환경 제약)로 기록 |

## 1. TC 목록

| TC ID | 여정 제목 | 분류 | 우선순위 | 자동화 | 결과 |
|---|---|---|---|---|---|
| TC-E2ED-001 | 시딩 기반 딥스캔 여정 (세션 시딩 → /deepscan 진입 → 인증 게이트 유도 검증 + 화면 여정) | UI 여정 | P0 | `scripts/e2e-deepscan-journey.cjs seeded` | **FAIL(환경 제약)** — 게이트 유도·위생 3체크 PASS, 화면 여정 1체크 BLOCKED(§3) |
| TC-E2ED-002 | 실호출 풀 여정 — 크롤러 직접 호출 실행 결과 매트릭스 (KR 대형주 4종목 × 최대 5회) | 통합 E2E(데이터 파이프라인) | P0 | `scripts/e2e-deepscan-journey.cjs live` | **PASS** — 4회 실호출 전부 최종 페이로드 생성(§5), 위원회 partial은 §6 재현 조건 |

## 2. 공통 사전조건

- jaroo dev 스택 기동(웹 3002·크롤러 3040) — 스크립트 preflight가 크롤러 `/api/source/system/health`와 웹 `/deepscan`(redirect manual) 확인
- `agent-browser` 바이너리(`--session-name` 지원) — 기본 `/home/pinion/.npm-global/bin/agent-browser`, `AGENT_BROWSER_BIN` 오버라이드
- **비용 규칙**: 스크립트 1회 실행당 실제 딥스캔 파이프라인(LLM 포함) 실행은 최대 5회(`LIVE_RUN_BUDGET=5`). 이번 TC 실측에서는 총 **4회 실행**(§5)으로 한도 내
- **부작용 금지 준수**: 회원가입·결제·크레딧 변동 없음. 미인증 요청이라 스냅샷 캐시·스캔 히스토리 기록도 발생하지 않음(`saveDeepScanSnapshot`은 세션 유저가 있을 때만 동작). 크롤러 인메모리 위원 진행 상태와 디버그 아티팩트는 캐시 목적 잔존으로 허용 범위

## 3. TC-E2ED-001 시딩 기반 딥스캔 여정 — 상세

- **분류**: UI 여정 · **우선순위**: P0
- **사전조건**: §2 + 게스트 상태(인증 쿠키 없음). 스크립트가 `sessionStorage['jaroo:applied-home-portfolio']`에 삼성전자(005930, 10주/평단 78,000원/-8.2%) 보유 행을 시딩하고 `jaroo:deepscan-target`은 제거(`verify-screens-browser.cjs` fixture와 동일 스키마)
- **단계와 결과** (실행 시각 2026-11-05 20:07, 로그 `/tmp/e2e-deepscan-seeded-run.log`):

| 단계 | 검증 내용 | 결과 |
|---|---|---|
| J1 | 세션 시딩 — applied-home-portfolio 삼성전자 005930 readback | **PASS** (3.1s) |
| J2 | 게스트 `/deepscan` 진입 → 인증 게이트 유도: `location.pathname === '/login'` + `next === '/deepscan'` + 홈 복귀 링크 존재 | **PASS** (3.6s) — 실측 `{url:"/login", next:"/deepscan", backLink:true}` |
| J3 | 딥스캔 화면 여정 (로딩 화면 → 브리핑 카드 → 위원 9명 그리드 → 브리핑 순차 노출 → 내러티브 → 결과 전환 → 인라인 결과) | **BLOCKED(환경 제약)** — §0 판정대로 인증 세션 부재. 스텝 구현은 스크립트에 유지됨 |
| J4 | 위생 — 게이트 여정 콘솔 에러·허용 외 HTTP 실패 0 | **PASS** (console=0, http=0) |

- **기대결과**: 게스트는 `/deepscan` 직접 진입이 아니라 로그인 유도를 받는 것이 설계 동작(`TC-e2e-journeys.md` TC-E2EJ-001과 정합) — 이 구간은 PASS. 로딩 화면 이후 화면 여정은 **인증 세션이 있는 환경에서 재실행**해야 한다
- **검증방법**: agent-browser 실제 탐색 후 `location.pathname`/`URLSearchParams(next)` 관측 + DOM 단정. 화면 여정 구간은 로딩 화면 h1·`[aria-label="딥스캔 안내"]` → `[aria-label="오늘 장 기준 시세 브리핑"]` → `[aria-label="세 팀 분석 진행 상태"]` 위원 ≥9 → `[data-today-briefing-item]` 순차 노출(15s 간격 비감소) → `[aria-label="분석가 진행 메시지"] article` → `[aria-label="완료 전환 상태"]` → 본문 `/세 팀의 의견|종합 결론/` 순서로 단계 도달 시각을 기록한다(verify-screens와 중복되지 않게 진행 중심 검증)
- **재실행 방법(환경 제약 해소 후)**: 유효한 Supabase 세션 쿠키를 브라우저 세션에 주입한 뒤 `E2E_FORCE_UI_JOURNEY=1 node scripts/e2e-deepscan-journey.cjs seeded` — 화면 여정 전 스텝(J3~J10)이 활성화된다. 이때 페이지가 발사하는 `GET /api/deepscan?...` URL을 네트워크 로그에서 캡처해 동일 URL을 리플레이하는 "실행 공유" 계측(크롤러 admission 동일 jobKey dedupe 활용)도 함께 동작한다
- **결과**: **FAIL(환경 제약)** — 원인: 테스트 환경에 Supabase 인증 세션 부재(제품 설계상 의도된 게이트, 코드 결함 아님). TC 기대값 오류도 아님(지시서가 가정한 "시딩으로 /deepscan 진입" 전제가 현 환경에서 성립하지 않는 것으로 확인됨)

## 4. TC-E2ED-002 실호출 풀 여정 — 상세

- **분류**: 통합 E2E(실제 데이터 파이프라인) · **우선순위**: P0
- **경로 대체 명시(지시서 허용 조항)**: UI 경로가 서버 인증(§0) 때문에 막혀 있으므로, **크롤러 API `GET /api/source/wisereport-fnguide-krx-polygon-fmp-deepscan-package/deepscan/canonical` 직접 호출 통합 E2E로 대체**했다. 이 라우트는 웹 라우트(`/api/deepscan`)가 KR 스캔 시 호출하는 상위 파이프라인 그 자체다(WiseReport/FnGuide 수집 → KRX/시세 → 9인 위원 LLM → 페이로드 빌드)
- **사전조건**: §2 + `OPENROUTER_API_KEY` 설정(위원 LLM 실호출). 크롤러 admission(`deepscan-kr-admission`) 글로벌 동시 1건이라 회차는 순차 실행(회차 간 3s 여유)
- **사용 종목(섹터 다양화)**: 삼성전자 A005930(IT/반도체)·KB금융 A105560(금융)·셀트리온 A068270(바이오)·LG화학 A051910(화학) — 모두 KOSPI. 요청 파라미터: `market=KOSPI&code=<코드>&name=<종목명>&from=e2e-live-matrix&selectedAt=<ISO>`(보유 파라미터 없는 게스트 스캔 형태)
- **단계**:
  1. 요청 발사(회차별 시작 시각·파라미터 로그) + 3종 계측 감시 시작 — 크롤러 콘솔 로그 tail(읽기 전용), 위원 디버그 아티팩트(crawler cwd 루트 + repo 루트), 429 busy 재시도 루프
  2. 응답 수신 — HTTP 상태·본문 확보, 소요시간 측정
  3. 페이로드 계약 검증 — metadata(version/generatedAt/degraded/debugId/inputValidity/sourceRefs/blockStatus 6블록) + 6개 메이저 블록(hero/committee/insights/strategy/sellNow/portfolioSimulation) + hero.score + 위원 9명 + 인사이트 ≥1 + 전략 필드 + llmCommittee.requestId
  4. 크롤러 레이어 후속 증거 — `committee-status?requestId=` 폴링, 디버그 dir summary.json(멤버별 성공/실패·elapsed_ms)
  5. 실패 시 동일 조건 1회 재실행(R5, 총 5회 한도)으로 재현성 판정
- **기대결과**: 파이프라인이 최종 페이로드(스코어/브리핑/위원 결과 등)를 생성하면 PASS. 외부 키/쿠키 부재 등 환경 제약 실패는 FAIL(환경 제약)로 원인을 구분 기록
- **검증방법**: HTTP 응답 본문(JSON) 계약 단정 + 크롤러 로그 스테이지 타이밍(`[deepscan-kr] stage sources/committee elapsed`) + 멤버 아티팩트(`request-<member>.json` 9명 발사, `<member>.json` 성공, `*-failure.json` 실패) + committee-status 폴링

## 5. 실행 결과 매트릭스 (종목 × 회차 × 결과 × 소요시간 × 실패 시그니처)

실행 창: 2026-11-05 19:58:53~20:00:39 KST (1차 계측 실행, 총 4회 실호출 — R1은 §0 게이트로 미발사, R5가 삼성전자 직접 계측을 대신 수행)

| 회차 | 종목(코드/섹터) | 요청 경로 | 시작 시각 | 총 소요 | sources 수집 | committee 스테이지 | HTTP | 위원(5s 스냅샷) | 결과 | 실패/제약 시그니처 |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 삼성전자(005930/IT·반도체) | 브라우저 발사 예정이었으나 **미발사**(§0 게이트) | — | — | — | — | — | — | **FAIL(환경 제약)** | `journey-blocked` — 실행 0회, 비용 0 |
| R2 | KB금융(105560/금융) | crawler-direct | 19:58:53 | **25.4s** | 18.0s | 5.0s | 200 | partial **2/9**(pending 7, errors 0) | **PASS**(페이로드 생성, degraded=true) | `soft-deadline-5s` (§6.1) |
| R3 | 셀트리온(068270/바이오) | crawler-direct | 19:59:24 | **20.3s** | 15.3s | 5.0s | 200 | partial **4/9**(pending 5, errors 0) | **PASS**(degraded=true) | `soft-deadline-5s` |
| R4 | LG화학(051910/화학) | crawler-direct | 19:59:50 | **21.9s** | 14.9s | 5.0s | 200 | partial **1/9**(pending 8, errors 0) | **PASS**(degraded=true) | `soft-deadline-5s` |
| R5 | 삼성전자 재실행(005930/IT·반도체) — R1의 직접 계측 대체 | crawler-direct | 20:00:17 | **19.4s** | 14.4s | 5.0s | 200 | partial **3/9**(pending 6, errors 0) | **PASS**(degraded=true) | `soft-deadline-5s` |

공통 페이로드 요약(4회 모두): `metadata.degraded=true`, `llmCommittee.status=partial`, `hero.score=36`(4종목 모두 동일값 — §9 관측 2), `blockStatus` 6블록 존재, 전략 목표가 텍스트 생성(KB금융 219,722원/셀트리온 287,059원/LG화학 368,143원/삼성전자 472,381원 — §9 관측 3), 인사이트·시뮬레이션 블록 생성. `metadata.errorCode` 없음.

회차별 requestId와 위원회 최종 상태(크롤러 로그 `[committee-llm] final` 라인):

| 회차 | requestId | 소프트 데드라인 스냅샷(5.0s) | 백그라운드 최종 | committee-status 사후 조회 |
|---|---|---|---|---|
| R2 | `kr-committee-105560-1793876351629` | `status=partial completed=2/9 pending=7 errors=0 elapsed=5007ms` | **`status=complete completed=9/9 errors=0 elapsed=19106ms`** | (상태 만료로 not_found) |
| R3 | `kr-committee-068270-1793876379785` | `status=partial completed=4/9 pending=5 errors=0 elapsed=5003ms` | **`status=complete completed=9/9 errors=0 elapsed=21792ms`** | (not_found) |
| R4 | `kr-committee-051910-1793876405183` | `status=partial completed=1/9 pending=8 errors=0 elapsed=5004ms` | **`status=complete completed=9/9 errors=0 elapsed=24883ms`** | (not_found) |
| R5 | `kr-committee-005930-1793876432103` | `status=partial completed=3/9 pending=6 errors=0 elapsed=5005ms` | **`status=complete completed=9/9 errors=0 elapsed=53348ms`** | 20:04 조회 `complete 9/9, errors 0` — 위원 9명 전원 결과 존재 확인 |

멤버 레벨 계측(디버그 아티팩트): 회차별 **9명 전원의 LLM 요청이 발사**(`request-<member>-attempt-1.json` ×9), 개별 응답 소요 **1.9s~44.0s**(attempt 1, 멤버 오류 0건). 5초 스냅샷 이후 도착한 백그라운드 완주분은 현재 페이로드에 반영되지 않음(§6.1).

## 6. 재현 조건 (핵심 산출물)

### 6.1 [결정론적 재현 — 로컬 4/4, 100%] 위원회 5초 소프트 데드라인 커트 → "완료됐는데 위원 결과가 대부분 비어 있는 딥스캔"

- **재현 조건(정확한 파라미터 조합)**:
  1. `DEEPSCAN_KR_LLM_SOFT_DEADLINE_MS` / `DEEPSCAN_LLM_SOFT_DEADLINE_MS` **미설정** → 기본값 `DEFAULT_KR_LLM_SOFT_DEADLINE_MS = 5_000`(`packages/crawler/src/services/deepscan-kr-committee-runtime.js:19`) 적용
  2. KR canonical 딥스캔 1회 실행(위원 9명, `concurrency=4`, `model=deepseek/deepseek-v4-flash`)
  3. 멤버별 LLM 응답이 5초를 넘거나(실측 1.9~44.0s), 동시성 4로 인해 5번째 이후 멤버의 요청 발사 자체가 5초 이후에 일어남
- **재현 결과(4/4 전회차 동일)**: `[committee-llm] soft-deadline snapshot status=partial completed=N/9 pending=… errors=0 elapsed=5003~5007ms` → **페이로드가 이 시점에 확정**(`metadata.llmCommittee.status=partial`, `degraded=true`) → 이후 백그라운드에서 9/9 전원 완주돼도 현재 페이로드에는 반영 안 됨(`[committee-llm] final status=complete completed=9/9 errors=0 elapsed=19106~53348ms`)
- **사용자 체감 증상**: 명시적 오류 카드 없이 "분석 완료" 상태로 진입하지만 위원 그리드 5~8명이 pending인 채로 남고, `hero.score`가 4개 서로 다른 종목에서 전부 36으로 수렴(§9 관측 2) — **"재현 조건을 모르는 deepscan 분석 오류"의 유력한 실체**
- **운영 정합성**: 포렌식 문서(`deepscan-failure-analysis.md` §1.2)가 운영 배치 로그에서도 `softDeadlineMs=5000`을 확인 — 로컬 한정이 아니라 **운영과 동일 조건**
- **판정**: **코드 결함(기본값 설계) 또는 설정 부재** — 위원회 자체는 건강(오류 0, 백그라운드 9/9 완주)이므로 외부 의존 문제가 아니다. 수정 방향(권고, 프로덕션 수정은 이번 TC 범위 밖): 유저 딥스캔 경로의 소프트 데드라인 기본값 상향(멤버 p95 응답 ~45s를 고려해 60~120s), 또는 partial 페이로드에 "위원분석 확장 중" 상태를 명시하고 committee-status 폴링 완주분 반영(스냅샷 writeback은 로그인 유저만 가능 — 게스트는 반영 경로 자체가 없음)
- **보고 형식 상의 유의점**: 본 TC의 매트릭스 판정 기준("최종 페이로드 생성 = PASS")상 4회 모두 PASS이지만, §6.1 조건이 남아 있는 한 유저가 보는 품질은 저하 상태다

### 6.2 [간헐 재현 — 로컬 2회 관측] `llm-upstream-error` (upstream 502 "bad upstream")

- 형태: `momentum-attempt-1-failure.json` = `{"errorKind":"llm-upstream-error","error":"bad upstream","status":200,"upstream_result":{"error":{"message":"bad upstream","code":502}},"elapsed_ms":1,"attempt":1}` — **HTTP 전송은 200인데 응답 본문에 upstream 오류 객체**가 실려 1ms 만에 종료, 비재시도 분류
- 관측: 2026-11-05 18:51(포렌식 담당 실행), 19:59(본 TC R2 실행 창) — 단, 후자의 아티팩트는 repo 루트 flat 경로에 기록돼 **동시 실행 중이던 타 에이전트 하니스(cwd=repo 루트) 산출물일 수 있어 본 TC 파이프라인 4회에 직접 귀속되지 않음**(본 TC 4회의 멤버 오류는 0건)
- 판정: **환경 제약(외부 OpenRouter 프런트 일시 장애)** — 일시적(재시도/시간 경과로 회복 관측). 운영 0/9 전멸(포렌식 §1.2, attempts=1 비재시도 252건)과 동일 분류 체계

### 6.3 [운영 전용 — 로컬 미재현] prod 위원 0/9 전멸

- 포렌식 문서의 운영 4일 연속 전멸(`llm-upstream-error` 252건)은 **로컬에서 미재현**: 동일 키·모델로 로컬 4회 모두 최종 9/9 완주(§5). 이는 포렌식 가설 B(운영 환경의 키/업스트림 문제)·가설 A(배포 빌드 불일치로 불필요 호출 발생)를 뒷받침하는 로컬 대조 증거다

## 7. 데이터 소스 사용 내역 (R5 삼성전자 기준, 디버그 source-input.json 실측)

| 소스 | 사용 내역 | 상태 |
|---|---|---|
| WiseReport (KR 11페이지) | company-status · company-overview · financial-analysis · investment-indicators · consensus · shareholding · recent-reports + (컨센서스·리포트 등) | **수집 성공** — API 키·쿠키 없이 동작(`.env.cookie` 없음에도) |
| FnGuide (3페이지) | fnguide-finance · fnguide-snapshot · fnguide-shareanalysis · fnguide-foreign-ownership-chart | **수집 성공** |
| KRX 현재가(quotes 번들) | `quotes.items = 0`, `missing: [{reason:'dependency-unavailable', message:'KRX direct login requires KRX_ID and KRX_PW.'}]` | **실패(환경 제약)** — `KRX_ID`/`KRX_PW` 미설정 |
| polygon / fmp (현재가 provider) | `providerStatus: { polygon: {configured:false, available:false}, fmp: {configured:false, available:false} }` | **스킵(환경 제약)** — 키 미설정, graceful degradation 정상 동작 |
| OpenRouter (9인 위원 LLM) | 멤버 9명 × attempt 1, 최종 9/9 성공 | **성공** — `deepseek/deepseek-v4-flash` |
| DART/공시 | 키 미설정으로 저하 경로 | 환경 제약(매트릭스 PASS 판정에 영향 없음) |

## 8. FAIL 목록과 원인 판정

| 대상 | 결과 | 원인 판정 | 근거 |
|---|---|---|---|
| TC-E2ED-001 화면 여정(로딩→브리핑→위원 그리드→결과 전환) | **FAIL(환경 제약)** | **환경 제약** — 테스트 환경에 Supabase 인증 세션 부재. `/deepscan` 인증 게이트는 `PROTECTED_APP_PATHS` 설계 동작(코드 결함 아님, TC 기대값 오류 아님) | §0 실측(307 → `/login?next=%2Fdeepscan`), §3 J3 |
| TC-E2ED-002 위원회 partial(1~4/9) | 매트릭스 판정은 PASS(페이로드 생성)이나 **품질 저하 요인으로 FAIL 성격 기록** | **코드 결함/설정 부재(기본값 5s)** — §6.1 결정론적 재현 | 크롤러 로그 스냅샷×4 + 백그라운드 9/9 완주 로그 |
| R1(브라우저 발사 방식) | FAIL(실행 0회) | **환경 제약** — §0과 동일. 비용 소모 없음 | J3 캡처 실패 = `/api/deepscan` 발사 자체가 없음 |

## 9. 발견한 이슈 (프로덕션 수정 없이 기록만)

1. **위원회 소프트 데드라인 기본 5s(§6.1)** — 본 TC의 핵심 재현 조건. 운영 배치 로그와 동일 조건이므로 유저 딥스캔 품질 이슈의 1순위 의심 원인
2. **hero.score가 4개 이종 종목에서 전부 36으로 동일**(위원 partial 상태) — 위원 미반영 시 히어로 점수가 종목 차별성 없이 수렴하는 정황. 포렌식 문서의 bughunt R1 발견(`buildHeroScore` 고정 분모 100, `build-payload.ts:1484`)과 정합 — 같은 경로일 가능성(단, 본 TC는 페이로드 원문을 비PASS 케이스에만 보존해 산출 경로까지는 단정하지 않음)
3. **전략 목표가 텍스트가 시세 대비 비정상적으로 큰 값**(예: 삼성전자 472,381원, KB금융 219,722원 — 현재가 수만 원대 종목) — 원금회수 예측 산식 또는 컨센서스 데이터 결합 문제 의심. 페이로드 원문 미보존으로 산출 경로 미확인, 후속 조사 권고
4. **KRX 현재가 경로가 `KRX_ID`/`KRX_PW` 로그인을 요구**(§7) — 키 없는 환경에서는 현재가·거래량 축이 `dependency-unavailable`로 저하. 문서화된 환경 제약이지만 "어떤 키가 왜 필요한지" 사용자 안내가 없으면 재현 조건 파악이 어려워지는 요인
5. **위원 백그라운드 완주분이 게스트에게 전달되지 않음** — `committee-status` 폴링+스냅샷 writeback(`src/app/api/deepscan/committee-status/route.ts`)은 세션 유저 전용이라 게스트는 partial 페이로드가 최종본이 됨(§6.1 판정과 연결)
6. **위원 디버그 아티팩트가 크롤러 프로세스 cwd에 따라 2곳에 분산 기록**(repo 루트 flat + `packages/crawler/.omx/.../kr-committee-*`) — 포렌식/재현 조간 추적 시 위치 혼동 유발(본 TC 감시 로직도 양쪽을 모두 보도록 구현해 해소)
7. **(참고) 본 TC 실행 중 타 에이전트의 병행 로컬 실행 흔적**(repo 루트 flat 아티팩트 19:59, 코드 226490 다수) — flat 파일은 실행 간 overwrite라 소속 실행 구분이 불가능하다. 병행 계측 시에는 서브디렉터리(logDir 전달) 경로 사용을 권고

## 10. 비용 회계

- 실제 딥스캔 파이프라인 실행: **총 4회**(R2~R5, 지시 한도 5회 이내) — 9인 위원 LLM 9×4=36회 호출(전부 attempt 1 성공), R1은 미발사
- 재현성 재실행(R5): §6.1이 결정론적 재현이라 추가 재실행 불필요 판단 — 매트릭스 마지막 슬롯을 삼성전자 직접 계측에 사용
- 시딩 여정 2차 실행(수정 스크립트): LLM 비용 0(게이트로 파이프라인 미발사)
