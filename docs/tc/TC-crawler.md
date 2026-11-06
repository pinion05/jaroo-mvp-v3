# 크롤러 영역 TC 목록

- 기준: master @ 3f7276f / 실행일: 2026-11-05
- 실행 명령: `npm --prefix packages/crawler run test` (내부적으로 `node --test --test-concurrency=1 test/*.test.cjs`)
- 요약: **기존 446개 / 신규 5개 = 총 451개 / 전부 PASS** (기존 36개 테스트 파일 + 신규 4개 파일, 2026-11-05 전수 실행 확인)

> 참고: 과거 문서 등에 "138개"로 기록된 적이 있으나, master @ 3f7276f 기준 실측은 **446개**이다
> (`node --test` 서브테스트 단위 집계, `# tests 446`).
> 신규 TC는 커버리지 갭(테스트 파일이 없던 src 모듈)을 대상으로 작성했으며 전부 mock/stub 방식(외부 네트워크 0회)이다.

## 1. 기존 자동화 TC (파일/기능 단위 그룹핑, TC-CRW-001 ~ TC-CRW-036)

| TC ID | 제목 | 분류 | 우선순위 | 자동화(파일) | 테스트 수 | 결과 |
|---|---|---|---|---|---|---|
| TC-CRW-001 | 카탈로그 엔드포인트: 정의 등록·데이터소스 명시·구경로(/api/catalog) 404 | 엔드포인트 | P1 | test/catalog-endpoint.test.cjs | 3 | PASS |
| TC-CRW-002 | 현재가: 네이버/KRX/WiseReport 폴백 체인, 거래정지·52주·동시성 제한, KR/US 진단 분리 | 현재가 | P0 | test/current-quotes.test.cjs | 22 | PASS |
| TC-CRW-003 | DART corpCode 프리페치: 디스크 캐시 기록·실패 비던짐·미설정 스킵·스케줄러 토글 | 공시 | P1 | test/dart-corpcode-prefetch.test.cjs | 4 | PASS |
| TC-CRW-004 | DART 공시 Q4 벤치마크: 아티팩트 고정·프로비넌스 변조 감지·오라클/매니페스트 게이트 | 공시 | P1 | test/dart-disclosure-q4-development-benchmark.test.cjs | 8 | PASS |
| TC-CRW-005 | OpenDART 공시 수집: corp_code 매핑·013 빈결과·taxonomy 검증·문서 덤프/리소스 한도·페이지 실패 격리·corpCode 캐시(Supabase 원격 계층 포함) | 공시 | P0 | test/dart-filings.test.cjs | 22 | PASS |
| TC-CRW-006 | 딥스캔 canonical/ETF 위원회 엔드포인트: 등록·쿼리 조립·400/내부오류 페이로드 | 엔드포인트 | P0 | test/deepscan-endpoint.test.cjs | 6 | PASS |
| TC-CRW-007 | KR 딥스캔 admission: 전역/종목 한도 429·jobKey dedup·와치독 504·실행 비활성 503 | 딥스캔-KR | P0 | test/deepscan-kr-admission.test.cjs | 8 | PASS |
| TC-CRW-008 | KR 위원회 LLM 런타임: 타임아웃·모델 분리·축/멤버 렌더·ETF 프롬프트·마켓타이밍 서브셋·멤버 도메인 오너십 | 딥스캔-KR | P0 | test/deepscan-kr-committee-runtime.test.cjs | 14 | PASS |
| TC-CRW-009 | 정정 공시 typed 파서: 적대 매트릭스 분류·정규값/레이아웃 증거·게이트 라이프사이클·행 로컬 증거 | 딥스캔-KR | P1 | test/deepscan-kr-correction-table.test.cjs | 4 | PASS |
| TC-CRW-010 | OpenDART 분류 데이터셋: taxonomy 완전성·중복 코드 없음·ambiguous 라우팅·버전 노출 | 딥스캔-KR | P1 | test/deepscan-kr-disclosure-classification-dataset.test.cjs | 5 | PASS |
| TC-CRW-011 | 공시 이벤트 추출기: 대조 코퍼스·결정론 셰이프·identity repair(증권/전환사채/소송)·시맨틱 게이트·증거 감사 | 딥스캔-KR | P0 | test/deepscan-kr-disclosure-event-extractors.test.cjs | 70 | PASS |
| TC-CRW-012 | 이벤트 온톨로지: manifest 해시·튜플 검증·템플릿 시맨틱 동결·별칭 canonicalize·불변성 | 딥스캔-KR | P1 | test/deepscan-kr-disclosure-event-ontology.test.cjs | 8 | PASS |
| TC-CRW-013 | 공시 파이프라인: 정규화·분류·관계(정정 체인)·선별(중요도>최신)·덤프 예산·소스별 상태 구분 | 딥스캔-KR | P0 | test/deepscan-kr-disclosure-pipeline.test.cjs | 12 | PASS |
| TC-CRW-014 | 시간성 holdout: 봉인 코퍼스/수집기·예측 누출 차단·RFC3161 타임스탬프·필드 매칭·ECE 캘리브레이션·strict 게이트 | 딥스캔-KR | P1 | test/deepscan-kr-disclosure-temporal-holdout.test.cjs | 73 | PASS |
| TC-CRW-015 | 시간성 no-event 골드: disposition 필수·합의/조정·추정(abstention·hallucination) 엄격 처리 | 딥스캔-KR | P1 | test/deepscan-kr-disclosure-temporal-no-event.test.cjs | 8 | PASS |
| TC-CRW-016 | KR 증거 패킷: nested/flat 입력 조립·OpenDART 리스크 승격·FnGuide 소유·컨센서스 스냅샷 dedup/폴백 | 딥스캔-KR | P0 | test/deepscan-kr-evidence.test.cjs | 18 | PASS |
| TC-CRW-017 | 네이버 컨센서스 폴백: 합성 행 rows(추정기관·목표주가·날짜) 복원 → slim 재조립 후 analystCount/최고·최저 복원(PR #345/#343 실측 005930 회귀) | 딥스캔-KR | P0 | test/deepscan-kr-naver-consensus.test.cjs | 2 | PASS |
| TC-CRW-018 | KR 패키지 어댑터: ssh 커맨드 검증·stdout 파싱·재시도/타임아웃·auth 비재시도·원문 마스킹·캐시/스냅샷 | 딥스캔-KR | P0 | test/deepscan-kr-package-adapter.test.cjs | 19 | PASS |
| TC-CRW-019 | KR 스코어: 결정론 스코어링·패키지 존재 보너스 제거·고위험 공시 페널티·exit-now 경로 | 딥스캔-KR | P0 | test/deepscan-kr-score.test.cjs | 5 | PASS |
| TC-CRW-020 | 딥스캔 페이로드: 입력 정화·KR 시나리오·위원회 LLM/soft deadline·ETF 네이티브 패스·내부오류 페이로드 | 딥스캔-공통 | P0 | test/deepscan-payload.test.cjs | 23 | PASS |
| TC-CRW-021 | ETF 시장 위원회 스냅샷: 캐시 히트/부분 셸·동시 재계산 병합·stale 폴백·백오프 | 딥스캔-KR | P1 | test/etf-committee.test.cjs | 10 | PASS |
| TC-CRW-022 | KR ETF 프로필: 네이버 가격+스냅샷 병합·30개 보유 한도·KOSDAQ·ETN·일봉 수집·NotAnEtfError | ETF | P0 | test/etf-profile.test.cjs | 15 | PASS |
| TC-CRW-023 | KRX 클라이언트: 날짜 정규화(yyyy-mm-dd·yyyymmdd)·trigger batch 모드 전달 | KR데이터 | P1 | test/krx-client.test.cjs | 2 | PASS |
| TC-CRW-024 | LLM 모의: JAROO_LLM_MOCK 게이트·시드 PRNG·위원회 [MOCK] 결정론 응답·미설정 시 기존 게이트 유지 | LLM | P1 | test/llm-mock.test.cjs | 7 | PASS |
| TC-CRW-025 | major 엔드포인트: /api/major 등록·구 USD/KRW 소스경로 404 | 엔드포인트 | P1 | test/major-endpoints.test.cjs | 2 | PASS |
| TC-CRW-026 | US 시장지표(VIX): Yahoo chart JSON 파싱·Investing 스크래핑 제거 확인 | US데이터 | P1 | test/market-indicators.test.cjs | 2 | PASS |
| TC-CRW-027 | KR 회복 전망: 적자 보유 예측 엔벨로프·가격 히스토리 폴백·상태 어휘(available/unavailable/low_confidence) | 딥스캔-KR | P1 | test/recovery-forecast.test.cjs | 5 | PASS |
| TC-CRW-028 | Supabase 크롤러 캐시: 자격 미설정 비활성·read-through(stale 폴백·강제 갱신)·slim 페이로드 캐시·RPC/JSON 오류 처리 | 인프라 | P0 | test/supabase-crawler-cache.test.cjs | 13 | PASS |
| TC-CRW-029 | US ETF 프로필: polygon ohlc/details 정규화·quoteSummary 병합·Yahoo 차단 시 브라우저 폴백 | ETF | P1 | test/us-etf-profile.test.cjs | 7 | PASS |
| TC-CRW-030 | US 업스트림 소스: ownership-flow/OHLC 엔드포인트 등록·Form4/13D 요약·FMP OHLC 정규화 | US데이터 | P1 | test/us-upstream-sources.test.cjs | 3 | PASS |
| TC-CRW-031 | USD/KRW 환율: 24h 메모리/Redis 캐시·실패 미캐시·Redis 장애 fail-open·er-api 폴백 | 환율 | P0 | test/usd-krw-rate.test.cjs | 9 | PASS |
| TC-CRW-032 | WiseReport 아카이브: 현행 slim 라우트만 활성·구 라우트 404 | 엔드포인트 | P2 | test/wisereport-archived-endpoints.test.cjs | 2 | PASS |
| TC-CRW-033 | WiseReport ETF 스냅샷: HTML 파싱(ETF/ETN)·요청/파싱·바디 읽기 데드라인 | ETF | P1 | test/wisereport-etf.test.cjs | 4 | PASS |
| TC-CRW-034 | WiseReport 글로벌 slim v1.1: raw aggregate 셰이프·뉴스 dedup·peer group·엔드포인트 전환 | 엔드포인트 | P1 | test/wisereport-global-slim-v1.test.cjs | 11 | PASS |
| TC-CRW-035 | WiseReport KR slim v1.1/v1.2: slim 필드·krFacts 투자자 유동·ETF 미적용 표시·엔드포인트 | 엔드포인트 | P0 | test/wisereport-kr-slim-v1.test.cjs | 9 | PASS |
| TC-CRW-036 | WiseReport KR 크롤러 v1~v3: 헤더 압축·테이블 파싱·페이지 준비·스테이지 캡처·normalized/provenance·slim 재조립 | 크롤러 | P0 | test/wisereport-kr-v123.test.cjs | 11 | PASS |

## 2. 신규 자동화 TC (커버리지 갭 해소, TC-CRW-037 ~ TC-CRW-041)

| TC ID | 제목 | 분류 | 우선순위 | 자동화(파일) | 결과 |
|---|---|---|---|---|---|
| TC-CRW-037 | api-clients in-memory 캐시: TTL 적중/만료·민감 쿼리 파라미터 마스킹 | US공통 | P0 | test/tc-api-clients.test.cjs | PASS |
| TC-CRW-038 | api-clients 429 처리: Retry-After 재시도 회복·fmp 쿨다운 exhausted·쇼트서킷 | US공통 | P0 | test/tc-api-clients.test.cjs | PASS |
| TC-CRW-039 | finnhub 재무제표 정규화: US-GAAP concept→canonical 키·연간/분기 필터·metric 폴백 파생(earningsYield=1/pe) | US재무 | P0 | test/tc-us-financials.test.cjs | PASS |
| TC-CRW-040 | US 뉴스: polygon·finnhub 병합/제목 dedup·감성 스코어 0~1 정규화·WiseReport 본문 보강 | US뉴스 | P1 | test/tc-us-news.test.cjs | PASS |
| TC-CRW-041 | US 컨센서스: FMP 미설정 시 finnhub 폴백 조립·추천 분포→파생 투자의견·WiseReport peer/스냅 보강 | US컨센서스 | P1 | test/tc-us-consensus.test.cjs | PASS |

### TC-CRW-037 — apiFetch in-memory 캐시 (test/tc-api-clients.test.cjs)

- **사전조건**: `globalThis.fetch` 스텁(항상 `{value:1}` JSON 응답), `clearCache()`로 캐시 초기화. 외부 네트워크 호출 없음.
- **시나리오**:
  1. 동일 URL(secEdgar, `apiKey=sk-secret-123` 포함)로 `cacheTTL: 60s` 지정 호출 2회
  2. `getCacheStats()`로 캐시 키 검사
  3. `cacheTTL: 30ms` 호출 후 60ms 대기 뒤 재호출
  4. `clearCache()` 후 `getCacheStats().size` 확인
- **기대결과**: 최초 호출만 fetch(TTL 내 재호출은 캐시 적중); 캐시 키의 `apiKey`는 `apiKey=%5Bredacted%5D`로 마스킹되고 원본 키 값은 통계에 미노출; TTL 만료 후에는 재fetch(총 2회); clear 후 size 0.
- **검증방법**: 스텁 fetch 호출 카운터로 URL별 fetch 횟수 단정, `getCacheStats().keys` 문자열 검사.

### TC-CRW-038 — apiFetch 429 처리 (test/tc-api-clients.test.cjs)

- **사전조건**: `globalThis.fetch` 스텁(호스트 단위 분기). 외부 네트워크 호출 없음.
- **시나리오**:
  1. finnhub: 1회차 429(Retry-After: 0) → 2회차 200
  2. fmp: 429 응답(쿨다운 프로바이더) → `getProviderStatus('fmp')` 확인 → 쿨다운 중 다른 경로 재호출
- **기대결과**: finnhub은 Retry-After 대기 후 재시도로 데이터 회복(정확히 2회 호출); fmp는 429 즉시 null(재시도 없음) + `exhausted: true`·`available: false`·`cooldownRemainingMs > 9분`; 쿨다운 중 재호출은 fetch 0회로 즉시 null.
- **검증방법**: 반환값·스텁 호출 수·provider 상태 3중 단정.

### TC-CRW-039 — finnhub 재무제표/지표 정규화 (test/tc-us-financials.test.cjs)

- **사전조건**: 동적 import 전 `FINNHUB_API_KEY` 설정 + `FMP_API_KEY`/`POLYGON_API_KEY` 삭제(모듈이 로드 시점에 키를 캡처하므로 환경 고정 필요). finnhub 2종 엔드포인트(/api/v1/stock/financials-reported, /api/v1/stock/metric)만 스텁.
- **시나리오**: 연간 5개 + 분기 2개 행 입력 → `getFinancialStatementsFinnhub` annual/quarterly 조회 → `getKeyMetrics`·`getFinancialRatios` 조회(FMP 미설정 → finnhub metric 폴백).
- **기대결과**: annual은 quarter===0 행만 최대 4개(입력 순서 유지), `us-gaap_Revenues/NetIncomeLoss/OperatingIncomeLoss/Assets/Liabilities/StockholdersEquity/NetCashProvidedByUsedInOperatingActivities`가 revenues·net_income·operating_income·total_assets·total_liabilities·total_equity·operating_cash_flow로 매핑, 연간 fiscalPeriod 'FY'/분기 'Qn'; metric 폴백은 marketCapitalization→marketCap, peTTM→peRatio, pbQuarterly→pbRatio, roeTTM→roe 등 파생 및 `earningsYield = 1/pe`; 네트워크는 URL 캐시 덕에 financials-reported·metric 각 1회만 발생.
- **검증방법**: 필드별 값 단정 + 스텁 fetch 호출 목록 비교.

### TC-CRW-040 — US 뉴스 병합/감성/WiseReport 보강 (test/tc-us-news.test.cjs)

- **사전조건**: polygon·finnhub 키 설정(임의 테스트 값), finnhub company-news/news-sentiment와 polygon 뉴스 엔드포인트 스텁. 보강 트리거용 `opts.wisereportRawData`(news-company-1 aux) 전달 — `crawlWiseReportGlobal` 네트워크 호출 차단.
- **시나리오**: polygon 2건(1건은 description 없음) + finnhub 2건(1건은 polygon과 제목 중복) 입력으로 `getUSNews('AAPL', 10, {wisereportRawData})` 실행.
- **기대결과**: 중복 제거로 총 3건(polygon 우선, finnhub 보완), polygon/funnhub 각 정규화 필드(source·url·image·publishedAt ISO 변환) 유지; 요약 공백 기사는 WiseReport 원문(HTML 제거)으로 summary/bodyText 채움 + `textSource: 'wisereport-global'`·`textStatus: 'augmented'`·meta.newsText matched/augmented 카운트; 원본 publishedAt은 덮어쓰지 않음; 감성은 `(bullish-bearish+1)/2 = 0.75` 정규화 + meta.sentiment.status 'ok'; 외부 호출은 스텁한 3회뿐.
- **검증방법**: 기사 배열·보강 메타·감성 값 단정 + 스텁 fetch 호출 목록(hostname+path) 정확 일치.

### TC-CRW-041 — US 컨센서스 finnhub 폴백 + WiseReport 보강 (test/tc-us-consensus.test.cjs)

- **사전조건**: `FINNHUB_API_KEY` 설정, `FMP_API_KEY`/`POLYGON_API_KEY` 삭제(FMP 전용 데이터는 키 게이트로 즉시 null). finnhub 3종(recommendation/earnings/profile2) 스텁.
- **시나리오**: `getUSConsensus('AAPL')` 전체 흐름 실행 → 반환값에 `augmentUSConsensusWithWiseReport(result, wisereportRawData)`(compare-list·snap-financial-summary aux 픽스처) 적용.
- **기대결과**: 프로필은 finnhub profile2 폴백(source 'finnhub-profile2'); 추천 분포 스냅샷은 최신 행 기준(총 5명); 파생 투자의견은 `(2·5+2·4+1·3)/5 = 4.2 → 'Buy'`·스케일 1~5; 실적은 finnhub earnings 히스토리 폴백; FMP 전용 consensus/estimates는 null + meta 'unavailable'; 프로필·컨센서스가 이미 있으면 WiseReport 자동 보강은 not_requested(네트워크 0회); 보강 시 기존 프로필 값을 유지한 채 공백 필드(price)만 채우고(filledFields ['price']), compare-list → peers 2종목 매핑(TICKER/PROPER_NAME/EX_NM/CMP_CD) + meta peers/references 'ok'.
- **검증방법**: 컨센서스 조립 결과 필드별 단정 + 보강 함수 순수 입력/출력 단정 + 스텁 fetch 호출 목록(전부 finnhub) 검증.

## 3. 커버리지 갭 분석 결과 (2026-11-05, master @ 3f7276f)

### 이번에 갭을 해소한 모듈
- `src/crawlers/api-clients.js` (공통 fetch 래퍼: US 전 크롤러의 관문) → TC-CRW-037/038
- `src/crawlers/us-financials.js` (US 재무제표/지표) → TC-CRW-039
- `src/crawlers/us-news.js` (US 뉴스/감성) → TC-CRW-040
- `src/crawlers/us-consensus.js` (US 컨센서스/애널리스트) → TC-CRW-041

### 갭 힌트 확인 결과
- **PR #343(네이버 컨센서스 폴백 복원)**: 관련 테스트 `deepscan-kr-naver-consensus.test.cjs`(2건)와 `deepscan-kr-evidence.test.cjs`의 폴백 브로커 캐리 회귀 TC(3건)가 **이미 master에 존재**하여 신규 작성하지 않았음(TC-CRW-016/017에 포함).

### 남은 미직접 테스트 모듈 (참고 — 이번 범위 외)
- `src/crawlers/stock-data.cjs`, `src/crawlers/investor-volume.cjs` (krx-client 위임 얇은 래퍼)
- `src/crawlers/us-market-indicators.js` (Yahoo/Point 폴백 지표 — VIX 파싱만 market-indicators 테스트로 부분 커버)
- `src/crawlers/us-sec-filings.js`, `src/crawlers/us-stock-report.js`, `src/crawlers/wisereport-global.js`(서버 라우트 테스트로 간접 커버)
- `src/services/http-error.js` (8줄 단순 에러 클래스)
- `src/services/deepscan-kr-disclosure-temporal-protocol.js` (temporal-holdout/no-event 테스트가 간접·전면 커버)

## 4. 실행 결과 및 버그 후보

- **실행**: `npm --prefix packages/crawler run test` → `# tests 451 / # pass 451 / # fail 0` (2026-11-05, 소요 약 36초)
- **버그 후보**: 없음(신규 TC 5건 전부 통과). 테스트 작성 과정에서 관찰된 동작은 모두 의도된 graceful degradation으로 판단:
  - polygon/fmp/finnhub는 API 키 미설정 시 fetch 없이 null 반환(호출측 `.catch(() => null)`과 결합한 우아한 저하 설계)
  - finnhub 429는 Retry-After 재시도, fmp는 10분 쿨다운 후 null — 프로바이더별 차등 전략은 문서화된 동작과 일치
