# KR WiseReport Slim v1.2 Source Contract Design

## Status

- Date: 2026-04-27
- Branch at drafting: `issue34-kr-dump-schema-design`
- Parent context: GitHub #34 / KR DeepScan context quality
- Relationship to current branch:
  - Current branch hardens **v1.1 evidence extraction** for facts already present in slim v1.1.
  - v1.2 is a separate source-contract redesign for facts that are not present in slim v1.1.

## Why v1.2 is needed

KR slim v1.1 currently captures WiseReport/FnGuide page payloads and a subset of normalized evidence, but DeepScan's LLM committee asks for decision facts that are not represented in the v1.1 contract.

The most important example is ownership/flow:

- v1.1 has:
  - major holder summary
  - 5%+ holder summary
  - free-float shares/ratio
  - major shareholder rows
  - shareholder change rows
- v1.1 does **not** have:
  - aggregate foreign ownership percentage
  - aggregate institutional ownership percentage
  - foreign/institutional/retail net-buy flow windows

When those facts are absent from the source contract, extractor/prompt changes can only mark them missing. They cannot produce reliable values without adding new source acquisition.

## Design goal

Design slim v1.2 from the **DeepScan committee fact checklist**, not merely from the crawled page list.

The contract must answer three questions for each decision fact:

1. What is the value?
2. Which source was checked?
3. If missing, is it truly unavailable from checked sources or only not parsed yet?

## Non-goals

- Do not fabricate institutional ownership by treating 국민연금 or another 5% holder as total institutional ownership.
- Do not infer foreign ownership from price/volume or shareholder rows.
- Do not force KR facts into the global/US shape.
- Do not replace v1.1 immediately; v1.2 should be additive until downstream consumers migrate.

## Proposed top-level shape

```ts
type KrSlimV12 = {
  schemaVersion: 'wisereport-kr-slim-v1.2'
  market: 'KR'
  code: string
  company: {
    code: string
    name: string | null
    market: string | null
    instrumentKind: 'stock' | 'etf' | 'etn' | 'unknown'
  }
  sourceCoverage: SourceCoverage
  pages: KrSlimV11Pages
  krFacts: KrFactsV12
}
```

`pages` remains close to the raw slim v1.1 payload for debugging/backward compatibility. `krFacts` becomes the first-class DeepScan source layer.

## Fact envelope

Every important fact should carry source and availability metadata.

```ts
type FactAvailability = 'present' | 'partial' | 'missing' | 'not_applicable' | 'error'

type Fact<T> = {
  value: T | null
  availability: FactAvailability
  source: {
    provider: 'wisereport' | 'fnguide' | 'krx' | 'naver' | 'internal' | 'unknown'
    pageId?: string
    fieldPath?: string
    checkedSources?: string[]
  }
  reasonCode?: string
  message?: string
  asOf?: string | null
}
```

Important distinction:

- `missing`: should exist for this instrument kind, but checked source did not provide it.
- `not_applicable`: not expected for this instrument kind, e.g. corporate profitability facts for some ETF/ETN views.
- `error`: source should have been checked but failed.

## KR facts v1.2

```ts
type KrFactsV12 = {
  quote: {
    currentPrice: Fact<number>
    currency: Fact<string>
    asOf: Fact<string>
  }

  holdingContext?: {
    shares: Fact<number>
    averagePrice: Fact<number>
    evaluationAmount: Fact<number>
    pnlAmount: Fact<number>
    pnlPct: Fact<number>
  }

  consensus: {
    targetPrice: Fact<number>
    previousTargetPrice: Fact<number>
    targetRevisionPct: Fact<number>
    targetGapPct: Fact<number>
    recommendation: Fact<string | number>
    analystOpinionRows: Fact<Array<Record<string, unknown>>>
  }

  profitability: {
    revenueLatest: Fact<number>
    revenuePrev: Fact<number>
    revenueYoY: Fact<number>
    operatingIncomeLatest: Fact<number>
    operatingIncomePrev: Fact<number>
    operatingIncomeYoY: Fact<number>
    netIncomeLatest: Fact<number>
    netIncomePrev: Fact<number>
    netIncomeYoY: Fact<number>
    operatingMarginLatest: Fact<number>
    netMarginLatest: Fact<number>
    roe: Fact<number>
  }

  valuation: {
    per: Fact<number>
    pbr: Fact<number>
    roe: Fact<number>
    evEbitda: Fact<number>
    forwardPer: Fact<number>
    forwardPbr: Fact<number>
  }

  ownership: {
    majorHolderPct: Fact<number>
    majorHolderShares: Fact<number>
    freeFloatPct: Fact<number>
    freeFloatShares: Fact<number>
    majorShareholders: Fact<Array<KrMajorShareholder>>
    knownInstitutionalMajorHolders: Fact<Array<KrKnownInstitutionalHolder>>
  }

  investorFlow: {
    foreignOwnershipPct: Fact<number>
    institutionalOwnershipPct: Fact<number>
    retailNetBuy: Fact<number>
    foreignNetBuy: Fact<number>
    institutionalNetBuy: Fact<number>
    flowWindow: Fact<'1d' | '5d' | '20d' | '60d'>
    flowRows: Fact<Array<Record<string, unknown>>>
  }

  reports: {
    totalCount: Fact<number>
    recent30dCount: Fact<number>
    latestReportDate: Fact<string>
    recentItems: Fact<Array<KrReportItem>>
  }

  styleFactors: {
    companyName: Fact<string>
    peerName: Fact<string>
    factors: Fact<Array<KrStyleFactor>>
  }

  sourceLimitations: Array<{
    factPath: string
    reasonCode: string
    checkedSources: string[]
    message: string
  }>
}
```

## Required new source acquisition

### 1. Investor flow source

v1.2 needs a source beyond current WiseReport shareholding page for:

- foreign ownership percentage
- institutional ownership percentage, if available
- foreign/institutional/retail net buy over a defined window

Candidate source groups to investigate:

- KRX investor trading by stock
- Naver Finance investor trend/foreign ownership tables
- FnGuide pages if there is a stable investor-flow endpoint not currently captured

Do not choose a provider until availability, stability, and terms/technical feasibility are checked.

### 2. Instrument kind source

ETF/ETN should not be sent through a corporate financial statement expectation path.

v1.2 should classify:

- common stock
- preferred stock if detectable
- ETF
- ETN
- unknown

The DeepScan loader/runtime can then decide:

- stock: full corporate committee path
- ETF/ETN: fund/product-specific path or explicit `not_applicable` facts
- unknown: conservative degraded path

## Mapping from v1.1 to v1.2

| v1.2 fact | v1.1 source | v1.2 status |
|---|---|---|
| targetPrice | `opinion.analystOpinions[].적정주가` | extractable now |
| targetRevisionPct | `opinion.analystOpinions[].적정주가(증감율)` | extractable now |
| operatingMarginLatest | `investment-indicators.metrics` | extractable now |
| netMarginLatest | `investment-indicators.metrics` | extractable now |
| majorHolderPct | `shareholding.ownershipSummary` | extractable now |
| freeFloatPct | `shareholding.ownershipSummary` | extractable now |
| knownInstitutionalMajorHolders | `shareholderChanges`, `majorShareholders` | extractable, but not aggregate |
| foreignOwnershipPct | not in v1.1 | new source required |
| institutionalOwnershipPct | not in v1.1 as aggregate | new source required or explicit unavailable |
| investor net-buy flow | not in v1.1 | new source required |
| ETF/ETN loading semantics | partial through quote fallback only | instrument-kind contract required |

## DeepScan committee checklist

v1.2 should satisfy committee inputs directly:

### Business quality

- revenue/latest/prev/yoy
- operating income/latest/prev/yoy
- net income/latest/prev/yoy
- operating margin
- net margin
- ROE
- missing profitability reason for ETF/ETN or source failures

### Valuation

- PER/PBR/EVEBITDA
- target price
- target gap
- target revision
- recommendation
- missing target reason

### Ownership stability

- major holder pct
- free float pct
- major shareholder list
- major shareholder changes
- known institutional major holders
- explicit absence of aggregate foreign/institutional ownership if no source supports it

### Market timing / flow

- relative return windows
- style factors
- recent reports total/recent30d
- foreign/institutional/retail net-buy window
- foreign ownership pct if source supports it

### Position fit

- current price
- average price
- shares
- PnL amount/percent
- target/upside buffer

## Acceptance criteria

1. v1.2 endpoint or builder exists without breaking v1.1 route/tests.
2. v1.2 output contains `schemaVersion: 'wisereport-kr-slim-v1.2'`.
3. `krFacts.investorFlow.foreignOwnershipPct` is either:
   - `present` with a concrete source path, or
   - `missing` with checked source list and source-specific reason.
4. `krFacts.investorFlow.institutionalOwnershipPct` is not populated from 국민연금/5% holder rows unless a true aggregate source exists.
5. ETF/ETN instruments produce `instrumentKind: 'etf' | 'etn'` and corporate financial facts become `not_applicable` rather than generic missing.
6. DeepScan runtime consumes v1.2 `krFacts` without needing full raw source pages in the LLM prompt.
7. Tests cover:
   - stock with available v1.1-derived facts
   - stock with missing investor-flow aggregate
   - stock with known institutional major holder but missing institutional aggregate
   - ETF/ETN `not_applicable` corporate facts
   - source failure vs true missing distinction

## Suggested implementation phases

### Phase 1 — Contract and fixtures

- Add v1.2 TypeScript/JSDoc schema or JS contract comments.
- Add fixture for 100840 from existing logs.
- Add tests that assert missing investor-flow fields are explicit, not silently null.

### Phase 2 — Fact builder

- Build `buildWiseReportKrSlimPayloadV12` or `buildDeepScanKrFactsV12` from existing v1.1 payload.
- Reuse the hardened v1.1 extractor where facts are already available.
- Add source limitation objects for missing flow aggregates.

### Phase 3 — New flow source research/prototype

- Evaluate KRX/Naver/FnGuide candidates.
- Add one provider only after tests prove stable field mapping.
- Keep provider failure isolated under `krFacts.investorFlow.*.availability = 'error'`.

### Phase 4 — Runtime migration

- Update DeepScan KR runtime to prefer v1.2 `krFacts` when present.
- Keep fallback to v1.1 hardened evidence.
- Compare old/new committee logs for 100840.

## Open questions

1. Which provider is acceptable for investor flow and foreign ownership?
2. Should institutional ownership aggregate be required, or is investor net-buy flow enough for timing committee?
3. Should ETF/ETN DeepScan use a separate committee composition instead of stock committee with `not_applicable` facts?
4. Should v1.2 be exposed as a new route immediately or first as an internal builder consumed by DeepScan?
