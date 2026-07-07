# Portfolio Auto-Save/Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a logged-in user's applied OCR portfolio to the `portfolio_holdings` table and reload it across sessions/devices, replacing the current volatile `sessionStorage`-only behavior.

**Architecture:** A new service-role Supabase client + `/api/portfolio` GET/POST route mediate all DB access (userId derived server-side from the session). SAVE fires from the two existing apply call-sites; LOAD replaces the Home screen's session-only bootstrap with an async DB-first resolver (session cache is a logged-out/error fallback only). A `sync_user_portfolio` RPC does an atomic per-user replace (DELETE+INSERT).

**Tech Stack:** Next.js 16.2.3 (App Router, `'use client'`), React 19, `@supabase/ssr` 0.12 (cookie clients), `@supabase/supabase-js` 2.108 (service-role client), Postgres/Supabase (RPC + RLS), TypeScript 5, `node:test` + `node:assert/strict`.

## Global Constraints

- Test runner: `npm run test:web:ts` (colocated `*.test.ts`, run via `tsx --test`).
- Build: `npm run build` (must exit 0; pre-existing tsc errors in `src/lib/*.test.ts` are unrelated and present on master — do not fix them).
- Korean UI copy (e.g. "포트폴리오를 불러오는 중…").
- `service_role` client is **server-only** (route handlers / server modules) — never import `@/lib/supabase/service` from a `'use client'` file.
- Never trust `user_id` from the client — always derive from `auth.getUser()` server-side.
- Reuse existing helpers (`parseOcrNumber`, `buildIdentifierLabel`, `buildPortfolioItemsFromAppliedHomePortfolioRows`) — do not duplicate their logic.

---

## File Structure

- **Create** `src/lib/supabase/config.test.ts` — tests for the new service-role config helper.
- **Modify** `src/lib/supabase/config.ts` — add `getSupabaseServiceRoleKey()` + `assertSupabaseServiceConfig()`.
- **Create** `src/lib/supabase/service.ts` — `createSupabaseServiceClient()` (service_role, server-only).
- **Create** `src/lib/portfolio-sync.ts` — DTO types, pure mappers, `syncPortfolioToServer()`, `fetchPortfolio()`, `parsePortfolioFetchResponse()`.
- **Create** `src/lib/portfolio-sync.test.ts` — mapper + response-parser unit tests.
- **Create** `src/app/api/portfolio/route.ts` — `GET`/`POST` + exported pure `getPortfolioRowsValidationError`.
- **Create** `src/app/api/portfolio/route.test.ts` — validation helper test.
- **Create** `supabase/migrations/20260706120000_portfolio_autosave.sql` — schema capture + trigger + RPC + RLS.
- **Modify** `src/app/ocr/page.tsx` — import + SAVE hook in `handleContinue`.
- **Modify** `src/components/merge/jaroo-merge-screen.tsx` — import + SAVE hook in `handleApply`.
- **Modify** `src/components/home/jaroo-home-screen.tsx` — import + loading state + async LOAD effect + gated `/screenshot` effect + loading overlay.

---

### Task 1: Supabase service-role config + client

**Files:**
- Modify: `src/lib/supabase/config.ts`
- Create: `src/lib/supabase/service.ts`
- Test: `src/lib/supabase/config.test.ts`

**Interfaces:**
- Consumes: `getSupabaseUrl()` (existing in `config.ts`), env `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `getSupabaseServiceRoleKey(): string`, `assertSupabaseServiceConfig(): { url, serviceRoleKey }` (in `config.ts`); `createSupabaseServiceClient()` (in `service.ts`) — used by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/supabase/config.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { assertSupabaseServiceConfig } from './config'

test('assertSupabaseServiceConfig는 service-role key가 없으면 throw한다', () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  delete process.env.SUPABASE_SERVICE_ROLE_KEY

  try {
    assert.throws(() => assertSupabaseServiceConfig(), /service-role key is not configured/)
  } finally {
    if (previousKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
    }
    if (previousUrl !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    }
  }
})

test('assertSupabaseServiceConfig는 url과 key가 있으면 설정을 반환한다', () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

  try {
    const config = assertSupabaseServiceConfig()
    assert.equal(config.url, 'https://example.supabase.co')
    assert.equal(config.serviceRoleKey, 'service-role-key')
  } finally {
    if (previousKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
    if (previousUrl !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    }
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web:ts 2>&1 | grep -A3 "config.test"`
Expected: FAIL — `assertSupabaseServiceConfig is not a function` (not yet exported).

- [ ] **Step 3: Add the config helpers**

Append to `src/lib/supabase/config.ts`:

```ts
export function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
}

export function assertSupabaseServiceConfig(): { url: string; serviceRoleKey: string } {
  const url = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase URL/service-role key is not configured')
  }

  return { url, serviceRoleKey }
}
```

- [ ] **Step 4: Create the service-role client**

Create `src/lib/supabase/service.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { assertSupabaseServiceConfig } from './config'

// Server-only. Bypasses RLS. Never import from a 'use client' module.
export function createSupabaseServiceClient() {
  const { url, serviceRoleKey } = assertSupabaseServiceConfig()

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:web:ts 2>&1 | grep -E "config.test|pass|fail" | head`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase/config.ts src/lib/supabase/config.test.ts src/lib/supabase/service.ts
git commit -m "feat(supabase): add service-role client for server-side data access"
```

---

### Task 2: portfolio-sync pure mappers

**Files:**
- Create: `src/lib/portfolio-sync.ts`
- Test: `src/lib/portfolio-sync.test.ts`

**Interfaces:**
- Consumes: `AppliedHomePortfolioRow` (from `@/lib/jaroo-home-data`), `parseOcrNumber` (from `@/lib/screenshot-ocr`), `buildIdentifierLabel` (from `@/lib/workflow-types`).
- Produces: `PortfolioSaveRow`, `PortfolioDbRow`, `mapAppliedRowsToSaveRows(rows): PortfolioSaveRow[]`, `mapDbRowsToAppliedRows(rows): AppliedHomePortfolioRow[]` — used by Task 3 and Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/portfolio-sync.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'
import { mapAppliedRowsToSaveRows, mapDbRowsToAppliedRows } from './portfolio-sync'

function createRow(overrides: Partial<AppliedHomePortfolioRow> = {}): AppliedHomePortfolioRow {
  return {
    name: '삼성전자',
    resolvedName: '삼성전자',
    quantity: '10',
    averagePrice: '70,000',
    profitRate: '+5%',
    evaluationAmount: '735,000',
    resolvedCode: '005930',
    code: '005930',
    resolvedTicker: undefined,
    ticker: undefined,
    resolvedMarket: 'KOSPI',
    resolvedMarketTone: 'kospi',
    resolvedKind: 'stock',
    ...overrides,
  }
}

test('mapAppliedRowsToSaveRows는 OCR row를 저장 DTO로 변환한다 (콤마/단위 제거, sort_order)', () => {
  const [row] = mapAppliedRowsToSaveRows([createRow(), createRow({ name: 'AAPL', resolvedMarketTone: 'nasdaq', resolvedKind: 'stock', resolvedTicker: 'AAPL', resolvedCode: undefined, code: undefined })])

  assert.equal(row.name, '삼성전자')
  assert.equal(row.quantity, 10)
  assert.equal(row.average_price, 70000)
  assert.equal(row.evaluation_amount, 735000)
  assert.equal(row.code, '005930')
  assert.equal(row.market_tone, 'kospi')
  assert.equal(row.kind, 'stock')
  assert.equal(row.source, 'ocr')
  assert.equal(row.sort_order, 0)
})

test('mapAppliedRowsToSaveRows는 두 번째 row의 sort_order를 1로 한다', () => {
  const rows = mapAppliedRowsToSaveRows([createRow(), createRow({ name: 'A' })])
  assert.equal(rows[0].sort_order, 0)
  assert.equal(rows[1].sort_order, 1)
})

test('mapAppliedRowsToSaveRows는 파싱 불가 숫자를 0으로 채운다 (NOT NULL 컬럼)', () => {
  const [row] = mapAppliedRowsToSaveRows([createRow({ quantity: 'N/A', averagePrice: '' })])
  assert.equal(row.quantity, 0)
  assert.equal(row.average_price, 0)
})

test('mapAppliedRowsToSaveRows는 identifier_label을 ticker · code 로 만든다', () => {
  const [row] = mapAppliedRowsToSaveRows([createRow({ resolvedTicker: 'AAPL', resolvedCode: undefined, code: undefined })])
  assert.equal(row.identifier_label, 'AAPL')
})

test('mapDbRowsToAppliedRows는 DB row를 AppliedHomePortfolioRow로 round-trip 한다', () => {
  const [saveRow] = mapAppliedRowsToSaveRows([createRow()])
  const [roundTrip] = mapDbRowsToAppliedRows([saveRow])
  assert.equal(roundTrip.name, '삼성전자')
  assert.equal(roundTrip.resolvedName, '삼성전자')
  assert.equal(roundTrip.quantity, '10')
  assert.equal(roundTrip.averagePrice, '70000')
  assert.equal(roundTrip.profitRate, '') // not stored; recomputed on load
  assert.equal(roundTrip.evaluationAmount, '735000')
  assert.equal(roundTrip.resolvedMarketTone, 'kospi')
  assert.equal(roundTrip.resolvedKind, 'stock')
})

test('mapDbRowsToAppliedRows는 null evaluation_amount를 빈 문자열로 채운다', () => {
  const [roundTrip] = mapDbRowsToAppliedRows([{ name: 'X', quantity: 1, average_price: 100, evaluation_amount: null, sort_order: 0, source: 'ocr' }])
  assert.equal(roundTrip.evaluationAmount, '')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:web:ts 2>&1 | grep -A3 "portfolio-sync.test"`
Expected: FAIL — cannot resolve `./portfolio-sync`.

- [ ] **Step 3: Write the mappers**

Create `src/lib/portfolio-sync.ts`:

```ts
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { type AppliedHomePortfolioRow, type AveragePriceCurrency } from '@/lib/jaroo-home-data'
import { buildIdentifierLabel } from '@/lib/workflow-types'

export type PortfolioSaveRow = {
  name: string
  code?: string
  ticker?: string
  market?: string
  market_tone?: AppliedHomePortfolioRow['resolvedMarketTone']
  kind?: AppliedHomePortfolioRow['resolvedKind']
  quantity: number
  average_price: number
  average_price_currency?: AveragePriceCurrency
  evaluation_amount?: number | null
  identifier_label?: string
  sort_order: number
  source: string
}

export type PortfolioDbRow = PortfolioSaveRow

export function mapAppliedRowsToSaveRows(rows: AppliedHomePortfolioRow[]): PortfolioSaveRow[] {
  return rows.map((row, index) => {
    const name = (row.resolvedName?.trim() || row.name.trim())
    const ticker = row.resolvedTicker?.trim() || row.ticker?.trim() || undefined
    const code = row.resolvedCode?.trim() || row.code?.trim() || undefined

    return {
      name,
      code,
      ticker,
      market: row.resolvedMarket?.trim() || undefined,
      market_tone: row.resolvedMarketTone,
      kind: row.resolvedKind,
      quantity: parseOcrNumber(row.quantity) ?? 0,
      average_price: parseOcrNumber(row.averagePrice) ?? 0,
      average_price_currency: row.averagePriceCurrency,
      evaluation_amount: parseOcrNumber(row.evaluationAmount) ?? null,
      identifier_label: buildIdentifierLabel(ticker, code),
      sort_order: index,
      source: 'ocr',
    }
  })
}

export function mapDbRowsToAppliedRows(rows: PortfolioDbRow[]): AppliedHomePortfolioRow[] {
  return rows.map((row) => {
    const name = (row.name ?? '').trim()
    return {
      name,
      resolvedName: name,
      quantity: row.quantity != null ? String(row.quantity) : '',
      averagePrice: row.average_price != null ? String(row.average_price) : '',
      profitRate: '',
      evaluationAmount: row.evaluation_amount != null ? String(row.evaluation_amount) : '',
      resolvedCode: row.code,
      code: row.code,
      resolvedTicker: row.ticker,
      ticker: row.ticker,
      resolvedMarket: row.market,
      resolvedMarketTone: row.market_tone,
      resolvedKind: row.kind,
      averagePriceCurrency: row.average_price_currency,
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:web:ts 2>&1 | grep -E "portfolio-sync.test|pass|fail" | head`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio-sync.ts src/lib/portfolio-sync.test.ts
git commit -m "feat(portfolio): add row<->save-row mappers"
```

---

### Task 3: portfolio-sync network functions

**Files:**
- Modify: `src/lib/portfolio-sync.ts` (append)
- Test: `src/lib/portfolio-sync.test.ts` (append)

**Interfaces:**
- Consumes: `mapAppliedRowsToSaveRows`, `mapDbRowsToAppliedRows` (Task 2), `/api/portfolio` (Task 4 — not yet built; tests here cover only the pure parser).
- Produces: `PortfolioFetchResult`, `parsePortfolioFetchResponse(response)`, `fetchPortfolio()`, `syncPortfolioToServer(rows)` — used by Tasks 6 & 7.

- [ ] **Step 1: Write the failing test for the response parser**

Append to `src/lib/portfolio-sync.test.ts`:

```ts
import { parsePortfolioFetchResponse } from './portfolio-sync'

function createResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('parsePortfolioFetchResponse: 401 → logged-out', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(401, { error: 'unauthorized' }))
  assert.equal(result.status, 'logged-out')
})

test('parsePortfolioFetchResponse: 200 + rows → rows(AppliedHomePortfolioRow[])', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(200, { rows: [{ name: 'A', quantity: 1, average_price: 100, sort_order: 0, source: 'ocr' }] }))
  assert.equal(result.status, 'rows')
  if (result.status === 'rows') {
    assert.equal(result.rows[0].name, 'A')
    assert.equal(result.rows[0].quantity, '1')
  }
})

test('parsePortfolioFetchResponse: 200 + 빈 배열 → empty', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(200, { rows: [] }))
  assert.equal(result.status, 'empty')
})

test('parsePortfolioFetchResponse: 500 → error', async () => {
  const result = await parsePortfolioFetchResponse(createResponse(500, { error: 'load-failed' }))
  assert.equal(result.status, 'error')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:web:ts 2>&1 | grep -A3 "parsePortfolioFetchResponse"`
Expected: FAIL — `parsePortfolioFetchResponse` not exported.

- [ ] **Step 3: Add the types + functions**

Append to `src/lib/portfolio-sync.ts`:

```ts
export type PortfolioFetchResult =
  | { status: 'rows'; rows: AppliedHomePortfolioRow[] }
  | { status: 'empty' }
  | { status: 'logged-out' }
  | { status: 'error' }

export async function parsePortfolioFetchResponse(response: Response): Promise<PortfolioFetchResult> {
  if (response.status === 401) {
    return { status: 'logged-out' }
  }
  if (!response.ok) {
    return { status: 'error' }
  }

  const payload = (await response.json()) as { rows?: PortfolioDbRow[] }
  const rows = Array.isArray(payload?.rows) ? payload.rows : []

  if (rows.length === 0) {
    return { status: 'empty' }
  }

  return { status: 'rows', rows: mapDbRowsToAppliedRows(rows) }
}

export async function fetchPortfolio(): Promise<PortfolioFetchResult> {
  try {
    const response = await fetch('/api/portfolio', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    })
    return await parsePortfolioFetchResponse(response)
  } catch {
    return { status: 'error' }
  }
}

export async function syncPortfolioToServer(rows: AppliedHomePortfolioRow[]): Promise<{ ok: boolean; saved?: number }> {
  try {
    const response = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: mapAppliedRowsToSaveRows(rows) }),
    })

    if (response.status === 401) {
      return { ok: false } // logged-out: silent no-op
    }
    if (!response.ok) {
      return { ok: false }
    }

    const payload = (await response.json()) as { saved?: number }
    return { ok: true, saved: payload.saved }
  } catch {
    return { ok: false }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:web:ts 2>&1 | grep -E "portfolio-sync.test|pass|fail" | head`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio-sync.ts src/lib/portfolio-sync.test.ts
git commit -m "feat(portfolio): add fetch/save network helpers + response parser"
```

---

### Task 4: /api/portfolio route

**Files:**
- Create: `src/app/api/portfolio/route.ts`
- Test: `src/app/api/portfolio/route.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` (`@/lib/supabase/server`), `createSupabaseServiceClient` (Task 1), RPC `sync_user_portfolio` (Task 5 — handler is wired now; RPC applied in Task 5).
- Produces: `GET /api/portfolio` → `{ rows: PortfolioDbRow[] }` (401 when logged out); `POST /api/portfolio` `{ rows: PortfolioSaveRow[] }` → `{ saved: number }` (401 logged out, 400 invalid). Exported pure `getPortfolioRowsValidationError`.

- [ ] **Step 1: Write the failing test for the validator**

Create `src/app/api/portfolio/route.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_PORTFOLIO_ROWS, getPortfolioRowsValidationError } from './route'

test('portfolio API는 rows가 배열이 아니면 거절한다', () => {
  assert.equal(getPortfolioRowsValidationError(undefined), 'rows must be an array.')
  assert.equal(getPortfolioRowsValidationError('x'), 'rows must be an array.')
})

test('portfolio API는 빈 rows를 허용한다 (전체 삭제 = clear)', () => {
  assert.equal(getPortfolioRowsValidationError([]), '')
})

test('portfolio API는 rows 상한을 넘기면 거절한다', () => {
  const rows = Array.from({ length: MAX_PORTFOLIO_ROWS + 1 }, (_, index) => ({ name: `종목${index}`, quantity: 1, average_price: 100, sort_order: index, source: 'ocr' }))
  assert.equal(getPortfolioRowsValidationError(rows), `Too many rows. Up to ${MAX_PORTFOLIO_ROWS} rows are supported.`)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:web:ts 2>&1 | grep -A3 "portfolio/route.test"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

Create `src/app/api/portfolio/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import type { PortfolioDbRow, PortfolioSaveRow } from '@/lib/portfolio-sync'

export const runtime = 'nodejs'

export const MAX_PORTFOLIO_ROWS = 200

const PORTFOLIO_COLUMNS = [
  'name',
  'code',
  'ticker',
  'market',
  'market_tone',
  'kind',
  'quantity',
  'average_price',
  'average_price_currency',
  'evaluation_amount',
  'identifier_label',
  'sort_order',
  'source',
].join(',')

export function getPortfolioRowsValidationError(rows: unknown): string {
  if (!Array.isArray(rows)) {
    return 'rows must be an array.'
  }
  if (rows.length > MAX_PORTFOLIO_ROWS) {
    return `Too many rows. Up to ${MAX_PORTFOLIO_ROWS} rows are supported.`
  }
  return ''
}

async function resolvePortfolioUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      return null
    }
    return data.user.id
  } catch {
    return null
  }
}

export async function GET() {
  const userId = await resolvePortfolioUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service
    .from('portfolio_holdings')
    .select(PORTFOLIO_COLUMNS)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'load-failed' }, { status: 500 })
  }

  return NextResponse.json({ rows: (data ?? []) as PortfolioDbRow[] })
}

export async function POST(request: Request) {
  const userId = await resolvePortfolioUserId()
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { rows?: unknown }
  try {
    body = (await request.json()) as { rows?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 })
  }

  const validationError = getPortfolioRowsValidationError(body.rows)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service.rpc('sync_user_portfolio', {
    p_user_id: userId,
    p_rows: body.rows as PortfolioSaveRow[],
  })

  if (error) {
    return NextResponse.json({ error: 'sync-failed' }, { status: 500 })
  }

  return NextResponse.json({ saved: (data as number) ?? 0 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:web:ts 2>&1 | grep -E "portfolio/route.test|pass|fail" | head`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the build compiles (route imports the not-yet-existing RPC; compile is fine, runtime needs Task 5)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "api/portfolio" | head`
Expected: no errors referencing `api/portfolio` (pre-existing unrelated errors elsewhere may remain).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/portfolio/route.ts src/app/api/portfolio/route.test.ts
git commit -m "feat(api): add /api/portfolio GET/POST (service-role, server-derived userId)"
```

---

### Task 5: Phase 0 migration — schema capture + trigger + RPC + RLS

**Files:**
- Create: `supabase/migrations/20260706120000_portfolio_autosave.sql`

**Interfaces:**
- Consumes: existing `public.set_updated_at()` (from `20260626084500_create_auth_profiles.sql`).
- Produces: table `public.portfolio_holdings` (idempotent capture), trigger `portfolio_holdings_set_updated_at`, function `public.sync_user_portfolio(uuid, jsonb)` (service_role-only), RLS own-rows policy.

> This is SQL infrastructure — not unit-testable in-repo. Verification is apply + introspection queries in the Supabase SQL editor.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260706120000_portfolio_autosave.sql`:

```sql
-- Portfolio auto-save/load: capture remote portfolio_holdings schema + atomic replace RPC + RLS.
-- Depends on public.set_updated_at() from 20260626084500_create_auth_profiles.sql.

-- 1. schema capture (no-op on the existing remote table)
create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  code text,
  ticker text,
  market text,
  market_tone text,
  kind text,
  quantity numeric not null,
  average_price numeric not null,
  average_price_currency text,
  evaluation_amount numeric,
  identifier_label text,
  sort_order integer not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_holdings_user_id_idx on public.portfolio_holdings(user_id);

drop trigger if exists portfolio_holdings_set_updated_at on public.portfolio_holdings;
create trigger portfolio_holdings_set_updated_at
  before update on public.portfolio_holdings
  for each row execute function public.set_updated_at();

-- 2. atomic per-user replace RPC (service_role only; serialized per user)
create or replace function public.sync_user_portfolio(p_user_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare inserted_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  delete from public.portfolio_holdings where user_id = p_user_id;

  insert into public.portfolio_holdings (
    user_id, name, code, ticker, market, market_tone, kind,
    quantity, average_price, average_price_currency, evaluation_amount,
    identifier_label, sort_order, source
  )
  select
    p_user_id,
    r->>'name',
    nullif(r->>'code',''),
    nullif(r->>'ticker',''),
    nullif(r->>'market',''),
    nullif(r->>'market_tone',''),
    nullif(r->>'kind',''),
    case when (r->>'quantity')      ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'quantity')::numeric      else 0 end,
    case when (r->>'average_price') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'average_price')::numeric else 0 end,
    nullif(r->>'average_price_currency',''),
    case when (r->>'evaluation_amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'evaluation_amount')::numeric else null end,
    nullif(r->>'identifier_label',''),
    case when (r->>'sort_order') ~ '^-?[0-9]+$' then (r->>'sort_order')::integer else (idx - 1) end,
    coalesce(nullif(r->>'source',''), 'ocr')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, idx)
  where nullif(r->>'name','') is not null;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.sync_user_portfolio(uuid, jsonb) from public, anon, authenticated;

-- 3. RLS (defense-in-depth; service_role bypasses regardless)
alter table public.portfolio_holdings enable row level security;

drop policy if exists "portfolio_holdings own rows" on public.portfolio_holdings;
create policy "portfolio_holdings own rows" on public.portfolio_holdings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration to the dev Supabase**

Open the Supabase SQL editor for the project (`hrfpnawmlcoaygipulpm`) and run the entire file contents. (Or, if a local psql connection is configured: `psql "$DATABASE_URL" -f supabase/migrations/20260706120000_portfolio_autosave.sql`.)

- [ ] **Step 3: Verify via introspection queries**

In the Supabase SQL editor, run:

```sql
select proname from pg_proc where proname = 'sync_user_portfolio';
-- Expected: one row, sync_user_portfolio

select relrowsecurity from pg_class where relname = 'portfolio_holdings';
-- Expected: true

select tgname from pg_trigger where tgname = 'portfolio_holdings_set_updated_at';
-- Expected: one row
```

Expected: all three return one row each (function exists, RLS enabled, trigger present).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260706120000_portfolio_autosave.sql
git commit -m "feat(db): portfolio_holdings schema capture + sync_user_portfolio RPC + RLS"
```

---

### Task 6: SAVE hook in the two apply call-sites

**Files:**
- Modify: `src/app/ocr/page.tsx` (import + `handleContinue`)
- Modify: `src/components/merge/jaroo-merge-screen.tsx` (import + `handleApply`)

**Interfaces:**
- Consumes: `syncPortfolioToServer(rows: AppliedHomePortfolioRow[])` (Task 3), `applyResult.persistedRows` (existing on `AppliedPortfolioBuildResult`).
- Produces: a fire-and-forget DB save after a successful apply (logged-in only; 401 is a silent no-op).

> **Documented deviation from the spec (please confirm at review):** the spec says "SAVE failure → toast". There is no shared toast system in the app. For v1 the SAVE failure is **silent + `console.warn`** (non-blocking; the session cache already holds the applied portfolio, so the user is unaffected). A toast can be wired when a toast system exists. This is noted, not hidden.

- [ ] **Step 1: Add the SAVE hook in `src/components/merge/jaroo-merge-screen.tsx`**

Add the import. In the existing import block, after the `@/lib/ocr-portfolio-apply` import:

```ts
import { syncPortfolioToServer } from '@/lib/portfolio-sync'
```

Then, inside `handleApply`, after the success guard and before `replacePortfolioItems`, add the hook. Replace:

```tsx
      if (!applyResult.persisted) {
        throw new Error('홈 포트폴리오 저장에 실패했어요.')
      }

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(applyResult.nextQuoteHoldings)
```

with:

```tsx
      if (!applyResult.persisted) {
        throw new Error('홈 포트폴리오 저장에 실패했어요.')
      }

      void syncPortfolioToServer(applyResult.persistedRows).then((result) => {
        if (!result.ok) {
          console.warn('portfolio save failed (logged-out or server error)')
        }
      })

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(applyResult.nextQuoteHoldings)
```

- [ ] **Step 2: Add the SAVE hook in `src/app/ocr/page.tsx`**

Add the import to the existing `@/lib` imports near the top of the file:

```ts
import { syncPortfolioToServer } from '@/lib/portfolio-sync'
```

Then, inside `handleContinue`, after the success guard, add the hook. Replace:

```tsx
      if (!applyResult.persisted || applyResult.normalizedItems.length === 0) {
        throw new Error('포트폴리오에 적용할 종목을 찾지 못했어요.')
      }

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(applyResult.nextQuoteHoldings)
```

with:

```tsx
      if (!applyResult.persisted || applyResult.normalizedItems.length === 0) {
        throw new Error('포트폴리오에 적용할 종목을 찾지 못했어요.')
      }

      void syncPortfolioToServer(applyResult.persistedRows).then((result) => {
        if (!result.ok) {
          console.warn('portfolio save failed (logged-out or server error)')
        }
      })

      const nextQuoteQuery = buildHomeCurrentQuoteQuery(applyResult.nextQuoteHoldings)
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: build exits 0 (no new errors in `ocr/page.tsx` or `merge/jaroo-merge-screen.tsx`).

- [ ] **Step 4: Commit**

```bash
git add src/app/ocr/page.tsx src/components/merge/jaroo-merge-screen.tsx
git commit -m "feat(portfolio): fire-and-forget DB save after apply (logged-in)"
```

---

### Task 7: LOAD — Home screen DB-first async resolver

**Files:**
- Modify: `src/components/home/jaroo-home-screen.tsx` (import + state + effect rewrite + overlay)

**Interfaces:**
- Consumes: `fetchPortfolio()` (Task 3), existing `readAppliedHomePortfolio`, `buildPortfolioItemsFromAppliedHomePortfolioRows`, `replacePortfolioItems`.
- Produces: logged-in users load from DB (empty → `/screenshot` redirect); logged-out users keep the session path; fetch in-flight shows a loading overlay; the redirect never fires while a fetch is pending.

- [ ] **Step 1: Add the import**

In `src/components/home/jaroo-home-screen.tsx`, add to the `@/lib` imports (next to the `@/lib/jaroo-home-data` import):

```ts
import { fetchPortfolio } from '@/lib/portfolio-sync'
```

- [ ] **Step 2: Add loading/empty state**

Find the line `const hasCheckedPersistedPortfolioRef = useRef(false)` (≈L576). Immediately after it, add:

```tsx
  const [persistedPortfolioLoading, setPersistedPortfolioLoading] = useState(false)
  const [persistedPortfolioEmpty, setPersistedPortfolioEmpty] = useState(false)
```

(`useState` is already imported on the existing React import line.)

- [ ] **Step 3: Replace the load effect with the async DB-first resolver + a gated redirect effect**

Replace the entire existing effect block:

```tsx
  useEffect(() => {
    if (hasPortfolioItems) {
      return
    }

    if (!hasCheckedPersistedPortfolioRef.current) {
      hasCheckedPersistedPortfolioRef.current = true
      const persistedPortfolio = readAppliedHomePortfolio()
      const persistedItems = persistedPortfolio ? buildPortfolioItemsFromAppliedHomePortfolioRows(persistedPortfolio.rows) : []

      if (persistedItems.length > 0) {
        replacePortfolioItems(persistedItems)
        return
      }
    }

    const timeoutId = window.setTimeout(() => {
      router.replace('/screenshot')
    }, 350)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasPortfolioItems, replacePortfolioItems, router])
```

with:

```tsx
  useEffect(() => {
    if (hasPortfolioItems) {
      return
    }
    if (hasCheckedPersistedPortfolioRef.current) {
      return
    }
    hasCheckedPersistedPortfolioRef.current = true
    setPersistedPortfolioLoading(true)

    let cancelled = false

    void (async () => {
      const result = await fetchPortfolio()

      if (cancelled) {
        return
      }

      // logged-in: DB is single source of truth (rows or empty). no session fallback here.
      if (result.status === 'rows') {
        const items = buildPortfolioItemsFromAppliedHomePortfolioRows(result.rows)
        setPersistedPortfolioLoading(false)
        if (items.length > 0) {
          replacePortfolioItems(items)
          return
        }
        setPersistedPortfolioEmpty(true)
        return
      }

      // logged-out (401) or fetch error → session cache fallback (resilience), then empty.
      const sessionPortfolio = readAppliedHomePortfolio()
      const sessionItems = sessionPortfolio ? buildPortfolioItemsFromAppliedHomePortfolioRows(sessionPortfolio.rows) : []
      setPersistedPortfolioLoading(false)
      if (sessionItems.length > 0) {
        replacePortfolioItems(sessionItems)
        return
      }
      setPersistedPortfolioEmpty(true)
    })()

    return () => {
      cancelled = true
    }
  }, [hasPortfolioItems, replacePortfolioItems])

  useEffect(() => {
    if (hasPortfolioItems || !persistedPortfolioEmpty) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      router.replace('/screenshot')
    }, 350)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasPortfolioItems, persistedPortfolioEmpty, router])
```

- [ ] **Step 4: Add the loading overlay**

Find the main render return:

```tsx
  return (
    <div className={styles.viewport}>
      <div ref={frameRef} className={styles.frame}>
```

Replace it with:

```tsx
  return (
    <div className={styles.viewport}>
      {persistedPortfolioLoading && !hasPortfolioItems ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--jaroo-bg)',
            zIndex: 50,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--jaroo-muted)' }}>포트폴리오를 불러오는 중…</span>
        </div>
      ) : null}
      <div ref={frameRef} className={styles.frame}>
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: build exits 0 (no new errors in `jaroo-home-screen.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/components/home/jaroo-home-screen.tsx
git commit -m "feat(portfolio): DB-first async load on Home (session fallback for logged-out)"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite green**

Run: `npm run test:web:ts 2>&1 | tail -15`
Expected: all tests pass (portfolio-sync: 10, config: 2, route: 3, plus pre-existing suites). No new failures.

- [ ] **Step 2: Production build green**

Run: `npm run build 2>&1 | tail -20`
Expected: exit 0.

- [ ] **Step 3: Manual E2E — acceptance criteria (run the app: `npm run dev`)**

1. **Logged-in persistence:** Log in → `/screenshot` → upload a broker screenshot → OCR → merge → apply → land on `/home` with the portfolio. Close the tab, reopen `/home` (still logged in) → **same portfolio loads from DB** (brief "불러오는 중…" overlay, no `/screenshot` redirect). ✓ Acceptance #1.
2. **Logged-out unchanged:** Log out → `/home` with a session portfolio → still shows session data; no DB calls succeed (401 silent). ✓ Acceptance #2.
3. **Empty logged-in → OCR CTA:** Log in with an account whose `portfolio_holdings` is empty → `/home` → redirects to `/screenshot` after ~350ms (no demo holdings). ✓ Acceptance #3.
4. **Replace, not append:** Apply portfolio A, then apply portfolio B (different screenshot) → reopen `/home` → only B is shown (A fully replaced). ✓ Acceptance #4.
5. **No crash on failure:** With network throttled/offline, apply a portfolio → no crash; session shows the apply; reload → session cache (logged-out path) or empty → `/screenshot`. ✓ Acceptance #5.

- [ ] **Step 4: DB sanity check (optional)**

In the Supabase table editor for `portfolio_holdings`, confirm rows were written with the correct `user_id`, `sort_order`, `source='ocr'`, after Step 3.1.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- § Decisions Q1–Q5 → Tasks 1–8 implement exactly those (scope portfolio-only; replace via RPC; DB single-truth LOAD with session fallback only on logged-out/error; empty → `/screenshot`; service_role + RPC). ✓
- § SAVE mapping (Table) → Task 2 `mapAppliedRowsToSaveRows` (uses `parseOcrNumber`, `buildIdentifierLabel(ticker, code)`, resolvedName fallback). ✓
- § LOAD mapping → Task 2 `mapDbRowsToAppliedRows` (evaluationAmount→'' for null, profitRate→''); Task 7 routes through `buildPortfolioItemsFromAppliedHomePortfolioRows`. ✓
- § Phase 0 SQL (trigger, regex guards, advisory lock, nullif, search_path, REVOKE, RLS) → Task 5 verbatim. ✓
- § Error handling (loading overlay, gated redirect, session fallback, no-crash) → Task 7 + Task 8.5. ✓
- § Acceptance criteria 1–5 → Task 8.3. ✓
- `PortfolioSaveRow` excludes `user_id` (server-injected) → Task 4 GET/POST. ✓

**Placeholder scan:** none. Every code step contains the actual code; every command has expected output. The one documented deviation (SAVE toast → silent+warn) is explicitly flagged in Task 6, not hidden.

**Type consistency:** `PortfolioSaveRow` / `PortfolioDbRow` (Task 2) consumed identically by Task 3 (`mapAppliedRowsToSaveRows`, `mapDbRowsToAppliedRows`), Task 4 (`PortfolioDbRow` GET return, `PortfolioSaveRow` POST body). `parsePortfolioFetchResponse` returns `PortfolioFetchResult` (Task 3) consumed by Task 7. `syncPortfolioToServer` returns `{ ok, saved? }` consumed by Task 6. `getPortfolioRowsValidationError` + `MAX_PORTFOLIO_ROWS` (Task 4) tested in Task 4. `createSupabaseServiceClient` (Task 1) used in Task 4. No signature drift across tasks.

**Scope:** single feature, one implementation plan, each task independently testable. ✓
