# Portfolio Auto-Save/Load — Design Spec

- **Date:** 2026-07-06
- **Status:** Approved (brainstorm), pending spec review → implementation plan
- **Scope:** User-account portfolio persistence (OCR → Home auto-save/load)
- **Out of scope (deferred):** DeepScan history (`analysis_results`), manual watchlist (`holdings`), notifications/settings, credits/billing

## Context

The app persists all user state (OCR results, applied home portfolio, deepscan target) in
`window.sessionStorage` (volatile, per-tab, no account/device sync). Supabase is used only for
auth (`auth.*`); there are zero `.from()` data queries in `src`. The `portfolio_holdings` table
exists on the remote DB (user_id-based, 17 columns, empty, 0 references, untracked by repo
migrations) but is not wired to the app.

This spec wires **portfolio auto-save/load** to `portfolio_holdings` for logged-in users.

## Decisions (brainstorm)

| # | Topic | Decision |
|---|---|---|
| Q1 | Scope | Portfolio (OCR → Home) only |
| Q2 | Re-OCR semantics | **Replace** — new apply fully replaces the saved set |
| Q3 | Load source-of-truth | **DB single truth**, session = pure sync cache, **no migration**, existing session data discarded on login |
| Q4 | Empty DB (logged-in) | **Empty state** + OCR CTA (no deceptive demo) |
| Q5 | Auth/write path | **service_role + API route** + `sync_user_portfolio` RPC (atomic replace) |

Baseline: **logged-out users keep current behavior** (sessionStorage / demo). Only logged-in users
get DB auto-save/load.

## Architecture (data flow)

```
[OCR / Merge → apply]                                  [/home load]
 persistAppliedPortfolioFromMergeRows                  jaroo-home-screen.tsx
   │ (session) — kept as sync cache                          │
   ▼                                                          ▼
 syncPortfolioToServer(rows)   ← NEW                fetchPortfolio()    ← NEW
   │ POST                                                     │ GET
   ▼                                                          ▼
 /api/portfolio  ──────────  portfolio_holdings (DB)  ────── /api/portfolio
   │ userId = auth.getUser().id (server-derived)              │ rows, ordered by sort_order
   ▼                                                          ▼
 RPC sync_user_portfolio(p_user_id, p_rows)           existing enrichment pipeline
   DELETE WHERE user_id + INSERT (atomic)             → HomeHolding (live quotes)
```

- **SAVE** fires immediately after a successful apply, logged-in only, fire-and-forget.
- **LOAD** runs on Home mount: logged-in → DB rows (empty → empty state); logged-out → current
  session/demo path.

## Data model & mapping

`AppliedHomePortfolioRow` → `portfolio_holdings`:

| DB column (required marked) | Source |
|---|---|
| `user_id` [REQ] | server session (`auth.getUser().id`) — never trusted from client |
| `name` [REQ] | row.name |
| `code` / `ticker` | row.resolvedCode ?? row.code / row.resolvedTicker ?? row.ticker |
| `market` / `market_tone` / `kind` | row.resolvedMarket / resolvedMarketTone / resolvedKind |
| `quantity` [REQ] | parse(row.quantity) → numeric (default 0 if unparseable) |
| `average_price` [REQ] | parse(row.averagePrice) → numeric (default 0 if unparseable) |
| `average_price_currency` | row.averagePriceCurrency |
| `evaluation_amount` | parse(row.evaluationAmount) → numeric (nullable) |
| `identifier_label` | buildIdentifierLabel(row) (optional, nullable) |
| `sort_order` [REQ] | array index |
| `source` [REQ] | `'ocr'` |
| `id` / `created_at` / `updated_at` [REQ] | DB defaults |

**Not stored** (recomputed on load via the existing enrichment pipeline using live quotes):
`profitRate`, `currentPrice`, `currentProfitRate`, `usdKrwRate`, and all display-only fields
(pnl, change, donut, metrics, opinion, etc.).

**DTO:** `PortfolioSaveRow` = the column subset above. Client maps row → DTO; server inserts as-is.

**Load-side mapping:** DB row → `PortfolioNormalizedItem` (`src/lib/workflow-types.ts`) — omit the
live-quote fields (`currentPrice`, `currentProfitRate`, `currentPriceCurrency`, `usdKrwRate`) — →
existing `buildHomeHoldingsFromPortfolioItems(items)` → `HomeHolding[]`. This reuses the current
enrichment pipeline unchanged; DB carries only the persistent position/identity fields.

## Components

### New

- `src/lib/supabase/service.ts` — `createSupabaseServiceClient()` (service_role, **server-only**).
  Reads `SUPABASE_SERVICE_ROLE_KEY`.
- `src/app/api/portfolio/route.ts`:
  - `GET` → resolve user via `createSupabaseServerClient()` + `auth.getUser()`; if none → 401.
    Else service-role SELECT ordered by `sort_order` → `{ rows: PortfolioSaveRow[] }`.
  - `POST` `{ rows: PortfolioSaveRow[] }` → same auth; call `sync_user_portfolio(p_user_id, rows)`;
    return `{ saved: n }`. 401 when logged out; 400 on empty/invalid body.
- `src/lib/portfolio-sync.ts` (client) — `syncPortfolioToServer(rows)`, `fetchPortfolio()`,
  and mapping helpers row ↔ `PortfolioSaveRow` ↔ DB rows.

### Edits

- `src/app/ocr/page.tsx:772` and `src/components/merge/jaroo-merge-screen.tsx:132` — after
  `persistAppliedPortfolioFromMergeRows(...)`, call
  `void syncPortfolioToServer(applyResult.persisted.rows)` (logged-in only; failure → toast).
- `src/components/home/jaroo-home-screen.tsx:605` — replace the bare
  `readAppliedHomePortfolio()` with a precedence resolver:
  1. `fetchPortfolio()`: 200 + rows → build holdings from DB rows;
  2. 200 + empty (logged-in) → **empty state** (OCR CTA → `/screenshot`);
  3. 401 (logged-out) → current session/demo path.

## Error handling & edge cases

- **SAVE failure:** non-blocking toast; session cache already updated so the Home UI stays
  consistent; retried on the next apply.
- **LOAD failure (network/500):** fall back to session cache; if absent, empty state. Home must
  never crash. (DB is the source of truth; cache is a resilience fallback, not an override.)
- **Logged-out (401):** silent; session path.
- **Unparseable quantity/average_price:** default 0 (columns are NOT NULL); row is kept.
- **Concurrent edits across devices:** last-write-wins (replace). Acceptable for v1.
- **Scale:** typical < 50 rows → no pagination.

## Phase 0 — migration / RPC / RLS

Idempotent migration `supabase/migrations/<ts>_portfolio_autosave.sql`:

1. **Schema capture** — `create table if not exists public.portfolio_holdings (...)` so a fresh DB
   matches the remote shape (no-op on the existing remote table); index on `user_id`;
   `updated_at` trigger (reuse existing `set_updated_at` if present).
2. **RPC** `sync_user_portfolio(p_user_id uuid, p_rows jsonb)`:
   `SECURITY DEFINER`; body does `DELETE WHERE user_id = p_user_id` then `INSERT` from
   `jsonb_array_elements` in a single transaction (atomic replace); empty array → DELETE only
   (clears the portfolio). `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` — **service_role
   only**. Because service_role yields `auth.uid() = NULL`, the RPC receives `p_user_id`
   explicitly from the API route (which derived it from the authenticated session).
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

-- 2. atomic replace RPC (service_role only)
create or replace function public.sync_user_portfolio(p_user_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
as $$
declare inserted_count integer;
begin
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
    coalesce((r->>'quantity')::numeric, 0),
    coalesce((r->>'average_price')::numeric, 0),
    nullif(r->>'average_price_currency',''),
    nullif(r->>'evaluation_amount','')::numeric,
    nullif(r->>'identifier_label',''),
    coalesce((r->>'sort_order')::integer, (idx - 1), 0),
    coalesce(r->>'source','ocr')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, idx)
  where r->>'name' is not null;
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

- **Mapping unit tests** (node:test, `src/lib/jaroo-home-data.test.ts` precedent): row ↔
  `PortfolioSaveRow` ↔ DB rows, including missing/empty fields and numeric parsing.
- **API route test** (`src/app/api/instruments/resolve/route.test.ts` precedent): logged-out →
  401; valid GET returns ordered rows; valid POST invokes a mocked RPC.
- **Load precedence test:** 401 → session path; 200+rows → DB; 200+empty → empty state; GET throw
  → session cache fallback.

## Acceptance criteria

1. A logged-in user who applies an OCR portfolio, closes the tab, reopens `/home` on the same or
   another device/browser, and is logged in, sees the same applied portfolio.
2. A logged-out user sees the current (session/demo) behavior unchanged.
3. A logged-in user with an empty `portfolio_holdings` sees the empty state with an OCR CTA, not
   demo holdings.
4. Re-applying replaces (not appends) the saved set.
5. SAVE/LOAD failures never crash the Home screen.

## Open items

- Decide whether to also capture `analysis_results`, `holdings`, `profiles` remote schemas into
  repo migrations as hygiene (not required for this feature).
