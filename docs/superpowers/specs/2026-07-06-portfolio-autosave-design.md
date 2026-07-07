# Portfolio Auto-Save/Load — Design Spec

- **Date:** 2026-07-06
- **Status:** Approved (brainstorm) → reviewer-revised → pending spec review → implementation plan
- **Scope:** User-account portfolio persistence (OCR → Home auto-save/load)
- **Out of scope (deferred):** DeepScan history (`analysis_results`), manual watchlist (`holdings`), notifications/settings, credits/billing

## Context

The app persists all user state (OCR results, applied home portfolio, deepscan target) in
`window.sessionStorage` (volatile, per-tab, no account/device sync). Supabase is used only for
auth (`auth.*`); there are zero `.from()` data queries in `src` (all `.from(` matches are
`Array.from`). The `portfolio_holdings` table exists on the remote DB (user_id-based, 17 columns,
empty, 0 references, untracked by repo migrations) but is not wired to the app.

This spec wires **portfolio auto-save/load** to `portfolio_holdings` for logged-in users.

## Decisions (brainstorm)

| # | Topic | Decision |
|---|---|---|
| Q1 | Scope | Portfolio (OCR → Home) only |
| Q2 | Re-OCR semantics | **Replace** — new apply fully replaces the saved set |
| Q3 | Load source-of-truth | **DB single truth**, session = pure sync cache, **no migration**, existing session data discarded on login |
| Q4 | Empty DB (logged-in) | **Empty state** = existing `/screenshot` redirect (OCR entry/CTA); no deceptive demo |
| Q5 | Auth/write path | **service_role + API route** + `sync_user_portfolio` RPC (atomic replace) |

Baseline: **logged-out users keep current behavior** (sessionStorage / demo). Only logged-in users
get DB auto-save/load.

## Architecture (data flow)

```
[OCR / Merge → apply]  (client components, 'use client')
 const applyResult = persistAppliedPortfolioFromMergeRows(...)   // existing: writes sessionStorage (sync cache)
 if (!applyResult.persisted || applyResult.normalizedItems.length === 0) throw   // existing guard
 replacePortfolioItems(applyResult.normalizedItems)              // existing: in-memory state
 void syncPortfolioToServer(applyResult.persistedRows)           // NEW: fire-and-forget DB save (logged-in only)

                                  ┌─────────────────────────────────────────────┐
                                  │  /api/portfolio (service_role, server-only) │
                                  │  userId = createSupabaseServerClient()      │
                                  │           .auth.getUser().id  (401 if none) │
                                  │  POST → RPC sync_user_portfolio(uid, rows)  │
                                  │  GET  → SELECT … order by sort_order        │
                                  └─────────────────────────────────────────────┘
                                                       │
                                                       ▼
                                         portfolio_holdings (DB)

[/home load]  (jaroo-home-screen.tsx, dynamic ssr:false)
 useEffect on mount when !hasPortfolioItems:
   1. await fetchPortfolio():
        200 + rows  → map DB→AppliedHomePortfolioRow[] → buildPortfolioItemsFromAppliedHomePortfolioRows → replacePortfolioItems
        200 + empty → logged-in empty → existing 350ms /screenshot redirect (OCR CTA)
        401         → logged-out → existing session path (readAppliedHomePortfolio → same builder → replacePortfolioItems; none → /screenshot)
        throw       → session cache fallback (same); none → /screenshot
   (a lightweight loading state is shown while the fetch is in-flight; the /screenshot timeout
    is armed only AFTER the fetch resolves to empty/401, never while pending)
```

- **SAVE** fires immediately after a successful apply, logged-in only, fire-and-forget. The rows
  come from `applyResult.persistedRows` (`AppliedHomePortfolioRow[]`) — **not** `applyResult.persisted`
  (which is a `boolean`).
- **LOAD** reuses the **existing** session→items builder (`buildPortfolioItemsFromAppliedHomePortfolioRows`)
  and `replacePortfolioItems`, so currency inference / market-tone resolution / `identifierLabel`
  stay identical to the session path. No new parallel mapper.

## Data model & mapping

`portfolio_holdings` columns (required marked): `id`[REQ], `user_id`[REQ], `name`[REQ], `code`,
`ticker`, `market`, `market_tone`, `kind`, `quantity`[REQ], `average_price`[REQ],
`average_price_currency`, `evaluation_amount`, `identifier_label`, `sort_order`[REQ],
`source`[REQ], `created_at`[REQ], `updated_at`[REQ].

### SAVE: `AppliedHomePortfolioRow` → `PortfolioSaveRow` (DTO) → DB

Reuse the same parse/resolution primitives the load-side builder uses, to avoid divergence
(`parseOcrNumber`, `buildIdentifierLabel(ticker, code)`):

| DB column | Source |
|---|---|
| `user_id` [REQ] | server session (`auth.getUser().id`) — never trusted from client |
| `name` [REQ] | `row.resolvedName?.trim() \|\| row.name` (matches builder) |
| `code` / `ticker` | `row.resolvedCode ?? row.code` / `row.resolvedTicker ?? row.ticker` |
| `market` / `market_tone` / `kind` | `row.resolvedMarket` / `resolvedMarketTone` / `resolvedKind` |
| `quantity` [REQ] | `parseOcrNumber(row.quantity) ?? 0` |
| `average_price` [REQ] | `parseOcrNumber(row.averagePrice) ?? 0` |
| `average_price_currency` | `row.averagePriceCurrency` (already inferred at apply time) |
| `evaluation_amount` | `parseOcrNumber(row.evaluationAmount ?? '')` (nullable) |
| `identifier_label` | `buildIdentifierLabel(row.resolvedTicker ?? row.ticker, row.resolvedCode ?? row.code)` |
| `sort_order` [REQ] | array index |
| `source` [REQ] | `'ocr'` |
| `id`/`created_at`/`updated_at` [REQ] | DB defaults |

`PortfolioSaveRow` (DTO, client→server) = the columns above **excluding** `user_id` (server-injected)
and the three DB-managed columns. The DTO carries clean numerics (already parsed by
`parseOcrNumber`); the RPC also guards with regex (see Phase 0).

### LOAD: DB row → `AppliedHomePortfolioRow` → existing builder → `replacePortfolioItems`

Map each DB row back into an `AppliedHomePortfolioRow` populating the **resolved\*** fields from the
stored (authoritative) DB columns, so the existing builder uses stored values rather than
re-inferring:

| `AppliedHomePortfolioRow` field | from DB column |
|---|---|
| `name` / `resolvedName` | `name` |
| `quantity` (string) | `String(quantity)` |
| `averagePrice` (string) | `String(average_price)` |
| `averagePriceCurrency` | `average_price_currency` |
| `evaluationAmount` | `evaluation_amount != null ? String(evaluation_amount) : undefined` |
| `code` / `resolvedCode` | `code` |
| `ticker` / `resolvedTicker` | `ticker` |
| `resolvedMarket` / `resolvedMarketTone` / `resolvedKind` | `market` / `market_tone` / `kind` |
| `profitRate` | `''` (not stored; recomputed from live quotes) |

Then: `buildPortfolioItemsFromAppliedHomePortfolioRows(rows)` → `replacePortfolioItems(items)` —
identical to the current session path (including `averagePriceCurrency` re-inference fallback).

**Not stored / recomputed on load** via the enrichment pipeline + live quotes: `profitRate`,
`currentPrice`, `currentProfitRate`, `currentPriceCurrency`, `usdKrwRate`, and all display-only
`HomeHolding` fields (pnl, change, donut, metrics, opinion, …).

## Components

### New

- `src/lib/supabase/service.ts` — `createSupabaseServiceClient()` (service_role, **server-only**).
  Reads `SUPABASE_SERVICE_ROLE_KEY` (present at `.env.local`, `role: service_role`).
- `src/app/api/portfolio/route.ts`:
  - `GET` → resolve user via `createSupabaseServerClient()` + `auth.getUser()`; if none → **401**
    (deliberate divergence from `/api/auth/me`, which returns `200 + guest` — here 401 is the
    logged-out signal the client keys on). Else service-role `SELECT … ORDER BY sort_order` →
    `{ rows: PortfolioSaveRow[] }` (**without** `user_id`).
  - `POST` `{ rows: PortfolioSaveRow[] }` → same auth; call `sync_user_portfolio(p_user_id, rows)`;
    return `{ saved: n }` where `n` is the RPC's post-`name`-filter inserted count (may be `<`
    input length if any rows were filtered; client-validated names make this a no-op in practice).
    400 on non-array/invalid body.
- `src/lib/portfolio-sync.ts` (client) — `syncPortfolioToServer(rows: AppliedHomePortfolioRow[])`,
  `fetchPortfolio()`, and the two mapping helpers above (row↔DTO, DB row↔`AppliedHomePortfolioRow`).
  Uses `fetch`; treats `401` as "logged-out, no-op".

### Edits

- **SAVE hook** — `src/app/ocr/page.tsx` (≈L774) and `src/components/merge/jaroo-merge-screen.tsx`
  (≈L134): after the existing `if (!applyResult.persisted …)` success guard, call
  `void syncPortfolioToServer(applyResult.persistedRows)` (logged-in only; failure → toast). The
  call sites are client components; `persistedRows` is the `AppliedHomePortfolioRow[]` from
  `AppliedPortfolioBuildResult`.
- **LOAD resolver** — `src/components/home/jaroo-home-screen.tsx` (≈L593–617, the
  `!hasPortfolioItems` effect): replace the synchronous `readAppliedHomePortfolio()` block with the
  async `fetchPortfolio()` precedence described in the data-flow. Keep
  `hasCheckedPersistedPortfolioRef` semantics but make it resolve after the network call. The
  terminal "no portfolio" state remains the existing `setTimeout(() => router.replace('/screenshot'), 350)`
  (the OCR CTA).

## Error handling & edge cases

- **Loading UX (new, async load):** while `fetchPortfolio()` is in-flight, render a lightweight
  loading state (skeleton/spinner). The 350ms `/screenshot` redirect is armed **only after** the
  fetch resolves to empty/401/error — never while a DB fetch is pending (prevents a flash redirect).
- **SAVE failure:** non-blocking toast; the session cache (written by the existing
  `persistAppliedHomePortfolio`) already reflects the apply, so the Home UI stays consistent;
  retried on the next apply.
- **LOAD failure (network/500):** fall back to session cache (`readAppliedHomePortfolio`); if none,
  the `/screenshot` redirect. Home never crashes. (DB is the source of truth; cache is a resilience
  fallback, not a precedence override.)
- **First load after login-discard (Q3):** there is no session to fall back to yet, so a LOAD
  failure here degrades to the empty/`/screenshot` path. Safe. (The Q3 "DB single truth" and the
  "session fallback on failure" statements only appear to conflict in this window; the fallback is
  a best-effort resilience path, not an authority override.)
- **Logged-out (401):** silent; existing session path.
- **Unparseable quantity/average_price:** the DTO guarantees clean numerics (`parseOcrNumber`);
  the RPC additionally regex-guards and defaults to 0 (Phase 0). Rows are kept.
- **Concurrency (cross-device):** the RPC takes `pg_advisory_xact_lock(hashtext(p_user_id::text))`
  so concurrent replaces for the same user serialize → strict last-write-wins (acceptance #4 holds).
  No cross-user contention.
- **Scale:** typical < 50 rows → no pagination.
- **Extra round-trip (noted, acceptable):** logged-out Home mounts currently fetch `/api/auth/me`
  (via `AuthHomeStatus`); they will now also GET `/api/portfolio` → 401. A shared client login flag
  could short-circuit this later; not required for v1.

## Phase 0 — migration / RPC / RLS

Idempotent migration `supabase/migrations/<ts>_portfolio_autosave.sql`. Depends on the existing
`public.set_updated_at()` function from the base migration (`20260626084500_create_auth_profiles.sql`).

1. **Schema capture** — `create table if not exists public.portfolio_holdings (...)` so a fresh DB
   matches the remote shape (no-op on the existing remote table); index on `user_id`; `BEFORE
   UPDATE` trigger reusing `set_updated_at()` (matches the `profiles` precedent). Note: the
   auto-save flow is DELETE+INSERT, so `updated_at` is refreshed by the INSERT `default now()`;
   the trigger future-proofs any later `UPDATE`.
2. **RPC** `sync_user_portfolio(p_user_id uuid, p_rows jsonb)`:
   - `SECURITY DEFINER`, `SET search_path = public` (prevents search_path hijacking; matches
     `handle_new_auth_user` convention).
   - `pg_advisory_xact_lock(hashtext(p_user_id::text))` first → per-user serialization.
   - `DELETE WHERE user_id = p_user_id`, then `INSERT` from `jsonb_array_elements` (atomic). Empty
     array → DELETE only (clears the portfolio).
   - Numeric/integer columns use **regex-guarded casts** (empty/comma values → default, never
     throw). `name` filter uses `nullif(...,'') is not null` so empty names are dropped (not
     inserted as NULL into the NOT NULL column).
   - `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` — **service_role only**. Because
     service_role yields `auth.uid() = NULL`, the RPC receives `p_user_id` explicitly from the API
     route (which derived it from the authenticated session).
3. **RLS (defense-in-depth)** — `enable row level security` + own-rows policy
   `user_id = auth.uid()`. service_role bypasses RLS regardless; the policy blocks anon reads.

```sql
-- 1. schema capture (idempotent)
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

-- 2. atomic replace RPC (service_role only; serialized per user)
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

-- 3. RLS (defense-in-depth)
alter table public.portfolio_holdings enable row level security;
drop policy if exists "portfolio_holdings own rows" on public.portfolio_holdings;
create policy "portfolio_holdings own rows" on public.portfolio_holdings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

## Testing

- **Mapping unit tests** (node:test; `src/lib/jaroo-home-data.test.ts` precedent):
  row→DTO (incl. missing/empty fields, `parseOcrNumber` semantics) and DB row→`AppliedHomePortfolioRow`
  round-trip (assert stored `resolved*`/currency survive).
- **API route test** (`src/app/api/instruments/resolve/route.test.ts` precedent): logged-out → 401;
  valid GET returns ordered rows without `user_id`; valid POST invokes a mocked RPC and returns
  `{ saved }`.
- **RPC test** (optional, via a scratch supabase instance or `pg`): empty array clears; bad-numeric
  row defaults to 0 without throwing; concurrent calls for the same user serialize.
- **Load precedence test:** 200+rows → builder; 200+empty → `/screenshot` redirect; 401 → session
  path; GET throw → session cache fallback; loading state shown while pending.

## Acceptance criteria

1. A logged-in user who applies an OCR portfolio, closes the tab, reopens `/home` on the same or
   another device/browser (logged in), sees the same applied portfolio.
2. A logged-out user sees the current (session/demo) behavior unchanged.
3. A logged-in user with an empty `portfolio_holdings` is sent to `/screenshot` (OCR CTA) — no demo
   holdings.
4. Re-applying replaces (not appends) the saved set, even under cross-device contention (advisory
   lock).
5. SAVE/LOAD failures never crash the Home screen.

## Review-driven revisions (this revision)

- **B1:** SAVE hook now uses `applyResult.persistedRows` (the previous `.persisted.rows` referenced
  a non-existent field; `persisted` is a boolean).
- **M1:** migration SQL now includes the `BEFORE UPDATE` `set_updated_at()` trigger (was promised in
  prose, missing in SQL).
- **M2:** RPC numerics/integers are regex-guarded (empty/comma no longer abort the transaction;
  matches the stated "default 0" rule).
- **M3:** LOAD routes through the existing `buildPortfolioItemsFromAppliedHomePortfolioRows` +
  `replacePortfolioItems` (the previous direct `DB→PortfolioNormalizedItem` mapper would have
  duplicated currency/market-tone inference).
- **m4/m5/m6/n1:** added `pg_advisory_xact_lock` (strict LWW), `nullif(name,'')` filter,
  `SET search_path = public`, and the correct `buildIdentifierLabel(ticker, code)` signature.

## Open items

- Capture `analysis_results`, `holdings`, `profiles` remote schemas into repo migrations as hygiene
  (not required for this feature).
