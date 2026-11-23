# E2E 사용자 여정 TC (비로그인 여정 + 세션 시딩 여정)

- **코드 기준**: master @ `3f7276f` (커밋 없음, 프로덕션 코드 미수정)
- **실행일**: 2026-11-05
- **실행 명령**: `node scripts/e2e-journeys.cjs` (개별 여정: `node scripts/e2e-journeys.cjs guards|login|legal|home|ocr-guard`, 목록: `--list`)
- **대상 스택**: jaroo dev 스택 — 웹 `http://127.0.0.1:3002` / 크롤러 `http://127.0.0.1:3040` (`JAROO_BASE_URL` 환경변수로 변경 가능, 기본값 `http://127.0.0.1:3002`)
- **브라우저**: `agent-browser` 0.27.0 (Chromium), 세션 이름 `jaroo-e2e-journeys` 로 분리 — 실행 후 자동 close
- **요약**: 총 **5여정 · 70체크 전부 PASS** (1차 실행 9체크 FAIL → 전부 TC 기대값/하니스 교정 사례, 제품 결함 0건 — §6 참조)

## 1. TC 목록

| TC ID | 여정 제목 | 분류 | 우선순위 | 자동화 | 결과 |
|---|---|---|---|---|---|
| TC-E2EJ-001 | 비로그인 가드 여정 (`/`, `/mypage`, `/deepscan` → `/login`, `/home` 게스트 개방) | 가드/인증 | P0 | scripts/e2e-journeys.cjs `guards` | **PASS** (16체크) |
| TC-E2EJ-002 | 로그인 페이지 여정 (렌더·동의 게이트·`__JAROO_ENV__` Supabase 주입) | 진입/인증 | P0 | scripts/e2e-journeys.cjs `login` | **PASS** (19체크) |
| TC-E2EJ-003 | 약관/정책 여정 (`/terms`, `/privacy` 진입·고지·링크 경로) | 법적 고지 | P1 | scripts/e2e-journeys.cjs `legal` | **PASS** (17체크) |
| TC-E2EJ-004 | 홈 여정 (세션 시딩 — 도넛·종목 리스트·요약·카드 클릭) | 핵심 화면 | P0 | scripts/e2e-journeys.cjs `home` | **PASS** (11체크) |
| TC-E2EJ-005 | OCR 가드 여정 (세션 없는 `/ocr` → `/screenshot`) | 가드/퍼널 | P1 | scripts/e2e-journeys.cjs `ocr-guard` | **PASS** (7체크) |

## 2. 공통 사전조건 (전체 여정)

- jaroo dev 스택 기동: 웹 3002 (`/api/health` 200), 크롤러 3040 — 스크립트 preflight가 확인, 미기동 시 exit 2
- `agent-browser` 바이너리가 `--session-name` 플래그 지원 (npm-global/.local 후보 탐색, `AGENT_BROWSER_BIN` 오버라이드)
- **인증 상태**: 미인증 게스트 (Supabase 인증 쿠키 시딩 없음). 실제 OAuth 로그인은 리다이렉트 URI 미화이트리스트로 범위 밖
- **네트워크 허용 규칙**: 게스트 하니스 특성상 `401/403 /api/portfolio`, `401/403 /api/auth/*`, `401/403 /api/ocr` 은 설계된 인증 게이트 응답으로 허용(§5, §6.4). 그 외 4xx/5xx는 FAIL
- **부작용 금지 준수**: 모든 여정은 Supabase 읽기 외 쓰기(회원가입·결제·데이터 변경)를 만들지 않는다 — 홈 카드 클릭은 `useState` 로컬 토글(`toggleCard`)만, 동의 체크는 localStorage 기록(`jaroo:terms-consent:v1`)만 발생

## 3. 여정별 상세

### TC-E2EJ-001 비로그인 가드 여정 (`guards`)

- **분류**: 가드/인증 · **우선순위**: P0
- **기대동작 근거(소스 확인)**: `src/lib/supabase/proxy.ts` — `PROTECTED_APP_PATHS = ['/mypage', '/deepscan', '/payments']` 는 게스트를 `/login?next=<원래경로>` 로 **서버 리다이렉트**(307). `src/app/page.tsx` — 루트 `/` 는 게스트를 `/login` 으로 리다이렉트(next 없음). `/home` 은 주석 명시대로 "게스트 체험 funnel(둘러보기 → 스크린샷 맛보기)로 개방" — 리다이렉트되지 않는 것이 **정상**
- **사전조건**: §2 공통 + 게스트 상태 초기화(스크립트가 `localStorage`/`sessionStorage` clear 후 진행)
- **단계**:
  1. (HTTP 레벨) `GET /`, `/mypage`, `/deepscan`, `/home` 을 `redirect: 'manual'` 로 요청
  2. (브라우저 레벨) 같은 경로를 실제 탐색하고 최종 URL 관측
  3. 게스트 `/home` 화면 콘텐츠 확인
- **기대결과**:
  - `/` → `307` + `Location: /login`
  - `/mypage` → `307` + `Location: /login?next=%2Fmypage`
  - `/deepscan` → `307` + `Location: /login?next=%2Fdeepscan`
  - `/home` → `200` (리다이렉트 없음), 브라우저에서도 `/home` 경로 유지
  - 게스트 `/home`은 포트폴리오 빈 상태(온보딩 화면) 렌더: "스크린샷 추가하기" CTA + "투자 자문·권유가 아니며" 참고용 고지 + 하단 네비 미노출 (빈 상태는 전면 준비 화면이 설계 동작)
  - 콘솔 에러 0, 허용 규칙 외 HTTP 실패 0
- **검증방법**: Node fetch(`redirect: 'manual'`) 상태코드/Location 단정 + agent-browser 실제 탐색 후 `location.pathname + search` 관측, DOM 텍스트 단정
- **결과**: **PASS** (16/16)

### TC-E2EJ-002 로그인 페이지 여정 (`login`)

- **분류**: 진입/인증 · **우선순위**: P0
- **기대동작 근거(소스 확인)**: `src/app/login/page.tsx` — 브랜드 "Jaroo", 히어로 카피 "MTS 스크린샷 한 장으로 / 내 주식을 AI가 진단", `ConsentCheckbox`(필수 배지·`/terms`·`/privacy` 링크), 시작 버튼 3종(이메일/Google/카카오) + Apple(준비 중) + "게스트로 둘러보기". 버튼 disabled 조건: `pending || (!devAutoLoginEnabled && !termsAgreed)`. `src/lib/jaroo-runtime-env.ts` + `src/app/layout.tsx` — 첫 페인트 전 `window.__JAROO_ENV__` 에 `supabaseUrl`/`supabaseAnonKey` 런타임 주입
- **사전조건**: §2 공통 + 동의 키(`jaroo:terms-consent:v1`) 초기화 — 미동의 상태에서 시작
- **단계**:
  1. `/login` 진입, 렌더 대기
  2. 브랜드/히어로 카피/동의 게이트/시작 버튼/게스트 버튼 DOM 계약 확인
  3. `window.__JAROO_ENV__` Supabase 설정 주입 확인
  4. 동의 체크박스 클릭 → Google 버튼 disabled → enabled 전환, 동의 시각 localStorage 기록 확인
- **기대결과**:
  - `/login` 경로 유지, 문서 타이틀에 "Jaroo"
  - 브랜드·히어로 카피·동의 문구("만 14세 이상")·약관 링크 2개 노출
  - 이메일/Google/카카오 시작 버튼 3종 존재, 게스트 버튼 존재
  - `__JAROO_ENV__` 객체 주입, `supabaseUrl` 이 `supabase.co` 포함, `supabaseAnonKey` 20자 이상
  - 이 dev 스택은 `devAutoLogin` 미주입이므로: 미동의 시 Google 버튼 `disabled=true` → 체크 후 `disabled=false`, localStorage에 ISO 동의 시각 기록
  - (분기) `devAutoLogin` 주입 스택에서는 게이트가 우회되므로 "처음부터 enabled"로 판정 — 스크립트가 런타임에 분기
  - 콘솔 에러 0, 허용 규칙 외 HTTP 실패 0
- **검증방법**: agent-browser eval DOM 단정(텍스트/속성/disabled 상태), localStorage 값 `Date.parse` 유효성 검사
- **결과**: **PASS** (19/19)
- **범위 밖**: 실제 OAuth/이메일 로그인 완료(리다이렉트 URI 미화이트리스트) — 시작 버튼 클릭 이후 전환은 검증하지 않음

### TC-E2EJ-003 약관/정책 여정 (`legal`)

- **분류**: 법적 고지 · **우선순위**: P1
- **기대동작 근거(소스 확인)**: `src/app/terms/page.tsx` — 제3조 "투자자문업·투자일임업 … 업무가 아닌" 고지, "투자 권유, 매수·매도의 청약·권유, 수익 보장이 아니며", 제8조 (회사의 면책) "정확성·신뢰성을 보장하지 않으며", 메타 "시행일 2026-08-20 · 버전 v1"(`src/lib/terms.ts`). `src/app/privacy/page.tsx` — 제1조 "개인정보보호법에 따라"(PIPA), 제7조 만 14세 미만 아동, 제9조 개인정보 보호책임자. 링크 경로: `/login` 동의 문구(게스트 접근 가능), `/mypage` 설정 행 "서비스 약관"/"개인정보처리방침"(**로그인 필요 — 게스트 여정 범위 밖**, `src/app/mypage/page.tsx:202-203`)
- **사전조건**: §2 공통
- **단계**:
  1. `/terms` 직접 진입 → 문서 계약 확인
  2. `/privacy` 직접 진입 → 문서 계약 확인
  3. `/login` 진입 → 동의 문구의 `a[href="/terms"]` 클릭 → `/terms` 도착 확인
  4. `/login` 재진입 → `a[href="/privacy"]` 클릭 → `/privacy` 도착 확인
- **기대결과**:
  - `/terms`, `/privacy` 모두 게스트 개방(200, 경로 유지), 각 문서 타이틀 노출
  - 약관: 시행일/버전 메타, 제1조, "투자자문업…아닌" 고지, "투자 권유…수익 보장이 아니며" 문구, 제8조 면책 본문 노출
  - 개인정보처리방침: 개인정보보호법 근거 고지, 제9조 보호책임자, 만 14세 미만 아동 조항 노출
  - 로그인 페이지 링크 클릭으로 두 문서 모두 도달 가능
  - 콘솔 에러 0, 허용 규칙 외 HTTP 실패 0
- **검증방법**: agent-browser eval — `document.title`, `h2` 섹션 존재, 본문 정규식 매칭, `a[href]` 클릭 후 pathname 관측
- **결과**: **PASS** (17/17)

### TC-E2EJ-004 홈 여정 — 세션 시딩 (`home`)

- **분류**: 핵심 화면 · **우선순위**: P0
- **기대동작 근거(소스 확인)**: verify-screens-browser.cjs 의 홈 시딩 fixture(`jaroo:applied-home-portfolio`, `readAppliedHomePortfolio()` 스키마) 재사용 — 로그인 없이 `/home` 의 포트폴리오 UI 검증 가능. `src/components/home/jaroo-home-screen.tsx` — `[aria-label="홈 포트폴리오 요약"]`, `[aria-label="보유 종목 비중 원차트"]`, 종목 카드(`button[aria-expanded]`, 클릭 시 `toggleCard` 로컬 상태로 상세 토글 — 서버 부작용 없음). `src/components/app-bottom-nav.tsx` — `NAV_ITEMS` 5슬롯(홈·워치·스캔 FAB·기록·마이)이 "앱 전체의 단일 네비게이션 소스"
- **사전조건**: §2 공통 + 홈 시딩 fixture 주입(스크립트가 origin 진입 후 `sessionStorage.setItem` — 키움증권 / 삼성전자 10주 / 평단 78,000원 / 평가금액 716,000원)
- **단계**:
  1. `/home` 진입 → 시딩 fixture 주입 → 재진입, 렌더 대기
  2. 도넛 차트·종목 리스트·요약 렌더 확인
  3. "삼성전자" 카드 클릭 → 상세 펼침(aria-expanded) 확인 → 펼친 카드 내 현재가/평단/평가금액 노출 확인
- **기대결과**:
  - `/home` 경로 유지, 요약 영역·도넛 차트 렌더
  - 총 평가액이 0원 아님(시딩 값 716,000원 반영) — "0원" 폴백 오탐 방지
  - "삼성전자" 종목 카드 존재, 하단 네비 정확히 5슬롯
  - 카드 클릭 → `aria-expanded=true` 전환, 펼친 article 내에 현재가/평단/평가금액 3라벨 노출
  - 콘솔 에러 0, 허용 규칙 외 HTTP 실패 0
- **검증방법**: agent-browser eval DOM 단정 + 클릭 이벤트 후 poll(`waitFor`)로 aria-expanded 관측(React 상태 반영이 비동기이므로 클릭과 관측을 분리)
- **결과**: **PASS** (11/11)

### TC-E2EJ-005 OCR 가드 여정 (`ocr-guard`)

- **분류**: 가드/퍼널 · **우선순위**: P1
- **기대동작 근거(소스 확인)**: `/ocr` 는 업로드 세션(`jaroo:screenshot-ocr-upload`)이 없으면 클라이언트 리다이렉트로 `/screenshot` 으로 이탈(verify-screens 'ocr-redirect'와 동일 계약). 세션이 있으면 `/ocr` 에 머물며, 마운트 시 자동으로 분석 배치를 실행(`src/app/ocr/page.tsx` `autoOcrSessionKeyRef` → `runOcrBatch` → `POST /api/ocr`) — 이 API는 로그인 요건(401)과 origin 가드(`src/lib/http-origin-guard.ts`)가 있어 게스트 하니스에서는 401/403이 설계된 차단 응답(§5)
- **사전조건**: §2 공통 + OCR 업로드 세션 제거 상태
- **단계**:
  1. `sessionStorage` 에서 OCR 업로드 세션 제거
  2. `/ocr` 진입 → 최종 pathname 관측 → `/screenshot` 도착 확인
  3. `/screenshot` 셸(`.jaroo-upload-frame`, 업로드 버튼) 렌더 및 `/ocr` 잔여 콘텐츠 없음 확인
  4. OCR 업로드 세션 재시딩(1×1 PNG fixture) → `/ocr` 재진입 → 경로 유지 확인
- **기대결과**:
  - 세션 없음 → `/screenshot` 리다이렉트, 업로드 화면 정상 렌더, `.jaroo-ocr-page` 잔존 없음
  - 세션 있음 → `/ocr` 경로 유지(가드의 반대편 계약)
  - 콘솔 에러 0, 허용 규칙 외 HTTP 실패 0 (게스트 자동 분석 호출의 401/403은 허용)
- **검증방법**: agent-browser `waitFor` pathname poll + DOM 셸 클래스 단정
- **결과**: **PASS** (7/7)

## 4. 실행 결과 (최종)

```text
Preflight
  ✓ web http://127.0.0.1:3002 healthy
  ✓ crawler http://127.0.0.1:3040 healthy
  ✓ agent-browser agent-browser 0.27.0
  ✓ session: jaroo-e2e-journeys

TC-E2EJ-001 guards   … 16체크 전부 PASS
TC-E2EJ-002 login    … 19체크 전부 PASS
TC-E2EJ-003 legal    … 17체크 전부 PASS
TC-E2EJ-004 home     … 11체크 전부 PASS
TC-E2EJ-005 ocr-guard … 7체크 전부 PASS

Summary: 70 passed, 0 failed  (62.6s)
```

## 5. 게스트 하니스 네트워크 허용 규칙 (설계된 응답)

| 패턴 | 상태 | 사유 |
|---|---|---|
| `/api/portfolio` | 401/403 | 게스트는 인증 쿠키 없음 — 포트폴리오 조회가 게이트에서 거절(verify-screens와 동일) |
| `/api/auth/*` | 401/403 | 인증 상태 확인 API의 게스트 응답 |
| `/api/ocr` | 401/403 | `/ocr` 마운트 시 자동 분석 배치가 실행되며, 로그인 요건(401)에 걸림. `127.0.0.1:3002` 접속 시에는 그 전에 origin 가드가 403 — 서버 `request.url` origin(`localhost:3002`)과 브라우저 Origin(`127.0.0.1:3002`)의 호스트 불일치(§6.4) |

## 6. 1차 실행 FAIL → 교정 기록 (원인 판정)

1차 실행(2026-11-05)에서 9체크 FAIL — **전부 TC 기대값 오류 또는 하니스 결함**이었고 제품 결함은 0건. 규칙에 따라 프로덕션은 수정하지 않고 TC를 교정했다:

| # | FAIL 항목 | 원인 판정 | 교정 |
|---|---|---|---|
| 1 | 가드 HTTP 상태코드 4건 ("307 기대, got 307") | **하니스 결함** — `expect.matches`(문자열 전용)에 숫자 상태코드를 넘김 | `expect.inSet([...])` 매처 신설로 숫자 집합 비교 |
| 2 | 게스트 /home 하단 네비 ≥6 → 0 | **TC 기대값 오류** — 포트폴리오 없는 게스트 /home은 하단 네비 없는 전면 빈 상태(온보딩 CTA)가 설계 동작(실측 확인) | 빈 상태 CTA("스크린샷 추가하기")·참고용 고지 노출로 기대결과 교정 |
| 3 | 시작 버튼 3종 `[true,true,true]` 기대 FAIL | **하니스 결함** — `expect.equals`의 `===` 참조 비교를 배열에 사용 | `expect.equalsJson` 매처 신설 |
| 4 | 홈 하단 네비 ≥6 → 5 | **TC 기대값 오류** — `NAV_ITEMS`는 홈·워치·스캔 FAB·기록·마이 **5슬롯**이 단일 네비 소스(소스 주석 명시). verify-screens의 `atLeast(6)`이 현재 소스와 불일치 | `equals(5)` 로 교정 |
| 5 | 클릭 후 aria-expanded=false | **하니스 결함** — 클릭과 속성 관측을 같은 eval에서 동기 실행(React 상태 반영은 비동기) | 클릭 → 대기 → 별도 eval poll 로 분리 |
| 6 | (부수) "평단/평가금액 노출"이 펼침 실패에도 PASS | **하니스 결함** — 본문 전체 텍스트 매칭이라 페이지 다른 영역에서 오탐 PASS | 펼친 `article` 범위로 스코프를 한정해 현재가/평단/평가금액 3라벨 동시 검증 |
| 7 | (부수) `403 POST /api/ocr` 네트워크 FAIL | **환경 제약 + 설계된 가드** — 세션 시딩 시 /ocr가 자동으로 분석 배치를 실행(소스 확인, "user action 시에만 호출"이라는 verify-screens 주석은 현재 소스와 불일치). 게스트는 401이 정상이며, 127.0.0.1 호스트 접속 시 origin 가드가 먼저 403 | `401/403 /api/ocr` 를 허용 규칙에 추가(§5) + 경로 유지 계약은 유지 |

## 7. 발견 이슈 (제품 수정 권고 — 본 TC에서는 수정하지 않음)

- **ISSUE-E2EJ-1 (문서 불일치, 경미)**: `scripts/verify-screens-browser.cjs` 홈 스위트의 하단 네비 기대(`atLeast(6)`)는 현재 5슬롯 `NAV_ITEMS` 설계와 불일치하여, 그대로 실행하면 FAIL이 예상된다. 본 문서 §6.4와 동일한 소스 근거(`app-bottom-nav.tsx` 5슬롯)이므로 해당 스크립트 담당 영역에서 기대값 갱신 권고. (본 TC는 해당 파일 수정 금지 준수)
- **ISSUE-E2EJ-2 (환경, 참고)**: dev 스택을 `127.0.0.1:3002` 로 접속하면 상태 변경 API의 origin 가드(`http-origin-guard.ts`)가 서버 origin(`localhost`)과 불일치해 403을 반환한다. `localhost:3002` 접속 시에는 통과(이후 401 인증 게이트). 게스트 OCR "맛보기" 퍼널이 실제로 분석까지 이어지려면 로그인이 필요하다는 설계이며, E2E에서는 §5 허용 규칙으로 처리
- **ISSUE-E2EJ-3 (참고)**: `/mypage` 의 약관/개인정보처리방침 설정 행 링크(`src/app/mypage/page.tsx:202-203`)는 로그인 게이트 뒤에 있어 게스트 여정으로는 도달 불가 — 로그인 여정 확장 시 검증 대상
