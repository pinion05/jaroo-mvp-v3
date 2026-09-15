# /etf ETF 실데이터 최소 편입 — 설계 (G11 · 이슈 #265)

- **작성일**: 2026-09-15
- **상태**: 승인 대기 (사용자 설계 승인 완료 — 스펙 리뷰 대기)
- **추적**: 런치플랜 G11 (`docs/plans/2026-09-14-mvp-launch-plan.md`) · GitHub #265 (선행: #23/#70 종료, PR #53 미머지)
- **공수**: G11 합계 4~6일 — 1단계 2~3일 + 2단계 2~3일 (소스 실증으로 2단계 상한 축소). 전체 MVP 잔여 공수 밴드는 6~10일 유지

## 1. 배경

`/etf`는 `etfAnalysis` 하드코딩 픽스처(`src/lib/jaroo-data.ts:452`, KODEX 200 가짜 시세)를 데이터 획득 계층 없이(props·API·store 0건) 직접 렌더한다. 프로덕션에서 서빙 중(`test.jaroo.kr/etf` 200 실측)이며 noindex도 없어 가짜 데이터 노출 리스크(감사 A1 high)다. 2026-09-15 결정으로 MVP 범위에 편입됐다.

## 2. 승인된 결정 사항

| # | 결정 | 내용 |
|---|---|---|
| D1 | 미지원 블록 | **"데이터 준비 중" 플레이스홀더** 유지 (숨김/제거 아님) — 2단계에서 실데이터로 교체 |
| D2 | 계획 범위 | **1+2단계 통합** 계획 |
| D3 | 시장 범위 | **한국 상장 ETF만** (kospi/kosdaq). 미국 ETF는 현행 주식 딥스캔 경로 유지, 3단계(출시 후) |
| D4 | AI 위원 | **제외**. 시나리오 확률 블록은 플레이스홀더. 근거: ETF는 애널리스트 커버리지 대상이 아니어서 목표가·컨센서스 원천 데이터가 없음(2026-09-15 라이브 실증) |
| D5 | 접근법 | **A — 딥스캔 플로우 재사용** (canonical query·타깃 하이드레이션·quotes fetch·로딩 핸드오프·뷰모델 패턴. AI 파이프라인 제외) |
| D6 | 데이터 소스 | **네이버 내부 JSON API 확정** (2026-09-15 CDP 조사+curl 실증). 2단계 소스 조사 spike는 불필요해짐. 기본정보 블록을 1단계로 승격 |

## 3. 라이브 실증 근거 (2026-09-15, 로컬 크롤러 + CDP 조사)

| 항목 | 결과 |
|---|---|
| ETF 실시간 시세 | `/api/source/krx-polygon-fmp/market/quotes/current?codes=069500` → 104,275원 `ok` (naver-finance). 주식·ETF 공용 파이프라인 |
| ETF 컨섴서스/목표가 | slim v1.2 `krFacts.consensus` 전체 `missing` (targetPrice·analystCount·recommendation 전무, 3/14 페이지). 대조 주식 005930: targetPrice 488,409 `present`·애널리스트 12명 |
| ETF 재무/밸류에이션 | 설계대로 `not_applicable` 처리 확인 |
| 구성종목 | `stock.naver.com/api/domestic/detail/{code}/ETFComponent` → KODEX 200 **202개** (종목명·비중·ISIN·기준일), 인증 없음 curl 200 |
| 기본정보 | `…/detail/{code}/price` (총보수 0.15%·순자산 24.4조·운용사·iNav/괴리율) + `…/detail/{code}/detail?codeType=ETF` (기준지수 "코스피 200") |
| ETF 유니버스 | `…/api/stockSecurity/etfs/v2/domestic` 페이지네이션 1,171개 |
| 일봉 | `fchart.stock.naver.com/sise.nhn?symbol=…&timeframe=day&count=N&requestType=0` (XML, requestType 필수) / `api.stock.naver.com/chart/domestic/item/{code}/day` (JSON) — ETF 코드 동작 |

## 4. 아키텍처

```
[홈] 한국 ETF 홀딩 카드 (jaroo-home-data — 현재 actionHref null)
  └─ actionHref: /etf?code=…&name=…&shares=…&averagePrice=…&evaluationAmount=…
     (canonical query 빌더 재사용 — deepscan-canonical.ts 패턴)
     └─ 딥스캔 로딩 핸드오프 (deepscan-navigation.ts — 이미 '/etf' 지원)
[/etf — 'use client' 유지]
  ├─ 타깃 복원: query + readAppliedHomePortfolio() 하이드레이션
  │   + 한국 ETF 가드 (kospi/kosdaq 외 코드 거부)
  ├─ [1단계] 시세: /api/quotes/current?codes=… (fetchLoadingProxyJson 재시도 재사용)
  │          기본정보: 크롤러 etf-profile 수집기 → /api/etf/profile 프록시
  ├─ [2단계] 구성종목: 동일 etf-profile (ETFComponent)
  │          리스크 지표: kr-daily-price-history (일봉) 산출
  │          구성종목 가중 목표가: 구성 비중 × krFacts.consensus.targetPrice (주식 파이프라인)
  └─ 뷰모델 매퍼: 수집 데이터 → etfAnalysis "모양"의 뷰모델 → 기존 JSX 그대로 소비
[크롤러] etf-profile 수집기 — 네이버 내부 API 경량 HTTP fetch (Playwright 불필요)
```

## 5. 블록별 데이터 매핑

| 화면 블록 | 1단계 | 2단계 | 이후(3단계) |
|---|---|---|---|
| 히어로: 시세·등락·보유손익 | **실데이터** (quotes + holding) | | |
| 기본정보: 운용사·기준지수·총보수·순자산·NAV | **실데이터** (etf-profile, D6 승격) | | |
| 수익 지표(1M/3M/1Y 등) | 플레이스홀더 | **실데이터** (일봉 산출) | |
| 시나리오 확률·목표가 | 플레이스홀더 (원천 부재 실증) | **구성종목 가중 목표가**로 대체 표기 ("구성종목 컨섴서스 기준 예상 레벨" — 목표가 아님을 명시) | AI 위원(별도 스펙) |
| 구성종목 테이블 | 플레이스홀더 | **실데이터** (ETFComponent) | |
| 섹터 비중 | 플레이스홀더 | 구성종목 × 섹터 매핑 **가능 시** 실데이터 (미해결 과제 — 매핑 소스 없으면 플레이스홀더 유지, #265 기록) | |
| 리스크 지표(변동성·52주 등) | 플레이스홀더 | **실데이터** (일봉 산출) | |
| 배당·비교 ETF | 플레이스홀더 | 플레이스홀더 | 실데이터 |

## 6. 컴포넌트 단위

**신규**
- `src/lib/etf/etf-view-model.ts` — 뷰모델 타입(`EtfTab`·`EtfScenarioTone`·`EtfValueTone`을 jaroo-data.ts에서 이동) + 실데이터→뷰모델 매퍼. `etfAnalysis` 픽스처는 삭제
- `src/lib/etf/etf-target.ts` — query/포트폴리오 타깃 복원 + 한국 ETF 가드
- `src/components/etf-preparing-card.tsx` — "데이터 준비 중" 플레이스홀더
- `src/app/api/etf/profile/route.ts` — 크롤러 etf-profile 프록시 (세션 필수는 아니나 레이트리밋 포함 — B2 교훈)
- 크롤러 `etf-profile` 수집기 — 네이버 내부 API fetch, 404/스키마 변경 감지 + KIS 폴백 로직 포함

**수정**
- `src/app/etf/page.tsx` — 픽스처 직접 참조 제거, 실데이터 렌더 + 로딩/에러/빈 상태
- `src/lib/jaroo-home-data.ts` — 실데이터 한국 ETF 카드에 `/etf` canonical query 액션 부여
- `src/lib/jaroo-data.ts` — `etfAnalysis`·`sectorWeights` dead export 제거

## 7. 오류 처리

- 시세/프로필 실패 → 홈과 동일한 status-union 에러카드 (부분 실패 시 사용 가능 블록만 렌더)
- query 없는 직접 접근·비한국 ETF 코드 → "홈에서 ETF를 선택해주세요" 빈 상태 (홈 CTA)
- 게스트(보유 없음) → 시세·기본정보만 표시, 보유손익 블록 숨김
- 네이버 내부 API는 비공개 — 스키마 변경/404 감지 시 플레이스홀더 폴백 + 운영 로그. KIS 공식 API(키 발급 필요)를 코드 수준 폴백 후보로 문서화만
- 일봉 부족(신규 상장 등) → 리스크 지표 블록 플레이스홀더

## 8. 테스트

- 유닛: 뷰모델 매퍼(quotes·profile·holding 조합·부족 데이터), 타깃 복원+가드, 가중 목표가 계산
- 수집기: 네이버 API 응답 스키마 검증 + 변경 감지 분기(모킹)
- E2E: 홈 ETF 카드 → /etf 실데이터 표시, 가짜 데이터 잔존 없음(렌더 결과에 픽스처 수치 미포함 검증), 게스트 빈 상태, 비한국 코드 거부
- 실측 체크리스트: quotes(069500)·ETFComponent·일둥 재확인 (2026-09-15 실증 재현)

## 9. NOT in scope

- AI 위원 분석(한국 ETF 딥스캔) — 컨텍스트 덤프 신규 설계가 선행. 참고: `US_ETF_AGENT_META` 축 교체 구조 (`build-payload.ts:1357`)
- 미국 ETF (kind 감지 개선 포함)
- 배당·비교 ETF 정보
- /sharecard 처리 (D6 결정: 404 제거 — 별도 작업)
- 워치 연동(ETF 감시) — 출시 후

## 10. 참고

- 종합 결론: `docs/출시준비-최종결론-2026-09-15.html` §5 G11
- 소스 조사 상세(2026-09-15 CDP): 네이버 내부 API 4종·KIS `inquire-constituent-list`(TR FHPG01330200)·KRX WAF 차단·data.go.kr 시세만
- 라이브 스택: `npm run dev` (web 3000 + crawler 3040)
