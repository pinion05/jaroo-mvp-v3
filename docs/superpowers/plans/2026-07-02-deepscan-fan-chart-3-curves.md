# DeepScan Fan Chart — 3 Target-Price Curves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show three projection curves (최고/평균/최저) in the DeepScan loading-screen consensus fan chart instead of the single average target path.

**Architecture:** Extract a pure, pixel-mapping geometry builder (`buildConsensusFanGeometry`) into `src/lib/deepscan-target-price-paths.ts` (where the GBM simulation primitives already live), so it is unit-testable with the project's `node:test` setup (the `.tsx` component cannot be imported into `node:test` because of its CSS-module import). The React component becomes a thin consumer that maps the returned curves to colored `<path>`/`<circle>` elements plus a 4-item legend.

**Tech Stack:** TypeScript, React (Next.js, client component), SVG, CSS Modules, `node:test` + `node:assert/strict` (run via `tsx --test`).

## Global Constraints

- Reuse existing CSS color tokens — do **not** introduce new hex values: 평균 `--ds-blue` (#2b6be6), 최고 `--ds-green` (#1a9d55), 최저 `--ds-red` (#e5484d), 현재가 `--ds-muted`, 현재 점 `--ds-ink`.
- Keep SVG `viewBox='0 0 300 120'` and the existing plot insets (`left=10`, `right=290`, `top=18`, `bottom=100`, `padY=10`).
- Reuse existing keyframes `consensus-target-draw` and `consensus-point-reveal` — do not add new keyframe animations.
- The simulation must stay deterministic for the same seed (no flicker on re-render).
- Tests run with `node:test`; only pure (non-React) logic is unit-tested, matching the existing pattern in `src/components/deepscan-loading-screen.test.ts`.
- Korean copy in the legend: 평균 / 최고 / 최저 / 현재가.

---

## File Structure

- **Create** `src/lib/deepscan-target-price-paths.test.ts` — unit tests for the new pure geometry builder (project has no test file for this lib yet).
- **Modify** `src/lib/deepscan-target-price-paths.ts` — add exported types + `buildConsensusFanGeometry` (pure). Reuses the file's existing private `simulateTargetPricePaths`, `buildTargetPriceFanBands`, `clamp`.
- **Modify** `src/components/deepscan-loading-screen.tsx` — rewrite `TargetPriceFanChart` to consume the new builder and render N curves; update imports; delete the now-redundant local `buildTargetPriceFanGeometry`.
- **Modify** `src/components/deepscan-loading-screen.module.css` — add `.consensusFanHighPath` / `.consensusFanLowPath`, `.consensusFanHighDot` / `.consensusFanLowDot`, legend swatch classes, and extend the reduced-motion block.

---

## Task 1: Pure multi-endpoint geometry builder + tests (TDD)

**Files:**
- Create: `src/lib/deepscan-target-price-paths.test.ts`
- Modify: `src/lib/deepscan-target-price-paths.ts` (add types + function; place the new code immediately before the `// --- internals ---` comment near the end of the file)

**Interfaces:**
- Consumes: the file's own `simulateTargetPricePaths`, `buildTargetPriceFanBands`, `clamp` (all already defined in this file), and the exported constant `DEFAULT_TARGET_PRICE_DAILY_VOLATILITY`.
- Produces: `buildConsensusFanGeometry(input)` returning `ConsensusFanGeometry | null`, where `ConsensusFanGeometry.curves` is an array of `{ key: 'high'|'average'|'low'; pathD: string; dotY: number }` in render order `[low, high, average]` (average last = foreground). Task 2 consumes exactly these names.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/deepscan-target-price-paths.test.ts` with this complete content:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildConsensusFanGeometry } from '@/lib/deepscan-target-price-paths'

test('buildConsensusFanGeometry returns null when current or average target is not positive/finite', () => {
  assert.equal(buildConsensusFanGeometry({ currentPrice: 0, averageTarget: 100 }), null)
  assert.equal(buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 0 }), null)
  assert.equal(buildConsensusFanGeometry({ currentPrice: Number.NaN, averageTarget: 100 }), null)
})

test('buildConsensusFanGeometry renders only the average curve when high/low are absent', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, seed: 's' })
  assert.ok(g)
  assert.deepEqual(g!.curves.map((c) => c.key), ['average'])
})

test('buildConsensusFanGeometry returns curves in render order [low, high, average] when all targets are present', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  assert.ok(g)
  assert.deepEqual(g!.curves.map((c) => c.key), ['low', 'high', 'average'])
})

test('buildConsensusFanGeometry skips a null or non-positive high/low but keeps the rest', () => {
  const onlyLow = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: null, seed: 's' })
  assert.ok(onlyLow)
  assert.deepEqual(onlyLow!.curves.map((c) => c.key), ['low', 'average'])

  const onlyHigh = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 0, highTarget: 160, seed: 's' })
  assert.ok(onlyHigh)
  assert.deepEqual(onlyHigh!.curves.map((c) => c.key), ['high', 'average'])
})

test('buildConsensusFanGeometry is deterministic for identical inputs', () => {
  const a = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  const b = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  assert.deepEqual(a, b)
})

test('buildConsensusFanGeometry anchors each curve tail exactly onto its endpoint dot', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 80, highTarget: 160, seed: 's' })
  assert.ok(g)
  for (const curve of g!.curves) {
    const match = curve.pathD.match(/L\d+(?:\.\d+)? (\d+(?:\.\d+)?)$/)
    assert.ok(match, `curve ${curve.key} should end with an L segment`)
    assert.equal(Number(match![1]), curve.dotY)
  }
})

test('buildConsensusFanGeometry places the high dot above the low dot (smaller y = higher)', () => {
  const g = buildConsensusFanGeometry({ currentPrice: 100, averageTarget: 120, lowTarget: 50, highTarget: 200, seed: 's' })
  assert.ok(g)
  const low = g!.curves.find((c) => c.key === 'low')
  const high = g!.curves.find((c) => c.key === 'high')
  assert.ok(low && high)
  assert.ok(high!.dotY < low!.dotY, 'high target should render above (lower y) the low target')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx -y tsx --test src/lib/deepscan-target-price-paths.test.ts`
Expected: FAIL — `buildConsensusFanGeometry` is not exported (does not exist yet).

- [ ] **Step 3: Implement `buildConsensusFanGeometry`**

In `src/lib/deepscan-target-price-paths.ts`, insert this block immediately **before** the `// --- internals ---` line near the end of the file:

```ts
// ---------------------------------------------------------------------------
// Multi-endpoint fan geometry
//
// Maps one median projection curve per active target-price endpoint (평균 /
// 최고 / 최저) into the SVG pixel space used by the loading-screen consensus
// chart. Pure + deterministic so it can be unit-tested with node:test
// (the .tsx component itself cannot be imported there due to its CSS-module
// import). The component consumes the returned `curves` array directly.
// ---------------------------------------------------------------------------

export type ConsensusFanCurveKey = 'high' | 'average' | 'low'

export type ConsensusFanCurve = {
  /** Which target-price level this curve projects to; drives styling + legend. */
  key: ConsensusFanCurveKey
  /** SVG path data for the median projection, e.g. "M10 50 L20 49 ...". */
  pathD: string
  /** Pixel y of the right-edge dot (the curve's terminal point lands here). */
  dotY: number
}

export type ConsensusFanGeometryInput = {
  currentPrice: number
  averageTarget: number
  highTarget?: number | null
  lowTarget?: number | null
  /** Per-step (daily) volatility; falls back to the default when not finite. */
  volatility?: number
  /** Base seed; suffixed per endpoint so each curve is independently stable. */
  seed?: string
}

export type ConsensusFanGeometry = {
  leftX: number
  rightX: number
  currentY: number
  /**
   * Active curves in render order `[low, high, average]` so the average
   * (primary) curve is painted last and sits on top. `high`/`low` are omitted
   * when their target is absent/non-positive.
   */
  curves: ConsensusFanCurve[]
}

/**
 * Build the pixel geometry for the consensus fan chart. Returns `null` when
 * the required current/average values are missing or no curve could be built.
 */
export function buildConsensusFanGeometry(input: ConsensusFanGeometryInput): ConsensusFanGeometry | null {
  const { currentPrice, averageTarget } = input
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(averageTarget) || averageTarget <= 0) {
    return null
  }

  // Plot region (must match the SVG viewBox 0 0 300 120 used by the component).
  const left = 10
  const right = 290
  const top = 18
  const bottom = 100
  const width = right - left
  const padY = 10
  const plotTop = top + padY
  const plotBottom = bottom - padY

  // Collect active endpoints (average is always present; high/low optional).
  const endpoints: Array<{ key: ConsensusFanCurveKey; price: number }> = []
  if (Number.isFinite(input.lowTarget) && (input.lowTarget as number) > 0) {
    endpoints.push({ key: 'low', price: input.lowTarget as number })
  }
  endpoints.push({ key: 'average', price: averageTarget })
  if (Number.isFinite(input.highTarget) && (input.highTarget as number) > 0) {
    endpoints.push({ key: 'high', price: input.highTarget as number })
  }

  const baseSeed = input.seed && input.seed.length ? input.seed : `${currentPrice}|${averageTarget}`
  const volatility = Number.isFinite(input.volatility) && (input.volatility as number) > 0
    ? (input.volatility as number)
    : DEFAULT_TARGET_PRICE_DAILY_VOLATILITY

  // Simulate a deterministic median path per endpoint.
  const perEndpoint = endpoints.map((ep) => {
    const paths = simulateTargetPricePaths({
      currentPrice,
      targetPrice: ep.price,
      volatility,
      seed: `${baseSeed}|${ep.key}`,
    })
    const bands = buildTargetPriceFanBands(paths)
    return { key: ep.key, price: ep.price, median: bands ? bands.median : null }
  })

  // Shared y-extent across current + every active endpoint + their medians,
  // so all curves + dots fit inside the plot area.
  const extentValues: number[] = [currentPrice, ...endpoints.map((e) => e.price)]
  for (const pe of perEndpoint) {
    if (pe.median) {
      extentValues.push(...pe.median)
    }
  }
  const minValue = Math.min(...extentValues)
  const maxValue = Math.max(...extentValues)
  const range = maxValue - minValue || Math.max(1, maxValue * 0.02)

  const stepCount = perEndpoint[0].median?.length ?? 0
  const xAt = (i: number) => (stepCount <= 1 ? right : left + (width * i) / (stepCount - 1))
  const yAt = (value: number) => clamp(plotBottom - ((value - minValue) / range) * (plotBottom - plotTop), top, bottom)
  const round = (v: number) => Math.round(v * 10) / 10

  const currentY = round(yAt(currentPrice))

  const renderOrder: ConsensusFanCurveKey[] = ['low', 'high', 'average']
  const curves: ConsensusFanCurve[] = []
  for (const key of renderOrder) {
    const pe = perEndpoint.find((p) => p.key === key)
    if (!pe || !pe.median || pe.median.length === 0) {
      continue
    }
    const median = pe.median
    const n = median.length
    const endpointY = round(yAt(pe.price))
    const lastMedianY = yAt(median[n - 1])
    // Anchor: nudge each point by a linear shift so the final point lands
    // exactly on the endpoint dot (same technique the old single-target
    // builder used), with no visible kink.
    const points = median.map((value, i) => {
      const t = n === 1 ? 1 : i / (n - 1)
      const shift = (endpointY - lastMedianY) * t
      return { x: round(xAt(i)), y: round(yAt(value) + shift) }
    })
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
    curves.push({ key, pathD, dotY: endpointY })
  }

  if (curves.length === 0) {
    return null
  }

  return { leftX: left, rightX: right, currentY, curves }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx -y tsx --test src/lib/deepscan-target-price-paths.test.ts`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deepscan-target-price-paths.ts src/lib/deepscan-target-price-paths.test.ts
git commit -m "feat(deepscan): add pure buildConsensusFanGeometry for multi-target fan chart"
```

---

## Task 2: Wire the component to render 3 curves + legend (+ CSS)

**Files:**
- Modify: `src/components/deepscan-loading-screen.tsx` — rewrite `TargetPriceFanChart` (≈ lines 601–652), update the import block (≈ lines 33–37), delete the local `buildTargetPriceFanGeometry` (≈ lines 1022–1075).
- Modify: `src/components/deepscan-loading-screen.module.css` — add curve/dot/legend classes (after the `.consensusFanTargetDot` block ending ≈ line 818 and the `.consensusFanLegendTarget i` rule ≈ line 849); extend the reduced-motion block (≈ lines 2708–2735).

**Interfaces:**
- Consumes: `buildConsensusFanGeometry`, `ConsensusFanCurveKey`, `ConsensusFanGeometry` from Task 1; and `estimateDailyVolatility` (already imported). Also reads `consensus.highTargetValue` / `consensus.lowTargetValue` (already on the `LoadingQuickFact['consensus']` type, ≈ lines 108–109).
- Produces: the rendered chart with up to 3 colored curves + dots + a 4-item legend. No new public component API.

- [ ] **Step 1: Add the new CSS classes (high/low curves, dots, legend swatches)**

In `src/components/deepscan-loading-screen.module.css`, find the `.consensusFanTargetDot { ... }` rule (ends ≈ line 818) and **insert immediately after its closing brace**:

```css
.consensusFanHighPath {
  fill: none;
  stroke: var(--ds-green);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: consensus-target-draw 1.8s 0.1s ease-out forwards;
}

.consensusFanLowPath {
  fill: none;
  stroke: var(--ds-red);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: consensus-target-draw 1.8s 0.1s ease-out forwards;
}

.consensusFanHighDot {
  fill: var(--ds-green);
  stroke: #fff;
  stroke-width: 1.4;
  opacity: 0;
  animation: consensus-point-reveal 0.4s 2.1s ease-out forwards;
}

.consensusFanLowDot {
  fill: var(--ds-red);
  stroke: #fff;
  stroke-width: 1.4;
  opacity: 0;
  animation: consensus-point-reveal 0.4s 2.1s ease-out forwards;
}
```

Then find the `.consensusFanLegendTarget i { ... }` rule (≈ lines 844–849) and **insert immediately after its closing brace**:

```css
.consensusFanLegendHigh,
.consensusFanLegendLow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.consensusFanLegendHigh i {
  display: inline-block;
  width: 14px;
  height: 0;
  border-top: 2px solid var(--ds-green);
  border-radius: 2px;
}

.consensusFanLegendLow i {
  display: inline-block;
  width: 14px;
  height: 0;
  border-top: 2px solid var(--ds-red);
  border-radius: 2px;
}
```

- [ ] **Step 2: Extend the reduced-motion block for the new classes**

In the same CSS file, in the `@media (prefers-reduced-motion: reduce)` block (≈ line 2700), **replace** this exact existing selector list:

```css
  .consensusFanTargetPath,
  .consensusFanCurrentLine,
  .consensusFanCurrentDot,
  .consensusFanTargetDot {
    animation: none;
    transition: none;
  }

  .consensusFanCurrentDot,
  .consensusFanTargetDot {
    opacity: 1;
  }

  .consensusFanTargetPath {
    stroke-dashoffset: 0;
  }
```

with:

```css
  .consensusFanTargetPath,
  .consensusFanHighPath,
  .consensusFanLowPath,
  .consensusFanCurrentLine,
  .consensusFanCurrentDot,
  .consensusFanTargetDot,
  .consensusFanHighDot,
  .consensusFanLowDot {
    animation: none;
    transition: none;
  }

  .consensusFanCurrentDot,
  .consensusFanTargetDot,
  .consensusFanHighDot,
  .consensusFanLowDot {
    opacity: 1;
  }

  .consensusFanTargetPath,
  .consensusFanHighPath,
  .consensusFanLowPath {
    stroke-dashoffset: 0;
  }
```

(The existing `.consensusFanCurrentLine { opacity: 0.7; }` rule that follows stays unchanged.)

- [ ] **Step 3: Update the import block in the component**

In `src/components/deepscan-loading-screen.tsx`, **replace** this exact import block (≈ lines 33–37):

```ts
import {
  buildTargetPriceFanBands,
  estimateDailyVolatility,
  simulateTargetPricePaths,
  type TargetPriceFanBands,
} from '@/lib/deepscan-target-price-paths'
```

with:

```ts
import {
  buildConsensusFanGeometry,
  estimateDailyVolatility,
} from '@/lib/deepscan-target-price-paths'
```

- [ ] **Step 4: Rewrite `TargetPriceFanChart` to render N curves + legend**

In `src/components/deepscan-loading-screen.tsx`, **replace** the entire `TargetPriceFanChart` function (from `function TargetPriceFanChart({` through its closing `}` right before `function QuickFactCard({`, ≈ lines 601–652) with:

```tsx
function TargetPriceFanChart({
  consensus,
  dailyCloses,
  seedKey,
}: {
  consensus: NonNullable<LoadingQuickFact['consensus']>
  dailyCloses?: Array<number | null | undefined>
  seedKey?: string
}) {
  const geometry = useMemo(() => {
    const current = consensus.currentPriceValue
    const target = consensus.targetPriceValue
    if (!isFiniteNumber(current) || current <= 0 || !isFiniteNumber(target) || target <= 0) {
      return null
    }
    const volatility = estimateDailyVolatility(dailyCloses ?? [])
    return buildConsensusFanGeometry({
      currentPrice: current,
      averageTarget: target,
      highTarget: consensus.highTargetValue,
      lowTarget: consensus.lowTargetValue,
      volatility,
      seed: seedKey ?? `${current}|${target}`,
    })
  }, [consensus.currentPriceValue, consensus.targetPriceValue, consensus.highTargetValue, consensus.lowTargetValue, dailyCloses, seedKey])

  if (!geometry) {
    return null
  }

  const curveClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanHighPath,
    average: styles.consensusFanTargetPath,
    low: styles.consensusFanLowPath,
  }
  const dotClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanHighDot,
    average: styles.consensusFanTargetDot,
    low: styles.consensusFanLowDot,
  }
  const legendClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanLegendHigh,
    average: styles.consensusFanLegendTarget,
    low: styles.consensusFanLegendLow,
  }
  const legendLabel: Record<'high' | 'average' | 'low', string> = {
    high: '최고',
    average: '평균',
    low: '최저',
  }
  const legendOrder: Array<'high' | 'average' | 'low'> = ['average', 'high', 'low']
  const activeKeys = new Set(geometry.curves.map((c) => c.key))

  return (
    <div className={styles.consensusFanWrap}>
      <svg className={styles.consensusFanChart} viewBox='0 0 300 120' role='img' aria-label='현재가에서 목표가까지 예상 경로'>
        <line className={styles.consensusFanCurrentLine} x1={geometry.leftX} y1={geometry.currentY} x2={geometry.rightX} y2={geometry.currentY} />
        {geometry.curves.map((curve) => (
          <path key={`path-${curve.key}`} className={curveClass[curve.key]} d={curve.pathD} pathLength={1} />
        ))}
        <circle className={styles.consensusFanCurrentDot} cx={geometry.leftX} cy={geometry.currentY} r='3.6' />
        {geometry.curves.map((curve) => (
          <circle key={`dot-${curve.key}`} className={dotClass[curve.key]} cx={geometry.rightX} cy={curve.dotY} r='3.6' />
        ))}
      </svg>
      <div className={styles.consensusFanLegend}>
        <span className={styles.consensusFanLegendCurrent}><i />현재가</span>
        {legendOrder.filter((key) => activeKeys.has(key)).map((key) => (
          <span key={`legend-${key}`} className={legendClass[key]}><i />{legendLabel[key]}</span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Delete the now-redundant local geometry builder**

In `src/components/deepscan-loading-screen.tsx`, delete the entire local `buildTargetPriceFanGeometry` function (the `function buildTargetPriceFanGeometry(input: { ... }` block, ≈ lines 1022–1075, ending just before `function buildOneMonthMeaning`). Its single caller was the `TargetPriceFanChart` rewritten in Step 4, so it is now unreferenced.

Confirm no other references remain:

```bash
rg -n "buildTargetPriceFanGeometry" src
```
Expected: no output.

- [ ] **Step 6: Verify — lint, types, tests**

Run each; all must succeed:

```bash
npm run lint:web
npx tsc --noEmit
npx -y tsx --test src/lib/deepscan-target-price-paths.test.ts
```
Expected: lint clean; `tsc` no errors; all 7 tests PASS.

- [ ] **Step 7: Verify visually**

The dev server is already running on `http://localhost:3000`. Open a DeepScan result for a KR equity that has analyst 최고/최저 (e.g. a large-cap with multiple analysts) and confirm:
- Three curves render: 초록(최고), 파랑(평균, thickest, on top), 빨강(최저), each ending at its colored right-edge dot.
- Legend reads: 현재가 · 평균 · 최고 · 최저 (only present ones).
- A stock with a single analyst (최고/최저 null) shows only the 파랑 평균 curve + 현재가 — no green/red.

- [ ] **Step 8: Commit**

```bash
git add src/components/deepscan-loading-screen.tsx src/components/deepscan-loading-screen.module.css
git commit -m "feat(deepscan): render 최고/평균/최저 projection curves in fan chart"
```

---

## Notes / Trade-offs (carried from the approved design)

- **y-axis compression**: because the shared y-extent now spans 최저..최고, the 평균 curve will appear flatter when 최고/최고 sit far outside the current→average range. This is the accepted trade-off of the user-chosen "3 curves" option (B). The `padY` inset prevents dots from clipping at the edges.
- **Determinism**: each endpoint uses a distinct seed suffix (`base|high|avg|low`) so curves are independently stable across re-renders.
- **Graceful degradation**: when `highTargetValue` or `lowTargetValue` is absent (analyst count ≤ 1), that curve/dot/legend entry is omitted; with neither, the chart is identical to today's single-curve view.
