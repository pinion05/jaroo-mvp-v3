# Jaroo V3 monorepo integration foundation (PR1)

## Intent
This PR adds the **monorepo foundation only** for Jaroo V3. It keeps `jaroo-mvp-v3` as the single repository while moving the current crawler code and stock-name-ticker-maps code into internal workspace packages.

PR1 is intentionally narrow:
- add package boundaries
- preserve the current web app behavior as much as possible
- avoid route rewrites and cross-package behavior migrations

## New workspace layout

```text
jaroo-mvp-v3/
├─ src/                         # existing Next.js web app remains the product entrypoint
├─ packages/
│  ├─ crawler/                 # migrated standalone crawler server/codebase
│  ├─ instrument-core/         # migrated KR/US instrument lookup resolver + data assets
│  └─ contracts/               # declaration-only shared contract skeletons
└─ docs/architecture/
   └─ jaroo-v3-monorepo-integration.md
```

## Source snapshots used in PR1

### `packages/crawler`
Migrated from the current sibling crawler codebase snapshot used during PR1 foundation work.
- rationale: bring the existing standalone crawler server, scripts, and tests into the monorepo first, without yet rewiring runtime ownership inside the web app

Copied scope:
- `src/**`
- `scripts/**`
- `test/**`
- `.env.example`
- `README.md`
- adapted `package.json`

Deferred/non-copied artifacts:
- `node_modules/**`
- `.git/**`
- `.env*` secrets/runtime files
- bulky reference `docs/**` and `example/**` outputs

### `packages/instrument-core`
Migrated from the current sibling stock-name-ticker-maps codebase snapshot used during PR1 foundation work.
- rationale: bring the reusable lookup resolver/data assets into the monorepo first, without yet replacing all web-side lookup/runtime flows

Copied scope:
- `src/**`
- `bin/**`
- `tests/**`
- `data/**`
- `README.md`
- `LICENSE`
- `manifest.json`
- adapted `package.json`

## Responsibility split

### Web app (`src/**`)
- remains the currently runnable user-facing app
- continues to own current route behavior in PR1
- may use thin compatibility hooks to discover internal package assets where safe

### Crawler (`packages/crawler`)
- owns crawler composition/orchestration logic
- remains a standalone server/package in PR1
- is **not yet** wired into app API route behavior in this PR

### Instrument core (`packages/instrument-core`)
- owns reusable KR/US lookup datasets and resolver utilities
- provides the internal home for the previously external stock-name-ticker-maps code
- does **not yet** replace all web-side instrument resolution code in PR1

### Contracts (`packages/contracts`)
- reserves shared type contracts for future API/package convergence
- intentionally contains only placeholders/basic types in PR1

## Compatibility approach in PR1
- preserve existing Next.js app structure
- avoid business logic rewrites
- prefer discovery compatibility over moving route behavior
- keep the later architecture direction intact: app routes become proxy/cache-oriented while crawler owns heavy composition

A thin development fallback was added to the current ticker-map resolver so local development can discover `packages/instrument-core` without relying on the old sibling repository path. Production remains explicit-path only.

## Explicit deferrals to later PRs
- rewriting `src/app/api/instruments/resolve/route.ts` around crawler/instrument-core
- moving current home/deepscan/quote flows into package-based contracts
- quote/current endpoint work
- eliminating duplicated web-side lookup logic
- introducing a fully shared runtime API between web and crawler
