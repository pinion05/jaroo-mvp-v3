# ETF 목표가 영역 대체(구성 종목 통합 카드) — 구현 계획 (이슈 #270)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/etf`의 시나리오 카드(52주 범위 위치)를 구성 종목 통합 카드(집중도 요약 + Top 10 리스트)로 교체하고, 차트 기반 AI 분석 방향 검토 문서를 작성한다.

**Architecture:** 웹 화면 계층만 수정한다 — 뷰모델(`etf-view-model.ts`)에 집중도 헤드라인 순수 함수를 추가하고, `page.tsx`에서 시나리오 카드와 기존 구성 Top 10 카드를 하나로 병합한다. 데이터 계약(`jaroo-etf-profile-v1`)·크롤러·API·DB는 불변. 검토 문서는 `docs/reports/`에 별도 산출.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, `node:test` + `tsx`(`npm run test:web:ts`가 `src/`·`tests/`의 `*.test.ts` 수집), Tailwind 유틸리티 클래스(기존 카드 문법 그대로).

**스펙:** `docs/superpowers/specs/2026-09-17-etf-target-slot-constituents-design.md`

## Global Constraints

- 데이터 계약 `jaroo-etf-profile-v1` 불변 — 크롤러·API 라우트·DB 마이그레이션 수정 금지 (스펙 §4)
- 표기 규칙: 손실 부호 −(U+2212), 천 단위 `ko-KR` 구분. 비중은 리스트 소수 2자리(예: `21.30%`), 요약 캡션 소수 1자리(예: `21.3%`), 집중도 소수 1자리 (스펙 §3)
- 색 규칙(확정 색 규칙 준수): 상승/강세=빨강 `#E5484D`, 하락/주의=파랑 `#2B6BE6`, 중립=기존 회색 톤. 집중도 게이지·리스트 바는 구성 카드 기존 문법의 중립 파랑 `#2B6BE6` 사용 (스펙 §3)
- 문구(스펙 §3에서 verbatim): 코멘트 `상위 종목 비중이 높은 편이에요` / `고르게 분산돼 있어요` / `중간 정도로 분산돼 있어요`, 출처 `네이버 제공 기준` / `Yahoo Finance 제공 기준`, 캡션 `상위 ${n}개 집중도`, 인트로 `오늘 장 기준 시세와 상품·구성·리스크를 한 흐름으로 정리해드려요.`
- 커밋 메시지: Conventional Commits 접두어 + 한국어 본문 (저장소 관례)
- 개발 런타임: `npm run dev`(웹+크롤러 스택). 단 3040 크롤러가 이미 실행 중이면 웹만 떠 있어도 검증 가능 — 실화면 확인 전 `curl http://localhost:3000/etf?code=069500`과 크롤러 헬스를 먼저 확인한다
- 집중도 = `clamp(0, 100, Σ top10 weightPct)` 후 `Math.round(x*10)/10` 반올림 1자리 (스펙 §3)

---

### Task 1: 뷰모델 — 구성 종목 집중도 헤드라인 (순수 함수 + 블록 확장)

**Files:**
- Modify: `src/lib/etf/etf-view-model.ts`
- Test: `src/lib/etf/etf-view-model.test.ts` (기존 파일에 추가 — `tests/` 아님 주의)

**Interfaces:**
- Consumes: `EtfProfileJson`(기존), `buildHoldingsBlock`(기존 내부 함수)
- Produces: `EtfHoldingsHeadline` 타입과 `buildHoldingsHeadline(holdings: NonNullable<EtfProfileJson['holdings']>, market: EtfProfileJson['market']): EtfHoldingsHeadline` — Task 2의 카드가 `vm.topHoldings.headline`로 소비. 파라미터를 계약의 holdings 배열 타입 그대로 받는다(테스트 리터럴의 `rank`·`code`·`changePct` 과잉 프로퍼티 오차 방지). 이 태스크에서는 기존 `summary` 필드를 **유지** (Task 2에서 제거) — 태스크 단위로 저장소가 그린 상태여야 한다.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/etf/etf-view-model.test.ts` 파일 끝(미국 ETF 테스트 뒤)에 추가. import 문도 함께 수정:

```ts
// import 라인 수정 (4행):
import { buildEtfViewModel, buildHoldingsHeadline, type EtfProfileJson } from './etf-view-model'
```

```ts
// ── 구성 종목 집중도 헤드라인 (이슈 #270 D3) ──────────────────────

const headlineHoldings = (weights: number[]) =>
  weights.map((weightPct, index) => ({
    rank: index + 1,
    code: `A${index}`,
    name: `종목${index + 1}`,
    weightPct,
    changePct: null,
  }))

test('buildHoldingsHeadline sums top-10 concentration with 1-decimal rounding and mid-band comment', () => {
  const headline = buildHoldingsHeadline(
    [
      { rank: 1, code: '005930', name: '삼성전자', weightPct: 21.3, changePct: null },
      { rank: 2, code: '000660', name: 'SK하이닉스', weightPct: 15.2, changePct: null },
      { rank: 3, code: '005380', name: '현대차', weightPct: 8.1, changePct: null },
    ],
    'kospi',
  )
  assert.equal(headline.concentrationPct, 44.6)
  assert.equal(headline.concentrationText, '44.6%')
  assert.equal(headline.concentrationCaptionText, '상위 3개 집중도')
  assert.equal(headline.topSummaryText, '1위 삼성전자 21.3% · 2위 SK하이닉스 15.2%')
  assert.equal(headline.sourceText, '네이버 제공 기준')
  assert.equal(headline.commentText, '중간 정도로 분산돼 있어요')
})

test('buildHoldingsHeadline clamps concentration above 100 and marks concentrated portfolios', () => {
  const concentrated = buildHoldingsHeadline(headlineHoldings([40, 25]), 'kospi')
  assert.equal(concentrated.concentrationPct, 65)
  assert.equal(concentrated.commentText, '상위 종목 비중이 높은 편이에요')

  const clamped = buildHoldingsHeadline(headlineHoldings([60, 50]), 'kospi')
  assert.equal(clamped.concentrationPct, 100)
  assert.equal(clamped.concentrationText, '100.0%')
})

test('buildHoldingsHeadline marks even dispersion and counts only the top 10', () => {
  const dispersed = buildHoldingsHeadline(headlineHoldings([20, 15]), 'kospi')
  assert.equal(dispersed.concentrationPct, 35)
  assert.equal(dispersed.commentText, '고르게 분산돼 있어요')

  const twelve = buildHoldingsHeadline(headlineHoldings([6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 30, 30]), 'kospi')
  assert.equal(twelve.concentrationCaptionText, '상위 10개 집중도')
  assert.equal(twelve.concentrationPct, 60)
})

test('buildHoldingsHeadline uses Yahoo source text for US market and summarizes a single holding', () => {
  const us = buildHoldingsHeadline(headlineHoldings([8.1]), 'us')
  assert.equal(us.sourceText, 'Yahoo Finance 제공 기준')
  assert.equal(us.concentrationCaptionText, '상위 1개 집중도')
  assert.equal(us.topSummaryText, '1위 종목1 8.1%')
})

test('buildEtfViewModel exposes holdings headline on the topHoldings block', () => {
  const vm = buildEtfViewModel({
    profile: {
      ...profile,
      holdings: [
        { rank: 1, code: '005930', name: '삼성전자', weightPct: 32.63, changePct: null },
        { rank: 2, code: '000660', name: 'SK하이닉스', weightPct: 27.07, changePct: null },
      ],
    },
    quote: { price: 104_275, changePct: 0 },
    holding: null,
  })
  assert.equal(vm.topHoldings.headline.concentrationPct, 59.7)
  assert.equal(vm.topHoldings.headline.topSummaryText, '1위 삼성전자 32.6% · 2위 SK하이닉스 27.1%')
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm run test:web:ts`
Expected: FAIL — `buildHoldingsHeadline` 미export로 신규 4개 테스트 에러, headline 통합 테스트 TypeError. 기존 테스트는 전부 PASS.

- [ ] **Step 3: 구현 — 순수 함수 + 블록 확장**

`src/lib/etf/etf-view-model.ts`:

(1) 타입 추가 — 기존 `EtfHoldingItem` 정의(L75) **앞에** 삽입:

```ts
// 구성 종목 집중도 헤드라인 — 상위 n개 비중 합계와 집중/분산 코멘트(이슈 #270 D3).
// 요약 캡션은 소수 1자리, 집중도도 소수 1자리로 반올림해 부동소수 오차를 없앤다.
export type EtfHoldingsHeadline = {
  concentrationPct: number // 0~100 (반올림 소수 1자리)
  concentrationText: string // '62.4%'
  concentrationCaptionText: string // '상위 10개 집중도'
  topSummaryText: string | null // '1위 삼성전자 21.3% · 2위 SK하이닉스 15.2%' — 0개면 null
  sourceText: string // '네이버 제공 기준' | 'Yahoo Finance 제공 기준'
  commentText: string // 집중/분산 코멘트
}

const HOLDINGS_HEADLINE_LIMIT = 10

export function buildHoldingsHeadline(
  holdings: NonNullable<EtfProfileJson['holdings']>,
  market: EtfProfileJson['market'],
): EtfHoldingsHeadline {
  const top = holdings.slice(0, HOLDINGS_HEADLINE_LIMIT)
  const rawSum = top.reduce((sum, holding) => sum + (Number.isFinite(holding.weightPct) ? holding.weightPct : 0), 0)
  const concentrationPct = Math.round(Math.max(0, Math.min(100, rawSum)) * 10) / 10
  const commentText =
    concentrationPct >= 60
      ? '상위 종목 비중이 높은 편이에요'
      : concentrationPct <= 40
        ? '고르게 분산돼 있어요'
        : '중간 정도로 분산돼 있어요'

  return {
    concentrationPct,
    concentrationText: `${concentrationPct.toFixed(1)}%`,
    concentrationCaptionText: `상위 ${top.length}개 집중도`,
    topSummaryText:
      top.length > 0
        ? top
            .slice(0, 2)
            .map((holding, index) => `${index + 1}위 ${holding.name} ${holding.weightPct.toFixed(1)}%`)
            .join(' · ')
        : null,
    sourceText: market === 'us' ? 'Yahoo Finance 제공 기준' : '네이버 제공 기준',
    commentText,
  }
}
```

(2) `EtfHoldingsBlock` 타입(L76-78) 교체 — `summary`는 이 태스크에서 유지:

```ts
export type EtfHoldingsBlock =
  | { notice: null; items: EtfHoldingItem[]; summary: string; headline: EtfHoldingsHeadline }
  | { notice: EtfNotice; items: null; summary: null }
```

(3) `buildHoldingsBlock`(L205-224)의 return에 `headline` 추가:

```ts
function buildHoldingsBlock(profile: EtfProfileJson): EtfHoldingsBlock {
  const holdings = profile.holdings
  if (!holdings || holdings.length === 0) {
    return { ...noticeBlock('source-pending', '구성종목은 소스 연결 후 보여줘요'), summary: null }
  }

  const top = holdings.slice(0, 10)
  const maxWeight = top[0]?.weightPct ?? 1
  return {
    notice: null,
    items: top.map((holding) => ({
      rank: holding.rank,
      code: holding.code,
      name: holding.name,
      weightText: `${holding.weightPct.toFixed(2)}%`,
      weightBarPct: maxWeight > 0 ? Math.round((holding.weightPct / maxWeight) * 100) : 0,
    })),
    summary: `상위 ${top.length}개 종목 · 네이버 제공 기준 · 구성등락률은 소스 준비 중`,
    headline: buildHoldingsHeadline(top, profile.market),
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm run test:web:ts`
Expected: PASS (전체 — 기존 + 신규)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/etf/etf-view-model.ts src/lib/etf/etf-view-model.test.ts
git commit -m "feat(etf): 구성 종목 집중도 헤드라인 순수 함수·블록 확장 (#270)"
```

---

### Task 2: 통합 카드 교체 — 시나리오 카드 제거·구성 종목 카드 병합·인트로 카피

**Files:**
- Modify: `src/lib/etf/etf-view-model.ts` (시나리오 블록·`summary` 제거)
- Modify: `src/app/etf/page.tsx:29` (import), `:129-159` (EtfScenarioCard), `:187-222` (EtfHoldingsCard), `:342-350` (인트로), `:366-386` (카드 묶음)
- Test: `src/lib/etf/etf-view-model.test.ts` (시나리오 단언 교체)

**Interfaces:**
- Consumes: Task 1의 `vm.topHoldings.headline: EtfHoldingsHeadline`
- Produces: `EtfViewModel`에서 `scenario` 필드 제거(타입·런타임), `EtfHoldingsBlock`에서 `summary` 제거. 이후 어떤 코드도 `vm.scenario`·`vm.topHoldings.summary`를 참조하지 않는다(`grep -rn 'vm\.scenario\|topHoldings\.summary\|EtfScenario' src/`로 0건 확인).

- [ ] **Step 1: 기존 테스트 교체 + 실패 확인용 신규 테스트**

`src/lib/etf/etf-view-model.test.ts`:

(1) `'buildEtfViewModel marks unavailable blocks with explicit reasons'` 테스트(L71-82)에서 시나리오 2줄(L73-75) 삭제:

```ts
test('buildEtfViewModel marks unavailable blocks with explicit reasons', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 104_275, changePct: 0 }, holding: null })
  // 일봉 지표 없음(260행 미만) → 수익률·리스크는 소스 준비 중 사유
  assert.equal(vm.returns.notice?.reason, 'source-pending')
  assert.equal(vm.riskMetrics.notice?.reason, 'source-pending')
  assert.equal(vm.sectorWeights.notice.reason, 'source-pending')
  assert.equal(vm.topHoldings.notice?.reason, 'source-pending')
  assert.equal(vm.peers.notice.reason, 'planned')
  assert.equal(vm.dividendInfo.notice.reason, 'planned')
})
```

(2) `'buildEtfViewModel fills returns·risk·scenario from metrics and holdings from profile'` 테스트(L84-130) — 이름을 `fills returns·risk·holdings from metrics and profile`로 바꾸고 시나리오 단언(L118-122)을 headline 단언으로, `summary` 단언(L129)을 headline 필드 단언으로 교체:

```ts
  // 구성 종목 — 상위 10개 + 비중 바 + 집중도 헤드라인(이슈 #270)
  assert.equal(vm.topHoldings.notice, null)
  assert.equal(vm.topHoldings.items?.length, 2)
  assert.equal(vm.topHoldings.items?.[0].weightText, '32.63%')
  assert.equal(vm.topHoldings.items?.[0].weightBarPct, 100)
  assert.equal(vm.topHoldings.headline.concentrationText, '59.7%')
  assert.equal(vm.topHoldings.headline.concentrationCaptionText, '상위 2개 집중도')
  assert.equal(vm.topHoldings.headline.sourceText, '네이버 제공 기준')
```

(3) 파일 끝에 실패 확인용 신규 테스트 추가:

```ts
test('buildEtfViewModel no longer exposes the 52-week scenario block (이슈 #270 D4)', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 150_000, changePct: 0 }, holding: null })
  assert.equal('scenario' in vm, false)
})
```

- [ ] **Step 2: 테스트 실행 — 신규 테스트 실패 확인**

Run: `npm run test:web:ts`
Expected: FAIL — `'scenario' in vm`이 `true`여서 신규 테스트만 실패, 나머지 PASS.

- [ ] **Step 3: 뷰모델에서 시나리오·summary 제거**

`src/lib/etf/etf-view-model.ts`:
- `export type EtfScenarioTone = ...` (L11) 삭제
- `EtfScenario` 타입(L84-91)·`EtfScenarioBlock`(L92) 삭제
- `EtfViewModel`에서 `scenario: EtfScenarioBlock` (L105) 삭제
- `buildScenarioBlock` 함수 전체(L182-203) 삭제
- `buildEtfViewModel` return에서 `scenario: buildScenarioBlock(quote.price, metrics, money),` (L279) 삭제
- `EtfHoldingsBlock`을 Task 1의 형태에서 `summary` 제거:

```ts
export type EtfHoldingsBlock =
  | { notice: null; items: EtfHoldingItem[]; headline: EtfHoldingsHeadline }
  | EtfNoticeBlock
```

- `buildHoldingsBlock`의 notice 가드 return을 `{ ...noticeBlock(...), summary: null }` → `noticeBlock('source-pending', '구성종목은 소스 연결 후 보여줘요')`로, 성공 return에서 `summary: ...` 줄 삭제

- [ ] **Step 4: page.tsx 통합 카드 교체**

`src/app/etf/page.tsx`:

(1) import(L29)에서 `EtfScenario` 제거:

```ts
import type { EtfNoticeReason, EtfViewModel } from '@/lib/etf/etf-view-model'
```

(2) `EtfScenarioCard`(L129-159, "// 시나리오 카드 — 52주 범위 위치" 주석 포함)와 `EtfHoldingsCard`(L187-222) **전체 삭제**, 그 자리(L129 부근)에 통합 카드 추가:

```tsx
// 구성 종목 통합 카드 — 이슈 #270. 목표가(52주 위치) 자리를 구성 종목 요약+리스트로 교체.
// 문법은 기존 결과 카드 그대로: 중앙 강조 + 게이지 + 리스트 + 노트.
function EtfHoldingsSummaryCard({ vm }: { vm: EtfViewModel }) {
  if (vm.topHoldings.notice || !vm.topHoldings.items) {
    return (
      <EtfNoticeSection
        eyebrow='구성 종목'
        reason={vm.topHoldings.notice!.reason}
        message={vm.topHoldings.notice!.message}
        icon={ListChecks}
      />
    )
  }

  const items = vm.topHoldings.items
  const headline = vm.topHoldings.headline
  return (
    <EtfResultCardShell eyebrow='구성' title='구성 종목' badge={`상위 ${items.length}개`}>
      <div className='px-4 py-5 text-center'>
        <div className='text-[10px] text-[#97A0AE]'>{headline.concentrationCaptionText}</div>
        <div className='mt-1 text-[28px] font-black leading-none text-[#0F1419]'>{headline.concentrationText}</div>
        <div className='mx-auto mt-3 h-[5px] w-[200px] overflow-hidden rounded-full bg-[#EFF1F4]'>
          <div className='h-full rounded-full bg-[#2B6BE6]' style={{ width: `${headline.concentrationPct}%` }} />
        </div>
        {headline.topSummaryText ? <p className='mt-2 text-[12px] text-[#5A6473]'>{headline.topSummaryText}</p> : null}
      </div>
      <div className='border-t border-[#EFF1F4] px-4 py-3'>
        <div className='space-y-3'>
          {items.map((holding) => (
            <div key={`${holding.rank}-${holding.code}`}>
              <div className='mb-1 flex items-center gap-2 text-[13px]'>
                <span className='size-2 shrink-0 rounded-full bg-[#2B6BE6]' />
                <span className='min-w-0 truncate font-bold text-[#0F1419]'>{holding.name}</span>
                <span className='shrink-0 text-[10px] text-[#97A0AE]'>{holding.code}</span>
                <span className='ml-auto shrink-0 font-bold text-[#5A6473]'>{holding.weightText}</span>
              </div>
              <div className='h-[5px] overflow-hidden rounded-full bg-[#EFF1F4]'>
                <div className='h-full rounded-full bg-[#2B6BE6]' style={{ width: `${holding.weightBarPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className='border-t border-[#EFF1F4] px-4 py-3 text-[10px] leading-4 text-[#97A0AE]'>
        {headline.sourceText} · {headline.commentText}
      </p>
    </EtfResultCardShell>
  )
}
```

(3) `EtfReadyBody`의 인트로 카피(L349) 교체:

```tsx
<p className={styles.introBody}>오늘 장 기준 시세와 상품·구성·리스크를 한 흐름으로 정리해드려요.</p>
```

(4) 카드 묶음(L366-386) — 시나리오 분기와 기존 holdings 카드 렌더 제거, 통합 카드를 상품정보 다음에:

```tsx
{/* 결과 카드 묶음 — 카드 사이 12px 리듬 (브리핑 카드와도 동일 간격) */}
<div className='mt-3 flex flex-col gap-3'>
  <EtfProductCard vm={vm} />

  {/* 이슈 #270 — 목표가(52주 위치) 자리를 구성 종목 통합 카드로 교체 */}
  <EtfHoldingsSummaryCard vm={vm} />

  <EtfReturnsCard vm={vm} />
  <EtfRiskCard vm={vm} />

  <EtfShareCard />
</div>
```

(5) 잔여 참조 확인 — `Telescope`(수익률 notice가 계속 사용)·`ListChecks`(통합 카드 notice가 사용) import는 유지.

- [ ] **Step 5: 테스트·타입 검증**

Run: `npm run test:web:ts && npm run typecheck`
Expected: 둘 다 PASS/에러 0.
추가 확인: `grep -rn 'vm\.scenario\|topHoldings\.summary\|EtfScenario' src/ | grep -v node_modules` → 0건.

- [ ] **Step 6: 실화면 확인 (KR/US)**

전제: 웹(3000)+크롤러(3040) 실행 중. 아니면 `npm run dev`로 스택 시작.

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/etf?code=069500'   # 200
agent-browser open 'http://localhost:3000/etf?code=069500' && sleep 6
agent-browser screenshot --full /tmp/etf-after-kr.png
agent-browser open 'http://localhost:3000/etf?symbol=VOO' && sleep 6
agent-browser screenshot --full /tmp/etf-after-us.png
```

확인 기준(스펙 §3·§7):
- KR: 상품정보 다음에 '구성 종목' 카드 — 집중도 중앙 강조·게이지·상위 2개 캡션·Top10 리스트·노트 "네이버 제공 기준 · {코멘트}". 52주 위치 카드·옛 구성 카드 잔존 없음
- US: 같은 구조, 노트 "Yahoo Finance 제공 기준 · 고르게 분산돼 있어요"(VOO top10 합계 약 37.8%)
- 인트로 카피가 "…상품·구성·리스크를 한 흐름으로…"로 교체됨

- [ ] **Step 7: 커밋**

```bash
git add src/app/etf/page.tsx src/lib/etf/etf-view-model.ts src/lib/etf/etf-view-model.test.ts
git commit -m "feat(etf): 목표가(52주 위치) 자리를 구성 종목 통합 카드로 교체 (#270)"
```

---

### Task 3: 차트 기반 AI 분석 방향 검토 문서 작성

**Files:**
- Create: `docs/reports/etf-ai-analysis-direction-2026-09-17.md`

**Interfaces:**
- Consumes: 스펙 §5의 문서 개요(5섹션), 아래 전체 본문
- Produces: 이슈 #270 기대동작 2번("차트 기반 AI 분석 방향 검토 결과 정리")의 산출물. 이슈 코멘트 게시는 **사용자 승인 후 별도 진행** (이 계획 범위 외)

- [ ] **Step 1: 문서 작성**

아래 본문 전체로 파일 생성:

````markdown
# ETF AI 분석 방향 검토 — 차트(기술적) 분석 중심 (이슈 #270)

- **작성일**: 2026-09-17
- **추적**: GitHub #270 (라이브몰로 회의 2026-09-16 · L706-751 AI 분석 비용, L782-800 구성 종목 이벤트) · 선행 스펙 `docs/superpowers/specs/2026-09-15-etf-real-data-design.md` §5 · 구현 스펙 `docs/superpowers/specs/2026-09-17-etf-target-slot-constituents-design.md`

## 1. 배경 — 왜 펀더멘털 전면 분석은 안 되는가

회의(2026-09-16)에서 ETF 대상 펀더멘털 전면 분석은 비용 과다로 판정됐다. 구체적 근거:

- **구성 종목별 컨센서스 크롤 비용**: 구성 종목마다 애널리스트 목표가를 얻으려면 종목당 수집 페이지가 다수 필요하다(선행 스펙 §5 — "구성별 컨센서스 크롤 13페이지×N건은 페이지 로드에 부적합"). KODEX 200급 상품은 구성이 200개+라 수집 시간·차단 리스크 모두 비현실적.
- **ETF 자체의 컨센서스 부재**: ETF는 애널리스트 커버리지 대상이 아니어서 목표가·의견 원천 데이터가 없다(2026-09-15 라이브 실증 — 선행 스펙 D4). 목표가 칸을 구성 종족 콘텐츠로 대체한 이유이기도 하다(별도 구현 완료).

## 2. 현행 구조·비용 지도

| 항목 | 현행 | 비용 |
|---|---|---|
| `/etf` 프로필 분석 | 시세·일봉·구성·리스크 카드 (규칙 기반, LLM 없음) | **무과금** — 크롤러 프록시+원장만 |
| 딥스캔(주식) | AI 위원회 — LLM 호출 | 10크레딧/회 (`DEEPSCAN_CREDIT_COST`, Pro 면제, 스냅샷 캐시 히트 0크레딧) |
| LLM | OpenRouter `deepseek/deepseek-v4-flash` 기본 (`DEEPSCAN_LLM_MODEL`로 교체 가능) — `packages/deepscan-runtime-core/src/committee-llm.js` | 호출당 토큰 비용만 |
| ETF 딥스캔 프롬프트 | KR `ETF_MEMBER_PROMPT_GUIDANCE`(구성 top10·NAV 중심 재해석), US `exchangeProduct` 가드 — "목표가 부재를 부정 근거로 쓰지 마라" | 딥스캔과 동일 |
| **차트 데이터(이미 확보)** | KR 네이버 일봉 / US Polygon 일봉(약 2년) + `etf-metrics`가 연변동성·MDD·샤프지수·52주 범위·기간별 수익률 계산(일봉 260행 이상) | **추가 수집 비용 0** |

핵심 관찰: ETF의 기술적 분석에 필요한 입력(가격 흐름·변동성·낙폭·52주 위치)은 **이미 `/etf` 파이프라인이 전부 갖고 있다**. 새로 크롤링할 것이 없다.

## 3. 차트(기술적) 분석 방향 제안

### 옵션 비교

| 옵션 | 내용 | 추가 비용 | 한계 |
|---|---|---|---|
| A. 규칙 기반 기술적 요약 | `etf-metrics` 지표로 문구 조합(추세 방향·변동성 수준·52주 위치 해석) 카드 | **0원**(LLM 없음) | 'AI 분석'이 아님 — 문형이 정형화됨 |
| B. LLM 차트 분석 | 지표 요약+일봉 통계를 프롬프트에 투입해 기술적 관점 코멘트·시나리오 생성 | LLM 토큰 비용만(기본 모델은 저가) | 환각 가드 필요(수치 소유권 규칙 — 기존 딥스캔 패턴 재사용) |
| C. 펀더멘털(구성 컨센서스 가중) | §1의 이유로 **제외 유지** | 과다 | — |

### 권고: B를 다음 단계로, 그 전에 A를 먼저

1. **1단계(A)**: 규칙 기반 지표 해석 카드 — 비용 0, 지금 있는 데이터로 즉시 가능. 기술적 관점 문구의 뼈대를 여기서 확정한다(예: "52주 상단 구간·변동성 중립 — 추세 추종 구간").
2. **2단계(B)**: LLM 차트 분석 파일럿 — A의 지표 요약을 프롬프트 입력으로 재사용해 자연어 코멘트 생성. 딥스캔의 숫자 인용 소유권·스키마 강제 JSON 패턴(`committee-llm.js`)을 그대로 계승해 환각을 통제한다.
3. **과금 정책**: `/etf`는 무과금 유지를 권고한다. B의 토큰 비용은 기본 모델 기준 회당 수십 원 수준이지만, 트래픽이 늘면 재검토. 유료화가 필요해지면 그때 딥스캔과 같은 크레딧 게이트를 붙이는 구조로 확장한다.

## 4. 구성 종목 이벤트 Top-N 노출 방안 (미확정 안건)

- **요구**: 회의에서 "구성 종목 이벤트를 상위 몇 개만 노출"하는 방안 검토 지시(L782-800).
- **소스 후보**:
  - DART 전자공시 — 기존 연구 문서 있음(`docs/reports/opendart-event-extraction-research-2026-07-21.md`, `…-completion-report-2026-07-24.md`). 실적발표·공시 이벤트 추출 연계 가능성.
  - 네이버 금융 종목별 뉴스/시세 일정 — 구성 종목 코드로 조회 가능하나 노이즈 필터 필요.
  - 위세리포트 종목 이벤트 — 딥스캔 KR 패키지와 이미 연결된 소스라 재사용성 검토 가치 있음.
- **비용 구조**: 상위 5~10개 종목에 대해서만 조회한다면 페이지 로드 내 수집 가능성이 있으나, 소스별 레이트리밋·캐시 전략 설계가 선행되어야 한다.
- **권고**: 별도 이슈로 분리하고, 이번 #270에서는 방향성만 기록한다. 노출 규모(N)·이벤트 종류(실적발표/공시/금감원)는 이슈에서 결정.

## 5. 결론 — 다음 스텝

1. (완료) 목표가 칸 대체 — 구성 종목 통합 카드로 교체 (스펙 2026-09-17 구현)
2. 규칙 기반 기술적 요약 카드(A) — 별도 이슈 생성 권고
3. LLM 차트 분석 파일럿(B) — A 안정화 후 별도 이슈
4. 구성 종목 이벤트 Top-N — 소스 조사 spike 포함 별도 이슈
````

- [ ] **Step 2: 커밋**

```bash
git add docs/reports/etf-ai-analysis-direction-2026-09-17.md
git commit -m "docs(#270): ETF 차트 기반 AI 분석 방향 검토 보고서"
```

---

### Task 4: 전체 검증 게이트

**Files:**
- 없음(검증만) — 실패 시 해당 태스크로 돌아가 수정

**Interfaces:**
- Consumes: Task 1~3의 산출물 전부
- Produces: 스펙 §7 인수 기준 충족 증거

- [ ] **Step 1: 정적 검증 전체**

```bash
npm run typecheck && npm run lint:web && npm test
```

Expected: 전부 통과(`npm test`는 mjs+web-ts+크롤러+instrument-core 전체).

- [ ] **Step 2: 브라우저 회귀 검증**

```bash
node scripts/verify-screens-browser.cjs --list
```

etf suite가 목록에 있으면 실행:

```bash
node scripts/verify-screens-browser.cjs etf
```

Expected: PASS. 목록에 없으면 Task 2 Step 6의 스크린샷 증거로 대체(코드에 손을 댄 영역이 /etf뿐이므로).

- [ ] **Step 3: 인수 기준 최종 확인 (스펙 §7)**

- [ ] ETF 결과 카드의 목표가 영역(구 시나리오 자리)이 구성 종목 콘텐츠로 교체됐고 카드 톤앤매너·레이아웃 일관성 유지 — `/tmp/etf-after-kr.png`·`/tmp/etf-after-us.png` 확인
- [ ] 차트 기반 AI 분석 방향 검토 결과 문서 완료 — `docs/reports/etf-ai-analysis-direction-2026-09-17.md`
- [ ] 52주 위치 카드 잔존 없음(52주 저~고는 리스크 카드에 유지)
- [ ] holdings 부재 시 notice 카드 폴백 동작(스펙 §3) — 이 경우는 실데이터에서 재현 어려우므로 테스트 코드로 충족(기존 `source-pending` 단언)

- [ ] **Step 4: 이슈 #270 종결 준비 (실행하지 않음 — 사용자 승인 대상)**

완료 증거(스크린샷·문서 링크)로 이슈 #270에 한국어 요약 코멘트와 PR을 준비한다. **코멘트·PR 작성은 사용자에게 내용을 보여드리고 승인받은 뒤** 진행한다(AGENTS.md — Issue/PR 한국어 작성 규칙 준수).
