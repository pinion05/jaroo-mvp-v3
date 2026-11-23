# TC-Blackbox-Security — 세션·보안·캐시 계약 블랙박스 TC (TC-BBS-001 ~ TC-BBS-018)

- 대상: **운영 https://jaroo.kr** (실서비스, 읽기 + 로그인/로그아웃만 수행)
- 수행 환경: CDP 9225 헤드리스 Chrome (jaroo-qa 격리 프로필, 운영 인증 세션 내장). **9222(사용자 실사용 브라우저) 미접속 원칙 준수**
- 수행 도구: `scripts/blackbox-session-security.cjs` (CDP 직접 제어 — 네트워크 헤더·쿠키 스토어·DOM 관찰, 토큰 값은 마스킹)
- 수행 일시(KST): 사전 스카우트 2026-11-06 00:40~00:41 / 1차 실행(`all`) 00:44~00:49 / 2차 실행(`relogin logout api auth`) 00:54~01:01 / 수동 보완 관찰 00:52
- 판정: **PASS 12 / WARN 1 / FAIL 3 / BLOCK 2** (총 18 TC)

## 1. 블랙박스 원칙과 기대값 출처

제품 소스(src/, packages/, tests/, scripts/ 기존 파일, docs/)를 일절 열람하지 않았고, 기대값은 아래 공개 출처만으로 도출했다.

| 출처 체계 | 구체적 근거 | 적용 TC |
|---|---|---|
| 공개 보안 관행 | OWASP Session Management Cheat Sheet (HttpOnly·Secure·SameSite, 로그아웃 시 자격 폐기), OWASP Access Control / API Security, OWASP 민감 정보 캐시 금지 | 001,002,003,005,006,007,010~015 |
| 공개 표준 | RFC 9110 §15.5.1(401 Unauthorized), 2xx 성공 의미론, MDN Cache-Control | 004,015,016 |
| OAuth/UX 관행 | Google Identity Platform(기존 동의는 재동의 생략), 로그인 상태 지속성·게스트 게이트 UX 관행 | 008,009,017,018 |
| 크로스환경 일관성 | 동일 계정·동일 브라우저에서 새로고침/새 탭/게스트 전환 간 동작 일관성 | 014,016,017,018 |

## 2. 요약 판정표

| ID | 이름 | 판정 | 근거 실행 |
|---|---|---|---|
| TC-BBS-001 | 세션 쿠키 플래그 계약(HttpOnly·Secure·SameSite) | ❌ FAIL | 1차 |
| TC-BBS-002 | document.cookie 세션 토큰 비가시성 | ❌ FAIL | 1차 |
| TC-BBS-003 | 로그인 시 세션 쿠키 발급 방식(Set-Cookie) | ❌ FAIL | 2차 |
| TC-BBS-004 | 민감 페이지(인증) Cache-Control no-store | ✅ PASS | 1차 |
| TC-BBS-005 | 로그아웃 직후 뒤로가기 개인정보 캐시 노출 | ✅ PASS | 1차 |
| TC-BBS-006 | 로그아웃 후 인증 쿠키 폐기 | ✅ PASS | 1차 |
| TC-BBS-007 | 로그아웃 후 보호 경로(/mypage) 가드 | ✅ PASS | 1차+2차 |
| TC-BBS-008 | 재로그인 여정(구글 계정 선택→콜백→/home) | ⛔ BLOCK | 1차+2차 |
| TC-BBS-009 | 재로그인 시 동의(consent) 게이트 동작 | ⛔ BLOCK | 1차+2차 |
| TC-BBS-010 | 게스트 가드: /home | ✅ PASS | 1차 |
| TC-BBS-011 | 게스트 가드: /mypage | ✅ PASS | 1차 |
| TC-BBS-012 | 게스트 가드: /deepscan | ✅ PASS | 1차 |
| TC-BBS-013 | 게스트 가드: /ocr | ✅ PASS | 1차+수동 |
| TC-BBS-014 | 인증 상태 보호 라우트 정상 접근(4라우트) | ✅ PASS | 1차(인증 구간) |
| TC-BBS-015 | API 인증 계약: 게스트 호출 401 | ⚠️ WARN | 1차+2차 |
| TC-BBS-016 | API 인증 계약: 인증 상태 정상 응답 | ✅ PASS | 스카우트(인증) |
| TC-BBS-017 | 새로고침 후 세션 유지 | ✅ PASS | 1차 |
| TC-BBS-018 | 새 탭 재오픈 후 세션 유지 | ✅ PASS | 1차 |

## 3. TC 상세

### G1. 세션 쿠키 계약

**TC-BBS-001 세션 쿠키 플래그 계약 — FAIL**
- 기대: 인증 쿠키는 `HttpOnly; Secure; SameSite=Lax 이상`으로 발급 (출처: OWASP Session Management Cheat Sheet)
- 절차: 인증 상태에서 CDP `Network.getCookies`로 jaroo.kr 쿠키 전수 관찰(값 마스킹)
- 관찰: 인증 쿠키 2개 `sb-…-auth-token.0`(값 base64… 3180바이트), `sb-…-auth-token.1`(값 CJpZCI… 1133바이트) — **둘 다 httpOnly=false, secure=false**, sameSite=Lax, 만료 2027-12-10(약 13개월 지속 쿠키)
- 판정: **FAIL** — HttpOnly·Secure 부재. Secure 부재는 평문 HTTP 구간 전송 가능성(다운그레이드)까지 내포

**TC-BBS-002 document.cookie 세션 토큰 비가시성 — FAIL**
- 기대: 세션 쿠키는 document.cookie에 관찰되지 않아야 함(XSS 토큰 탈취 차단) (출처: OWASP)
- 절차: 인증 상태 /home에서 `document.cookie` 평가
- 관찰: `sb-…-auth-token.0`, `sb-…-auth-token.1` **모두 document.cookie에 노출**. 값은 base64 세션 JSON으로 access_token·refresh_token 포함(런 초반 우회 관찰에서 확인, 본 기록에는 값 미기재)
- 판정: **FAIL** — 임의 스크립트(XSS)가 세션 전체를 탈취 가능한 구조

**TC-BBS-003 로그인 시 세션 쿠키 발급 방식(Set-Cookie) — FAIL**
- 기대: 세션 쿠키는 서버 `Set-Cookie`(HttpOnly; Secure; SameSite)로 발급되어야 함 (출처: OWASP)
- 절차: 재로그인 시도 구간 전체에서 jaroo.kr 응답의 Set-Cookie 헤더 캡처(CDP Network.responseReceivedExtraInfo) + 로그인 직후 쿠키 스토어 대비
- 관찰: jaroo.kr 응답 Set-Cookie **0건** + 로그인 직후 인증 쿠키 생성 ⇒ **클라이언트 JS(document.cookie) 설정 확증**. supabase.co 도메인 Set-Cookie 2건은 별도(jaroo.kr로 전송되지 않음)
- 판정: **FAIL** — 구조적으로 HttpOnly 설정이 불가능한 발급 방식(TC-BBS-001/002와 동일 근원). BFF/서버 발급 쿠키 전환 권장

### G2. 민감 페이지 캐시 정책

**TC-BBS-004 인증 상태 민감 페이지 Cache-Control — PASS**
- 기대: /home·/mypage·/deepscan 문서 응답은 `no-store`로 캐시 금지 (출처: OWASP 민감 정보 캐시 금지, MDN)
- 절차: 인증 상태에서 3개 라우트 문서(Document) 응답 헤더 관찰
- 관찰: 3개 모두 HTTP 200, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
- 판정: **PASS**

**TC-BBS-005 로그아웃 직후 뒤로가기 개인정보 캐시 노출 — PASS (출시 핵심 항목)**
- 기대: 로그아웃 후 뒤로가기 시 개인 페이지(이름·평가액·마이페이지 데이터)가 캐시/bfcache로 재노출되지 않아야 함 (출처: OWASP Authentication/Session Management)
- 절차: /home → /mypage(인증, pageshow 리스너 주입) → 로그아웃 버튼 클릭 → `history.back()` 후 DOM·navigation type 관찰
- 관찰(1차, 실제 로그아웃 발생): 로그아웃 후 `/login?next=%2Fmypage`로 이동. back 시 `/home` 도달 — **개인 마커(이름/평가액/마이페이지) 전부 미노출**(nav=back_forward). 직전 /mypage 히스토리 엔트리가 로그인 페이지로 대체(replace)되어 뒤로가기로 /mypage 복귀 불가 구조로 관찰됨
- 판정: **PASS** — 개인정보 잔여 없음

### G3. 로그아웃 여정

**TC-BBS-006 로그아웃 후 인증 쿠키 폐기 — PASS**
- 기대: 로그아웃 시 인증 쿠키는 브라우저에서 제거/즉시 만료 (출처: OWASP)
- 절차: 로그아웃 전후 쿠키 스토어 비교
- 관찰(1차): 인증 쿠키 **2개 → 0개**. 서버 로그아웃 호출은 해당 구간 네트워크 캡처에서 미관찰(클라이언트 처리 또는 캡처 범위 밖 가능 — 블랙박스 한계)
- 판정: **PASS** (클라이언트 폐기 기준). 서버 측 토큰 취소(리프레시 토큰 revoke) 여부는 본 자동화 범위 밖 — 후속 확인 권장

**TC-BBS-007 로그아웃 후 보호 경로(/mypage) 가드 — PASS**
- 기대: 게스트의 /mypage 직접 접근은 개인정보 미노출 + 로그인 유도 (출처: OWASP Access Control, UX 관행)
- 절차: 로그아웃(게스트) 상태에서 /mypage 신규 내비게이션
- 관찰: `/login?next=%2Fmypage`로 리디렉션(HTTP 200, 로그인 게이트 UI). 개인 마커 없음. 1차·2차 실행 모두 동일
- 판정: **PASS**

### G4. 재로그인 여정

**TC-BBS-008 재로그인 여정(구글 계정 선택 → 콜백 → /home) — BLOCK**
- 기대: 저장된 구글 세션으로 계정 선택만으로 재로그인 완료 후 /home 도달 (출처: OAuth 2.0 / Google 로그인 UX 관행)
- 절차: 게스트에서 /login → "Google로 시작하기" 클릭 → 계정 선택 → 콜백 대기
- 관찰: 1차 실행에서 구글 계정 선택기(accountchooser, 다중 계정) 관찰 — 자동화가 의도와 다른 계정 항목을 선택해 비밀번호 재확인(challenge/pwd)으로 이행했고, 이후 구글이 해당 프로필에 **재인증(다시 로그인) 요구** 상태로 전환되어 계정 선택만의 여정 진행 불가(비밀번호 입력은 수행하지 않음 — 자격증 취급 금지). 간접 증거: 당일 13:39(UTC) 프로필 네트워크 이력에서 `supabase /auth/v1/authorize → /auth/callback?code=…&consent=… → /home` 직행(재로그인 성공 사례)
- 판정: **BLOCK(환경 제약)** — 제품 결함 아님. QA 프로필에서 구글 수동 재인증 후 `node scripts/blackbox-session-security.cjs relogin` 으로 재검증 권장

**TC-BBS-009 재로그인 시 동의(consent) 게이트 동작 — BLOCK**
- 기대: 이미 동의한 사용자의 재로그인은 재동의를 요구하지 않아야 함 (출처: Google Identity Platform 관행)
- 관찰: 직접 관찰 불가(TC-BBS-008과 동일 제약). 간접 증거: 상기 13:39 성공 이력에서 동의 화면 재등장 없이 콜백 직행, 콜백 URL에 `consent=<타임스탬프>` 파라미터 상시 포함(서비스 자체 동의 게이트 흔적)
- 판정: **BLOCK(환경 제약)** — 재인증 후 재관찰 권장

### G5. 게스트↔인증 가드 매트릭스

| 라우트 | 게스트 기대 | 게스트 관찰(1차) | 판정 |
|---|---|---|---|
| /home | 개인정보 미노출 + 로그인 유도 | 게스트 랜딩("게스트·로그인 포트폴리오 준비" + 로그인/스크린샷 CTA), 개인 마커 없음 | ✅ PASS (TC-BBS-010) |
| /mypage | 로그인 리디렉션 | `/login?next=%2Fmypage`, 개인 마커 없음 | ✅ PASS (TC-BBS-011) |
| /deepscan | 로그인 리디렉션 | `/login?next=%2Fdeepscan`, 개인 마커 없음 | ✅ PASS (TC-BBS-012) |
| /ocr | 개인정보 미노출 + 로그인 유도 | `/screenshot`으로 리다이렉트된 공개 업로드 가이드 — 이름/이메일 미노출, 표시 종목은 안내용 샘플(삼성전자 1주 321,000원 등), "로그인" CTA 존재 | ✅ PASS (TC-BBS-013, 수동 보완 관찰로 분류 확정) |

- 비고(TC-BBS-013): 게스트가 업로드 UI에 도달할 수 있는 설계. **업로드 실행(쓰기)은 금지 범위라 게이트 여부 미검증** — 수동 확인 권장(1회 업로드 시도 시 로그인 게이트가 뜨는지).

**TC-BBS-014 인증 상태 보호 라우트 정상 접근 — PASS**
- 기대: 인증 사용자는 4개 라우트 모두 게이트 없이 이용 가능 (출처: UX 관행, 크로스환경 일관성)
- 관찰(1차 실행의 인증 구간): /home — 이름·포트폴리오 렌더(게이트 없음). /mypage — HTTP 200 + 로그아웃 버튼·내 종목 관리 등 개인 UI. /deepscan — HTTP 200 문서로 게이트 없음. /ocr→/screenshot — 인증 홈의 "스크린샷 추가" CTA 및 게스트/인증 패리티로 간접 확인
- 판정: **PASS** (단 /ocr의 인증 상태 화면은 간접 근거 — 재인증 후 직접 재확인 권장)

### G6. API 인증 계약

**TC-BBS-015 게스트 호출 401 — WARN**
- 기대: 개인 데이터 API는 게스트에 401. /me 계열은 익명 컨텍스트(개인정보 미포함) 또는 401 (출처: RFC 9110 §15.5.1, OWASP API Security, REST 관행)
- 절차: 게스트 상태(로그아웃 후)에서 페이지 컨텍스트 `fetch(credentials:'include')` — 쿠키 없는 게스트 조건
- 관찰: `/api/portfolio` → **401** `{"error":"unauthorized"}` ✅ / `/api/auth/me` → 200 `{"authScope":"guest","user":null,…}`(개인정보 미포함) / `/api/payments/me` → 200 `{"authScope":"guest","balance":0,"deepScanLeft":0,…}`(개인정보 미포함)
- 판정: **WARN** — 개인 데이터 API(/api/portfolio)는 401 계약 충족. /me 2종은 guest 스코프 설계로 개인정보 유출은 없으나 "인증 필요 → 401" 계약과 표면상 불일치하므로 API 계약 문서화·통일 권장

**TC-BBS-016 인증 상태 정상 응답 — PASS**
- 기대: 인증 상태 동일 API 2xx + 개인 데이터 반환 (출처: RFC 9110, 크로스환경 일관성)
- 관찰(스카우트 단계, 인증 상태 네트워크 관찰): `/api/auth/me` 200, `/api/portfolio` 200, `/api/quotes/current`·`/api/watch` 등 200
- 판정: **PASS** (2차 실행의 재측정은 구글 세션 제약으로 게스트 상태 — 무효 데이터로 판정에서 제외, 스크립트에도 인증 상태 확인 실패 시 BLOCK 처리 추가됨)

### G7. 세션 지속성

**TC-BBS-017 새로고침 후 세션 유지 — PASS** — reload 후 /home 이름·개인 콘텐츠 유지 (출처: UX 관행)
**TC-BBS-018 새 탭 재오픈 후 세션 유지 — PASS** — 신규 탭 /home에서 이름 표시, URL 유지 (출처: 쿠키 기반 세션 일관성)

## 4. 세션·캐시 리스크 목록 (출시 관점)

| # | 등급 | 리스크 | 근거 TC | 권고 |
|---|---|---|---|---|
| R1 | **High** | 세션 토큰 쿠키 비-HttpOnly·비-Secure, document.cookie 전체 노출(값에 access·refresh 토큰 포함) — XSS/악성 스크립트가 세션 전체 탈취 가능, Secure 부재 시 평문 HTTP 구간 전송 가능 | 001, 002, 003 | 서버 발급 `HttpOnly; Secure; SameSite` 쿠키 또는 BFF 패턴 전환. refresh 토큰은 특히 서버 저장으로 격리 |
| R2 | **Medium** | 세션 쿠키 만료 ~13개월(2027-12-10) — 탈취 시 장기 악용 여지 | 001 | 만료 단축 + 슬라이딩 갱신, 장기 자동로그인은 리프레시 토큰 분리로 |
| R3 | Low | /api/auth/me·/api/payments/me가 게스트에 200(guest 스코프) — 유출은 없으나 401 계약과 불일치 | 015 | API 인증 계약 문서화·응답 통일 |
| R4 | Low | /ocr→/screenshot 게스트 접근 허용(가이드+샘플 데이터) — 업로드 게이트 여부 미검증 | 013 | 업로드 시작 시점 로그인 게이트 여부 1회 수동 확인 |
| R5 | 환경 | QA 프로필 구글 세션이 재인증 요구 상태 — 재로그인 여정 자동화 불가 | 008, 009 | jaroo-qa 프로필에서 수동 재인증 후 `relogin` 그룹 재실행 |

**양호 확인(출시 방어선)**: 민감 3라우트 no-store ✅ / 로그아웃 시 쿠키 즉시 폐기 ✅ / 로그아웃 후 뒤로가기 개인정보 미노출 ✅ / 게스트 라우트 가드 ✅ / 세션 지속성 ✅

## 5. 한계 및 후속

- 블랙박스 원칙상 서버 측 세션 취소(리프레시 토큰 revoke)·쿠키 발급 코드는 미검증 — R1 개선 시 화이트박스 확인 병행 권장
- 단일 계정·단일 브라우저(jaroo-qa) 기준. 크로스브라우저(Safari bfcache 등) 재확인 권장
- TC-008/009는 구글 프로필 재인증 후 재실행 필요(스크립트는 동일 환경에서 즉시 재사용 가능)
- 본 TC는 읽기·로그인/로그아웃만 수행(포트폴리오 변경·딥스캔 실행·OCR 업로드·결제 미실행)

## 6. 스크립트 사용법

```bash
node scripts/blackbox-session-security.cjs            # 전체 여정(all): 로그인/로그아웃 각 1회
node scripts/blackbox-session-security.cjs cookies    # TC-001/002 (인증 상태에서)
node scripts/blackbox-session-security.cjs cache      # TC-004 + 로그아웃 여정(005~007)
node scripts/blackbox-session-security.cjs logout     # 로그아웃 여정(005~007)
node scripts/blackbox-session-security.cjs relogin    # TC-003/008/009 (게스트에서 시작)
node scripts/blackbox-session-security.cjs guards     # 게스트(010~013)+인증(014) 매트릭스
node scripts/blackbox-session-security.cjs api        # TC-015/016
node scripts/blackbox-session-security.cjs persistence# TC-017/018
node scripts/blackbox-session-security.cjs auth       # 인증 매트릭스만(014)

# 환경변수: BB_BASE_URL(기본 https://jaroo.kr), BB_CDP(기본 9225),
#           BB_EMAIL/BB_NAME(개인정보 마커), BB_CDP=9222 접속 금지
```

- 안전장치: 쿠키/토큰 값 마스킹 출력, 자기 탭만 생성/종료(브라우저 미종료), 순차 실행·최소 반복, 산출 마지막에 `SUMMARY_JSON {…}` 1행 출력(집계 파싱용)
- 주의: 재로그인 자동화는 프로필의 구글 세션 상태에 의존 — 계정 선택기에 대상 계정(`BB_EMAIL`) 항목이 있을 때만 클릭하고, 비밀번호 입력 화면에서는 자동 중단(차단 보고)

## 7. 후속 화이트박스 진단 — R1 세션 쿠키 노출의 실제 구조 (2026-11-06, fix/session-cookie-httponly)

TC-BBS-001/002/003 관찰(쿠키 httpOnly=false·secure=false)과 AGENTS.md 기술("세션의 진실 소스는 `sb-<ref>-auth-token` 계열 httpOnly 쿠키")이 충돌해 소스를 직접 진단했다. 결론: **둘 다 절반씩 맞는 이중 발급 구조**였다.

### 세션 쿠키 발급 경로 3곳 (수정 전)

1. 서버 라우트(`/auth/callback`, `/auth/dev-set-session`, `/api/auth/login`·`logout`) — `src/lib/supabase/server.ts`가 이미 `httpOnly:true`(+prod `Secure`)로 발급. 초기 발급은 문서대로 httpOnly였다.
2. **proxy(미들웨어, `src/lib/supabase/proxy.ts`)** — 액세스 토큰 만료(기본 1시간)마다 `auth.getUser()`가 토큰을 리프레시하고, 이때 `response.cookies.set`에 `@supabase/ssr` 0.12 기본 옵션(`httpOnly:false`, `maxAge:400일` ≈ 13개월)을 **그대로** 전달했다. 즉 로그인 직후에는 httpOnly였던 세션 쿠키가 첫 리프레시부터 JS-가독 쿠키로 덮어써졌고, 운영 관찰(httpOnly=false·secure=false·만료 ~13개월·SameSite=Lax)과 정확히 일치한다. R1의 근원.
3. 브라우저 클라이언트(`createBrowserClient`) — OAuth 시작 시 PKCE code-verifier 쿠키만 `document.cookie`로 기록한다(세션 토큰 아님). 단 기본 플래그(`detectSessionInUrl`·`autoRefreshToken`)가 켜져 있어 조건부로 브라우저에서 세션 쿠키까지 재발급할 수 있는 여지가 있었다.

### 수정 내용

- 신규 `src/lib/supabase/session-cookie.ts`: 세션 쿠키 속성 단일 소스. `httpOnly:true` + `Secure`(prod) + `SameSite=Lax` + 만료 30일 슬라이딩 상한(R2 — @supabase/ssr가 400일로 강제하는 maxAge를 발급 시점에 절단, 활동 중 토큰 리프레시마다 갱신).
- `server.ts`·`proxy.ts`: 발급·갱신·**삭제** 전부 이 헬퍼를 통과. 삭제(`maxAge=0`)에도 httpOnly를 유지한다 — RFC 6265bis상 httpOnly 쿠키는 httpOnly Set-Cookie로만 덮어쓸 수 있어, 폐기 플래그가 없으면 로그아웃이 조용히 실패한다.
- `client.ts`: 브라우저 클라이언트의 `detectSessionInUrl`·`autoRefreshToken` 비활성 — 세션 발급·갱신은 전적으로 서버 경로로만.

### 실측(로컬 스택 PORT=3011 + 모의 Supabase auth 서버, 운영 쓰기 없음)

- `dev-set-session`·`/auth/callback`(PKCE 교환)·미들웨어 토큰 리프레시(보호 경로 통과)·로그아웃 폐기 — 전 경로의 Set-Cookie가 `HttpOnly; SameSite=lax; Max-Age=2592000` (prod에선 `Secure` 추가, dev http localhost는 예외).
- headless Chrome(CDP): 세션 성립 후 `/home`에서 `document.cookie` = 빈 문자열, 쿠키 스토어에는 `httpOnly=true` 세션 쿠키 존재 — TC-BBS-002 관점 통과.
- 계약 테스트: `src/lib/supabase/session-cookie.test.ts`(속성·직렬화 계약), `tests/tc-web-session-cookie-httponly.test.mjs`(발급 경로 소스 계약).
