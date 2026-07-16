# OCR Profit Sign and Cost Basis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 증권사 스크린샷의 signed 평가손익 금액을 구조화하고 이를 우선 사용해 손실 부호와 평단을 정확히 계산한다.

**Architecture:** OCR 계약에 선택 호환 가능한 `profitAmount`를 추가하고, `screenshot-ocr.ts`를 손익금/수익률 정규화와 평단 계산의 단일 진실 소스로 유지한다. 검수·다계좌 병합·적용 단계까지 손익금을 전달하되 DB migration 없이 정확히 계산된 기존 `average_price`를 저장한다. live quote 로직은 변경하지 않고 정확한 원가 입력만 제공한다.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, React 19, Node test runner + tsx, OpenRouter vision OCR

## Global Constraints

- `profitAmount`가 있으면 `costBasis = evaluationAmount - profitAmount`, `averagePrice = costBasis / quantity`를 사용한다.
- `profitAmount`가 없거나 유효하지 않으면 기존 수익률 역산을 유지한다.
- 구형 OCR 결합 문자열 `-13,263 (6.8%)`를 계속 지원한다.
- DB migration은 하지 않는다.
- 실제 제보 JPEG로 OCR → 종목 식별 → 현재 시세 → 최종 손익을 검증한다.
- 개발 런타임은 웹과 crawler sidecar를 함께 사용한다.

---

### Task 1: 손익금 정규화와 정확한 평단 계산

**Files:**
- Modify: `src/lib/screenshot-ocr.test.ts`
- Modify: `src/lib/screenshot-ocr.ts:5-19, 143-324`

**Interfaces:**
- Produces: `normalizeOcrProfitAmount(profitAmount: string, combinedProfitText?: string): string`
- Produces: `normalizeOcrProfitRate(value: string, profitAmount?: string): string`
- Changes: `computeAveragePrice(quantity: string, profitRate: string, evaluationAmount: string, profitAmount?: string): string`
- Changes: `isAveragePriceComputedFromEvaluation(..., averagePrice: string, profitAmount?: string): boolean`
- Produces: sanitized `OcrRow.profitAmount?: string`

- [ ] **Step 1: 실제 제보 행의 실패 테스트 작성**

`src/lib/screenshot-ocr.test.ts`에 다음 테스트를 추가한다.

```ts
import {
  computeAveragePrice,
  normalizeOcrProfitAmount,
  normalizeOcrProfitRate,
  sanitizeOcrRows,
} from './screenshot-ocr'

test('signed 평가손익이 unsigned 괄호 수익률의 손실 부호를 결정한다', () => {
  assert.equal(normalizeOcrProfitAmount('-13,263원'), '-13263')
  assert.equal(normalizeOcrProfitRate('6.8%', '-13,263원'), '-6.8%')
  assert.equal(computeAveragePrice('3주', '6.8%', '181,137원', '-13,263원'), '64,800')
})

test('구형 결합 손익 문자열에서 손익금과 수익률을 복원한다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'SOOP',
    quantity: '3주',
    profitRate: '-13,263 (6.8%)',
    evaluationAmount: '181,137원',
  }])

  assert.equal(row?.profitAmount, '-13263')
  assert.equal(row?.profitRate, '-6.8%')
  assert.equal(row?.averagePrice, '64,800')
})

test('평가손익이 있으면 반올림 수익률보다 정확한 원가를 사용한다', () => {
  const [row] = sanitizeOcrRows([{
    name: 'KODEX 코스피',
    quantity: '35주',
    profitAmount: '+262,740원',
    profitRate: '12.7%',
    evaluationAmount: '2,320,500원',
  }])

  assert.equal(row?.profitAmount, '+262740')
  assert.equal(row?.profitRate, '+12.7%')
  assert.equal(row?.averagePrice, '58,793.1429')
})

test('평가손익이 없거나 원금이 유효하지 않으면 수익률 역산으로 fallback한다', () => {
  assert.equal(computeAveragePrice('3주', '-6.8%', '181,137원'), '64,784.3348')
  assert.equal(computeAveragePrice('3주', '-6.8%', '181,137원', '300,000원'), '64,784.3348')
})
```

- [ ] **Step 2: 테스트가 기능 부재로 실패하는지 확인**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/screenshot-ocr.test.ts
```

Expected: `normalizeOcrProfitAmount`/`normalizeOcrProfitRate` export 또는 `profitAmount`/정확 평단 assertion이 실패한다.

- [ ] **Step 3: 최소 정규화 및 평단 구현**

`OcrRow`에 `profitAmount?: string`을 추가한다. `screenshot-ocr.ts`에 다음 동작을 구현한다.

```ts
export function normalizeOcrProfitAmount(value: string, combinedProfitText = '') {
  // Unicode minus를 '-'로 바꾸고 value, combinedProfitText 순으로 검사한다.
  // '%' 바로 앞의 signed 숫자는 금액으로 취급하지 않는다.
  // signed 금액을 찾으면 comma/currency/unit을 제거한 '+262740'/'-13263'을 반환한다.
  // 명시적 0만 '0'으로 허용하고 방향 없는 비영 금액은 빈 문자열로 둔다.
}

export function normalizeOcrProfitRate(value: string, profitAmount = '') {
  // 마지막 percent를 선택한다.
  // profitAmount가 non-zero이면 그 부호를 최우선 사용한다.
  // 없으면 percent의 명시 부호, 결합 문자열 앞 signed 금액, accounting 괄호 순으로 결정한다.
  // '+12.7%'/'-6.8%'처럼 정규화한다.
}

export function computeAveragePrice(quantity: string, profitRate: string, evaluationAmount: string, profitAmount = '') {
  const parsedQuantity = parseOcrNumber(quantity)
  const parsedEvaluationAmount = parseOcrNumber(evaluationAmount)
  const parsedProfitAmount = parseOcrNumber(profitAmount)

  if (parsedQuantity !== null && parsedQuantity !== 0 && parsedEvaluationAmount !== null && parsedProfitAmount !== null) {
    const principal = parsedEvaluationAmount - parsedProfitAmount
    if (Number.isFinite(principal) && principal > 0) {
      return formatComputedNumber(principal / parsedQuantity)
    }
  }

  // 기존 profitRate 역산 fallback
}
```

`sanitizeOcrRows`는 raw 값을 다음 순서로 처리한다.

```ts
const rawProfitRate = typeof item.profitRate === 'string' ? item.profitRate.trim() : ''
const rawProfitAmount = typeof item.profitAmount === 'string' ? item.profitAmount.trim() : ''
const profitAmount = normalizeOcrProfitAmount(rawProfitAmount, rawProfitRate)
const profitRate = normalizeOcrProfitRate(rawProfitRate, profitAmount)
const averagePrice = existingAveragePrice || computeAveragePrice(quantity, profitRate, evaluationAmount, profitAmount)
```

`isAveragePriceComputedFromEvaluation`도 같은 `computeAveragePrice` 결과와 비교하도록 변경한다.

- [ ] **Step 4: 핵심 테스트 통과 확인**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/screenshot-ocr.test.ts
```

Expected: PASS.

- [ ] **Step 5: 핵심 계산 커밋**

```bash
git add src/lib/screenshot-ocr.ts src/lib/screenshot-ocr.test.ts
git commit -m "fix(ocr): 평가손익으로 손실 부호와 평단 계산"
```

---

### Task 2: OCR Route 계약에 평가손익 추가

**Files:**
- Modify: `src/app/api/ocr/route.test.ts`
- Modify: `src/app/api/ocr/route.ts:18-95`

**Interfaces:**
- Produces: exported `OCR_SCHEMA`
- Produces: exported `OCR_SYSTEM_PROMPT`
- OCR row JSON adds required string `profitAmount`; unreadable values use `""`.

- [ ] **Step 1: Route 계약 실패 테스트 작성**

`src/app/api/ocr/route.test.ts` import와 테스트를 추가한다.

```ts
import {
  OCR_SCHEMA,
  OCR_SYSTEM_PROMPT,
  extractJsonObjectText,
  extractOpenRouterErrorMessage,
  extractOpenRouterErrorStatus,
  toPublicOcrErrorMessage,
} from './route'

test('OCR schema requires signed row-level profitAmount', () => {
  const rowSchema = OCR_SCHEMA.schema.properties.rows.items
  assert.equal(rowSchema.properties.profitAmount.type, 'string')
  assert.equal(rowSchema.required.includes('profitAmount'), true)
})

test('OCR prompt carries P/L amount sign into unsigned parenthesized return', () => {
  assert.match(OCR_SYSTEM_PROMPT, /profitAmount/)
  assert.match(OCR_SYSTEM_PROMPT, /-13,263[^\n]*\(6\.8%\)[\s\S]*-6\.8%/)
  assert.match(OCR_SYSTEM_PROMPT, /\+262,740[^\n]*\(12\.7%\)[\s\S]*\+12\.7%/)
})
```

- [ ] **Step 2: Route 테스트 실패 확인**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/ocr/route.test.ts
```

Expected: `OCR_SCHEMA`/`OCR_SYSTEM_PROMPT` export 또는 `profitAmount` assertion이 실패한다.

- [ ] **Step 3: JSON schema와 프롬프트 구현**

`OCR_SCHEMA`와 `SYSTEM_PROMPT`를 각각 `export const OCR_SCHEMA`, `export const OCR_SYSTEM_PROMPT`로 바꾸고 request body가 `OCR_SYSTEM_PROMPT`를 사용하게 한다.

행 schema에 다음을 추가한다.

```ts
profitAmount: { type: 'string' },
```

required는 다음과 같이 변경한다.

```ts
required: ['name', 'quantity', 'profitAmount', 'profitRate', 'evaluationAmount'],
```

프롬프트에 다음 규칙을 추가한다.

```text
Every row must contain profitAmount as a string; use "" when it is not visible.
- profitAmount: signed row-level profit/loss amount, not market value.
- When a row shows "+262,740 (12.7%)", return profitAmount "+262,740" and profitRate "+12.7%".
- When a row shows "-13,263 (6.8%)", return profitAmount "-13,263" and profitRate "-6.8%".
- If the parenthesized percentage has no sign, inherit the sign from the visible profitAmount or loss/profit color.
```

- [ ] **Step 4: Route 및 core 테스트 통과 확인**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/ocr/route.test.ts src/lib/screenshot-ocr.test.ts
```

Expected: PASS.

- [ ] **Step 5: OCR 계약 커밋**

```bash
git add src/app/api/ocr/route.ts src/app/api/ocr/route.test.ts
git commit -m "fix(ocr): 평가손익 추출 계약 추가"
```

---

### Task 3: 검수·다계좌 병합·적용 단계로 손익금 전달

**Files:**
- Modify: `src/lib/workflow-types.ts:13-70, 150-271`
- Modify: `src/lib/ocr-review-resolution.ts:12-30`
- Modify: `src/lib/ocr-review-resolution.test.ts`
- Modify: `src/lib/ocr-review-aggregation.ts`
- Modify: `src/lib/ocr-review-aggregation.test.ts`
- Modify: `src/lib/ocr-portfolio-apply.ts`
- Modify: `src/components/merge/jaroo-merge-screen.test.ts`
- Modify: `src/lib/jaroo-home-data.ts`

**Interfaces:**
- Adds: `OcrExtractedRow.profitAmount?: string`
- Adds: `ConfirmedHolding.profitAmountText?: string`, `profitAmountValue?: number`
- Adds: `AppliedHomePortfolioRow.profitAmount?: string`
- Aggregation sums signed `profitAmount` when every row provides one.

- [ ] **Step 1: handoff 및 aggregation 실패 테스트 작성**

`src/lib/ocr-review-resolution.test.ts`에 raw 보존 assertion을 추가한다.

```ts
test('review row raw payload preserves signed profitAmount', () => {
  const row = toReviewRow(createSourceRow({ profitAmount: '-13263' }))
  assert.equal(row.profitAmount, '-13263')
  assert.equal(row.raw?.profitAmount, '-13263')
})
```

`src/lib/ocr-review-aggregation.test.ts`에 합산 테스트를 추가한다.

```ts
test('aggregateResolvedOcrReviewRows sums profitAmount and derives exact merged return', () => {
  const [aggregated] = aggregateResolvedOcrReviewRows([
    row({ id: 'a', quantity: '3', evaluationAmount: '181137', profitAmount: '-13263', averagePrice: '64800' }),
    row({ id: 'b', quantity: '7', evaluationAmount: '124491', profitAmount: '-7459', averagePrice: '18850' }),
  ])

  assert.equal(aggregated?.profitAmount, '-20722')
  assert.equal(aggregated?.evaluationAmount, '305,628')
  assert.equal(aggregated?.profitRate, '-6.3496%')
})
```

`src/components/merge/jaroo-merge-screen.test.ts`에 정확 평단 적용 테스트를 추가한다.

```ts
test('prepareMergeRowsForApply는 평가손익 금액으로 정확한 평단을 보강한다', () => {
  const [prepared] = prepareMergeRowsForApply([{
    name: 'SOOP', quantity: '3주', profitAmount: '-13,263원',
    profitRate: '6.8%', evaluationAmount: '181,137원', averagePrice: '',
  }])
  assert.equal(prepared?.averagePrice, '64,800')
})
```

- [ ] **Step 2: handoff 테스트 실패 확인**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/ocr-review-resolution.test.ts \
  src/lib/ocr-review-aggregation.test.ts \
  src/components/merge/jaroo-merge-screen.test.ts
```

Expected: `profitAmount` type/field 및 exact average assertion이 실패한다.

- [ ] **Step 3: workflow와 적용 경로 구현**

다음 필드를 추가하고 전달한다.

```ts
export type OcrExtractedRow = {
  // existing fields
  profitAmount?: string
}

export type ConfirmedHolding = {
  // existing fields
  profitAmountText?: string
  profitAmountValue?: number
}
```

`toReviewRow().raw`, `toConfirmedHolding`, `getApplicableConfirmedHoldings`, `buildAppliedHomePortfolioRowsFromConfirmedHoldings`에 `profitAmount`를 복사한다. `prepareMergeRowsForApply`와 `buildMergeRowsFromReviewRows`는 다음 호출을 사용한다.

```ts
computeAveragePrice(row.quantity, row.profitRate, row.evaluationAmount, row.profitAmount ?? '')
```

`AppliedHomePortfolioRow`와 sanitizer는 `profitAmount` 문자열을 보존한다. `resolveAppliedAveragePriceCurrency`가 computed average를 검사할 때도 `profitAmount`를 넘긴다.

- [ ] **Step 4: 다계좌 합산 구현**

`OcrReviewAccountDetail`에 `profitAmount?: string`을 추가한다. 모든 행의 손익금을 숫자로 읽을 수 있으면 합산한다.

```ts
const totalProfitAmount = sumParsedOptional(orderedRows, 'profitAmount')
const principal = evaluationAmount - totalProfitAmount
const mergedRate = principal > 0 ? (totalProfitAmount / principal) * 100 : null
```

합산 손익금은 양수에 `+`, 음수에 `-`, 0에는 부호 없이 `formatComputedNumber`로 저장한다. 손익금이 하나라도 없으면 기존 수익률 기반 병합을 유지한다.

- [ ] **Step 5: handoff 테스트 통과 확인**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/ocr-review-resolution.test.ts \
  src/lib/ocr-review-aggregation.test.ts \
  src/components/merge/jaroo-merge-screen.test.ts \
  src/lib/jaroo-home-data.test.ts \
  src/lib/portfolio-sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: workflow 커밋**

```bash
git add \
  src/lib/workflow-types.ts \
  src/lib/ocr-review-resolution.ts \
  src/lib/ocr-review-resolution.test.ts \
  src/lib/ocr-review-aggregation.ts \
  src/lib/ocr-review-aggregation.test.ts \
  src/lib/ocr-portfolio-apply.ts \
  src/components/merge/jaroo-merge-screen.test.ts \
  src/lib/jaroo-home-data.ts
git commit -m "fix(portfolio): signed 평가손익을 적용 단계까지 보존"
```

---

### Task 4: OCR 직접 수정 UI에서 평가손익 지원

**Files:**
- Modify: `src/app/ocr/page.tsx:47-56, 724-753, 960-1040`
- Modify: `tests/frontend-accessibility.test.mjs`

**Interfaces:**
- Adds: `ManualEditableField` variant `'profitAmount'`
- Manual edits recompute average with `profitAmount` priority.

- [ ] **Step 1: UI source contract 실패 테스트 작성**

`tests/frontend-accessibility.test.mjs`의 OCR page source 검사에 다음 assertion을 추가한다.

```js
assert.match(ocrSource, /평가손익/)
assert.match(ocrSource, /field === 'profitAmount'/)
assert.match(ocrSource, /computeAveragePrice\(nextRow\.quantity, nextRow\.profitRate, nextRow\.evaluationAmount, nextRow\.profitAmount/)
```

- [ ] **Step 2: UI contract 테스트 실패 확인**

Run:

```bash
node --test tests/frontend-accessibility.test.mjs
```

Expected: `평가손익` 또는 `profitAmount` assertion이 실패한다.

- [ ] **Step 3: 직접 수정 필드 구현**

`ManualEditableField`에 `'profitAmount'`를 추가하고 patch row를 다음처럼 갱신한다.

```ts
profitAmount: field === 'profitAmount' ? value : currentRow.profitAmount,
```

평단 재계산은 다음을 사용한다.

```ts
nextRow.averagePrice = computeAveragePrice(
  nextRow.quantity,
  nextRow.profitRate,
  nextRow.evaluationAmount,
  nextRow.profitAmount ?? '',
) || nextRow.averagePrice
```

편집 grid에 선택 입력을 추가한다.

```tsx
<label className='jaroo-ocr-edit-field'>
  <span>평가손익</span>
  <input
    value={editableRow.profitAmount ?? ''}
    onChange={(event) => handleManualFieldChange(editableRowId, 'profitAmount', event.target.value)}
  />
</label>
```

- [ ] **Step 4: UI 및 관련 테스트 통과 확인**

Run:

```bash
node --test tests/frontend-accessibility.test.mjs
./node_modules/.bin/tsx --test src/lib/screenshot-ocr.test.ts src/lib/ocr-review-resolution.test.ts
```

Expected: PASS.

- [ ] **Step 5: UI 커밋**

```bash
git add src/app/ocr/page.tsx tests/frontend-accessibility.test.mjs
git commit -m "fix(ocr): 평가손익 직접 확인 필드 추가"
```

---

### Task 5: 전체 자동검증과 실제 JPEG 라이브 테스트

**Files:**
- No production file changes expected.
- Temporary request/response files only under `/tmp`, removed after verification.

**Interfaces:**
- Consumes: local web `http://localhost:3000`, crawler sidecar `http://localhost:3040`
- Consumes: `/Users/pinion/Downloads/137F6F44-297B-4EAE-B3BF-023C02AA30CA_1_201_a.jpeg`

- [ ] **Step 1: 정적 검증 실행**

Run:

```bash
npm run test:web:ts
npm run lint:web
npx tsc --noEmit
npm run build:web
```

Expected: 모두 exit 0. 기존 warning이 있으면 새 warning과 구분해 기록한다.

- [ ] **Step 2: 개발 stack 상태 확인 또는 시작**

Run:

```bash
curl -fsS http://localhost:3000/home >/dev/null
curl -fsS http://localhost:3040/api/source/krx-polygon-fmp/market/quotes/current?codes=005930 >/dev/null
```

둘 중 하나라도 실패하고 stack이 실행 중이 아니면 프로젝트 규칙에 따라 `npm run dev`로 웹과 crawler를 함께 시작한다. 웹만 단독 실행하지 않는다.

- [ ] **Step 3: 실제 JPEG를 OCR route에 전송**

Python으로 JPEG를 data URL로 만들고 `/api/ocr`에 POST한다. 응답에서 다음을 assertion한다.

```text
rows.length === 7
SOOP.profitAmount < 0, SOOP.profitRate < 0
파미셀.profitAmount < 0, 파미셀.profitRate < 0
삼성 인버스 코스피 200 선물 ETN.profitAmount < 0, profitRate < 0
KODEX 코스피.averagePrice is approximately 58793.1429
SOOP.averagePrice === 64800
```

- [ ] **Step 4: 종목 식별과 live quote 검증**

OCR rows를 `/api/instruments/resolve`에 POST하고 다음 code 배열을 확인한다.

```text
226490, 100840, 042700, 003720, 067160, 005690, 530092
```

해당 코드를 `/api/quotes/current`에 요청하여 모든 항목의 `status === 'ok'`를 확인한다. 응답 가격과 정확 평단으로 최종 P/L을 계산하고, 앱의 `applyCurrentQuotesToHomeHoldings` 결과 부호와 수치가 같은지 확인한다.

- [ ] **Step 5: 보안 및 repository 상태 확인**

Run:

```bash
rm -f /tmp/jaroo-ocr-* /tmp/jaroo-live-*
git diff --check
git status --short
git log --oneline -5
```

Expected: 민감 request 파일이 제거되고, 계획된 파일만 변경/커밋되어 있다.

- [ ] **Step 6: GPT-5.6 xhigh fresh reviewer로 최종 검토**

현재 세션 전용 `openai-codex/gpt-5.6-sol`, thinking `xhigh` reviewer가 diff를 읽기 전용으로 검토한다. correctness, backward compatibility, test gaps, live-test evidence를 확인한다. blocker가 있으면 부모가 수정하고 관련 검증을 다시 실행한다.
