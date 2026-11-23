# 웹 영역 TC 목록

- 기준: master @ 3f7276f / 실행일: 2026-11-05
- 실행 명령: `node --test tests/*.test.mjs && npm run test:web:ts`
- 요약: 기존 40개 / 신규 6개 / **전부 PASS** (`.mjs` 스위트 155건 PASS + 웹 TS 스위트 665건 PASS)
- 웹 TS 스위트 범위: `scripts/run-web-ts-tests.cjs`가 `src/**`와 `tests/**`를 재귀 순회하여 `*.test.ts`/`*.test.mts` 92개 파일을 tsx로 실행한다 (src/app/api route tests, src/components, src/lib 포함).

## 기존 TC (파일·기능 단위 시나리오 묶음)

| TC ID | 제목 | 분류 | 우선순위 | 자동화(파일) | 결과 |
|---|---|---|---|---|---|
| TC-WEB-001 | Supabase auth 파운데이션(라우트·SSR·가입 상태·RLS·env 문서) | 인증 | P0 | tests/auth-supabase-foundation.test.mjs | PASS |
| TC-WEB-002 | 회원가입 필수 약관 동의 게이트(로그인/구버전 폼/OAuth 콜백/동의 시점 파서) | 인증 | P0 | tests/signup-terms-consent.test.mjs | PASS |
| TC-WEB-003 | 회원 탈퇴(본인 전용 API·포트폴리오 정리·확인 다이얼로그) | 인증 | P0 | tests/account-withdrawal.test.mjs | PASS |
| TC-WEB-004 | 비밀번호 재설정(메일 발송·code 교환 서버 라우트·UI 재사용) | 인증 | P1 | tests/password-reset.test.mjs | PASS |
| TC-WEB-005 | Supabase 클라이언트·서버·프록시·OAuth 리다이렉트·가입/동의 유틸 | 인증 | P1 | src/lib/supabase/*.test.ts (auth, auth-error, signup, terms-consent, config, proxy, oauth-callback-origin, oauth-redirect) | PASS |
| TC-WEB-006 | 토스 결제 파운데이션(승인 금액 DB 기준·빌링 구독·웹훅 멱등·cron 보호·RLS) | 결제 | P0 | tests/payments-toss-foundation.test.mjs | PASS |
| TC-WEB-007 | 결제 상품 카탈로그(config·products) | 결제 | P2 | src/lib/payments/products.test.ts | PASS |
| TC-WEB-008 | 법적 페이지(이용약관·개인정보처리방침 PIPA 필수 고지·공유 레이아웃) | 법적 | P0 | tests/legal-pages.test.mjs | PASS |
| TC-WEB-009 | 전역 투자 디스클레이머 상시 노출·딥스캔 경고 문구 유지·자본시장법 검토 문서 | 법적 | P1 | tests/global-investment-disclaimer.test.mjs | PASS |
| TC-WEB-010 | 홈 실데이터 파이프라인(OCR 평가금/손익 보존·평단 재계산 금지·소수점 수량) | 홈 | P0 | src/lib/jaroo-home-data.test.ts | PASS |
| TC-WEB-011 | 홈 현재가 쿼트(KR/US 분리 dedupe·ETN/ETF 배지 갱신·FX 조건부 요구) | 홈 | P0 | src/lib/home-current-quotes.test.ts | PASS |
| TC-WEB-012 | 홈 쿼트 부트스트랩(재시도 실패 시 stale 보존·FX 폴백·타임아웃) | 홈 | P1 | src/lib/home-quote-bootstrap.test.ts | PASS |
| TC-WEB-013 | 홈 레이아웃 CSS 회귀(종목카드 접힘 0fr·배지 nowrap·바텀넵 고정, PR #342/#344) | 홈 | P1 | tests/home-stock-card-collapse-css.test.mjs, tests/home-badge-nowrap-css.test.mjs, tests/home-bottom-nav-layout.test.mjs | PASS |
| TC-WEB-014 | 홈 화면 컴포넌트 모델(jaroo-home-screen) | 홈 | P1 | src/components/home/jaroo-home-screen.test.ts | PASS |
| TC-WEB-015 | 루트 엔트리·개발 스택 런처(스택 기동·SIGINT 전파·env 오버레이) | 인프라 | P2 | tests/root-dev-entrypoint.test.mjs, tests/with-local-env.test.mjs | PASS |
| TC-WEB-016 | 런타임 env 주입(window.__JAROO_ENV__·force-dynamic·프록시 전달·자동로그인 플래그) | 인프라 | P0 | tests/jaroo-runtime-env.test.mjs, tests/runtime-env-dynamic.test.mjs | PASS |
| TC-WEB-017 | 워크플로 타입·스토어(스냅샷 수익률 보존·타깃 캐시키) | 상태 | P2 | src/lib/workflow-types.test.ts, src/lib/stores/workflow-stores.test.ts | PASS |
| TC-WEB-018 | 딥스캔 canonical payload 계약(블록 구조·query 빌더·준비성 판별) | 딥스캔 | P0 | src/lib/deepscan-canonical.test.ts, tests/contracts-deepscan-types.test.ts | PASS |
| TC-WEB-019 | 딥스캔 로딩 동작(payload 준비성 독립·현재가 우선순위·팀요약 강조·공시 용어 치환) | 딥스캔 | P0 | src/lib/deepscan-loading-behavior.test.ts, src/lib/deepscan-loading-current-price.test.ts, src/components/deepscan-loading-screen.test.ts, src/components/deepscan-loading-briefing-card.test.ts | PASS |
| TC-WEB-020 | 딥스캔 페이지 판별(목표가 상태 3분류·상장상품 판별·US 종목·시세/브리핑 URL) | 딥스캔 | P1 | tests/deepscan-page-loading-facts.test.ts, tests/deepscan-page-us-and-stages.test.ts | PASS |
| TC-WEB-021 | 딥스캔 브리핑 스냅샷(연속 구간 카운트)·스냅샷 캐시 정책(TTL·드리프트 5%) | 딥스캔 | P1 | src/lib/deepscan-briefing-snapshot.test.ts, src/lib/deepscan-snapshot-policy.test.ts | PASS |
| TC-WEB-022 | 딥스캔 대상 선택·하이드레이션(최악 보유종목 선택·FX 수렴·OCR 행 정리) | 딥스캔 | P1 | tests/deepscan-target.test.ts, src/lib/deepscan-target-hydration.test.ts | PASS |
| TC-WEB-023 | 딥스캔 목표가 팬/투영 경로 기하(양수·결정론·렌더 순서·y축 반전) | 딥스캔 | P1 | src/lib/deepscan-target-price-paths.test.ts, tests/deepscan-target-price-paths.test.mjs | PASS |
| TC-WEB-024 | 딥스캔 거래정지 판정(권위 필드 우선·거래량 폴백·정규장 게이트·halt API) | 딥스캔 | P1 | src/lib/deepscan-halt.test.ts, src/app/api/deepscan/halt/route.test.ts | PASS |
| TC-WEB-025 | 딥스캔 크레딧 부족 UX(402 보존·전용 예외 화면·레거시 위젯 배제) | 딥스캔 | P1 | src/lib/deepscan-credit-shortage.test.ts, tests/deepscan-credit-notice.test.mjs, tests/deepscan-quick-facts-skeleton-sequence.test.mjs | PASS |
| TC-WEB-026 | 딥스캔 기록 원장(append 전용·limit 클램프·단건 404 통일·복원) | 딥스캔 | P1 | tests/deepscan-history-api.test.mjs, src/lib/deepscan-history-restore.test.ts | PASS |
| TC-WEB-027 | 딥스캔 위원회 쓰기백 가드·팀요약 요청 코디네이터 | 딥스캔 | P2 | src/lib/deepscan-committee-writeback.test.ts, src/lib/deepscan-team-summary-fetch.test.ts | PASS |
| TC-WEB-028 | 딥스캔 API 프록시 라우트(본문·briefing-snapshot·committee-status·slim·team-summary) | 딥스캔 | P1 | src/app/api/deepscan/{route,briefing-snapshot,committee-status,slim,team-summary}/route.test.ts | PASS |
| TC-WEB-029 | 딥스캔 슬림 정규화·미국 통화 컨텍스트(KRW 평단 환산·FX 부재 차단) | 딥스캔 | P1 | src/lib/deepscan-slim.test.ts, src/lib/deepscan-us-currency.test.ts | PASS |
| TC-WEB-030 | 딥스캔 결과 문구(하락 충격 3단계·short flow·인라인/결론/합의 리빌·카드 자동스크롤) | 딥스캔 | P2 | src/lib/deepscan-intro-mention.test.ts, src/lib/deepscan-short-flow.test.ts, src/components/deepscan-inline-results.test.ts, src/components/deepscan-conclusion-reveal.test.ts, src/components/deepscan-consensus-reveal.test.ts, tests/recovery-forecast-briefing-array.test.mjs, tests/committee-card-autoscroll.test.mjs | PASS |
| TC-WEB-031 | 원금회수 예측 엔진(3모델 중앙값·신뢰도·rebound 윈도우·파라미터 추정) | 딥스캔 | P1 | tests/recovery-forecast.test.mjs, src/app/api/recovery-forecast/route.test.ts | PASS |
| TC-WEB-032 | 딥스캔 내비게이션 핸드오프·재진입 캐시·웹 임포트 경계(크롤러 직접 임포트 금지) | 딥스캔 | P2 | src/lib/deepscan-navigation.test.ts, src/lib/deepscan-page-projection-cache.test.ts, tests/deepscan-web-import-boundary.test.mjs | PASS |
| TC-WEB-033 | 딥스캔 런타임 훅(payload 빌드·LLM 위원회·US 합의·perf trace·provenance 제거·아티팩트 싱크) | 딥스캔 | P2 | src/lib/deepscan-runtime/*.test.ts (7개) | PASS |
| TC-WEB-034 | OCR API 4겹 가드(레이트리밋·가드 선배선·순수 모듈 검증) | OCR | P0 | tests/ocr-api-guard.test.mjs, src/app/api/ocr/route.test.ts, src/app/api/ocr/rate-limit.test.ts | PASS |
| TC-WEB-035 | OCR 파서(종목명 정규화·수익률 파싱·손실 부호 복원·수동 입력 passthrough) | OCR | P1 | src/lib/screenshot-ocr.test.ts | PASS |
| TC-WEB-036 | OCR 검토 집계·식별자 해상(가중 평단·병합·재시도·수동 경로 전환·평가금 미리보기) | OCR | P1 | src/lib/ocr-review-aggregation.test.ts, src/lib/ocr-review-resolution.test.ts, src/lib/ocr-identifier-resolution.test.ts, src/lib/ocr-evaluation-preview.test.ts | PASS |
| TC-WEB-037 | OCR 페이지 와이어링(page.wiring) | OCR | P2 | src/app/ocr/page.wiring.test.ts | PASS |
| TC-WEB-038 | 보유종목 식별자 룩업(KR/US fuzzy·별칭·ETN·단일문자 티커 회귀·ticker-map) | OCR | P1 | src/lib/holding-instrument-lookup.test.ts, src/lib/holding-instrument-lookup.regression.test.ts, src/lib/ticker-map-resolver.test.ts | PASS |
| TC-WEB-039 | ETF 페이지 모델·데이터 노티스 카드(사유 명시 카드·financialToneClass) | ETF | P1 | src/app/etf/etf-page-model.test.ts, src/components/etf-data-notice-card.test.ts | PASS |
| TC-WEB-040 | ETF 지표·타깃·뷰모델(etf-metrics·etf-target·etf-view-model) | ETF | P1 | src/lib/etf/etf-metrics.test.ts, src/lib/etf/etf-target.test.ts, src/lib/etf/etf-view-model.test.ts | PASS |
| TC-WEB-041 | ETF 기록 원장 스토어(payload 계약·스키마 분리 가드·기준가·ETN 거부) | ETF | P1 | src/lib/etf-history-store.test.ts, src/app/api/etf/{committee,profile}/route.test.ts | PASS |
| TC-WEB-042 | 포트폴리오 동기화(OCR row→저장 DTO·DB row round-trip) | 포트폴리오 | P1 | src/lib/portfolio-sync.test.ts, src/app/api/portfolio/route.test.ts | PASS |
| TC-WEB-043 | 병합 화면·충돌 카드(jaroo-merge-screen) | 병합 | P2 | src/components/merge/jaroo-merge-screen.test.ts | PASS |
| TC-WEB-044 | 공유 카드 뷰모델(종목/포트폴리오 카드·바람 등급·환율 혼합 합산) | 공유 | P2 | src/lib/sharecard-view-model.test.ts | PASS |
| TC-WEB-045 | 금융 색상 컨벤션(수익=빨강/손실=파랑 토큰 분리·부호 판별 공통화) | UI | P1 | tests/financial-color-convention.test.mjs, src/lib/financial-value-tone.test.ts | PASS |
| TC-WEB-046 | KR 일봉 수집·정규장 시간(네이버 페이징 병합·5-청크 순차·TTL 캐시·09:00~15:30) | 시장데이터 | P1 | src/lib/kr-daily-price-history.test.ts, src/lib/kr-market-hours.test.ts | PASS |
| TC-WEB-047 | 시장 지표·FX 프록시(indicators·us-indicators·usd-krw·타임아웃 504) | 시장데이터 | P1 | src/app/api/market/indicators/route.test.ts, src/app/api/market/us-indicators/route.test.ts, src/app/api/market/fx/usd-krw/route.test.ts | PASS |
| TC-WEB-048 | 현재가·종목 resolve 프록시(quotes/current·instruments/resolve) | 시장데이터 | P1 | src/app/api/quotes/current/route.test.ts, src/app/api/instruments/resolve/route.test.ts | PASS |
| TC-WEB-049 | 프론트엔드 접근성(아이콘 링크 라벨·바텀내브 상태·게스트 탈출로·aria-expanded) | 접근성 | P1 | tests/frontend-accessibility.test.mjs | PASS |
| TC-WEB-050 | 모바일 풀스크린 셸(390px 프레임·transform containing block·이중 폰트박스 금지) | UI | P1 | tests/mobile-fullscreen-shell.test.mjs | PASS |
| TC-WEB-051 | 디버그 내비 데스크톱 전용 가드(모바일 셸 비노출·캡처/OCR 워크스페이스 비노출) | UI | P2 | tests/debug-nav-mobile-guard.test.mjs, src/lib/debug-page-nav.test.ts | PASS |
| TC-WEB-052 | 로딩 fetch 재시도(5xx·body.ok=false·네트워크 오류·abort 즉시 중단) | 공통 | P2 | tests/loading-fetch-retry.test.mjs | PASS |
| TC-WEB-053 | 웹 헬스체크 라우트(ok·서비스명) | 인프라 | P2 | src/app/api/health/route.test.ts | PASS |

## 신규 TC (커버리지 갭 — 상세)

| TC ID | 제목 | 분류 | 우선순위 | 자동화(파일) | 결과 |
|---|---|---|---|---|---|
| TC-WEB-054 | 루트 메타·파비콘·OG 브랜딩 회귀 가드 (PR #346) | 메타/SEO | P1 | tests/tc-web-meta-favicon-og.test.mjs | PASS |
| TC-WEB-055 | 워치 API 가드(목록·알림강도·배치 트리거) | API 가드 | P1 | tests/tc-web-watch-api-guards.test.mjs | PASS |
| TC-WEB-056 | 텔레그램 연동·웹훅 가드 | API 가드 | P1 | tests/tc-web-telegram-link-webhook.test.mjs | PASS |
| TC-WEB-057 | ETF 기록·위원회 상태 API 계약 | API 가드 | P1 | tests/tc-web-etf-history-api.test.mjs | PASS |
| TC-WEB-058 | 개발 전용·내부 라우트 프로덕션 차단·프로필 수정 검증 | 보안 | P0 | tests/tc-web-dev-internal-routes-guard.test.mjs | PASS |
| TC-WEB-059 | 클라이언트 크래시 리포트 수집 계약 | 관측성 | P2 | tests/tc-web-client-errors-telemetry.test.mjs | PASS |

### TC-WEB-054: 루트 메타·파비콘·OG 브랜딩 회귀 가드 (PR #346)

- **배경**: 최근 병합된 PR #346(파비콘·메타 타이틀·OG 폴리싱)은 커밋 전 테스트 커버리지가 전혀 없었다. 타이틀이 다시 `<title>jaroo-mvp-v3</title>` 플레이스홀더로 돌아가거나 OG 자산이 유실되어도 알 수 없다.
- **사전조건**: `src/app/layout.tsx`와 `src/app/` 하위 브랜딩 자산이 master @ 3f7276f 상태로 존재한다.
- **시나리오**:
  1. 루트 메타데이터가 한글 브랜드 타이틀(`Jaroo — MTS 스크린샷 한 장으로 AI 주식 진단`)·한국어 설명·`applicationName: 'Jaroo'`을 노출하고, 프로젝트명 플레이스홀더 타이틀을 쓰지 않는지 검사한다.
  2. `metadataBase`가 기본 `https://jaroo.kr`을 쓰고 `NEXT_PUBLIC_SITE_URL` 오버라이드를 허용하는지 검사한다(카톡/디스코드 크롤러는 상대 경로 OG 이미지를 무시).
  3. openGraph가 `ko_KR` 로케일·1200x630 이미지 선언·한국어 alt를 갖고, twitter 카드가 `summary_large_image`인지 검사한다.
  4. `themeColor(#eef4f8)`가 Next 16 규약대로 `viewport` export에 있고 `metadata` 블록 안에는 없는지 검사한다.
  5. favicon.ico(ICONDIR 시그니처)·icon.svg(viewBox)·apple-icon.png·icon-192.png·icon-512.png·opengraph-image.png(PNG 시그니처) 자산 존재와 형식을 검사하고, OG PNG의 IHDR 실측 크기가 선언(1200x630)과 일치하는지 검사한다.
- **기대결과**: 모든 단계 통과 — 타이틀·OG·파비콘 회귀 시 즉시 FAIL.
- **검증방법**: 소스 정규식 정적 검사 + PNG/ICO 바이너리 헤더 파싱 (`node --test tests/tc-web-meta-favicon-og.test.mjs`)

### TC-WEB-055: 워치 API 가드(목록·알림강도·배치 트리거)

- **배경**: `/api/watch`, `/api/watch/settings`, `/api/watch/batch/tick` 3개 라우트는 전용 테스트가 없었다(인증·Origin·입력 클램프 무보호).
- **사전조건**: 워치 3개 라우트 소스가 master @ 3f7276f 상태다.
- **시나리오**:
  1. 목록 라우트 GET/POST/DELETE 3곳 모두 미인증 401, 상태 변경(POST/DELETE)만 `originAllowedForStateChange` 403, 입력 클램프 한도(코드 24/이름 80/마켓 24)와 `code+name` 필수 400을 유지하는지 검사.
  2. 등록 upsert가 `onConflict: 'user_id,code'`(재등록 갱신), DELETE가 `.eq('user_id', user.id)`(본인 행만 해지)를 유지하는지 검사.
  3. 알림 강도 설정이 GET/PUT 모두 401 게이트·PUT만 Origin 가드·`normalizeAlertLevel` 정규화·행 없음 기본값 폴백·계정 단위 upsert(`onConflict: 'user_id'`)를 유지하는지 검사.
  4. 배치 트리거가 `WATCH_BATCH_SECRET` 미설정 시 503(실행 금지), `timingSafeEqual` 상수시간 Bearer 비교를 유지하는지 검사.
- **기대결과**: 가드 누락·스코프 확장(타인 행 해지 가능)·평문 시크릿 비교 회귀 시 FAIL.
- **검증방법**: 소스 정규식 정적 검사 (`node --test tests/tc-web-watch-api-guards.test.mjs`)

### TC-WEB-056: 텔레그램 연동·웹훅 가드

- **배경**: `/api/telegram/link`와 `/api/telegram/webhook`은 개인 연동 상태(chat_id↔user_id)와 봇 시크릿을 다루지만 전용 테스트가 없었다.
- **사전조건**: 텔레그램 2개 라우트 소스가 master @ 3f7276f 상태다.
- **시나리오**:
  1. link 라우트의 모든 응답(16곳)이 `NO_STORE_PRIVATE_HEADERS`를 유지하는지 검사(개인 연동 상태 캐시 금지).
  2. GET까지 봇 미설정을 검증해 503으로 UI 행을 숨기는지 검사(미설정인데 행이 보이고 클릭 시에야 503이 뜬 사례 회귀 방지).
  3. POST/DELETE의 Origin 가드, 1회용 토큰 규약(randomBytes 24바이트 base64url·10분 TTL·재발급 시 미사용 토큰 무효화)을 검사.
  4. webhook이 `x-telegram-bot-api-secret-token` 헤더를 상수시간 비교로 검증하고, 미설정 503/위조 401을 구분하는지 검사.
  5. 개인 채팅만 수용, `/startabc` 오인 방지 파싱, 만료·재사용 토큰 거절, chat_id 충돌(한 텔레그램 계정 = 한 Jaroo 계정) 거부를 검사.
- **기대결과**: no-store 누락·시크릿 평문 비교·토큰 무효화 누락 회귀 시 FAIL.
- **검증방법**: 소스 정규식 정적 검사 (`node --test tests/tc-web-telegram-link-webhook.test.mjs`)

### TC-WEB-057: ETF 기록·위원회 상태 API 계약

- **배경**: ETF 기록 API(`/api/etf/history`, `/api/etf/history/[id]`)와 위원회 상태 프록시(`/api/etf/committee-status`)는 lib(etf-history-store)만 테스트되고 라우트 계약이 무보호였다.
- **사전조건**: 3개 라우트 소스가 master @ 3f7276f 상태다.
- **시나리오**:
  1. 목록 라우트의 limit 정규화(기본 20·상한 50·무효값 기본값)로 무제한 인출을 차단하는지 검사.
  2. 인증 단일 소스(`resolveApiUserId`): unavailable 503 2곳·unauthorized 401 1곳과 전 응답 no-store·`force-dynamic`을 검사.
  3. 단건 라우트가 본인 userId 스코프로 조회하고(uuid 아님/남의 행 포함) 404로 통일해 존재 추론을 막는지 검사.
  4. 위원회 상태 프록시가 requestId 인코딩 릴레이·부재 400·응답 3곳 모두 no-store·upstream 장애 502(한국어 안내)를 검사하고, deepscan committee-status와 동일 계약임을 검사.
- **기대결과**: limit 클램프·404 통일·no-store 회귀 시 FAIL.
- **검증방법**: 소스 정규식 정적 검사 (`node --test tests/tc-web-etf-history-api.test.mjs`)

### TC-WEB-058: 개발 전용·내부 라우트 프로덕션 차단·프로필 수정 검증

- **배경**: 세션 토큰을 노출하는 dev 라우트(`/api/auth/dev-tokens`, `/auth/dev-set-session`)와 내부 성능 진단(`/api/deepscan/perf-summary`)은 프로덕션 404 가드가 생명이지만 테스트가 없었다. `/api/account/profile`도 무커버였다.
- **사전조건**: 4개 라우트 소스가 master @ 3f7276f 상태다.
- **시나리오**:
  1. dev-tokens·dev-set-session이 `NODE_ENV === 'production'`에서 404로 비활성화되는지 검사.
  2. dev-tokens가 개발 환경에서도 세션 없으면 401로 토큰을 주지 않는지 검사.
  3. perf-summary가 프로덕션 404(dev 라우트 패턴)를 유지하는지 검사.
  4. profile이 Origin 가드 403·미인증 401·닉네임 1~30자 검증 400·서버 측 `updateUser(display_name)`(#224 E1 httpOnly 쿠키 전제)·전 응답 no-store(7곳)를 유지하는지 검사.
- **기대결과**: 프로덕션에서 세션 토큰 라우트가 살아나는 회귀 시 FAIL — 계정 탈취 직결 방어선.
- **검증방법**: 소스 정규식 정적 검사 (`node --test tests/tc-web-dev-internal-routes-guard.test.mjs`)

### TC-WEB-059: 클라이언트 크래시 리포트 수집 계약

- **배경**: `/api/client-errors`(global-error.tsx → client_error_logs)는 크래시 관측의 유일한 통로지만 전용 테스트가 없었다.
- **사전조건**: 라우트와 `src/app/global-error.tsx` 소스가 master @ 3f7276f 상태다.
- **시나리오**:
  1. 라우트가 Origin 가드 403·JSON 파싱 실패 400·`message` 필수 400을 유지하는지 검사.
  2. 모든 텍스트 필드가 2000자로 클램프되는지 검사(로그 테이블 비대 방지).
  3. user_id가 세션이 있을 때만 귀속(로그아웃 크래시도 수용), 적재는 deny-all RLS 테이블이므로 서비스 롤로만 수행하는지 검사.
  4. 적재 실패와 무관하게 항상 200 계열로 응답하는지 검사(UX 보호).
  5. global-error 바운더리가 `void fetch('/api/client-errors')`로 fire-and-forget 발신하고 digest 표준 필드를 보내는지 검사.
- **기대결과**: 수집 통로 끊김(발신 배선·라우트 계약 파손) 시 FAIL.
- **검증방법**: 소스 정규식 정적 검사 (`node --test tests/tc-web-client-errors-telemetry.test.mjs`)

## 커버리지 갭 메모 (테스트화하지 않은 나머지 갭)

- `src/app/api/auth/{login,logout,me,signup}`·`src/app/auth/*`: TC-WEB-001/004/005가 소스 수준에서 커버. 라우트 단위 동작 테스트는 없음(레벨 P2 여지).
- `src/app/api/payments/*` 8개 라우트: TC-WEB-006이 소스 정적 검사로 커버(승인 금액·웹훅 멱등·cron 보호 등).
- `src/app/api/telegram` 외 나머지 갭은 신규 TC로 흡수 완료.
- 페이지 렌더 E2E(sharecard/merge/etf/mypage 실제 렌더링)는 dev 서버 기동 금지 제약으로 정적·유닛 계층만 커버 — `npm run verify:screens` 별도 채널.
- 발견된 버그 후보: 없음 (신규 테스트 6파일 모두 기존 프로덕션 코드와 일치, FAIL 0)
