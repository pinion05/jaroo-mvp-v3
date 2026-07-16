# DeepScan 촬영 시점·현재가 수익률 분리 설계

## 배경

OCR은 증권사 화면 촬영 시점의 평가금액·평가손익·수익률을 읽는다. 홈과 DeepScan은 이후 현재 시세를 조회해 평단 대비 수익률을 다시 계산한다. 두 값은 기준 시점이 다르지만 현재 DeepScan 헤더는 현재가 기준 숫자만 `수익률`처럼 노출해 OCR 결과가 잘못 전달된 것으로 보인다.

운영 SOOP 재현값:

- 촬영 시점: 평단 64,800원, 평가금액 181,137원, 수익률 -6.8%
- 현재가 기준: 현재가 47,100원, 수익률 -27.3%

또한 기존 DB에는 `profit_rate`가 없고 평가금액·평단·수량만 있으므로, 촬영 시점 수익률은 이 세 값에서 복원해야 한다.

## 목표

1. DeepScan에서 현재가 기준 수익률과 OCR 촬영 시점 수익률을 명확히 분리한다.
2. 새 OCR 등록, DB 재접속, DeepScan 새로고침 모두 동일한 촬영 시점 수익률을 유지한다.
3. 현재 시세 기반 분석과 손익 계산은 그대로 유지한다.
4. DB 스키마 변경 없이 기존 저장 행도 지원한다.

## 선택한 접근

### 이중 표시

DeepScan 헤더에 다음 의미를 분리해 표시한다.

- 주 수치: `현재가 기준 -27.3%`
- 보조 수치: `촬영 당시 -6.8%`

현재가 기준 값은 기존처럼 최신 quote와 평단으로 계산한다. 촬영 당시 값은 OCR의 명시적 수익률을 우선하고, DB에서 다시 읽은 행은 `(촬영 시점 평가금액 / (평단 × 수량) - 1) × 100`으로 복원한다.

### 데이터 계약

`PortfolioNormalizedItem`과 `DeepScanTargetInput`에 `snapshotProfitRate?: number`를 추가한다.

- OCR apply: `ConfirmedHolding.profitRateValue`를 `snapshotProfitRate`로 보존한다.
- DB/session rehydrate: 저장된 평가금액·평단·수량으로 snapshot rate를 복원한다.
- HomeHolding/session target: snapshot rate를 별도 필드로 전달한다.
- live quote의 `currentProfitRate`와 snapshot rate를 덮어쓰지 않는다.
- DeepScan target key에 snapshot rate를 포함해 이전 캐시가 재사용되지 않게 한다.

## UI 원칙

기존 DeepScan의 밀도와 색 체계를 유지한다. 현재가 기준 값은 기존 gain/loss 색을 유지하고, 촬영 당시 값은 작은 중립색 보조 문구로 표시한다. 두 숫자가 경쟁하지 않도록 현재 값을 주 정보, 촬영값을 출처가 명시된 보조 정보로 둔다.

## 오류·fallback

- snapshot rate를 계산할 수 없으면 `촬영 당시` 행을 숨긴다.
- live quote가 없으면 기존 `currentProfitRate` fallback을 사용하되 라벨은 `현재가 기준`으로 유지한다.
- 통화가 달라 현재 수익률을 계산할 수 없으면 기존 환율 fallback을 유지한다.

## 테스트

1. SOOP OCR 데이터가 snapshot rate -6.8%로 normalized item에 보존되는 테스트.
2. DB형 행에서 평가금액·평단·수량으로 -6.8%를 복원하는 테스트.
3. HomeHolding → persisted DeepScan target → page target 변환에서 snapshot rate가 유지되는 테스트.
4. DeepScan 헤더가 `현재가 기준 -27.3%`와 `촬영 당시 -6.8%`를 함께 렌더링하는 테스트.
5. 기존 live quote, target key, reload handoff 회귀 테스트.

## 제외 범위

- 과거 DB 평단을 자동으로 다시 쓰는 데이터 마이그레이션
- 현재가 대신 OCR 수익률을 분석의 권위값으로 사용하는 변경
- Supabase 스키마 변경
