# DeepScan Snapshot vs Live Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DeepScan에서 현재가 기준 수익률과 OCR 촬영 당시 수익률을 별도 데이터로 전달하고 명확한 라벨로 함께 표시한다.

**Architecture:** `snapshotProfitRate`를 normalized portfolio와 DeepScan target의 독립 필드로 추가한다. OCR 명시값을 우선하고 DB 재접속 시 평가금액·평단·수량으로 복원하며, live `currentProfitRate`와 분리한 채 HomeHolding/session/DeepScan UI까지 전달한다.

**Tech Stack:** TypeScript, React 19, Next.js 16, Zustand, node:test

## Global Constraints

- DB 스키마를 변경하지 않는다.
- 현재 시세 기반 계산과 분석은 유지한다.
- snapshot 값을 계산할 수 없으면 촬영 당시 문구를 숨긴다.
- 현재 수익률을 주 정보, 촬영 당시 수익률을 중립색 보조 정보로 표시한다.
- 모든 동작 변경은 RED 테스트를 먼저 확인한다.

---

### Task 1: Snapshot 수익률 계약과 복원 계산

**Files:**
- Create: `src/lib/workflow-types.test.ts`
- Modify: `src/lib/workflow-types.ts`

**Interfaces:**
- Produces: `deriveSnapshotProfitRate(input): number | undefined`
- Produces: `PortfolioNormalizedItem.snapshotProfitRate?: number`
- Produces: `DeepScanTargetInput.snapshotProfitRate?: number`

- [ ] **Step 1: Write failing tests**

`src/lib/workflow-types.test.ts`에서 다음을 검증한다.

```ts
assert.equal(deriveSnapshotProfitRate({ quantity: 3, averagePrice: 64800, evaluationAmount: 181137 }), -6.822530864197529)
assert.equal(toPortfolioNormalizedItem(soopHolding)?.snapshotProfitRate, -6.8)
assert.equal(toDeepScanTargetInput({ ...item, snapshotProfitRate: -6.8 }).snapshotProfitRate, -6.8)
assert.notEqual(getDeepScanTargetKey({ ...target, snapshotProfitRate: -6.8 }), getDeepScanTargetKey({ ...target, snapshotProfitRate: -27.3 }))
```

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/tsx --test src/lib/workflow-types.test.ts
```

Expected: `deriveSnapshotProfitRate` 또는 `snapshotProfitRate` 계약이 없어 실패.

- [ ] **Step 3: Implement minimal contract**

`deriveSnapshotProfitRate`는 유한한 양수 수량·평단과 평가금액에만 다음 식을 적용한다.

```ts
const costBasis = quantity * averagePrice
return costBasis > 0 ? ((evaluationAmount / costBasis) - 1) * 100 : undefined
```

`toPortfolioNormalizedItem`은 `holding.profitRateValue`를 우선하고 없으면 위 함수로 복원한다. `toDeepScanTargetInput`과 `getDeepScanTargetKey`도 snapshot 값을 전달·구분한다.

- [ ] **Step 4: Run GREEN**

```bash
./node_modules/.bin/tsx --test src/lib/workflow-types.test.ts
```

Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflow-types.ts src/lib/workflow-types.test.ts
git commit -m "fix(deepscan): 촬영 시점 수익률 계약 추가"
```

---

### Task 2: DB·HomeHolding·session handoff 보존

**Files:**
- Modify: `src/lib/jaroo-home-data.ts`
- Modify: `src/lib/jaroo-home-data.test.ts`
- Modify: `src/components/home/jaroo-home-screen.tsx`
- Modify: `src/app/deepscan/page.tsx`

**Interfaces:**
- Consumes: `deriveSnapshotProfitRate`, `snapshotProfitRate`
- Produces: `HomeHolding.snapshotProfitRate?: number`
- Produces: reload 후 `DeepScanTargetInput.snapshotProfitRate`

- [ ] **Step 1: Write failing tests**

`src/lib/jaroo-home-data.test.ts`에 SOOP DB형 행을 넣고 다음을 검증한다.

```ts
const [item] = buildPortfolioItemsFromAppliedHomePortfolioRows([{ quantity: '3주', averagePrice: '64,800원', evaluationAmount: '181,137원', profitRate: '', ...identity }])
assert.equal(Number(item.snapshotProfitRate?.toFixed(1)), -6.8)
const [holding] = buildHomeHoldingsFromPortfolioItems([{ ...item, currentPrice: 47100, currentProfitRate: -27.3 }])
assert.equal(Number(holding.snapshotProfitRate?.toFixed(1)), -6.8)
assert.equal(holding.change, '-27.3%')
persistDeepScanTarget(holding)
assert.equal(Number(resolveDeepScanTargetSession().holding.snapshotProfitRate?.toFixed(1)), -6.8)
```

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/tsx --test src/lib/jaroo-home-data.test.ts
```

Expected: `snapshotProfitRate`가 rehydrate/session 경로에서 사라져 실패.

- [ ] **Step 3: Implement minimal handoff**

- `HomeHolding`에 optional snapshot 필드를 추가한다.
- `buildAppliedRowFromPortfolioItem`의 `profitRate`에는 snapshot을, `currentProfitRate`에는 live 값을 기록한다.
- DB형 row는 `deriveSnapshotProfitRate`로 복원한다.
- `buildHomeHoldingsFromOcrRows`가 snapshot과 live 값을 별도로 보존한다.
- 홈 클릭 loading target과 DeepScan Zustand target에 snapshot을 전달한다.
- `buildDeepScanTargetInputFromSession`이 persisted holding의 snapshot을 읽는다.

- [ ] **Step 4: Run GREEN and related regression tests**

```bash
./node_modules/.bin/tsx --test src/lib/jaroo-home-data.test.ts src/lib/home-current-quotes.test.ts src/lib/deepscan-page-projection-cache.test.ts
```

Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jaroo-home-data.ts src/lib/jaroo-home-data.test.ts src/components/home/jaroo-home-screen.tsx src/app/deepscan/page.tsx
git commit -m "fix(deepscan): 촬영 수익률을 세션까지 보존"
```

---

### Task 3: DeepScan 이중 수익률 UI

**Files:**
- Modify: `src/components/deepscan-loading-screen.tsx`
- Modify: `src/components/deepscan-loading-screen.module.css`
- Modify: `src/components/deepscan-loading-screen.test.ts`
- Modify: `src/app/deepscan/page.tsx`

**Interfaces:**
- Consumes: `DeepScanTargetInput.snapshotProfitRate`
- Produces: `buildDeepScanReturnRateDisplay({ currentProfitRate, snapshotProfitRate })`

- [ ] **Step 1: Write failing display test**

```ts
assert.deepEqual(
  buildDeepScanReturnRateDisplay({ currentProfitRate: -27.3, snapshotProfitRate: -6.8 }),
  { current: '-27.3%', snapshot: '-6.8%' },
)
```

소스 계약 테스트로 `현재가 기준`과 `촬영 당시` 라벨이 실제 헤더 JSX에 존재하는지도 확인한다.

- [ ] **Step 2: Run RED**

```bash
./node_modules/.bin/tsx --test src/components/deepscan-loading-screen.test.ts
```

Expected: display helper 또는 snapshot prop이 없어 실패.

- [ ] **Step 3: Implement minimal UI**

- `DeepScanLoadingScreenProps`에 `snapshotProfitRate`를 추가한다.
- 헤더 주 수치는 `현재가 기준 {current}`로 표시한다.
- snapshot이 유효할 때만 `촬영 당시 {snapshot}`을 작은 중립색 행으로 표시한다.
- 페이지가 `target.snapshotProfitRate`를 prop으로 전달한다.
- 기존 gain/loss 색은 current 수치에만 적용한다.

- [ ] **Step 4: Run GREEN and full web checks**

```bash
./node_modules/.bin/tsx --test src/components/deepscan-loading-screen.test.ts src/lib/workflow-types.test.ts src/lib/jaroo-home-data.test.ts
npm run test:web:ts
npm run lint:web
npm run build:web
```

Expected: 테스트와 build 통과, lint error 0.

- [ ] **Step 5: Browser verification**

SOOP 기준으로 개발 서버 DeepScan에서 다음이 함께 보여야 한다.

```text
현재가 기준 -27.3%
촬영 당시 -6.8%
```

- [ ] **Step 6: Commit**

```bash
git add src/components/deepscan-loading-screen.tsx src/components/deepscan-loading-screen.module.css src/components/deepscan-loading-screen.test.ts src/app/deepscan/page.tsx
git commit -m "fix(deepscan): 현재와 촬영 수익률을 분리 표시"
```
