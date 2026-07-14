# DeepScan 원금회수 모델 안정화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 월봉을 일봉으로 오인하고 저점 이후 상승 구간만 학습해 `15거래일·100%`를 만드는 KR 원금회수 모델을 실제 일봉 기반의 보수적 시뮬레이션으로 교체하고, 도달 비율의 의미를 정직하게 표시한다.

**Architecture:** 계산 엔진은 날짜 주기 검증과 전체 관측 구간 옵션을 갖도록 강화한다. KR 웹 canonical builder는 crawler의 월봉 기반 `recoveryForecastRaw`를 네이버 최근 360개 일봉으로 재계산한 뒤 UI block으로 성형한다. 일봉 조회 또는 최소 252개 수익률 조건이 실패하면 기존 월봉 결과로 되돌아가지 않고 예측을 차단한다.

**Tech Stack:** Node.js ESM, TypeScript, Next.js 16 route runtime, Node test runner, React 19.

## Global Constraints

- 이 작업의 분석·구현은 `openai-codex/gpt-5.6-sol`만 사용한다.
- Monte Carlo 경로 도달 비율을 예측 정확도 또는 보장 확률로 표현하지 않는다.
- 월봉 또는 주기를 판별할 수 없는 가격열로 거래일 단위 결과를 만들지 않는다.
- 사용자 평단가와 현재가, 시뮬레이션 252거래일·5,000경로 설정은 유지한다.
- 기존 crawler canonical 응답 계약은 유지하되 웹 계층에서 안전하게 raw forecast를 교체한다.

---

### Task 1: 계산 엔진의 주기·표본·선택 편향 차단

**Files:**
- Modify: `packages/deepscan-runtime-core/src/recovery-forecast.js`
- Test: `tests/recovery-forecast.test.mjs`

**Interfaces:**
- Consumes: `deriveRecoveryReturnParameters(priceSeries, options)` 및 `buildRecoveryForecastFromPriceSeries(input, options)`
- Produces: `returnParameters.windowMode='full'`, `requireDailyCadence=true`, `minReturnCount=252`; 2모델 합의는 `confidence.level='low'`.

- [x] 월간 날짜열을 `requireDailyCadence`에서 거절하는 실패 테스트를 추가하고 실행한다.
- [x] `windowMode='full'`이 전역 저점 이후 slice 대신 전체 trailing 관측값을 사용하는 실패 테스트를 추가한다.
- [x] 일봉 cadence 분석과 최소 표본 검증을 구현한다.
- [x] 가용 모델이 GBM/JD 두 개뿐이면 신뢰도를 `low`로 내리는 실패 테스트와 구현을 추가한다.
- [x] `npm test -- --test-name-pattern recovery` 대신 `node --test tests/recovery-forecast.test.mjs`로 focused suite를 통과시킨다.

### Task 2: 유사 패턴을 동일한 252거래일 도달 사건으로 정규화

**Files:**
- Modify: `packages/deepscan-runtime-core/src/recovery-forecast.js`
- Test: `tests/recovery-forecast.test.mjs`

**Interfaces:**
- Consumes: `calculateSimilarPatternRecovery(input, options)`
- Produces: 각 표본의 로컬 고점 회복 여부와 `horizonDays=252` 이내 도달 일수.

- [x] 사용자 절대 평단가 대신 각 표본의 `peakClose`를 회복 목표로 사용해야 하는 실패 테스트를 추가한다.
- [x] `findFirstRecoveryDay`에 horizon 상한을 추가하고 실제 index 차이를 거래일로 사용한다.
- [x] 기존 유사 패턴 테스트와 신규 테스트를 모두 통과시킨다.

### Task 3: KR 일봉 360개 조회 서비스

**Files:**
- Create: `src/lib/kr-daily-price-history.ts`
- Create: `src/lib/kr-daily-price-history.test.ts`

**Interfaces:**
- Produces: `fetchKrDailyPriceHistory(code, options?): Promise<Array<{date:string; close:number}>>`
- Rules: 네이버 `m.stock.naver.com/api/stock/{code}/price`, 60개씩 6페이지 병렬 조회, 날짜 중복 제거, 오름차순 정렬, 전체 실패 시 throw.

- [x] 6페이지 fixture를 병합·정렬·중복 제거하는 실패 테스트를 작성한다.
- [x] invalid code와 upstream non-OK를 거절하는 실패 테스트를 작성한다.
- [x] 최소 구현 후 `npx tsx --test src/lib/kr-daily-price-history.test.ts`를 통과시킨다.

### Task 4: canonical KR payload를 일봉 모델로 재계산

**Files:**
- Modify: `src/lib/deepscan-runtime/build-payload.ts`
- Test: `src/lib/deepscan-runtime/build-payload.test.ts`

**Interfaces:**
- Extend: `KrDeepScanCrawlerFetchOptions.recoveryPriceHistoryLoader`
- Production: `buildDeepScanPayloadFromSearchParams`가 `fetchKrDailyPriceHistory` loader를 전달한다.
- Recovery options: full window, daily cadence required, 252 returns minimum, similar pattern 252 horizon, 5,000 paths/252 days.

- [x] crawler raw가 `15일·100%`여도 loader의 일봉 결과로 교체되는 실패 테스트를 작성한다.
- [x] 일봉 loader 실패 시 월봉 raw로 fallback하지 않고 blocked recovery block이 되는 실패 테스트를 작성한다.
- [x] 재계산 helper와 source ref(`naver-daily-price-history`)를 구현한다.
- [x] `npx tsx --test src/lib/deepscan-runtime/build-payload.test.ts`를 통과시킨다.

### Task 5: 사용자 문구를 조건부 도달 통계로 수정

**Files:**
- Modify: `src/lib/deepscan-runtime/build-payload.ts`
- Modify: `src/components/deepscan-recovery-forecast-card.tsx`
- Test: `src/components/deepscan-recovery-forecast-card.test.ts`

**Interfaces:**
- Replace: `회복 확률` → `1년 내 도달 비율`
- Replace: `예상 회수 기간` → `도달 사례 중앙값`
- Disclaimer: 5,000개 모의 경로 중 252거래일 내 평단가에 한 번 이상 도달한 비율이며 예측 정확도·보장이 아님을 명시.

- [x] 기존 오해 유발 문구가 없어지고 새 설명이 렌더되는 실패 테스트를 작성한다.
- [x] UI와 summary/disclaimer 문구를 최소 수정한다.
- [x] component 및 build-payload focused tests를 통과시킨다.

### Task 6: SNT에너지 실데이터 검증과 전체 회귀 검증

**Files:**
- No production file changes expected.

**Interfaces:**
- Acceptance: SNT에너지(100840, 현재 25,150원, 평단 49,256.7334원)가 월봉 기반 `13~15거래일·100%`를 더 이상 표시하지 않는다.

- [x] raw Naver 일봉 360개와 canonical API 결과를 비교한다.
- [x] Orca `/deepscan`에서 모델 행, 도달 비율, 신뢰도, 설명 문구를 확인한다.
- [x] `npm run test:web:ts`, `npm run test:crawler`, `node --test tests/recovery-forecast.test.mjs`, 변경 파일 ESLint, `git diff --check`를 실행한다.
- [x] 검증 결과와 남은 한계(아웃오브샘플 calibration 미완료)를 보고하고 커밋·push한다.
