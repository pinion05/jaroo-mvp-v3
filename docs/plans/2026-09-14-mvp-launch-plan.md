# Jaroo MVP 실제 출시 플랜 (2026-09-14)

> **상태**: 초안 — gstack autoplan 리뷰 파이프라인(CEO → Design → Eng) 입력본.
> **2026-09-15 갱신**: **ETF 실데이터를 P2(출시 후 제외)에서 MVP 범위로 편입** — G11 신설(사용자 결정), 추적 이슈 **#265**(스테일 이슈 #23/#70·PR #53은 종료 정리). 함께 G3 행 중복 기재를 정리했다.
> **출시 정의(본 플랜의 성공 기준)**: 일반 사용자가 `jaroo.kr`에서 구글 로그인 → OCR 등록 → 홈 → 딥스캔(유료 크레딧) → 워치 구독(유료, 텔레그램 알림)까지 **실패 없이** 수행하고, 장애 시 운영자가 알 수 있으며, 결제·법률·품질 게이트가 모두 녹색인 상태. **ETF 보유 종목은 /etf에서 실데이터로 확인 가능해야 한다(2026-09-15 MVP 편입).**

---

## 1. 현재 상태 — 이미 존재하는 것 (증거 기반)

| 영역 | 상태 | 증거 |
|---|---|---|
| 진단 흐름 (로그인→OCR→홈→딥스캔) | ✅ 동작 | `src/app/{login,ocr,home,deepscan}`, 여정 ①~④ 구현 (PM 보고서 §4-1) |
| 딥스캔 엔진 (KR 실AI) | ✅ 동작 | `packages/crawler`, 위원 응답 스냅샷 쓰래밍 (#256), 목표가 팬차트 (#260) |
| 실패 시 크레딧 환불 (구 P0) | ✅ 해결 | `refundDeepScanCredits` + `refund_credits` RPC (`src/app/api/deepscan/route.ts:45-80`) |
| 결제 인프라 (Toss) | ✅ 구조 완성 | 주문/승인/빌링/웹훅(재조회 검증)/cron tick/해지 — `docs/payments-toss.md` |
| 워치 백엔드 | ✅ 최근 착수 완료 | `watch_items`(#…01) · 감시 배치 `src/lib/watch/daily-batch.ts`(#253) · 알림 강도 3단계+게이팅(#254) · 텔레그램 채널(8/31) |
| 워치 상시 스케줄러 | ✅ (단일 인스턴스 전제) | `src/lib/watch/scheduler.ts` — 상주 프로세스 하루 1회, 스케일아웃 시 리더락 필요(코드 주석 명시) |
| 인증 (Supabase SSR+PKCE) | ✅ | `test.jaroo.kr` OAuth 실검증 (`docs/railway-migration-2026-08-14.md`) |
| 법률 기반 설계 | 🟡 프레임 완료, 전문가 검토 전 | `docs/capital-markets-law-review-2026-08-20.md` — 디스클레이머/약관/탈퇴 ✅, 청약철회 UI 문구 ⚠️, 변호사 검토 미정 |
| 배포 | 🟡 이원화 | `test.jaroo.kr`=Railway 단일 컨테이너(web+crawler, entrypoint) / `jaroo.kr`=OCI 1GB(OOM 이력, 폐지 예정) |
| 디자인 규칙 (초록·이모지·부호) | 🟡 대부분 수습 | `--jaroo-success` 토큰 중립색화(`globals.css:85`), 홈 이모지 제거 확인. 잔여 항목은 교차검증 §2 참조 |
| 클라이언트 에러 수집 | ✅ 최소 | `client_error_logs` 테이블 + `/api/client-errors` |

## 2. 갭 목록 — 출시까지 남은 것

### P0 — 출시 불가 (게이트/운영 기반)

| # | 갭 | 근거 | 작업 |
|---|---|---|---|
| G1 | **CI 게이트 RED — 최근 3회 전부 실패** | `gh run list` dev 브랜치 전부 `failure`. (a) eslint error `src/app/deepscan/page.tsx:138`(effect 내 동기 setState), (b) 깨진 테스트 `tests/deepscan-target-price-paths.test.mjs` — 존재하지 않는 `buildTargetPriceFanBands` import (#260 리팩터 잔해) | (a)(b) 수정 → dev CI green 복구. Railway 자동배포가 현재 **무검증**으로 일어나는 상태를 끝낸다 |
| G2 | **프로덕션 도메인 미이전** | `jaroo.kr`이 OCI(1GB, 빌드 OOM 이력)에 남아 있고 Railway는 test 서브도메인만 검증됨 | Railway 단일 컨테이너로 `jaroo.kr` 이전: DNS 전환, Supabase Auth redirect URI/URL 설정 갱신, Google Console redirect 등록, OCI 폐지. `http-origin-guard`/oauth runtime-origin (#…581955e) 재검증 |
| G4 | **결제 갱신 cron 미운영화** | `POST /api/payments/cron/tick`을 매일 호출하는 스케줄러 필요 — 미설정 시 구독 갱신·만료·past_due 재시도 자체가 안 됨 | Railway Cron 또는 GitHub Actions schedule로 KST 1회 tick 구성 + `PAYMENTS_CRON_SECRET` 주입 + 실패 알림 |
| G3 | **과금 스위치 미활성** | `authorizeDeepScanRun` — "결제 미설정 → 무료 통과"(`src/lib/payments/deepscan-entitlement.ts:15,30`). 워치 API·설정에 과금 게이팅 전무(`src/app/api/watch/route.ts`). **신규 유저 크레딧 0** — `spend_credits`는 balance row가 없으면 `false`(migration :199-201), 가입 그랜트 트리거 없음 | (1) Toss **실키** 전환 + 자동결제(빌링) 계약 — 계약 전엔 크레딧 팩만 팔거나 베타 공개. (2) 딥스캔 크레딧 게이팅 실활성. (3) 워치 = Pro 구독 게이팅 + **무료 체험 기간**(PM 보고서 A5 — 미결정). (4) 신규 유저 웰컴 크레딧/첫 분석 무료 정책 구현 |

### P1 — 출시 품질 (출시 주차 착수)

| # | 갭 | 근거 | 작업 |
|---|---|---|---|
| G6 | **에러 트래킹·온콜 부재** | Sentry 등 서버사이드 트래킹 없음. 클라이언트 에러만 DB 적재 | Sentry(또는 Railway 로그 알림) 도입 + `/api/health` 외부 uptime 모니터링(UptimeRobot 등) + 장애 시 텔레그램 알림 경로 |
| G7 | **감시 배치 단일 실행 보장** | `scheduler.ts` 주석: 다중 인스턴스 시 중복 실행, 리더락 필요 | 단일 컨테이너 유지를 출시 원칙으로 문서화하거나 `watch_daily_scans` unique + 리더락 구현 |
| G8 | **법률 검토 완결** | 자본시장법 프레임 문서가 "변호사 검토 전제" 명시. 청약철회 고지가 결제 UI에 미반영 | 금융 전문 변호사 리뷰 1회 + 결제 화면 청약철회 제한 문구 + 자문 표현 회피 어휘 정책 점검 |
| G9 | **출시 범위 결정 — 워치 UI** | 워치 = 목록 CRUD(`mypage/watchlist`, 179줄)+배치+알림. 대시보드/버틸근거 4질문/물타기 계산기는 미구현(PM 보고서 §4-3) | **결정 필요**: 최소 출시("구독하면 텔레그램 알림") vs 풀 스펙. 최소 출시 시 미구현 화면은 출시 노트에 명시 |
| G10 | **백업/복구 정책** | Supabase 백업 플랜, 크롤러 쿠키 만료 시 복구 절차 문서 없음 | Supabase PITR/백업 확인 + 복구 리허설 1회 + 쿠키 갱신 runbook |
| G11 | **ETF 실데이터 최소 편입** — 2026-09-15 MVP 범위 편입(사용자 결정) | /etf가 etfAnalysis 하드코딩 목업(KODEX 200 가짜 시세)을 프로덕션 서빙 중(test 200 실측). 선택 ETF 연결 PR #53 CLOSED(미머지)·기존 이슈 #23/#70 종료 후 **#265로 재계획**(2026-09-15). 크롤러는 ETF 감지만 하고 전용 분석 부재(`server.js:1025`) | **1단계(2~3일)**: 홈 ETF 카드→/etf 선택 연결(#53 재착수) + 실시간 시세·등락·보유손익 실데이터 + 미지원 탭 숨김(가짜 데이터 노출 제거). **2단계(+2~3일)**: 구성종목·리스크 탭 실데이터(소스 확정 — 2026-09-15 네이버 내부 API 실증, `docs/superpowers/specs/2026-09-15-etf-real-data-design.md` §3). 배당·비교 ETF는 계속 출시 후 |

### P2 — 출시 후 (명시적 제외)

- 딥스캔 81초→60초 타임라인, 판정 방식(투표 vs 점수) — PM 보고서 A2/A3 (이사님 결정)
- OpenDART/SEC 고도화 (#195/#196), 물타기 계산기, 워치 "버틸 근거" 풀 화면, ETF 고도화 잔여분(배당·비교 — G11 3단계)
- 전달문서(PM 문서) 갱신 — 승인 후

## 3. NOT in scope (이번 출시에서 안 함)

- 신규 기능 개발 (워치 풀 스펙 화면, 계산기, SEC 고도화, ETF 고도화 잔여분) — 단, ETF 실데이터 최소범위(G11 1·2단계)는 2026-09-15 MVP 편입 결정으로 예외
- 아키텍처 변경 (모놀리스 분리, 크롤러 별도 서비스화) — 단일 컨테이너 유지
- OCI 즉시 폐지 외 인프라 재설계

## 4. 마일스톤 (권장 순서)

1. **게이트 복구** (반나절): G1 → dev CI green. 검증: `gh run list` 최신 success.
2. **프로덕션 이전** (1~2일): G2 + G5 점검표 + G6 최소(Sentry+uptime). 검증: `jaroo.kr` 로그인→딥스캔 실측.
3. **과금 활성** (스프린트): G3 + G4 + G8 + **G11 ETF 1단계(병렬 착수)**. 검증: 테스트카드 실결제→크레딧 차감→실패 환불→구독 갱신 tick + /etf 실측(가짜 데이터 잔존 없음).
4. **출시 판정**: G7/G9/G10 + G11(1단계 완료·2단계 범위 판정) 마무리 + 위험 수용 결정 (이사님 게이트).

## GSTACK REVIEW REPORT

**리뷰 실행**: gstack autoplan 파이프라인(CEO → Design → Eng, 6원칙 자동결정) · 2026-09-14 · 대상: 본 플랜 + 실제 코드 대조

**보이스 가용성 — [single-model] 태그**: 독립 외부 리뷰 보이스 4종 시도가 전부 인프라/인증 사유로 실패해 1차 리뷰어(pi) 단독 수행.

- `scout`·`reviewer` 서브에이전트 — 호스트 런타임이 선언 도구 `read`를 제공하지 않음(tool contract 실패, lane infrastructure failure)
- `codex exec` — 토큰 갱신 실패: "refresh token was already used. Please log out and sign in again." → **운영 후속: codex 재로그인 필요**
- `claude-code` CLI — plan-mode 훅 충돌로 도구 호출 0건, 결과 없이 조기 종료

따라서 합의 테이블의 독립 보이스 칼럼은 N/A이며, 단일 critical 발견도 플래그된 것으로 읽는다(autoplan degradation matrix).

### CEO Phase — 전제 검증 (0A)

| 전제 | 판정 | 근거 |
|---|---|---|
| "출시 = 유료화 즉시 전환" | ⚠️ **TASTE → 최종 게이트** | 빌링 계약 전(테스트키)·법률 검토 전·신규 유저 크레딧 0. 대안: 1주 무료 공개(그랜트 크레딧) 후 과금 스위치. 잘못 고르면: 첫 유저가 결제 벽+자문업 경계에 동시 노출 |
| "jaroo.kr → Railway 이전이 출시 전제" | ✅ | 라이브 프로브: `test.jaroo.kr`만 `server: railway-hikari`(2026-09-14). OCI 1GB OOM 이력 |
| "CI green이 출시 게이트" | ✅ | dev 최근 3회 CI failure — 현재 Railway는 **무검증 배포** 중 |
| "워치 백엔드를 출시에 포함" | ✅ | `daily-batch.ts`·`levels.ts`·텔레그램 채널 실동작(#253/#254) |
| "법률 검토 전 유료화 보류" | ✅ | 자본시장법 프레임 문서가 전문 변호사 검토를 전제로 명시 |

### CEO Phase — 기존 코드 활용 맵 (0B)

| 출시 하위 문제 | 이미 존재하는 구현 | 새로 만들 것 |
|---|---|---|
| 크레딧 과금/환불 | `spend_credits`/`refund_credits` RPC, `authorizeDeepScanRun` | 없음(스위치만) |
| 구독 갱신 워커 | `/api/payments/cron/tick`(멱등·재조회 기반, past_due 7일 유예) | **외부 호출자 스케줄**(G4) |
| 감시/알림 | `daily-batch.ts`, `levels.ts`, `scheduler.ts`(instrumentation prod-only), 텔레그램 | 없음 |
| 에러 수집 | `client_error_logs` + `/api/client-errors`, `/api/health` | 서버사이드 트래킹·uptime(G6) |
| 법률 페이지 | `/terms`·`/privacy` + `legal-pages.test.mjs` | 결제 UI 청약철회 문구(G8) |

### CEO Phase — 드림 스테이트 (0C)

```
CURRENT: 진단 도구 무료 통과 · jaroo.kr(OCI)+test(Railway) 이원화 · CI RED · 결제 구조만 완성
   ↓ 본 플랜
PLAN:   jaroo.kr 단일 Railway · CI green · 과금 스위치 ON · cron 운영 · 최소 관측성 · 법률 클리어
   ↓ 12개월
IDEAL: 워치 풀 스펙(버틸 근거·물타기 계산기) · SEC 공시 고도화 · 지표 기반 개선 사이클 · 온콜 체계
```

### CEO Phase — 구현 대안 (0C-bis)

| 대안 | 판정 | 이유 |
|---|---|---|
| A. Railway 단일 컨테이너 유지 | **채택(자동결정)** | 이미 실검증, 이전만 남음. P3(실용) |
| B. web/crawler 서비스 분리 | 보류 | 출시 후 과제. 지금은 복잡도만 추가 |
| C. OCI 유지 | 기각 | OOM 이력·폐지 예정 문서화됨 |

### CEO Phase — 시간 분해 (0E)

- HOUR 1: G1 수정(lint 1건 + 깨진 테스트) → dev CI green
- HOUR 2~6: G5 env 체크리스트 문서 + G6 Sentry/uptime 최소셋 + G4 cron 호출자 구성
- DAY 2~3: G2 도메인 이전(DNS·Supabase redirect·Google Console) + 로그인→딥스캔 실측
- SPRINT: G3 과금 활성(빌링 계약 병렬) + G8 법률 + G7/G10
- 0F 모드 선택: **SELECTIVE EXPANSION**(autoplan 기본) — blast radius 내 <1d 작업은 흡수(G3에 E4 통합 등), 외부 범위는 P2/보류로 분리


### ENG Phase — 아키텍처 (§1)

```
[Railway 단일 컨테이너]
  next start :$PORT
    ├─ instrumentation.ts → watch scheduler (prod 전용, in-process)
    ├─ /api/deepscan ─→ authorizeDeepScanRun ─→ crawler 127.0.0.1:3040
    ├─ /api/payments/* ─→ Toss API (webhook=재조회 검증)
    ├─ /api/payments/cron/tick ←── [외부 스케줄러 필요 — 현재 부재] (G4)
    └─ Supabase (auth·RLS·RPC 원장)
  [외부 의존] Toss · DART · Finnhub · FMP · OpenRouter(LLM) · wisereport 쿠키
```

| ID | 발견 | 심각도 | 자동결정/조치 |
|---|---|---|---|
| E1 | in-process 스케줄러 — 레플리카 2 이상이면 알림 중복 발송. `watch_daily_scans` unique는 수집 dedup만 보장 | high | G7 채택: Railway 스케일 1 고정을 출시 원칙으로 문서화 + G6 모니터링에서 레플리카 수 경보 |
| E2 | cron tick 실패가 조용히 past_due로만 남음 — 갱신 실패 알림 없음 | high | G6에 통합: tick 응답의 `renewalFailed>0` → 운영자 텔레그램 알림 |
| E3 | 환불 실패 시 로그만 남고 runbook 없음(`수동 정산 필요`) | medium | G10 runbook에 절차 명시 |
| E4 | 신규 유저 balance row 부재 — `spend_credits`가 `false` 반환 → 게이팅 ON 시 첫 화면이 결제 벽 | high | G3에 흡수: 웰컴 크레딧 그랜트 또는 첫 분석 무료(게이트 결정) |
| E5 | `WISEREPORT_COOKIES_B64` 만료 시 크롤러 저하 — 복구 절차 부재 | medium | G10 runbook: 쿠키 갱신 절차 + 만료 전 알림 |

### ENG Phase — 테스트 다이어그램 (§3)

| 출시 경로 | 기존 커버 | 갭 → 결정 |
|---|---|---|---|
| 목표가 팬차트 경로(#260/#261) | **깨진 테스트**(존재하지 않는 `buildTargetPriceFanBands` import) | **즉시 수정(G1)** — export 변경을 따라가거나 삭제 후 재작성 |
| 딥스캔 크레딧 게이트 | `products.test.ts`(카탈로그)만 존재 | 게이트 분기 테스트 추가(미설정=무료 / 설정+0크레딧=거부 / Pro=통과) — G3와 함께 |
| 워치 배치·알림 | `levels.test.ts`만 존재 | `daily-batch` 이벤트 선정 경로 테스트 — 출시 주차 deferred(이유: 로직이 계산 기반 단순 경로, 이벤트 소스는 실측 검증됨) |
| 구독 갱신 cron | `payments-toss-foundation.test.mjs`(구조) | 갱신 시퀀스는 실측(테스트카드)으로 검증 — 마일스톤 3 검증 항목에 명시됨 |
| 법률/디스클레이머 | `legal-pages`·`global-investment-disclaimer` 테스트 존재 | 없음 ✅ |

테스트 플랜 아티팩트: `~/.gstack/projects/jaroo-mvp-v3/{branch}-test-plan-20260914.md` (동일 내용 저장)

### ENG Phase — 성능 (§4)

단일 컨테이너에서 LLM 동시 호출(`DEEPSCAN_*_CONCURRENCY`)이 딥스캔 지연(81초)의 주체 — 이미 타임아웃/소프트데드라인 env로 통제됨. 출시 병목은 CPU가 아닌 **크롤러 직렬 구간**이나 신규 접점이 아니므로 신규 작업 없음(1-2문장 기록 요건 충족).

### Failure Modes Registry

| 실패 모드 | 사용자 영향 | 감지 | 완화 |
|---|---|---|---|
| CI red 상태 배포 | 무검증 코드 서빙 | 현재 진행 중(G1) | G1 수정 + master required check |
| cron 미구성 | 구독 갱신/만료 정지 | 없음→이상없음 착각 | G4 + E2 알림 |
| wisereport 쿠키 만료 | 딥스캔 실패(환불은 정상 작동) | 실패율 급증 | E5 runbook |
| 스케줄러 중복 | 중복 알림(신뢰 훼손) | 사용자 신고 | E1 스케일 1 고정 |
| 환불 RPC 실패 | 크레딧 누수·불만 | 콘솔 에러만 | G6 Sentry + E3 runbook |

### Design Phase (압축 수행) / DX Phase (스킵)

- **Design**: UI 스코프 존재하나 교차검증(8/31)+PM 보고서가 1차 감사 완료. 본 리뷰가 재검증: 초록 토큰 중립화(`globals.css:85`), 홈 이모지 제거, 도넛 팔레트 무초록(`jaroo-donut-summary.tsx:7`) 확인. 잔여: 평단 소수점·부호 통일 표기 — 출시 주차 G9와 함께 마무리(작업량 소).
- **DX**: 스킵 — 소비자용 제품으로 개발자 대상 스코프 없음(autoplan 트리거 조건 미충족).

### 최종 결정 게이트 (사용자/이사님 결정 — 자동결정 불가 항목)

| # | 결정 | 옵션 | 추천 |
|---|---|---|---|
| D1 | 출시 방식 | A) 유료 즉시 B) 1주 무료 공개(웰컴 크레딧) → 빌링 계약·법률 클리어 후 과금 스위치 | **B** — 결제 벽+법률 리스크 동시 노출 회피, 유저 데이터 조기 확보 |
| D2 | 워치 UI 범위 (G9) | A) 최소(구독→텔레그램 알림) B) 풀 스펙(대시보드·버틸 근거·계산기) | **A** — 백엔드는 완성, 화면은 출시 노트에 명시 |
| D3 | 무료 체험 설계 (A5) | 웰컴 크레딧 N회 / 워치 체험 M일 | 딥스캔 3회 + 워치 7일 제안 — 수치는 이사님 확정 |
| D4 | CI 레드 기간 위험 수용 | 현재처럼 무검증 배포 지속 여부 | **거부** — G1 즉시 수정 |

### 보이스 합의 테이블

```
CEO DUAL VOICES — CONSENSUS TABLE:                    Claude  Codex   Consensus
  1. Premises valid?                                  ✅      N/A     [single-model]
  2. Right problem to solve?                          ✅      N/A     [single-model]
  3. Scope calibration correct?                       ✅(D1~D3 게이트) N/A  [single-model]
  4. Alternatives sufficiently explored?              ✅      N/A     [single-model]
  5. Competitive/market risks covered?                ⚠️ D1   N/A     [single-model]
  6. 6-month trajectory sound?                        ✅      N/A     [single-model]

ENG DUAL VOICES — CONSENSUS TABLE:                    Claude  Codex   Consensus
  1. Architecture sound?                              ✅(E1)  N/A     [single-model]
  2. Test coverage sufficient?                        ⚠️(§3)  N/A     [single-model]
  3. Performance risks addressed?                     ✅      N/A     [single-model]
  4. Security threats covered?                        ✅      N/A     [single-model]
  5. Error paths handled?                             ⚠️(E2~E5) N/A   [single-model]
  6. Deployment risk manageable?                      ✅(G2)  N/A     [single-model]
```

**STATUS: DONE_WITH_CONCERNS** — 분석·플랜 완성. Concerns: (1) 독립 보이스 전부 실패 → 단일 모델 리뷰( Codex 재로그인 권장). (2) D1~D4는 사용자 결정 대기. (3) CI 레드가 현재 진행형 리스크.

