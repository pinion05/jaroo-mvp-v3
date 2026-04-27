# Issue #34 — KR DeepScan Dump Schema v2 Design

## Status

- Branch: `issue34-kr-dump-schema-design`
- Date: 2026-04-27
- Scope: analysis/design plus implementation baseline for extractor/runtime v2.
- Related log: `.omx/context/committee-debug-logs/kr-committee-100840-1777268560462/`
- Related issue: GitHub #34, “Improve DeepScan context quality for low-evidence committee analysis”

## Problem statement

KR DeepScan currently tries to normalize WiseReport/FnGuide/KRX evidence into a generic `shared + members` runtime dump that resembles the US/global committee path. That common interface is useful for the LLM runner, but the **facts inside the dump are too global-shaped** and lose KR-specific data that exists in raw sources.

Observed effect:

- The LLM says context is missing even when raw KR source contains the data.
- Some member calls are unstable near the 45s timeout.
- Composite facts are marked `availability: present` even when important child fields are null/empty, which weakens evidence quality semantics.

## Current evidence from latest forensic run

Latest run succeeded 9/9 members, but still exposed context gaps:

- `targetPrice: null`, though raw `opinion.analystOpinions.rows[0].적정주가` = `66,000`.
- `targetGapPct: null`, though current price = `57,100`, implying target gap ≈ `15.59%`.
- `revisionPct: null`, though raw `적정주가(증감율)` = `10.00`.
- `operatingMarginLatest: null`, `netMarginLatest: null`, though raw `investment-indicators.metrics` has 2026E operating margin `19.75`, net margin `15.93`.
- `majorHolderPct: null`, though raw `shareholding.ownershipSummary` has `10,820,079주 (52.32%)`.
- no typed `freeFloatPct`, though raw `유동주식비율` = `43.23%`.
- `styleAnalysisSnapshot.factorScores: []`, though raw `style-analysis.factorScores.CHART_D` has 12 factor rows.
- `recent30dReportCount` missing, though recent report rows yield 4 reports within 30 days of quote date `2026-04-27`.

Fields truly missing from the current captured sources:

- aggregate foreign ownership percentage
- aggregate institutional ownership percentage
- `packageResult` / packageContext

## Design principle

Do **not** force KR facts into the US/global shape too early.

Keep the LLM runtime interface common:

```ts
scoreCommitteeMembers({ memberKeys, shared, members, options })
```

But branch the runtime dump facts by market/source flavor:

```ts
runtimeShape = {
  schemaVersion: 'jaroo.deepscan.runtime.v2',
  locale: 'KR',
  sourceFlavor: 'wisereport-fnguide-krx',
  shared,
  factBank: {
    kr: { ...KR-specific normalized facts... }
  },
  members
}
```

US/global keeps its existing generator/contract path. KR gets a first-class KR fact bank rather than a lossy global approximation.

## Proposed KR schema v2

### Common fact envelope

Every normalized field should carry value, quality, source path, and derivation kind.

```ts
type Fact<T> = {
  value: T | null
  quality: {
    availability: 'present' | 'partial' | 'missing'
    reasonCode: string[]
    derivationKind: 'direct' | 'computed' | 'inferred' | 'not_provided'
    inputOrigin: 'source' | 'derived' | 'system'
    sourcePath?: string
    sourceChecked?: string[]
  }
  notes?: string[]
}
```

Important: parent objects should not be blindly `present` when key child facts are missing. Use `partial` for snapshots containing a mix of present/missing facts.

### KR fact bank

```ts
factBank.kr = {
  instrument: {
    code,
    name,
    market,
    kind
  },

  quote: {
    currentPrice,
    currency,
    asOf,
    source
  },

  holding: {
    shares,
    averagePrice,
    evaluationAmount,
    pnlAmount,
    pnlPct
  },

  opinionConsensus: {
    targetPrice,
    previousTargetPrice,
    targetRevisionPct,
    targetGapPct,
    recommendation,
    recommendationPrevious,
    estimateAsOf,
    analystRows
  },

  profitability: {
    revenueLatest,
    revenuePrev,
    revenueYoY,
    operatingIncomeLatest,
    operatingIncomePrev,
    operatingIncomeYoY,
    netIncomeLatest,
    netIncomePrev,
    netIncomeYoY,
    operatingMarginLatest,
    netMarginLatest,
    roe
  },

  valuation: {
    per,
    pbr,
    roe,
    evEbitda,
    forwardPer,
    forwardPbr
  },

  ownership: {
    majorHolderPct,
    majorHolderShares,
    freeFloatPct,
    freeFloatShares,
    majorShareholders,
    shareholderChanges,
    foreignOwnershipPct,
    institutionalOwnershipPct,
    sourceLimitations
  },

  styleFactors: {
    factors: [
      { name, companyValue, industryValue, sourcePath }
    ]
  },

  reports: {
    totalCount,
    recent30dCount,
    latestReportDate,
    recentItems,
    sourceLimitations
  },

  packageContext: {
    available,
    summaryFacts,
    marketView,
    boardHighlights
  },

  limitations: [
    { code, message, sourceChecked }
  ]
}
```

## Mapping from raw KR source to schema

| Fact | Raw source | Current issue | v2 mapping |
|---|---|---|---|
| target price | `opinion.analystOpinions.rows[0].적정주가`; fallback `opinion.estimateHistory` | extractor only checks `consensus` and only `목표주가` | `factBank.kr.opinionConsensus.targetPrice` direct |
| target revision | `opinion.analystOpinions.rows[0].적정주가(증감율)` | not extracted | `targetRevisionPct` direct |
| target gap | target price + quote price | not computed | `targetGapPct` computed |
| margins | `investment-indicators.metrics` rows for `영업이익률`, `순이익률` | extractor only checks financial/fnguide pages | `profitability.operatingMarginLatest`, `netMarginLatest` direct |
| major holder | `shareholding.ownershipSummary.rows[0].최대주주(보유지분)` | key-based value with shares + pct not parsed | parse shares and parenthesized pct |
| free float | `shareholding.ownershipSummary.rows[0].유동주식*` | no typed field | add `freeFloatPct`, `freeFloatShares` |
| style factors | `style-analysis.factorScores.CHART_D` plus `CHART_H`; fallback popupTable | extractor reads `CHART_H` as data | map CHART_D rows to company/industry values |
| recent 30d reports | `recent-reports.recentReports.rows[*].일자` + quote date | only total count exists | compute rolling count |
| foreign ownership | not in current source | truly missing | missing fact with `not_provided_by_wisereport_shareholding` |
| institutional ownership | no aggregate in current source; major holders include 국민연금 | ambiguous | missing aggregate; optionally expose `knownInstitutionalMajorHolders` separate from aggregate |
| packageContext | `sources.packageResult` absent | truly missing | missing/available false |

## Runtime dump shape

### Shared context should be small

`shared` should contain only data every member needs:

```ts
shared = {
  schemaVersion,
  locale,
  sourceFlavor,
  instrument,
  quote,
  holdingSummary,
  sourceCoverage,
  limitationsSummary,
  topFacts,
  topRisks
}
```

### Member context should be a KR-specific slice

Avoid sending the full shared object plus duplicated facts to every member. Build member slices from `factBank.kr`:

```ts
members.profitability = {
  member: 'profitability',
  locale: 'KR',
  axis: 'Business Quality',
  facts: {
    profitability: factBank.kr.profitability,
    valuation: pick(factBank.kr.valuation, ['pbr', 'roe']),
    reports: pick(factBank.kr.reports, ['recent30dCount'])
  },
  sourceLimitations: relevantLimitations([...])
}

members.ownershipStability = {
  member: 'ownershipStability',
  locale: 'KR',
  axis: 'Business Quality',
  facts: {
    ownership: factBank.kr.ownership,
    styleFactors: pickTopStyleFactors(factBank.kr.styleFactors),
    reports: pick(factBank.kr.reports, ['totalCount', 'recent30dCount'])
  },
  sourceLimitations: [foreignOwnershipMissing, institutionalAggregateMissing]
}
```

This preserves KR source semantics while keeping token load controlled.

## Prompt implications

KR system prompt should mention source flavor explicitly:

- “You are using KR WiseReport/FnGuide/KRX factBank.kr.”
- “Do not call a fact missing if it exists as a present fact in `factBank.kr`.”
- “If a fact is marked missing, describe the source-specific limitation rather than generic context 부족.”
- “Use KR-specific names: 적정주가, 유동주식비율, 스타일 팩터, 최근 리포트.”

## Runtime stability design

Latest run showed one empty response at exactly ~45s and final success on retry. The issue is not only prompt size; hidden reasoning tokens and 9-way concurrent calls are pushing latency.

Recommended low-risk runtime changes:

1. Make timeout env-configurable, default 60s for KR committee.
2. Add committee concurrency cap, default 3 or 4, no new dependency.
3. Preserve retry for empty 200 responses with jittered backoff.
4. Continue forensic logs: request, prompt, source-input, attempt logs, upstream choice/usage.
5. Later: reduce duplicate `sharedContext` in member prompts.

## Implementation plan

### Phase 0 — Preserve current forensic logging

Current branch already contains forensic logging changes. Keep them while implementing schema v2 so every before/after run can be compared.

### Phase 1 — KR extractor fixes

Edit `packages/crawler/src/services/deepscan-kr-evidence.js`:

- Add helper for key-based row extraction.
- Add helper for parenthesized percent parsing.
- Add latest-column selector that prefers estimate/latest columns over oldest historical columns.
- Extend consensus extraction to include `opinion` page.
- Extend financial/margin extraction to include `investment-indicators` page.
- Fix style factor extraction to use `CHART_D`/`popupTable`.
- Compute `recent30dReportCount` from report dates and quote date.
- Add explicit missing facts/limitations for not-provided fields.

### Phase 2 — KR dump v2 builder

Edit `packages/crawler/src/services/deepscan-kr-committee-runtime.js`:

- Introduce `buildKrFactBank(input, evidence, sources)` or import from a dedicated module.
- Add `buildKrSharedDumpV2` and `buildKrMemberDumpV2`.
- Include `schemaVersion`, `locale`, `sourceFlavor`.
- Keep old compatibility fields temporarily if downstream code needs them.
- Ensure `runtime-shape.json` logs both `shared`, `factBank`, and `members`.

### Phase 3 — Tests

Add/extend tests in `packages/crawler/test/deepscan-kr-score.test.cjs` or a dedicated evidence test:

- target price extracted from `opinion.analystOpinions`.
- target gap computed from target and quote.
- margins extracted from `investment-indicators.metrics`.
- major holder pct/free-float pct parsed from shareholding summary.
- style factors extracted from `CHART_D`.
- recent 30d count computed correctly.
- foreign/institutional aggregate missing is explicit and source-specific.

Runtime tests:

- empty 200 response retry still logs attempt-specific files.
- concurrency cap returns all members without changing result shape.
- timeout env config is honored.

### Phase 4 — Live comparison

Run `/deepscan` for `100840` again and compare:

- old log: `kr-committee-100840-1777268560462`
- new log: next `kr-committee-100840-*`

Expected improvements:

- LLM no longer says target price is missing.
- LLM no longer says margin data is missing when KR margins exist.
- ownership member uses typed `majorHolderPct` and `freeFloatPct`.
- style/trend members receive actual factor scores.
- consensus/trend/upside members receive `recent30dReportCount`.
- truly missing fields are described source-specifically.

## Non-goals

- Do not fabricate foreign/institutional ownership aggregate from unrelated fields.
- Do not treat 국민연금 5.18% as aggregate institutional ownership unless product policy explicitly allows a separate “known institutional major holder” fact.
- Do not send full raw KR source to the LLM.
- Do not make UI-only copy changes before the evidence/dump layer is fixed.

## Decision

Adopt a **common runtime envelope + market-specific fact bank**.

- Common: member scoring API, result schema, logging, retry/concurrency controls.
- KR-specific: fact extraction, fact bank, member slices, source-specific missing reasons.
- US/global-specific: keep existing generated dump contract unless a separate migration is planned.

## Implementation checkpoint

Implemented in this branch:

- `deepscan-kr-evidence.js`
  - extracts target price/revision from `opinion.analystOpinions`
  - parses parenthesized KR shareholding strings such as `10,820,079주 (52.32%)`
  - selects the latest annual/estimate period instead of oldest historical columns
  - extracts operating/net margins and valuation ratios from `investment-indicators`
  - maps style factor `CHART_D` rows with company/peer values
  - computes `recent30dReportCount`
  - emits source-specific limitations for truly unavailable foreign/institutional aggregates
- `deepscan-kr-committee-runtime.js`
  - logs `schemaVersion`, `locale`, `sourceFlavor`, `factBank`, `shared`, and `members`
  - includes `krFacts` member slices in LLM request context
  - updates KR prompt guardrails so source-provided facts are not called missing
  - defaults KR committee timeout to 75s and concurrency to 4 unless overridden by env
- `deepscan-runtime-core/src/committee-llm.js`
  - adds configurable timeout/retry delay
  - adds dependency-free committee concurrency limiting
  - records effective concurrency in the summary log

Verification evidence:

- `node --test packages/crawler/test/deepscan-kr-evidence.test.cjs`
- `npx -y tsx --test packages/deepscan-runtime-core/test/committee-llm.test.ts`
- `npm --prefix packages/crawler run check`
- `npm --prefix packages/crawler run test`
- `npm test`
- `npm run lint:web` (passes with pre-existing warnings only)
- direct replay of old log `kr-committee-100840-1777268560462` now yields:
  - target price `66,000`, previous `60,000`, revision `10%`, target gap `15.59%`
  - operating margin `19.75`, net margin `15.93`
  - major holder `52.32%`, free float `43.23%`
  - 12 style factors
  - recent 30d reports `4`
