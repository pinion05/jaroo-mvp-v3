# Jaroo DeepScan Canonical Payload Implementation Plan

> For Hermes: use subagent-driven-development skill to execute this plan task-by-task.

Goal: deepscan 화면 전체를 crawler-owned JarooDeepScanPayload 계약으로 재정의하고, app route는 raw proxy/cache만 맡기고, page는 canonical payload를 렌더만 하게 만든다.

Architecture: 먼저 contracts를 고정한 뒤 crawler service가 canonical payload를 생성하고, crawler endpoint -> Next app route -> deepscan page 순으로 연결한다. 기존 `src/lib/deepscan-target.ts`의 heuristic copy 생성은 점진적으로 걷어내되, UI 레이아웃은 최대한 유지하고 데이터 소유권만 crawler 쪽으로 이동한다.

Tech Stack: Next.js 16 App Router, TypeScript strict, Node test, crawler Express server, workspace package `packages/contracts`, workspace package `packages/crawler`.

---

## Pre-flight code anchors

- Contracts placeholder: `packages/contracts/src/index.ts:1-52`
- Crawler public surface: `packages/crawler/src/index.js:1-137`
- Crawler endpoint registry: `packages/crawler/src/server.js:1697-2268`
- Existing inline payload builders: `packages/crawler/src/server.js:578-1669`
- Existing app proxy example: `src/app/api/deepscan/slim/route.ts:1-47`
- Existing deepscan target snapshot: `src/lib/jaroo-home-data.ts:833-870`
- Existing heuristic generator: `src/lib/deepscan-target.ts:1-501`
- Existing deepscan page blocks: `src/app/deepscan/page.tsx:258-585`

## Canonical block source matrix

### input
- Source: `targetSession.holding`, `selectedAt`, session handoff metadata
- Required fields:
  - `instrument.name`
  - `instrument.code?`
  - `instrument.ticker?`
  - `instrument.market?`
  - `instrument.kind?`
  - `holding.shares?`
  - `holding.averagePrice?`
  - `holding.evaluationAmount?`
  - `selectedAt?`
  - `sourceContext.from`
  - `sourceContext.sessionKey?`
  - `sourceContext.appliedAt?`
- Fallback: missing `code/ticker`이면 crawler가 `inputValidity.valid=false`, `metadata.errorCode='input-invalid'`, 각 major block은 `blocked`

### hero
- Source: instrument + holding + slim-derived/high-level crawler facts
- Required fields:
  - `headline`
  - `body`
  - `statusText`
  - `score`
  - `scoreLabel`
  - `scoreDelta`
  - `blockState/sourceRefs/fallback/error`
- Fallback: block-level fail-closed. fake heuristic headline 금지.

### committee
- Source: crawler-computed axis groups + 9 member reasons
- Required fields:
  - `axes[].label`
  - `axes[].score`
  - `axes[].scoreText`
  - `axes[].axisStatusText`
  - `axes[].subtitle`
  - `axes[].avgLabel`
  - `axes[].members[].shortLabel/title/reason/score/scoreLabel/tone/iconTone`
  - `blockState/sourceRefs/fallback/error`
- Fallback: failed axis/member는 빈 placeholder 카드가 아니라 block error 상태 노출

### insights
- Source: report/news/market/holding/system-derived insight items
- Required fields:
  - `sectionLabel`
  - `items[].sourceType`
  - `items[].sourceLabel`
  - `items[].date`
  - `items[].label`
  - `items[].title`
  - `items[].body`
  - `summaryTags[]`
  - `blockState/sourceRefs/fallback/error`
- Fallback: item-level fake news 생성 금지, block error 노출

### strategy
- Source: crawler-owned scenario synthesis
- Required fields:
  - `weekSignal`
  - `weekSignalTone`
  - `weekBadgeText`
  - `scenarioLabel`
  - `scenarioProbability`
  - `scenarioPeriod`
  - `scenarioCondition`
  - `currentPriceText`
  - `targetPriceText`
  - `scenarioDetails[]`
  - `otherScenarios[]`
  - `otherScenarioTags[]`
  - `blockState/sourceRefs/fallback/error`
- Fallback: scenario card를 heuristic 문구로 복원하지 말고 canonical fallback 문구만 사용

### sellNow
- Source: holding + current/target/return math + crawler commentary
- Required fields:
  - `realizedText`
  - `rows[].label/value/tag/tagTone/valueTone/emphasis`
  - `blockState/sourceRefs/fallback/error`
- Fallback: block error 상태 + 최소 설명

### portfolioSimulation
- Source: holding weight + crawler-computed before/after summary
- Required fields:
  - `beforeScore`
  - `afterScore`
  - `deltaLabel`
  - `caption`
  - `blockState/sourceRefs/fallback/error`
- Fallback: simulation unavailable 상태 노출, fake delta 금지

### metadata
- Required fields:
  - `generatedAt`
  - `version`
  - `degraded`
  - `errorCode?`
  - `debugId`
  - `inputValidity`
  - `sourceRefs`
  - `blockStatus.hero`
  - `blockStatus.committee`
  - `blockStatus.insights`
  - `blockStatus.strategy`
  - `blockStatus.sellNow`
  - `blockStatus.portfolioSimulation`

---

## Task 1: Create canonical contracts file

Objective: placeholder `JarooDeepScanInput/JarooDeepScanSummary`를 deepscan 전용 contracts 파일로 분리하고, canonical payload/block/meta 타입을 먼저 고정한다.

Files:
- Create: `packages/contracts/src/deepscan.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/contracts-deepscan-types.test.ts`

Step 1: Write failing type-shape test

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { JarooDeepScanPayload } from '../packages/contracts/src/deepscan'

test('JarooDeepScanPayload exposes all top-level blocks', () => {
  const payload = {} as JarooDeepScanPayload
  const keys = Object.keys(payload as Record<string, unknown>).sort()
  assert.deepEqual(keys, [
    'committee',
    'hero',
    'input',
    'insights',
    'metadata',
    'portfolioSimulation',
    'sellNow',
    'strategy',
  ])
})
```

Step 2: Run test to verify failure

Run: `npx tsx --test tests/contracts-deepscan-types.test.ts`
Expected: FAIL — `Cannot find module '../packages/contracts/src/deepscan'`

Step 3: Write minimal implementation

Add to `packages/contracts/src/deepscan.ts`:
- `DeepScanBlockState = 'ok' | 'error' | 'blocked'`
- `DeepScanSourceType = 'ocr' | 'holding' | 'report' | 'news' | 'market' | 'system'`
- `DeepScanSourceRef`, `DeepScanBlockFallback`, `DeepScanBlockError`, `DeepScanBlockMeta`
- `JarooDeepScanInput`, `JarooDeepScanHeroBlock`, `JarooDeepScanCommitteeBlock`, `JarooDeepScanInsightsBlock`, `JarooDeepScanStrategyBlock`, `JarooDeepScanSellNowBlock`, `JarooDeepScanPortfolioSimulationBlock`, `JarooDeepScanMetadata`, `JarooDeepScanPayload`
- keep `input.sourceContext` and `metadata.inputValidity` structured

Update `packages/contracts/src/index.ts`:
- move common instrument/ocr types there only
- `export * from './deepscan'`

Step 4: Run test to verify pass

Run: `npx tsx --test tests/contracts-deepscan-types.test.ts`
Expected: PASS

Step 5: Run type/build smoke

Run: `npm run build:web`
Expected: PASS

Step 6: Commit

```bash
git add packages/contracts/src/deepscan.ts packages/contracts/src/index.ts tests/contracts-deepscan-types.test.ts
git commit -m "feat: add deepscan canonical contracts"
```

---

## Task 2: Create crawler payload service baseline

Objective: deepscan canonical payload를 만드는 service module과 fail-closed skeleton/input-invalid 처리 규칙을 만든다.

Files:
- Create: `packages/crawler/src/services/deepscan-payload.js`
- Modify: `packages/crawler/src/index.js`
- Test: `packages/crawler/test/deepscan-payload.test.cjs`

Step 1: Write failing service test

```js
const test = require('node:test')
const assert = require('node:assert/strict')

test('buildJarooDeepScanPayload returns input-invalid payload when code/ticker missing', async () => {
  const { buildJarooDeepScanPayload } = await import('../src/services/deepscan-payload.js')
  const payload = await buildJarooDeepScanPayload({ instrument: { name: '삼성전자' } })

  assert.equal(payload.metadata.inputValidity.valid, false)
  assert.equal(payload.metadata.errorCode, 'input-invalid')
  assert.equal(payload.hero.blockState, 'blocked')
  assert.equal(payload.committee.blockState, 'blocked')
})
```

Step 2: Run test to verify failure

Run: `npm --prefix packages/crawler run test -- deepscan-payload.test.cjs`
Expected: FAIL — module missing

Step 3: Write minimal implementation

Implement in `packages/crawler/src/services/deepscan-payload.js`:
- `createDeepScanSourceRef()`
- `createDeepScanBlockError()`
- `createBlockedBlockMeta()`
- `createErrorBlockMeta()`
- `createOkBlockMeta()`
- `createInputInvalidPayload(input)`
- `buildJarooDeepScanPayload(input)`

Rules:
- if both `input.instrument.code` and `input.instrument.ticker` are absent → return canonical input-invalid payload
- initial happy-path payload may still use temporary deterministic placeholder content, but only inside crawler service and only marked with real `sourceRefs/fallback`; no page heuristic reuse
- every major block must always include `blockState/sourceRefs/fallback/error`

Update `packages/crawler/src/index.js`:
- export `buildJarooDeepScanPayload`

Step 4: Run targeted tests

Run: `npm --prefix packages/crawler run test -- deepscan-payload.test.cjs`
Expected: PASS

Step 5: Run crawler syntax check

Run: `npm --prefix packages/crawler run check`
Expected: PASS

Step 6: Commit

```bash
git add packages/crawler/src/services/deepscan-payload.js packages/crawler/src/index.js packages/crawler/test/deepscan-payload.test.cjs
git commit -m "feat: add deepscan payload service baseline"
```

---

## Task 3: Register crawler canonical endpoint

Objective: crawler server에 canonical deepscan endpoint를 등록하고 raw payload + meaningful HTTP status를 보장한다.

Files:
- Modify: `packages/crawler/src/server.js`
- Test: `packages/crawler/test/deepscan-endpoint.test.cjs`

Step 1: Write failing endpoint-definition test

```js
const test = require('node:test')
const assert = require('node:assert/strict')

test('deepscan canonical endpoint definition is registered', async () => {
  const { endpointDefinitions } = await import('../src/server.js')
  const definition = endpointDefinitions.find((item) => item.id === 'deepscan-canonical')

  assert.ok(definition)
  assert.equal(definition.primaryPath, '/api/deepscan')
  assert.equal(definition.rawSuccess, true)
})
```

Step 2: Run test to verify failure

Run: `npm --prefix packages/crawler run test -- deepscan-endpoint.test.cjs`
Expected: FAIL — definition missing

Step 3: Write minimal implementation

In `packages/crawler/src/server.js`:
- import `buildJarooDeepScanPayload` from `./services/deepscan-payload.js`
- add endpoint id `deepscan-canonical`
- primary path: `/api/deepscan`
- aliases: `['/crawl/deepscan']`
- query: `market(optional)`, `code(optional)`, `ticker(optional)`, `name(optional)`, `shares(optional)`, `averagePrice(optional)`, `evaluationAmount(optional)`, `selectedAt(optional)`, `from(optional)`
- handler builds `JarooDeepScanInput` from query and calls service
- if payload.metadata.errorCode === 'input-invalid' return raw payload with 400
- success/partial success => 200
- unexpected internal error => 500 or 502 with canonical error payload when possible

Step 4: Add response behavior tests

Also assert:
- `GET /api/deepscan?market=KR&code=005930&name=삼성전자` returns status 200 and raw payload body
- `GET /api/deepscan?name=삼성전자` returns status 400 and raw payload body

Step 5: Run tests

Run: `npm --prefix packages/crawler run test -- deepscan-endpoint.test.cjs`
Expected: PASS

Step 6: Run full crawler tests

Run: `npm --prefix packages/crawler run test`
Expected: PASS

Step 7: Commit

```bash
git add packages/crawler/src/server.js packages/crawler/test/deepscan-endpoint.test.cjs
git commit -m "feat: add deepscan crawler endpoint"
```

---

## Task 4: Add Next app proxy route

Objective: app-side `/api/deepscan` route를 만들고 crawler raw payload를 그대로 프록시한다.

Files:
- Create: `src/app/api/deepscan/route.ts`
- Create: `src/app/api/deepscan/route.test.ts`
- Reference: `src/app/api/deepscan/slim/route.ts:1-47`

Step 1: Write failing proxy path test

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDeepScanCanonicalUpstreamPath } from './route'

test('deepscan canonical proxy passes through market/code query', () => {
  assert.equal(
    buildDeepScanCanonicalUpstreamPath(new URLSearchParams('market=KR&code=005930&name=삼성전자')),
    '/api/deepscan?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90',
  )
})
```

Step 2: Run test to verify failure

Run: `npx tsx --test src/app/api/deepscan/route.test.ts`
Expected: FAIL — route missing

Step 3: Write minimal implementation

Create `src/app/api/deepscan/route.ts`:
- helper `buildDeepScanCanonicalUpstreamPath(searchParams)`
- allow only canonical query keys used by crawler endpoint
- build upstream URL with `buildCrawlerUrl(getCrawlerBaseUrl(), upstreamPath)`
- proxy `response.text()` 그대로 반환
- proxy error 시에만 local 400 JSON error

Step 4: Run targeted tests

Run: `npx tsx --test src/app/api/deepscan/route.test.ts`
Expected: PASS

Step 5: Commit

```bash
git add src/app/api/deepscan/route.ts src/app/api/deepscan/route.test.ts
git commit -m "feat: add deepscan app proxy route"
```

---

## Task 5: Add page-side canonical fetch adapter

Objective: current `targetSession`을 canonical request로 변환하고, page에서 raw payload 상태를 읽을 수 있는 pure helper를 만든다.

Files:
- Create: `src/lib/deepscan-canonical.ts`
- Create: `src/lib/deepscan-canonical.test.ts`
- Reference: `src/lib/jaroo-home-data.ts:833-870`

Step 1: Write failing adapter test

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDeepScanCanonicalQuery } from './deepscan-canonical'

test('buildDeepScanCanonicalQuery prefers code/ticker over name-only input', () => {
  const query = buildDeepScanCanonicalQuery({
    holding: {
      name: '삼성전자',
      code: '005930',
      identifierCode: '005930',
      shares: '10주',
      averagePrice: '70,000원',
      evaluationAmount: '750,000원',
    },
    selectedAt: '2026-04-15T15:00:00.000Z',
  })

  assert.equal(query.get('code'), '005930')
  assert.equal(query.get('name'), '삼성전자')
})
```

Step 2: Run test to verify failure

Run: `npx tsx --test src/lib/deepscan-canonical.test.ts`
Expected: FAIL — helper missing

Step 3: Write minimal implementation

Create helper module with:
- `buildDeepScanCanonicalQuery(targetSession)`
- `fetchDeepScanCanonicalPayload(targetSession, fetcher = fetch)`
- `isDeepScanPayloadReady(payload)`
- optional `readBlockedReason(payload)`

Rules:
- request builder must pass `code || identifierCode`, `ticker || identifierTicker`, `name`, `shares`, `averagePrice`, `evaluationAmount`, `selectedAt`, `from='home-handoff'`
- no heuristic copy generation here
- this module only does query building + fetch + payload guards

Step 4: Run targeted tests

Run: `npx tsx --test src/lib/deepscan-canonical.test.ts`
Expected: PASS

Step 5: Commit

```bash
git add src/lib/deepscan-canonical.ts src/lib/deepscan-canonical.test.ts
git commit -m "feat: add deepscan canonical fetch helpers"
```

---

## Task 6: Migrate deepscan page to canonical payload rendering

Objective: `src/app/deepscan/page.tsx`가 더 이상 heuristic text generator를 직접 신뢰하지 않고 canonical payload 상태를 기준으로 hero/committee/insights/strategy/sellNow/portfolioSimulation를 렌더하게 만든다.

Files:
- Modify: `src/app/deepscan/page.tsx:258-585`
- Modify: `src/lib/deepscan-target.ts` (only to shrink/remodel legacy snapshot helpers if still needed)
- Test: `tests/deepscan-target.test.ts`
- Optional create: `src/lib/deepscan-page-projection.ts`

Step 1: Write failing UI-facing test

Add to `tests/deepscan-target.test.ts` a new case that verifies:
- page projection uses canonical hero headline/body when payload is available
- blocked payload does not fall back to old samsung fixture text

Step 2: Run test to verify failure

Run: `npx tsx --test tests/deepscan-target.test.ts`
Expected: FAIL — page still depends on heuristic-only data

Step 3: Write minimal implementation

Implementation shape:
- keep `targetSession` subscription as request seed only
- add client fetch state in `page.tsx`: `idle | loading | success | error`
- fetch `/api/deepscan?...` on target change
- while loading: show clear loading state, not fake analysis
- on success: render each block directly from payload fields
- if a block has `blockState !== 'ok'`: render that section’s fallback/error state, not heuristic copy
- if payload is input-invalid: render invalid-state hero + blocked sections
- retain existing layout/styles/classes as much as possible

Important minimization rule:
- do not redesign tabs/cards
- only swap data source ownership and fallback behavior

Step 4: Run targeted tests

Run: `npx tsx --test tests/deepscan-target.test.ts src/lib/deepscan-canonical.test.ts src/app/api/deepscan/route.test.ts`
Expected: PASS

Step 5: Run lint/build

Run: `npm run lint:web`
Expected: PASS

Run: `npm run build:web`
Expected: PASS

Step 6: Commit

```bash
git add src/app/deepscan/page.tsx src/lib/deepscan-target.ts tests/deepscan-target.test.ts src/lib/deepscan-page-projection.ts
 git commit -m "feat: render deepscan from canonical payload"
```

---

## Task 7: Final integration verification

Objective: crawler/app/page contract drift 없이 end-to-end smoke를 확인한다.

Files:
- No required code changes
- If needed, document findings in `docs/architecture/jaroo-v3-monorepo-integration.md`

Step 1: Run crawler tests

Run: `npm --prefix packages/crawler run test`
Expected: PASS

Step 2: Run web tests

Run: `npx tsx --test tests/contracts-deepscan-types.test.ts tests/deepscan-target.test.ts src/lib/deepscan-canonical.test.ts src/app/api/deepscan/route.test.ts src/app/api/deepscan/slim/route.test.ts`
Expected: PASS

Step 3: Run lint/build

Run: `npm run lint:web && npm run build:web`
Expected: PASS

Step 4: Smoke crawler endpoint

Run:
```bash
node -e "fetch('http://127.0.0.1:3040/api/deepscan?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90').then(r=>r.text()).then(console.log)"
```
Expected: raw `JarooDeepScanPayload` JSON body

Step 5: Smoke app proxy

Run:
```bash
node -e "fetch('http://127.0.0.1:3000/api/deepscan?market=KR&code=005930&name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90').then(r=>r.text()).then(console.log)"
```
Expected: same raw payload shape

Step 6: Manual UI smoke

Check:
- `/deepscan` hero uses canonical `headline/body`
- no Samsung hardcoded fallback when selected holding differs
- blocked/input-invalid case shows explicit unavailable state
- 9인 위원, 인사이트, 시나리오, 지금 팔면, 포트폴리오 시뮬 all derive from payload blocks

Step 7: Final commit if verification-only changes occurred

```bash
git add -A
git commit -m "test: verify deepscan canonical integration"
```

---

## Notes for execution

- TDD is mandatory for code tasks: RED -> GREEN -> REFACTOR.
- Fresh delegate_task per task. Do not let two child agents edit the same files concurrently.
- `src/lib/deepscan-target.ts` should end as a seed/fallback helper only, not the owner of analysis copy.
- If actual crawler source composition for a block is still not ready, return canonical `error/blocked` metadata instead of fabricating prose in the page.
- Keep route payload raw. Do not reintroduce `{ ok, data, error }` envelope for canonical deepscan.
