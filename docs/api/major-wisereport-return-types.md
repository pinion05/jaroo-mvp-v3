# Major WiseReport return types

This document describes the **raw JSON** payloads returned by the two active Major WiseReport crawler endpoints:

- `GET /api/major/wisereport-fnguide/kr/companies/:code/slim/v1.1`
- `GET /api/major/wisereport-global/us/companies/:ticker/slim/v1.1`

These endpoints **do not use the common crawler envelope** (`ok`, `data`, `meta`, etc.) on success. They return their payload objects directly.

Source of truth:

- `packages/crawler/src/server.js`
- `packages/crawler/test/wisereport-kr-slim-v1.test.cjs`
- `packages/crawler/test/wisereport-global-slim-v1.test.cjs`

## 1. Shared behavior

### 1.1 Success shape

Both endpoints return raw JSON with a page map under `pages`.

- Missing pages are represented as `null`.
- Source-empty table sections are preserved through `status` / `note` when the upstream payload exposes `dataAvailability`.
- The endpoints are **slim** representations:
  - wrapper / transport keys are stripped
  - the payload keeps business data only

### 1.2 Failure shape

On failure, both endpoints still use the standard crawler error envelope.

```json
{
  "ok": false,
  "error": {
    "message": "not found"
  }
}
```

## 2. KR payload: `/api/major/wisereport-fnguide/kr/companies/:code/slim/v1.1`

### 2.1 Top-level schema

```ts
type KrWiseReportSlimV11 = {
  code: string
  company: {
    code: string
    name: string | null
  }
  pages: Record<KrWiseReportPageId, KrWiseReportPage | null>
}
```

### 2.2 Page ids

The KR payload keeps the full 10-page WiseReport/FnGuide page set:

- `company-overview`
- `financial-analysis`
- `investment-indicators`
- `consensus`
- `shareholding`
- `recent-reports`
- `fnguide-finance`
- `relative-return`
- `opinion`
- `style-analysis`

### 2.3 What v1.1 does

The KR builder is a recursive slim-down pass over the normalized page payloads.

It:

- removes transport/debug keys such as `source`, `capture`, `quality`, `stages`, `bodyTextHead`, `sourceType`, `sourceKey`
- keeps only `company.code` and `company.name`
- strips empty / undefined values
- preserves table business data under `rows`
- preserves source-empty annotations via `status` and `note`
- removes spacer columns like `column_10` when they are only blank filler columns
- normalizes row labels:
  - leading `펼치기` / `감추기` prefixes are removed from `항목`
  - trailing `보기` / `닫기` suffixes are removed from keys

### 2.4 Common KR page patterns

#### A. Plain object / list pages

Examples:

- `company-overview`
- `relative-return`
- `opinion`
- `style-analysis`

These pages typically keep only the business fields that are still meaningful after slimming.

Example:

```json
{
  "company-overview": {
    "profile": [
      { "key": "홈페이지", "value": "https://www.samsung.com/sec" }
    ],
    "recentHistory": {
      "rows": [
        { "일자": "2025/01/01", "이벤트": "예시" }
      ]
    },
    "salesComposition": {
      "status": "source-empty",
      "note": "The salesComposition value cells were empty in the upstream source.",
      "rows": [
        { "매출유형": "기타", "제품명": "메모리 반도체" }
      ]
    }
  }
}
```

#### B. Table-like pages

Examples:

- `financial-analysis`
- `investment-indicators`
- `consensus`
- `shareholding`
- `fnguide-finance`

The slim payload keeps the table rows and any meaningful status metadata, but removes the parser-only wrapper fields.

Example:

```json
{
  "financial-analysis": {
    "financialStatements": {
      "rows": [
        {
          "항목": "매출액(수익)",
          "2025/12 (IFRS연결) 연간컨센서스": "100",
          "2026/03(E)(최근분기) 분기컨센서스": "10"
        }
      ]
    }
  }
}
```

### 2.5 Nullability and optionality

- `pages[pageId]` can be `null` when a page is missing upstream.
- `company.name` can be `null` if the company name cannot be inferred from any page.
- Table-like children may omit `status` / `note` unless the upstream source provided them.
- Empty arrays are preserved when they are meaningful business results.

### 2.6 KR contract summary

The KR v1.1 endpoint is best thought of as:

- **same page coverage as the archived KR aggregate**
- **same business fields, but slimmer**
- **no transport wrapper**
- **no schemaVersion field**

## 3. Global payload: `/api/major/wisereport-global/us/companies/:ticker/slim/v1.1`

### 3.1 Top-level schema

```ts
type GlobalWiseReportSlimV11 = {
  schemaVersion: '1.1'
  company: {
    securityId: string | null
    ticker: string | null
    market: string | null
    exchange: string | null
    name: string | null
    currency: string | null
  }
  pages: {
    snap: GlobalSnapPage | null
    finance: GlobalFinancePage | null
    invest: GlobalInvestPage | null
    consensus: GlobalConsensusPage | null
    analysis: GlobalAnalysisPage | null
  }
  ticker: string | null
  cmpCode: string | null
}
```

### 3.2 Page coverage

The Global v1.1 endpoint consumes only the **Company 5 routes**:

- `company-snap`
- `company-finance`
- `company-invest`
- `company-consensus`
- `company-analysis`

It does **not** include the archived earnings/news/theme/economy routes.

### 3.3 Shared block types

The Global payload is normalized into a more explicit schema than KR.

#### Table block

```ts
type GlobalTableBlock = {
  columns: Array<{
    id: string
    label: string
    frequency: 'forward' | null
    estimate: boolean
    sequence: number
    sourceIndex: number
  }>
  rows: Array<{
    rowId: string
    label: string | null
    meta: {
      rowType: 'metric' | 'section'
      level: number | null
      unit: string | null
      pointCount?: number | null
      labelEn?: string | null
    }
    cells: Record<string, string | number | null>
  }>
  sectionRows?: Array<...>
  availability: {
    status: 'ok' | 'empty'
    note: string | null
  }
}
```

#### Chart block

```ts
type GlobalChartBlock = {
  id: string
  title: string | null
  xAxis: {
    type: 'period'
    points: Array<{
      id: string
      label: string
      frequency: 'forward' | null
      estimate: boolean
      sequence: number
      sourceIndex: number
    }>
  }
  yAxes: Array<{
    id: string
    label: string | null
  }>
  series: Array<{
    id: string
    name: string | null
    type: string | null
    unit: string | null
    axisId: string
    points: Array<{
      x: string
      y: string | number | null
    }>
  }>
  availability: {
    status: 'ok' | 'empty'
    note: string | null
  }
}
```

### 3.4 Page-by-page schema

#### A. `snap`

`snap` contains:

- `news`
- `valuationBands.primary`
- `valuationBands.secondary`
- `financialSummary`
- `priceVolume`
- `esg`

Example:

```json
{
  "pages": {
    "snap": {
      "news": [
        {
          "id": "story-1",
          "publishedAt": "2026-04-08T03:00:00.000Z",
          "titles": {
            "en": "English title",
            "ko": "한글 제목"
          }
        }
      ],
      "financialSummary": {
        "columns": [
          { "id": "period:202301", "label": "202301", "sequence": 1, "sourceIndex": 1, "estimate": false, "frequency": null }
        ],
        "rows": [
          {
            "rowId": "M705500",
            "label": "시가총액",
            "meta": { "rowType": "metric", "level": 2, "unit": "[단위: USD mn]" },
            "cells": {
              "period:202301": 480610.2
            }
          }
        ],
        "availability": { "status": "ok", "note": null }
      }
    }
  }
}
```

Field notes:

- `news[]`
  - deduped by `storyId` when present, otherwise by title
  - sorted newest-first by `publishedAt`
  - each item keeps `id`, `publishedAt`, and bilingual titles
- `valuationBands.*`
  - band definitions are fixed to `p1` through `p4`
  - `semanticStatus` is always `source-opaque`
- `financialSummary`
  - table block with row/column ids derived from the source headers
- `priceVolume`
  - `samplingInterval` is always `weekly_or_source_defined`
  - `benchmark.semanticType` is always `relative_performance`
- `esg`
  - contains `ratings`, `summary`, and `peerComparison`

#### B. `finance`

`finance` contains:

- `statements.income`
- `statements.balanceSheet`
- `statements.cashFlow`
- `charts`

Example:

```json
{
  "pages": {
    "finance": {
      "statements": {
        "income": {
          "rows": [
            {
              "rowId": "1",
              "label": "매출액(수익)",
              "meta": { "rowType": "metric", "level": 1, "unit": null },
              "cells": {
                "period:202301": 26914,
                "period:202401": 26974
              }
            }
          ],
          "availability": { "status": "ok", "note": null }
        }
      },
      "charts": {
        "chartData1": {
          "id": "chartData1",
          "title": "주요재무항목",
          "xAxis": {
            "type": "period",
            "points": [
              { "id": "period:202301", "label": "202301", "sequence": 1, "sourceIndex": 1, "estimate": false, "frequency": null }
            ]
          },
          "yAxes": [
            { "id": "left", "label": "%" }
          ],
          "series": [
            {
              "id": "series:매출액-좌",
              "name": "매출액(좌)",
              "type": "column",
              "unit": "USD mn",
              "axisId": "right",
              "points": [
                { "x": "period:202301", "y": 26914 }
              ]
            }
          ],
          "availability": { "status": "ok", "note": null }
        }
      }
    }
  }
}
```

#### C. `invest`

`invest` contains:

- `metrics`
- `charts`

It uses the same table / chart block shapes as `finance`.

#### D. `consensus`

`consensus` contains:

- `currency`
- `targetPeriods`
- `metricDefinitions`
- `observations`
- `availability`

Example:

```json
{
  "pages": {
    "consensus": {
      "currency": "USD",
      "targetPeriods": [
        {
          "id": "fwd:202701",
          "label": "Fwd.12M",
          "frequency": "forward",
          "estimate": false,
          "sequence": 2,
          "sourceIndex": 2
        }
      ],
      "metricDefinitions": [
        { "id": "val1", "sourceField": "VAL1", "label": null }
      ],
      "observations": [
        {
          "asOfDate": "2026-04-08",
          "targetPeriodId": "period:202701",
          "targetPeriodLabel": "202701",
          "metrics": {
            "val1": 182.08
          }
        }
      ],
      "availability": { "status": "ok", "note": null }
    }
  }
}
```

#### E. `analysis`

`analysis` contains:

- `peerGroup.members`
- `peers`
- `metrics`
- `returns`

`peerGroup.members` merges the peer list, metrics list, and returns list by `securityId`.

Example:

```json
{
  "pages": {
    "analysis": {
      "peerGroup": {
        "members": [
          {
            "company": {
              "securityId": "NVDA-US",
              "ticker": "NVDA",
              "exchange": "NASDAQ",
              "market": "US",
              "name": "NVIDIA"
            },
            "metrics": {
              "per": 40.8646,
              "epsGw": 146.236,
              "pbr": 37.04859,
              "roe": 119.177,
              "eps": 2.93824,
              "evEbitda": null
            },
            "returns": {
              "return1dPct": 2.2346,
              "return1wPct": 3.6017,
              "return3mPct": -1.5997,
              "return6mPct": -3.7175,
              "return1yPct": 89.0758,
              "return3yPct": 573.4474
            }
          }
        ],
        "availability": { "status": "ok", "note": null }
      }
    }
  }
}
```

### 3.5 Nullability and optionality

- `pages.snap`, `pages.finance`, `pages.invest`, `pages.consensus`, `pages.analysis` can each be `null`.
- `company.securityId`, `ticker`, `market`, `exchange`, `name`, `currency` can each be `null` when the upstream source is incomplete.
- `sectionRows` is optional and appears only when a table contains section-style rows.
- `availability` is always present on table/chart blocks produced by the v1.1 builder.

### 3.6 Global contract summary

The Global v1.1 endpoint is a stronger normalization contract than KR:

- explicit `schemaVersion`
- explicit `company` object
- explicit page-specific normalized blocks
- explicit table/chart metadata
- no common crawler envelope on success

## 4. KR vs Global differences

| Aspect | KR v1.1 | Global v1.1 |
| --- | --- | --- |
| Top-level version field | 없음 | `schemaVersion: "1.1"` |
| Company object | `{ code, name }` | `{ securityId, ticker, market, exchange, name, currency }` |
| Page model | 10 slimmed page payloads | 5 normalized blocks |
| Table normalization | Recursive slimming of source tables | Dedicated `table block` schema |
| Chart normalization | Source-shaped slimmed chart objects | Dedicated `chart block` schema |
| Missing page value | `null` | `null` |
| Transport wrapper on success | 없음 | 없음 |

## 5. Practical guidance

- Use **KR v1.1** when you want to preserve WiseReport/FnGuide source page shape but remove parser noise.
- Use **Global v1.1** when you want a more structured and stable consumer schema.
- In both cases, do not expect the common crawler envelope on success.
- For client code, treat nested page entries and table/chart sub-blocks as potentially nullable.
