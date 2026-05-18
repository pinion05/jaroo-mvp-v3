# DeepScan KR Real-AI v1 Plan

## Metadata
- Scope repo: `/home/pinion/worktrees/jaroo-v3-monorepo-foundation`
- Branch: `feat/deepscan-canonical-payload`
- Date: 2026-04-15
- Status: planning-first, execution-ready

## 1. 고정 결정
- v1 범위는 KR 종목(`code`)만 처리한다.
- canonical contract는 그대로 유지한다.
- crawler가 business composition을 계속 소유한다.
- app route는 proxy/cache only, page는 canonical payload render only.
- `hero / committee / insights / strategy / sellNow / portfolioSimulation` 6블록 모두 real output을 목표로 구현한다.
- 맥북 패키지 입력 경계는 `stockCode`, `holdingQty`, `avgPrice` 3개다.
- OpenRouter key 재사용, 모델은 `deepseek/deepseek-v4-flash` 계열을 사용한다.
- 점수/상태/blocked 판정은 crawler 코드가 결정하고, LLM은 텍스트 생성만 담당한다.

## 2. 추천 경계
### 2.1 package 재사용 범위
맥북 `jaroo-report-pakage`는 그대로 숫자 truth source로 쓰지 않고 아래만 재사용한다.
- 보고서 생성 패턴
- 9인 위원 페르소나/프롬프트 구조
- chairman 스타일의 전략 문장 구조
- 보유수량/평단 입력 인터페이스

즉 package의 LLM 산출물은 `문장/요약/근거 표현` 용도로만 쓰고, canonical numeric score는 로컬 crawler 코드가 다시 계산한다.

### 2.2 sourceRefs 기본 정책
기본 정책은 보수적으로 간다.
- quantitative/source-of-truth ref: 로컬 crawler 증거만 사용
  - KR aggregate/slim pages
  - `/api/quotes/current` 기반 현재가
  - 입력 holding 값
- package 결과는 `system` 성격의 derived-analysis ref로만 추가 가능
- package가 숫자를 말해도 canonical score의 직접 sourceRef로 채택하지 않는다

권장 표현:
- `report`: WiseReport/FnGuide page refs
- `market`: current quotes / relative return / style analysis
- `holding`: qty / avgPrice / evaluationAmount
- `system`: remote package derived text, local score engine version

## 3. 목표 아키텍처
### 3.1 새 service 분리
1. `packages/crawler/src/services/deepscan-kr-evidence.js`
   - KR aggregate/slim/current quote 추출
   - canonical block에서 쓸 normalized evidence packet 생성

2. `packages/crawler/src/services/deepscan-kr-package-adapter.js`
   - SSH로 맥북 package 호출
   - 입력: `stockCode`, `holdingQty`, `avgPrice`
   - 출력: `reportContent`, `boardAnalysis`, `marketScoreSnapshot`, `listingMarket`, `timestamp`
   - timeout / retry / cache 포함

3. `packages/crawler/src/services/deepscan-kr-score.js`
   - deterministic subscore/axis score/hero score/sellNow decision/portfolioSimulation score 계산

4. `packages/crawler/src/services/deepscan-kr-copy.js`
   - evidence packet + precomputed score + package text를 받아 canonical text field 생성
   - OpenRouter 호출 또는 package output reuse 정리

5. `packages/crawler/src/services/deepscan-payload.js`
   - 위 4개 결과를 조합해 최종 `JarooDeepScanPayload` assemble

### 3.2 권장 실행 흐름
1. input normalize
2. 필수 입력 검사
3. KR local evidence 수집
4. holdingQty/avgPrice가 있으면 remote package 호출
5. deterministic score 계산
6. text field 생성
7. block별 `blockState/sourceRefs/fallback/error` 채움
8. raw canonical payload 반환

## 4. KR evidence inventory
### 4.1 로컬 crawler source
- `getCrawl(code)` KR aggregate
- `buildWiseReportKrSlimPayloadV11()` 결과 page set
- `getCurrentQuotes({ codes: [code] })`
- input holding
  - `shares`
  - `averagePrice`
  - `evaluationAmount` (있으면 사용, 없어도 진행)

### 4.2 KR aggregate pages
- `company-overview`
- `financial-analysis`
- `investment-indicators`
- `consensus`
- `shareholding`
- `recent-reports`
- `fnguide-finance`
- `relative-return`
- `opinion`
- `style-analysis`

### 4.3 remote package output
- `reportContent`
- `boardAnalysis.boardOpinions`
- `boardAnalysis.boardMarketEvaluation`
- `marketScoreSnapshot`
- chairman/prompt 스타일 문장 자산

## 5. 블록별 설계
## 5.1 hero
### deterministic inputs
- committee 3축 최종 점수
- current quote
- target price / opinion / report freshness

### deterministic formula
- `heroScore = round(businessQuality*0.40 + marketTiming*0.35 + positionFit*0.25)`
- hard penalty
  - current quote missing: `-8`
  - consensus/opinion 둘 다 없음: `-6`
  - report freshness stale: `-4`
- `scoreLabel = "{score} / 100"`
- `statusText`는 score band로 결정
  - `>= 67`: 우세
  - `55~66`: 보통
  - `<55`: 경계

### LLM responsibility
- `headline`
- `body`
- headline/body는 precomputed score와 top facts만 사용
- 새 숫자 생성 금지

### sourceRefs
- `report`: `consensus`, `opinion`, `recent-reports`
- `market`: `quotes/current`
- `system`: `deepscan-kr-score@v1`

## 5.2 committee
committee는 3축 × 각 3명 구조를 유지한다.

### axis mapping
1. `Business Quality`
   - local inputs: `financial-analysis`, `investment-indicators`, `fnguide-finance`, `shareholding`
   - member mapping:
     - A 가치 분석가
     - B 성장 전략가
     - C 재무 감사인
   - score rule:
     - profitability subscore 45%
     - valuation subscore 35%
     - ownership/stability subscore 20%

2. `Market Timing`
   - local inputs: `relative-return`, `style-analysis`, `consensus`, `recent-reports`, `quotes/current`
   - member mapping:
     - D 차트 마스터
     - E 수급 추적자
     - F 모멘텀 스캐너
   - score rule:
     - trend subscore 40%
     - consensus momentum 35%
     - price location 25%

3. `Position Fit`
   - local inputs: `holding`, `quotes/current`, `consensus/opinion`
   - package text can be used for explanation only
   - member mapping:
     - G 심리 분석
     - H 산업 전문가
     - I 이벤트 추적
   - score rule:
     - avgPrice gap 45%
     - upside/downside buffer 30%
     - holding data completeness 25%

### note
package의 `boardOpinions.score`는 canonical numeric truth로 직접 쓰지 않는다. 대신 member `reason` text draft나 wording 참고용으로만 쓴다.

### sourceRefs
- 각 axis는 사용한 page를 직접 적는다.
- `Position Fit`은 반드시 `holding` ref 포함.

## 5.3 insights
### deterministic inputs
- `company-overview`
- `recent-reports`
- `consensus`
- `opinion`
- `shareholding`
- `relative-return` / `style-analysis` 중 변화가 큰 포인트

### deterministic selection rule
- code가 5~7개의 insight 후보를 뽑고 우선순위를 정한다.
- 우선순위 축
  - 최신성
  - 수치 변화폭
  - 전략 관련성
- 최종 payload는 3개 아이템 고정 추천.

### LLM responsibility
- 각 item의 `title`, `body`
- `sectionLabel`
- `summaryTags`

### sourceRefs
- 각 item에 직접 연결된 page만 남긴다.
- package derived text는 supplemental `system` ref만 추가 가능.

## 5.4 strategy
### deterministic inputs
- hero/committee score
- current quote
- target price / opinion
- recent report freshness
- relative return / style analysis

### deterministic rule
- `weekSignalTone`, `weekBadgeText`, `scenarioLabel`, `scenarioProbability`, `scenarioPeriod`는 코드가 결정
- probability bucket
  - `70%`: favorable
  - `60%`: mildly favorable
  - `50%`: mixed
  - `35%`: cautious
  - `20%`: adverse
- bucket 결정 조건
  - hero score
  - current→target upside
  - report freshness
  - momentum quality

### LLM responsibility
- `scenarioCondition`
- `scenarioDetails[]`
- `otherScenarios[]`의 문장
- 단, probability 숫자는 코드가 넣고 문장만 생성

### sourceRefs
- `report`: `opinion`, `consensus`, `recent-reports`
- `market`: `quotes/current`, `relative-return`, `style-analysis`
- `system`: score engine version

## 5.5 sellNow
### runtime gating
- `holdingQty` 또는 `avgPrice`가 없으면 `blocked`
- complete input일 때만 real output

### deterministic inputs
- holding qty / avgPrice / evaluationAmount
- current quote
- target price / opinion
- hero score / positionFit score

### deterministic outputs
- `rows`
  - 보유 수량
  - 평균 단가
  - 현재가
  - 평가 손익
  - 목표가
  - upside/downside gap
- decision band
  - `hold`
  - `trim`
  - `exit-watch`
  - `exit-now`
- rule skeleton
  - hero < 45 and upside <= 0 => `exit-now`
  - hero 45~54 or positionFit < 45 => `exit-watch`
  - hero 55~66 and upside positive => `trim` or `hold`
  - hero >= 67 and upside positive => `hold`

### LLM responsibility
- `realizedText`
- rows는 LLM이 수정 금지

### sourceRefs
- `holding`
- `market`: `quotes/current`
- `report`: `opinion` / `consensus`

## 5.6 portfolioSimulation
### v1 semantics
진짜 멀티자산 포트폴리오 시뮬레이터가 아니라, 단일 포지션 기준의 `portfolio impact proxy`로 정의한다.

### 이유
현재 canonical input에는 전체 portfolio context가 없어서 진짜 before/after diversification 계산은 불가능하다.
그래서 v1에서는 이 포지션을 `유지 / 축소 / 종료`할 때의 포지션 리스크 건강도 변화를 proxy 점수로 보여준다.

### deterministic inputs
- hero score
- positionFit score
- holding qty / avgPrice
- current quote
- sellNow decision band

### deterministic outputs
- `beforeScore`
  - 현재 포지션 리스크 건강도
- `afterScore`
  - 권장 action 적용 후 리스크 건강도
- `deltaLabel`
  - `after - before`

### deterministic rule example
- `beforeScore = round(positionFit*0.7 + hero*0.3)`
- action별 delta
  - `hold`: `+0 ~ +3`
  - `trim`: `+4 ~ +9`
  - `exit-watch`: `+6 ~ +12`
  - `exit-now`: `+8 ~ +15`
- 최종 점수는 `0~100` clamp

### LLM responsibility
- `caption`
- proxy simulation 성격을 과장 없이 설명

### sourceRefs
- `holding`
- `market`
- `report`
- `system`: `portfolio-proxy-v1`

## 6. runtime blocked/error 정책
### 6.1 input invalid
- `code`/`ticker` 둘 다 없음: payload 400 + canonical invalid payload

### 6.2 partial input
- `code`는 있지만 `holdingQty/avgPrice` 없음
  - `hero`, `committee`, `insights`, `strategy`: `ok`
  - `sellNow`, `portfolioSimulation`: `blocked`

### 6.3 upstream/package failure
- local KR aggregate 실패: 영향 블록 `error`
- current quote 실패: `hero/strategy/sellNow/portfolioSimulation` 감점 또는 `error`
- remote package 실패:
  - numeric score는 계속 local deterministic으로 생성 가능
  - text field는 local fallback prompt/template로 축소 생성
  - payload 전체를 죽이지 말고 block별 `fallback.used=true`로 닫는다

## 7. 구현 task 순서
### Task A. package adapter 추가
- 새 service: `deepscan-kr-package-adapter.js`
- SSH invocation + stdout JSON
- timeout/retry/cache
- raw package output snapshot 저장

### Task B. KR evidence extractor 추가
- 새 service: `deepscan-kr-evidence.js`
- aggregate/slim/current quote/holding normalize
- `topFacts`, `topRisks`, `sourceCoverage`, `missingSources` packet 생성

### Task C. deterministic score engine 추가
- 새 service: `deepscan-kr-score.js`
- subscore 함수
- axis score 함수
- hero score 함수
- sellNow decision 함수
- portfolio proxy simulation 함수

### Task D. text generator 추가
- 새 service: `deepscan-kr-copy.js`
- OpenRouter `deepseek/deepseek-v4-flash` 호출
- strict JSON output
- 입력은 raw source가 아니라 evidence packet + precomputed score만 사용

### Task E. canonical composer 교체
- `buildJarooDeepScanPayload()` 내부 baseline placeholder 제거
- KR path real composition 연결
- block별 `sourceRefs/fallback/error` 조립

### Task F. endpoint/query 정리
- `/api/deepscan` query를 package-adapter friendly 하게 유지
- 내부적으로는 `shares -> holdingQty`, `averagePrice -> avgPrice` 변환
- 필요 시 evaluationAmount는 optional keep

### Task G. test 추가
1. contracts/service
   - score engine unit tests
   - sellNow gating tests
   - portfolio proxy tests
2. crawler route
   - valid KR full input -> 6블록 ok
   - KR code-only -> sellNow/portfolio blocked
   - package failure -> fallback used
3. app/web
   - existing `/api/deepscan` route tests update
   - page projection smoke

### Task H. integration verify
- `npm run test`
- `npm run check:crawler`
- deepscan targeted tests
- `npm run lint:web`
- `npm run build:web`
- crawler `/api/deepscan?code=...&shares=...&averagePrice=...`
- app `/api/deepscan?...`
- Playwright `/deepscan` smoke

## 8. 추천 sourceRef id 규칙
- report
  - `kr:company-overview:{code}`
  - `kr:financial-analysis:{code}`
  - `kr:investment-indicators:{code}`
  - `kr:consensus:{code}`
  - `kr:shareholding:{code}`
  - `kr:recent-reports:{code}`
  - `kr:relative-return:{code}`
  - `kr:opinion:{code}`
  - `kr:style-analysis:{code}`
- market
  - `kr:quotes-current:{code}:{asOf}`
- holding
  - `holding:{code}:{selectedAt}`
- system
  - `system:deepscan-kr-score:v1`
  - `system:deepscan-kr-package-adapter:v1`
  - `system:portfolio-proxy:v1`

## 9. 구현 시 주의점
- package의 LLM score를 canonical numeric score로 그대로 쓰지 말 것
- sourceRefs는 반드시 block별 실제 사용 근거만 남길 것
- `portfolioSimulation`은 v1에서 진짜 multi-asset claim 금지
- page projection에서 heuristic text 재도입 금지
- package 장애가 전체 payload 500으로 번지지 않게 block-level fallback 유지

## 10. 바로 이어서 구현할 최소 단위
1. package adapter 뼈대
2. KR evidence packet extractor
3. deterministic score engine
4. hero/committee 먼저 real 전환
5. strategy/sellNow/portfolioSimulation 확장
6. insights 마지막 문장 polish
