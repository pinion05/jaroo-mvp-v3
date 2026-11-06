# Jaroo MVP v3 TC 마스터 문서

- **코드 기준**: master @ `3f7276f` (origin/master = jaroo.kr 배포 코드와 동일. 검증 전 워크트리를 `fix/recovery-chart-similar-pattern-line`→master로 fast-forward 갱신. 해당 브랜치 커밋은 PR #343/#345로 이미 master 병합 상태였음)
- **검증일**: 2026-11-05
- **검증 방식**: 팀 분할 검수 — 웹(tc-web) / 크롤러(tc-crawler) / 코어(tc-core) 영역별 기존 자동화 테스트의 TC 목록화 + 커버리지 갭 신규 자동화 TC 작성 + 전수 실행, 이후 사용자 여정 기반 E2E(e2e-journeys / e2e-deepscan) 추가 검증

## 1. 영역별 요약

| 영역 | TC 문서 | 기존 TC | 신규 TC | 자동화 실행 결과 |
|---|---|---|---|---|
| 웹 (루트 `tests/` + 웹 TS) | [TC-web.md](./TC-web.md) | TC-WEB-001~053 | TC-WEB-054~059 (6) | `.mjs` 155 PASS + TS 665 PASS |
| 크롤러 (`packages/crawler`) | [TC-crawler.md](./TC-crawler.md) | TC-CRW-001~036 | TC-CRW-037~041 (5) | 451/451 PASS |
| 코어 (`instrument-core` + `deepscan-runtime-core` + contracts) | [TC-core.md](./TC-core.md) | TC-CORE-001~025 | TC-CORE-026~030 (5) | 85/86 PASS (**의도적 FAIL 1 — 버그 증거 보존**) |
| E2E 사용자 여정 (비로그인 + 세션 시딩) | [TC-e2e-journeys.md](./TC-e2e-journeys.md) | — | TC-E2EJ-### | 진행 중 |
| E2E 딥스캔 여정 (시딩 + 실호출 1건) | [TC-e2e-deepscan.md](./TC-e2e-deepscan.md) | — | TC-E2ED-### | 진행 중 |

## 2. 실행 환경

- 단위/통합 스위트: `npm test` = 루트 `node --test tests/*.test.mjs` → `test:web:ts`(tsx, src·tests 재귀 글로브) → `test:crawler` → `test:instrument-core` → `test:runtime-core`
- dev 스택(코드 기준 master): 웹 `http://127.0.0.1:3002` / 크롤러 `http://127.0.0.1:3040` — 포트 3000은 본 머신 Grafana(DSH 인프라)가 점유해 jaroo 웹은 3002로 기동
- `.env.local`에 배포 사이트와 동일한 공개 Supabase runtime env(SUPABASE_URL / SUPABASE_ANON_KEY = jaroo.kr `window.__JAROO_ENV__` 값) 추가 → 로그인 페이지 등 클라이언트 인증 플로우가 실제와 동일하게 동작
- E2E: `agent-browser` CLI(Chromium) + `scripts/verify-screens-browser.cjs`의 sessionStorage 세션 시딩 하우스 패턴. 실제 Google OAuth는 로컬 리다이렉트 URI 미화이트리스트로 범위 외
- 딥스캔 실호출 1건: OPENROUTER 키 사용. DART/polygon/fmp/finnhub 키·WiseReport 쿠키는 미설정(해당 소스 graceful degradation)

## 3. 발견된 버그 후보 (수정은 별도 승인 — 보고만)

### BUG-CAND-001 — safe-json `Authorization: Bearer <토큰>` 마스킹 누수 🚨
- **위치**: `packages/deepscan-runtime-core/src/safe-json.js` `redactString`
- **재현**: `safeJsonStringify({ k: 'Authorization: Bearer <token>' })` → 토큰이 마스킹 없이 생존
- **원인 추정**: 치환 순서(QUERY→ASSIGNMENT→BEARER)상 `SENSITIVE_ASSIGNMENT_PATTERN`의 `authorization` 키워드가 `Authorization: ` 뒤 첫 토큰인 'Bearer'라는 단어를 값으로 소비 → 이후 `BEARER_PATTERN`이 적용 대상을 잃음. 가장 흔한 형태의 자격증명이 위원회 로그에 남을 수 있음(보안 flavor)
- **처리**: 증거 테스트를 **FAIL 상태로 보존**(TC-CORE-029 `[버그 후보]`, `packages/deepscan-runtime-core/test/tc-safe-json-edge.test.ts`) — 사용자 확정(2026-11-05, FAIL 보존 방침). 수정 시 BEARER 치환을 ASSIGNMENT보다 먼저 적용하는 방안 검토
- **부수 관찰(버그 아님, 문서화만)**: `JAROO_LLM_MOCK_LATENCY_MS=''` → `Number('')===0` 특성으로 무지연 0 고정

## 4. 딥스캔 실패 포렌식 — "재현 조건을 모르던 분석 오류"의 재현 조건 특정 🎯

상세: [deepscan-failure-analysis.md](./deepscan-failure-analysis.md) (실패 모드 매트릭스 FM-1~11, 회귀 TC-DSF-001~019 21/21 PASS)

**핵심 발견**: Railway `jaroo-mvp-v3/app`(test.jaroo.kr) 운영 로그(2026-11-02~11-05, 배포 73ff430d)에서 **4일 연속 100% 재현되는 결정론적 실패** 확인 —

- 매일 18:00~18:03 KST 워치 일일 배치(7종목)에서 **위원회 LLM 9인이 호출되어 전멸**(llm-upstream-error, attempts=1, 즉시 실패 = 400/401/403 계열). 일일 63건(7종목×9위원), 4일간 252건
- 배치는 committeeLlm=off를 보내 스킵돼야 정상인데 호출이 일어남 → **가설 A(최유력)**: 11-02 배포 빌드에 ffeb1bb(10-30 committeeLlm 스킵 배선) 미반영 또는 무효 / **가설 B**: 배포 환경 OPENROUTER 키 무효·엔드포인트 400 (키 미설정은 errorKind=llm-unknown이어야 하므로 배제)
- 표면은 **오류카드가 아니라 200 OK 저하 payload**(score 0·"재시도 필요" hero) — `failed=0`으로 배치 지표에도 안 잡히는 **침묵 실패**
- 로컬 master에는 스킵 배선이 존재하며 TC-DSF-017이 이를 핀으로 잠음 → 로컬과 배포의 차이(빌드/env)가 유력
- 그 외 과거 실패 패턴은 로컬 버그헌트 리포트(1029/1030/FINAL)에서 매트릭스화: 빌더 실패(환불), 크레딧 이중 소진, 소스 hang→504, 침묵 데이터 오염(통화 붕괴·옛종가) 등

※ jaroo.kr 본 운영 프로젝트는 이 토큰 워크스페이스에 없어 미조회 — 본운영 로그 확인은 별도 필요

### 4.1 로컬 교차검증 — 소프트 데드라인 재현 조건 확정 (e2e-deepscan, 2026-11-05)

로컬 master에서 실호출 딥스캔 4회(KB금융·셀트리온·LG화학·삼성전자)를 계측 실행한 결과, 운영 배치 로그의 `softDeadlineMs=5000`과 **동일 조건을 로컬 4/4 100% 재현**:

- **재현 조건**: `DEEPSCAN_*_LLM_SOFT_DEADLINE_MS` 미설정 → 기본값 5,000ms → 5초 시점 partial 스냅샷(위원 1~4/9 완료)이 페이로드로 확정(degraded=true, hero.score=36) → **백그라운드에서 9/9 완주한 완전한 위원 결과는 폐기**
- 크롤러 로그 증거: `[committee-llm] soft-deadline snapshot status=partial completed=N/9 … elapsed=5003~5007ms` 직후 `[committee-llm] final status=complete completed=9/9 … elapsed=19106~53348ms`
- 즉 "재현 조건을 모르던 deepscan 분석 오류"(완료됐는데 위원 결과가 빈/부실한 분석)의 실체는 **①운영 배치 위원 전멸(llm-upstream-error) + ②소프트 데드라인 5초 조기 확정**의 합작으로 특정됨
- 권고: 유저 딥스캔 경로 소프트 데드라인 상향(멤버 p95 ~45s 고려 60~120s) 또는 완주분 반영 경로 제공 — 수정은 별도 승인 대기
- 부수 발견: hero.score 4종목 전부 36 동일 수렴(buildHeroScore 고정 분모 100 정합), 목표가 비정상 대형값(삼성전자 472,381원 — 산출 경로 후속 조사 필요), KRX 현재가는 KRX_ID/KRX_PW 미설정으로 생략(graceful degradation), WiseReport 11페이지+FnGuide는 키·쿠키 불필요 정상 수집

## 5. 테스트 실행 방법

```bash
# 전체 자동화 스위트 (단위/통합)
npm test

# E2E — dev 스택 기동 후 (3000 점유로 웹 3002 사용)
PORT=3002 CRAWLER_PORT=3040 JAROO_CRAWLER_BASE_URL=http://127.0.0.1:3040 npm run dev
node scripts/e2e-journeys.cjs          # 비로그인 + 세션 시딩 여정
node scripts/e2e-deepscan-journey.cjs  # 딥스캔 시딩 여정 + 실호출 1건
```

## 6. 영역별 상세

- 웹: [TC-web.md](./TC-web.md) — 인증/결제/법적 페이지/홈/딥스캔/OCR/접근성 등 59개 TC. 신규 6건은 PR #346 메타·파비콘·OG 회귀 가드, 워치 API 가드, 텔레그램 link/webhook, ETF history API, dev 내부 라우트 프로덕션 404 가드, client-errors 텔레메트리
- 크롤러: [TC-crawler.md](./TC-crawler.md) — 41개 TC(파일/기능 36그룹 + 신규 5). 신규는 api-clients(캐시 TTL·마스킹·429 쿨다운), US 재무제표 정규화, US 뉴스 병합/dedup, US 컨센서스 폴백
- 코어: [TC-core.md](./TC-core.md) — 30개 TC(기능 25 + 신규 5, 실테스트 44). 신규는 kr-stock-resolver, fuzzy-resolver 엣지, llm-mock, safe-json 엣지(버그 증거 포함), 위원회 결과 정규화
- E2E 여정: [TC-e2e-journeys.md](./TC-e2e-journeys.md), 딥스캔: [TC-e2e-deepscan.md](./TC-e2e-deepscan.md)

## 7. 기존 E2E 채널(verify:screens) 검증 결과 — 4곳 stale 확정, 제품 결함 0건
기존 `scripts/verify-screens-browser.cjs`(읽기 전용 참고 채널)를 본 검증 스택(웹 3002/크롤러 3040)에서 실행: **26 ✓ / 21 ✗, EXIT=1**. 실패 4종을 전부 원인 분류한 결과 제품 코드 결함은 없었고, 전부 "제품 진화에 뒤처진 하니스/기대값"이었음:

| 스위트 | 실패 | 분류 | 근거 |
|---|---|---|---|
| deepscan (16체크) | 전면 FAIL — 종목명 h1·브리핑·위원 그리드 등 전부 null | **하니스 stale**: `/deepscan`이 서버 사이드 인증 게이트(307 → `/login`)로 막혀 게스트 하니스(sessionStorage 시딩)가 페이지에 도달 불가. TC-E2EJ-001(e2e-journeys)과 일치 | 서버 리다이렉트는 클라이언트 시딩으로 우회 불가 — 인증 세션 주입 또는 API 레벨 검증으로 이관 필요 |
| home (1체크) | 하단 네비 `>= 6` vs 실제 5 | **기대값 stale**: `NAV_ITEMS` 5슬롯이 현재 설계(app-bottom-nav.tsx 주석 명시). ISSUE-E2EJ-1과 동일 | 소스 주석 + e2e-journeys 교정 기록 |
| ocr (1체크) | `403 POST /api/ocr` | **환경/하니스**: 127.0.0.1 접속 시 origin 가드(서버 origin=localhost)가 먼저 403. ISSUE-E2EJ-2와 동일 | `localhost:3002`로 접속하면 401(설계된 인증 게이트)로 변함 |
| screenshot (1체크) | 파일 input `= 3` vs 실제 1 | **기대값 stale**: a9ff3bd "스크린샷 업로드를 네이티브 사진 피커로 변경" 이후 `multiple` 단일 input이 설계 | 소스 line 315 + git log |
| ocr-redirect | 없음 | PASS | — |

> 권고(수정은 별도 승인): verify-screens의 deepscan 스위트는 인증 세션 주입 방식으로 재작성하거나 폐기, home/screenshot 기대값 갱신, 하니스 기준 origin을 localhost로 통일.

## 8. 블랙박스 TC (별도 팀 — 소스·내부 문서 열람 금지 원칙, 기대값은 법령·공개 관행·제품 공개 문구·크로스환경 일관성에서만 도출)

| 영역 | TC 문서 | 대상 | 판정 분포 |
|---|---|---|---|
| 배포 패리티·공개 표면 | [TC-blackbox-parity.md](./TC-blackbox-parity.md) | 로컬(3002) + 운영 jaroo.kr (비파괴) | 25 TC: PASS 19 / FAIL 1 / WARN 2 / OBSERVE 1 / INFO 2 |
| 인증 기능 여정 | TC-blackbox-functional.md | 로컬 게스트 표면 + jaroo-dev(QA) 인증 표면 | 13 TC: 종합 PASS 4 / FAIL 6 / SKIP 3 |
| 세션·보안·캐시 계약 | [TC-blackbox-security.md](./TC-blackbox-security.md) | 운영 jaroo.kr (격리 인증 세션 복제 프로필) | 18 TC: PASS 12 / FAIL 3 / WARN 1 / BLOCK 2 |
| 출시 체크리스트 | [TC-blackbox-launch.md](./TC-blackbox-launch.md) | 운영(게스트) + 로컬 | 24 TC: PASS 17 / FAIL 3 / INFO 4 |
| 금융 데이터 표시 신뢰성 | [TC-blackbox-data.md](./TC-blackbox-data.md) | jaroo-dev(QA) + 로컬 빈 상태 + 보유 계정 수기 실측 | 28 TC: PASS 8 / FAIL 1 / WARN 4 / SKIP 15 (+수기 산술 검증 6/6 일치) |

**2차 확장 (프로덕션 출시 대비, 2026-11-06)**: 세션·보안(쿠키 플래그·로그아웃 후 개인정보 캐시 노출·재로그인 사이클), 출시 체크리스트(성능 예산·WCAG 기본·결제 표시 계약·크로스 뷰포트·SEO), 금융 데이터 신뢰성(포트폴리오 산술 정합·시세 상식 범위·목표가 이상치·한국 색 규약).

**출시 체크리스트 주요 결과**: 성능 큰 여유(전 페이지 TTFB 83~165ms = 예산의 8~21%, 응답 일관성·뷰포트 12조합 이상 0건). FAIL 3 — ① 전 게스트 페이지 h1 부재 ② "준비 중" 배지 색대비 2.64:1(WCAG 4.5:1 미달) ③ canonical 부재. INFO — 결제·플랜 표시는 전부 로그인 게이트 뒤(약관상 결제 화면 위임 고지는 확인, 게스트 가격 노출 0건).

**금융 데이터 주요 결과**: 보유 계정 수기 실측 — 산술 정합 6/6 완전 일치(Σ종목손익=총손익 차 0원, 수량×평단=평가액 정확, 손익률·라벨·부호·콤마 포맷 정상). 리스크 — [P1] dev 분석 기록 페이지(/mypage/history) 지속 로드 실패 → 딥스캔 이력·점수·목표가 검증 블라인드 존, [P1] dev↔운영 혼선(dev에서 jaroo.kr API 호출·프로덕션 이동 관찰), [P2] "—회/—cr" 미정 표시·홈 시세 기준 시각 부재·dev 자동로그인 간헐 무반응, [P3] OCR 가이드 예시가 321,000원(상식 범위 초과), 부호 글리프 혼용 등.

**세션·보안 주요 결과**: 출시 방어선 양호 — 인증 페이지 no-store ✅, 로그아웃 즉시 쿠키 폐기 ✅, **로그아웃 후 뒤로가기 개인정보 미노출** ✅, 게스트 라우트 가드 ✅, 세션 지속성 ✅. 리스크 — **[High] 세션 쿠키가 HttpOnly=false·Secure=false (document.cookie에 access+refresh 토큰 노출, 클라이언트 JS 발급 → XSS 시 세션 탈취 경로. BFF/서버 발급 HttpOnly 전환 권장)**, [Medium] 세션 쿠키 만료 ~13개월, [Low] 게스트에 /api/auth/me·/api/payments/me 200(guest 스코프). 로그아웃이 공유 토큰을 서버 측 폐기(다른 기기 동반 로그아웃) 확인. BLOCK 2: QA 프로필 구글 세션이 재인증 요구로 전환되어 재로그인 여정 자동화 불가(수동 재인증 후 `relogin` 그룹 재실행 가능).

**세션 복제 부작용 관찰 (테스트 인프라 교훈)**: 운영 세션을 복제한 격리 프로필(9225)에서 로그아웃 테스트 시 **공유된 Supabase 세션 토큰이 서버 측 폐기되어 원본 브라우저(9222) 세션도 동반 로그아웃**됨을 실측 (다른 기기 로그아웃이 전 세션 폐기로 이어지는지는 세션·보안 TC 결과로 확정 예정). 사용자 원본 세션은 리드가 재로그인으로 복구.

### 8.1 블랙박스 스위트 리드 재실행 검증 (2026-11-06 02:4x)

에이전트 산출 후 리드가 4개 스위트를 재실행해 재현성 확인 (세션·보안은 격리 브라우저 정리로 재실행 제외 — 원본 실행 결과만 유효):

| 스위트 | 재실행 결과 | 비고 |
|---|---|---|
| blackbox-parity | PASS 18 / WARN 3 / OBSERVE 1 / INFO 2 | www.jaroo.kr TLS 불일치는 별도 직접 실측으로 **현재도 재현 확인**(*.up.railway.app 인증서 제시, 핸드셰이크 실패) |
| blackbox-launch-check | PASS 17 / FAIL 3 / INFO 4 (24 TC) | 원본과 완전 동일 재현 |
| blackbox-auth-journeys | PASS 8 / FAIL 3 / SKIP 2 (13여정) | 제품 FAIL 3건(동의 게이팅·404 표면·/login 재접근) 재현. 딥스캔/OCR은 비용 장부로 SKIP(설계대로). 1차 재실행 전량 SKIP은 일시적 하니스 상태 |
| blackbox-data-sanity | PASS 8 / FAIL 1 / WARN 2 / SKIP 17 (28 TC) | **dev 자동로그인 간헐 무반응이 FAIL로 재현** (원본 P2 관찰의 재확인) |

**패리티 주요 발견**: 로컬↔운영 공개 표면(상태·본문·법적 고지·메타) 전 항목 일치. 운영 리스크 — **R1(FAIL): `https://www.jaroo.kr` TLS 인증서 불일치**(*.up.railway.app 인증서 제시로 핸드셰이크 실패 → www 진입 사용자에게 브라우저 보안 경고. DNS 제거 또는 SAN 인증서+301 권고), R2 robots/sitemap 부재, R3 인프라 메타 노출(railway-hikari·x-powered-by), R4 HSTS preload 미지정(관찰), R5 세션 쿠키 플래그는 로그인 금지로 미검증.

**인증 표면 환경 결정 과정**: 로컬 dev 스택은 자동로그인 env(DEV_AUTO_LOGIN_*) 미보유·값은 jaroo-dev 배포(별도 워크스페이스)의 sealed 변수로 활성화 불가 → 세션 필요 여정은 **jaroo-dev(QA 배포, Basic Auth 게이트 뒤, 고정 계정 qa-auto@dev.jaroo.kr 원클릭 로그인)**에서 실행. 로컬은 게스트 표면 한정.

## 9. 최종 검증 결과

### 9.1 전체 자동화 스위트 (2026-11-05 최종 실행, `npm test`)

| 스위트 | tests | pass | fail | 비고 |
|---|---|---|---|---|
| 루트 `node --test tests/*.test.mjs` | 176 | 176 | 0 | tc-web 6파일 + deepscan-failure 3파일 포함 |
| `test:web:ts` (tsx, src·tests 재귀) | 665 | 665 | 0 | |
| `test:crawler` | 451 | 451 | 0 | 신규 tc-* 5 TC 포함 |
| `test:instrument-core` | 39 | 39 | 0 | 신규 tc-* 2파일(14 테스트) 포함 |
| `test:runtime-core` | 47 | 46 | **1** | 유일한 FAIL = BUG-CAND-001 증거 테스트(의도적, FAIL 보존 확정) |
| **합계** | **1,378** | **1,377** | **1** | EXIT=1 (버그 증거 1건 때문 — 예상된 결과) |

### 9.2 E2E

| 채널 | 결과 |
|---|---|
| `node scripts/e2e-journeys.cjs` | 5여정 70체크 전부 PASS |
| `node scripts/e2e-deepscan-journey.cjs` | TC-E2ED-002 실호출 매트릭스 **PASS**(4회 전부 최종 페이로드 생성) / TC-E2ED-001 시딩 화면 여정은 환경 제약 FAIL(/deepscan 서버 인증 게이트 — 설계 동작, 코드 결함 아님). §4.1 재현 조건 확정이 핵심 산출 |
| 기존 verify:screens | 26 ✓ / 21 ✗ — §7 참조 (전부 stale 하니스, 제품 결함 0건) |

### 9.3 검증 중 파악된 제품 이슈 (수정 별도 승인 대기)

1. **BUG-CAND-001** — safe-json `Authorization: Bearer <토큰>` 마스킹 누수 (§3)
2. **배포 빌드 위원 전멸(침묵 실패)** — §4 포렌식: 배포 환경에서 committeeLlm 스킵 미작동 가설 A/B 판정 필요

### 9.4 수정 진행 (2026-11-06, P0+P1 범위 — 팀 분할 PR)

| 이슈 | 상태 | PR |
|---|---|---|
| TC 스위트 원본 | ✅ PR 오픈 | #347 (test/tc-suite-v1) |
| h1·canonical·404 표면·/login 재접근 (P1 4건) | ✅ 수정+검증 완료 | #348 (fix/ux-foundations) |
| 세션 쿠키 HttpOnly·Secure+30일 슬라이딩 (P0) | ✅ 수정+검증 완료 — 기존 #325(부분 패치)는 대체 종료 | #349 (fix/session-cookie-httponly) |
| 딥스캔 소프트 데드라인 90s·/mypage/history 503 복구·dev혼선·hero.score 정규화·목표가 가드 (P0 2+P1 3) | ✅ 수정+검증 완료 — 목표가 이상치는 네이버 컨센서스 API 실제 데이터(코드 결함 아님, 상식 범위 가드 추가) | #350 (fix/deepscan-quality) |
| www.jaroo.kr TLS 불일치 (P0) | **현상 유지 확정** (사용자 결정 2026-11-06) — Railway 플랜 커스텀 도메인 한도(서비스당 1개, jaroo.kr 사용 중). 대안 기록: www DNS 레코드 삭제(무료) 또는 플랜 업그레이드+301. jaroo.kr NS는 Railway 자체(9mwqd93x.up.railway.app), www는 apex CNAME | — (인프라) |

**통합 검증 (integrate/p0p1-fixes 브랜치, 3-way 병합 충돌 0)**: 전체 스위트 **1,421 테스트 중 1,420 PASS + 의도적 FAIL 1**(tc-safe-json-edge 버그 증거) — 루트 mjs 189·web:ts 681·crawler 465·instrument-core 39·runtime-core 46/47. 병합 권장 순서: #347 → #348 → #349 → #350 (혹은 integrate/p0p1-fixes 참조).


