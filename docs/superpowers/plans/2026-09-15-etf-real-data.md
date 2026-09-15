# /etf ETF 실데이터 (G11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/etf`를 하드코딩 KODEX 200 픽스처에서 선택한 한국 ETF의 실데이터 화면(1단계) + 구성·수익률·리스크 실데이터(2단계)로 전환한다. 채울 수 없는 필드는 사유를 화면에 명시한다(D7).

**Architecture:** 딥스캔 플로우 재사용 — 홈 ETF 카드가 sessionStorage 타깃 세션(`DEEPSCAN_TARGET_STORAGE_KEY`)+actionHref `/etf`로 전달하고, 페이지가 query/세션에서 타깃 복원 후 `/api/quotes/current`(시세)와 신규 `/api/etf/profile`(네이버 내부 API + 위세리포트 ETF 스냅샷 병합, 크롤러 경유)를 fetch해 뷰모델로 맵핑한다. 미지원 블록은 `EtfDataNoticeCard`(사유 3종)로 대체한다.

**Tech Stack:** Next.js(App Router, 'use client' 페이지) · packages/crawler(ESM 수집기 + server.js 라우트 등록) · node:test(웹 TS는 `src/**/*.test.ts`, 크롤러는 `packages/crawler/test/*.test.cjs`)

**Spec:** `docs/superpowers/specs/2026-09-15-etf-real-data-design.md`

## Global Constraints

- 한국 상장 ETF만 (kospi/kosdaq). 미국 ticker/kind!=='etf'는 거부 (D3)
- AI/LLM 호출 금지 — 이 계획의 어떤 코드도 OpenRouter/위원회를 호출하지 않는다 (D4)
- 미지원 필드는 `EtfDataNoticeCard`로 사유 명시: `source-absent`("ETF에는 없는 데이터") / `source-pending`("소스 준비 중") / `planned`("출시 후 예정") (D7)
- 디자인 금지 규칙(핸드오프 §7): 이모지 금지, 점수 숫자 금지, 초록(#1A9D55) 금지, 평단 소수점 금지(정수 반올림), 손실 부호 `−`(U+2212), 천단위 `toLocaleString('ko-KR')`
- 시세 표기는 `--jaroo-*` 토큰 체계 유지(현행 페이지 CSS 그대로)
- 데이터 소스 UA: 네이버 내부 API fetch엔 일반 브라우저 UA 필수 (`User-Agent: Mozilla/5.0 ...`)
- 테스트 게이트: `npm run lint && npm run typecheck && npm test` — 모든 태스크 종료 시 green
- 커밋 스타일: `feat(etf): ...` / `test(etf): ...` 한국어 설명

## 데이터 소스 (실증 완료 — 스펙 §3)

- 시세: 기존 `/api/quotes/current?codes=` (변경 없음)
- 구성종목: `https://stock.naver.com/api/domestic/detail/{code}/ETFComponent` (코드·이름·비중·기준일)
- 기본정보·수익률·52주·베타: 기존 `packages/crawler/src/crawlers/wisereport-etf.js`의 `fetchWiseReportEtfSnapshot(code)` — **구현돼 있으나 라우트 미등록** (설정일·기준지수·총보수·운용사·배당주기·ERN1/3/6/12·52주·베타 포함)
- 일봉: `https://api.stock.naver.com/chart/domestic/item/{code}/day?startDateTime=...&endDateTime=...` (JSON, 인증 없음)
- 타깃 복원: `resolveDeepScanTargetSession`(`@/lib/jaroo-home-data` export) + `buildDeepScanCanonicalQuery`(`@/lib/deepscan-canonical`)

---

## Phase 1 — 1단계 (MVP 필수)

### Task 1: EtfViewModel 타입 + 빌더 (`etf-view-model.ts`)

**Files:**
- Create: `src/lib/etf/etf-view-model.ts`
- Test: `src/lib/etf/etf-view-model.test.ts`

**Interfaces:**
- Consumes: `EtfProfile`(Task 3이 정의하는 크롤러 응답 타입 — 아래 `EtfProfileJson`을 그대로 사용), quotes `{ price, changePct }`, holding `{ shares, averagePrice }`
- Produces: `EtfViewModel`, `buildEtfViewModel(input)`, `EtfTab`/`EtfValueTone`/`EtfScenarioTone` (jaroo-data.ts에서 이동)

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/etf/etf-view-model.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildEtfViewModel, type EtfProfileJson } from './etf-view-model'

const profile: EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1',
  code: '069500',
  name: 'KODEX 200',
  market: 'kospi',
  ok: true,
  product: {
    issuerName: '삼성자산운용',
    baseIndexName: '코스피 200',
    totalFeePct: 0.15,
    firstSettleDate: '2002-10-11',
    aum: 24_400_000_000_000,
    nav: 104_100,
    deviationPct: 0.02,
  },
  returns: null, // 1단계에서는 미제공(2단계 일봉 산출)
  holdings: null,
  daily: null,
}

test('buildEtfViewModel maps quotes+holding+profile into hero and basicInfo with integer formatting', () => {
  const vm = buildEtfViewModel({
    profile,
    quote: { price: 104_275, changePct: 1.24, asOf: '2026-09-15T17:23:19+09:00' },
    holding: { shares: 100, averagePrice: 101_400.49 },
  })

  assert.equal(vm.header.name, 'KODEX 200')
  assert.equal(vm.header.code, '069500')
  assert.equal(vm.header.issuer, '삼성자산운용')
  assert.equal(vm.hero.price, '104,275원')
  assert.equal(vm.hero.change, '+1.24%')
  assert.equal(vm.hero.averagePrice, '평단 101,400원') // 소수점 버림 금지규칙
  assert.equal(vm.hero.stats[0].label, '순자산')
  assert.equal(vm.hero.stats[0].value, '24.4조원')
  assert.equal(vm.hero.stats[1].value, '연 0.15%')
  // 보유손익: (104,275−101,400)×100 = 287,500
  assert.equal(vm.hero.profitAmount, '+287,500원')
})

test('buildEtfViewModel without holding hides profit fields (guest)', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 104_275, changePct: 1.24 }, holding: null })
  assert.equal(vm.hero.profitAmount, null)
})

test('buildEtfViewModel marks unavailable blocks with explicit reasons', () => {
  const vm = buildEtfViewModel({ profile, quote: { price: 1, changePct: 0 }, holding: null })
  assert.equal(vm.scenario.notice.reason, 'source-absent')
  assert.equal(vm.sectorWeights.notice.reason, 'source-pending')
  assert.equal(vm.riskMetrics.notice.reason, 'source-pending')
  assert.equal(vm.dividendInfo.notice.reason, 'planned')
  assert.equal(vm.peers.notice.reason, 'planned')
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:web:ts` → 모듈 없음으로 실패
- [ ] **Step 3: 구현**

```ts
// src/lib/etf/etf-view-model.ts
export type EtfTab = 'overview' | 'holdings' | 'risk'
export type EtfValueTone = 'danger' | 'positive' | 'neutral'
export type EtfScenarioTone = 'positive' | 'primary' | 'warning'

export type EtfNoticeReason = 'source-absent' | 'source-pending' | 'planned'

export type EtfProfileJson = {
  schemaVersion: 'jaroo-etf-profile-v1'
  code: string
  name: string
  market: 'kospi' | 'kosdaq'
  ok: true
  product: {
    issuerName: string | null
    baseIndexName: string | null
    totalFeePct: number | null
    firstSettleDate: string | null
    aum: number | null
    nav: number | null
    deviationPct: number | null
  }
  returns: { m1: number | null; m3: number | null; m6: number | null; y1: number | null } | null
  holdings: Array<{ rank: number; code: string; name: string; weightPct: number; changePct: number | null }> | null
  daily: Array<{ date: string; close: number }> | null
}

const krw = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const signedPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const MINUS = '−'

function trillionText(aum: number) {
  const trillion = aum / 1_000_000_000_000
  return `${trillion.toFixed(1)}조원`
}

function noticeBlock(reason: EtfNoticeReason, message: string) {
  return { notice: { reason, message }, items: null }
}

export type EtfViewModel = {
  header: { name: string; code: string; issuer: string; tracking: string }
  hero: {
    name: string; price: string; change: string; averagePrice: string | null
    profitAmount: string | null
    stats: Array<{ label: string; value: string }>
  }
  momentum: { label: string; badge: string } // 재정의: 최근 등락 기반(quotes만 사용)
  scenario: { notice: { reason: EtfNoticeReason; message: string }; items: null }
  returns: { eyebrow: string; notice: { reason: EtfNoticeReason; message: string }; items: null } | { eyebrow: string; items: Array<{ label: string; value: string; tone: EtfValueTone }> }
  basicInfo: { eyebrow: string; items: Array<{ label: string; value: string }> }
  sectorWeights: ReturnType<typeof noticeBlock>
  topHoldings: { eyebrow: string; notice: { reason: EtfNoticeReason; message: string }; items: null } | { eyebrow: string; summary: string; items: Array<{ rank: string; name: string; code: string; weight: string; change: string; tone: EtfValueTone }> }
  riskMetrics: { eyebrow: string; notice: { reason: EtfNoticeReason; message: string }; items: null } | { eyebrow: string; items: Array<{ label: string; value: string; subtitle: string; tone: EtfValueTone }> }
  peers: ReturnType<typeof noticeBlock>
  dividendInfo: ReturnType<typeof noticeBlock>
}

export function buildEtfViewModel(input: {
  profile: EtfProfileJson
  quote: { price: number; changePct: number; asOf?: string }
  holding: { shares: number; averagePrice: number } | null
}): EtfViewModel {
  const { profile, quote, holding } = input
  const p = profile.product
  const stats: Array<{ label: string; value: string }> = []
  if (p.aum != null) stats.push({ label: '순자산', value: trillionText(p.aum) })
  if (p.totalFeePct != null) stats.push({ label: '총보수', value: `연 ${p.totalFeePct.toFixed(2)}%` })
  if (p.firstSettleDate) stats.push({ label: '설정일', value: p.firstSettleDate.slice(0, 7).replace('-', '.') })

  const basicItems: Array<{ label: string; value: string }> = []
  if (p.issuerName) basicItems.push({ label: '운용사', value: p.issuerName })
  if (p.baseIndexName) basicItems.push({ label: '기준지수', value: p.baseIndexName })
  if (p.nav != null) basicItems.push({ label: 'NAV', value: krw(p.nav) })
  if (p.deviationPct != null) basicItems.push({ label: 'NAV 괴리율', value: `${p.deviationPct.toFixed(2)}%` })

  const profit = holding
    ? {
        amount: (quote.price - holding.averagePrice) * holding.shares,
        pct: ((quote.price - holding.averagePrice) / holding.averagePrice) * 100,
      }
    : null

  return {
    header: {
      name: profile.name,
      code: profile.code,
      issuer: p.issuerName ?? '',
      tracking: p.baseIndexName ? `${p.baseIndexName} 추종` : '',
    },
    hero: {
      name: profile.name,
      price: krw(quote.price),
      change: signedPct(quote.changePct),
      averagePrice: holding ? `평단 ${krw(holding.averagePrice)}` : null,
      profitAmount: profit ? `${profit.amount >= 0 ? '+' : MINUS}${Math.abs(Math.round(profit.amount)).toLocaleString('ko-KR')}원` : null,
      stats,
    },
    momentum: {
      label: quote.changePct >= 0 ? '최근 거래일 상승 — 순풍' : '최근 거래일 하락 — 역풍',
      badge: quote.changePct >= 0 ? '↗' : '↘',
    },
    scenario: noticeBlock('source-absent', 'ETF에는 애널리스트 목표가·컨센서스가 없어요'),
    returns: noticeBlock('source-pending', '기간별 수익률은 일봉 데이터 연결 후 제공돼요'),
    basicInfo: { eyebrow: '기본 정보', items: basicItems },
    sectorWeights: noticeBlock('source-pending', '섹터 비중은 구성종목 매핑 준비 중이에요'),
    topHoldings: noticeBlock('source-pending', '구성종목은 데이터 연결 후 보여줘요'),
    riskMetrics: noticeBlock('source-pending', '리스크 지표는 일봉 데이터 연결 후 제공돼요'),
    peers: noticeBlock('planned', '유사 ETF 비교는 출시 후 제공될 예정이에요'),
    dividendInfo: noticeBlock('planned', '배당 정보는 출시 후 제공될 예정이에요'),
  }
}
```

(2단계에서 `returns`·`topHoldings`·`riskMetrics`의 실데이터 분기 추가 — Task 8·9)

- [ ] **Step 4: 통과 확인** — `npm run test:web:ts`
- [ ] **Step 5: 커밋** — `git add src/lib/etf/ && git commit -m "feat(etf): ETF 뷰모델 타입·빌더 — 사유 명시 블록 포함"`

### Task 2: 타깃 복원 + 한국 ETF 가드 (`etf-target.ts`)

**Files:**
- Create: `src/lib/etf/etf-target.ts`
- Test: `src/lib/etf/etf-target.test.ts`

**Interfaces:**
- Consumes: `resolveDeepScanTargetSession`(`@/lib/jaroo-home-data`) — sessionStorage `jaroo:deepscan-target` + 적용 포트폴리오에서 `DeepScanCanonicalTargetSession` 복원
- Produces: `resolveEtfPageTarget(input) → { status:'ok', code, name, holding } | { status:'invalid' } | { status:'empty' }`

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/etf/etf-target.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveEtfPageTarget } from './etf-target'

test('query etf target with kospi code is accepted and parses holding', () => {
  const r = resolveEtfPageTarget({
    searchParams: new URLSearchParams('code=069500&name=KODEX%20200&market=kospi&kind=etf&averagePrice=101400&shares=100'),
    readSession: () => null,
  })
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') {
    assert.equal(r.code, '069500')
    assert.equal(r.holding?.averagePrice, 101_400)
  }
})

test('non-etf kind and us market are rejected', () => {
  assert.equal(resolveEtfPageTarget({ searchParams: new URLSearchParams('code=005930&kind=stock'), readSession: () => null }).status, 'invalid')
  assert.equal(resolveEtfPageTarget({ searchParams: new URLSearchParams('ticker=SPY&kind=etf&market=nasdaq'), readSession: () => null }).status, 'invalid')
})

test('no query falls back to session, otherwise empty', () => {
  const fromSession = resolveEtfPageTarget({
    searchParams: new URLSearchParams(''),
    readSession: () => ({ code: '069500', name: 'KODEX 200', market: 'kospi', kind: 'etf', holding: { shares: 10, averagePrice: 100_000 } }),
  })
  assert.equal(fromSession.status, 'ok')
  assert.equal(resolveEtfPageTarget({ searchParams: new URLSearchParams(''), readSession: () => null }).status, 'empty')
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:web:ts`
- [ ] **Step 3: 구현**

```ts
// src/lib/etf/etf-target.ts
export type EtfPageTarget =
  | { status: 'ok'; code: string; name: string; holding: { shares: number; averagePrice: number } | null }
  | { status: 'invalid' }
  | { status: 'empty' }

const KR_ETF_CODE = /^\d{6}$/
const KR_MARKETS = new Set(['kospi', 'kosdaq', 'kr', 'etf', ''])

function toFinitePositive(v: string | null | undefined) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function resolveEtfPageTarget(input: {
  searchParams: URLSearchParams
  readSession: () => { code?: unknown; name?: unknown; market?: unknown; kind?: unknown; holding?: unknown } | null
}): EtfPageTarget {
  const q = input.searchParams
  const code = q.get('code')?.trim() ?? ''
  const ticker = q.get('ticker')?.trim() ?? ''
  const kind = (q.get('kind') ?? '').toLowerCase()
  const market = (q.get('market') ?? '').toLowerCase()

  if (code || ticker || kind) {
    const isKrEtf = KR_ETF_CODE.test(code) && (kind === '' || kind === 'etf') && KR_MARKETS.has(market) && !ticker
    if (!isKrEtf) return { status: 'invalid' }
    const averagePrice = toFinitePositive(q.get('averagePrice'))
    const shares = toFinitePositive(q.get('shares'))
    return {
      status: 'ok',
      code,
      name: q.get('name')?.trim() || code,
      holding: averagePrice && shares ? { shares, averagePrice } : null,
    }
  }

  const session = input.readSession()
  if (session && KR_ETF_CODE.test(String(session.code ?? '')) && String(session.kind ?? 'etf') === 'etf') {
    const holding = session.holding as { shares?: unknown; averagePrice?: unknown } | undefined
    const shares = Number(holding?.shares)
    const averagePrice = Number(holding?.averagePrice)
    return {
      status: 'ok',
      code: String(session.code),
      name: String(session.name ?? session.code),
      holding: Number.isFinite(shares) && shares > 0 && Number.isFinite(averagePrice) && averagePrice > 0 ? { shares, averagePrice } : null,
    }
  }
  if (session) return { status: 'invalid' }
  return { status: 'empty' }
}
```

- [ ] **Step 4: 통과 확인** → **Step 5: 커밋** `feat(etf): /etf 타깃 복원 + 한국 ETF 가드`

### Task 3: 크롤러 `etf-profile` 수집기 + 라우트 등록

**Files:**
- Create: `packages/crawler/src/crawlers/etf-profile.js`
- Modify: `packages/crawler/src/server.js` (라우트 테이블 — `quotes-current` 항목 바로 아래에 추가)
- Test: `packages/crawler/test/etf-profile.test.cjs`

**Interfaces:**
- Consumes: `fetchWiseReportEtfSnapshot`(`./wisereport-etf.js`, 기존) — product·returns(ERN)·52주·베타 제공
- Produces: `buildEtfProfile({ quote, snapshot, component, daily })` (순수 조립 함수 — 테스트용 export) + 라우트 `GET /api/major/naver-wisereport/kr/etf/{code}/profile` → `{ ok, schemaVersion:'jaroo-etf-profile-v1', ... }` (Task 1 `EtfProfileJson`과 동일 모양)
- 네이버 fetch: `ETFComponent`, `detail/price`(aum·nav·보수 보강) — UA 헤더 필수, 10s 타임아웃, 실패 시 해당 필드 null 폴백(부분 성공 허용)

- [ ] **Step 1: 실패 테스트** — fixture JSON(스펙 §3 실측값 축소판)으로 `buildEtfProfile` 조립·폴백 검증 (fetch는 mocking 주입)
- [ ] **Step 2: 실패 확인** — `npm run test:crawler`
- [ ] **Step 3: 구현** — `buildEtfProfile` + `fetchEtfProfile(code, { fetchImpl, timeoutMs })` + server.js 라우트 등록(id `etf-profile`, params `code`, dataSources `['naver-finance','wisereport']`)
- [ ] **Step 4: 통과 확인 + 라이브 스모크** — `npm run dev:crawler` 후 `curl "http://127.0.0.1:3040/api/major/naver-wisereport/kr/etf/069500/profile"` → `ok:true`, product 필드 확인
- [ ] **Step 5: 커밋** `feat(etf): 크롤러 etf-profile 수집기 — 네이버 구성종목·위세리포트 상품정보 병합`

### Task 4: 웹 프록시 `/api/etf/profile`

**Files:**
- Create: `src/app/api/etf/profile/route.ts`
- Test: `src/app/api/etf/profile/route.test.ts`

**Interfaces:**
- Consumes: `buildCrawlerUrl, getCrawlerBaseUrl`(`@/lib/crawler-api`), 레이트리밋은 `/api/ocr`의 shared 상수 패턴 재사용(`src/app/api/ocr/shared.ts` 참고 — 10회/5분 고정윈도 in-memory)
- Produces: `GET /api/etf/profile?code=069500` → 크롤러 응답 프록시. 400(코드 형식) · 429(레이트리밋) · 502(상류 실패). 인증 요구 안 함(공개 시세성 데이터)

- [ ] **Step 1~5**: TDD 동일 — 커밋 `feat(etf): /api/etf/profile 프록시 + 레이트리밋`

### Task 5: `EtfDataNoticeCard` 컴포넌트

**Files:**
- Create: `src/components/etf-data-notice-card.tsx`
- Test: `src/components/etf-data-notice-card.test.tsx`

**Interfaces:**
- Produces: `<EtfDataNoticeCard reason='source-absent' message='...' />` — 사유 라벨 텍스트: `source-absent`→"제공되지 않는 데이터", `source-pending`→"소스 준비 중", `planned`→"출시 후 예정". 스타일은 기존 카드 문법(`rounded-[24px] border --jaroo-border`) 준수, 이모지 금지.

- [ ] **Step 1~5**: TDD — 커밋 `feat(etf): 미지원 블록 사유 명시 안내 카드`

### Task 6: `/etf` 페이지 전환 + 픽스처 제거

**Files:**
- Modify: `src/app/etf/page.tsx` (전면: 픽스처 → 뷰모델)
- Modify: `src/lib/jaroo-data.ts` (`etfAnalysis`·`sectorWeights`·관련 타입 export 삭제 — dead export 정리)
- Test: `src/app/etf/etf-page-model.test.ts` (상태머신 유닛: 로딩→데이터/에러/빈 상태 전이)

**핵심 구조 (기존 JSX 유지, 데이터 소스만 교체):**
- `useEffect`에서 ①`resolveEtfPageTarget`(query: `new URLSearchParams(window.location.search)`, session: `resolveDeepScanTargetSession` 래) ②`invalid/empty` → 안내 상태 ③`ok`면 `Promise.all([fetch('/api/quotes/current?codes='+code), fetch('/api/etf/profile?code='+code)])` ④`buildEtfViewModel` → 렌더
- 렌더 분기: `vm.hero`·`vm.basicInfo`·`vm.momentum` = 실데이터 / notice 블록(scenario·returns·sectorWeights·topHoldings·riskMetrics·peers·dividendInfo) = `<EtfDataNoticeCard>`
- 에러: quotes 실패 시 status-union 에러카드 문구("시세를 가져오지 못했어요"), 재시도 버튼
- 2단계(Task 9)에서 notice 블록을 실데이터로 하나씩 교체

- [x] **Step 1~5**: TDD(상태머신) → 구현 → `npm run lint && npm run typecheck && npm run test` → 커밋 `feat(etf): /etf 실데이터 전환 — 픽스처 제거·사유 카드`
  - 구현 중 결정 사항: quotes/current에 등락률이 없어 크롤러가 profile.quote.changePct(네이버 prevChangeRate)를 내림. 크롤러 400(NOT_ETF)은 invalid 상태로 매핑. 딥스캔 플레이스홀더 세션('종목 미선택')은 empty로 처리. 브라우저 검증 완료(실시세·평단·손익·사유 카드·invalid/empty 상태·픽스처 문자열 부재).
  - **2026-09-15 재디자인(사용자 지시)**: "기존 JSX 유지"는 철회 — /etf는 **딥스캔 결과 화면과 동일 구조를 직접 재사용**한다. 딥스캔 로딩 스크린 셸(module.css topBar·intro) + `TodayBriefingCard`(시세·평단·3개월 일봉 차트·시장 브리핑 재사용, 시세 소스를 quotes/current → `/api/deepscan/briefing-snapshot`으로 교체) + 결과 카드 문법(16px 카드·#E8EAEE 보더·다크 칩 헤더). 탭 구조는 제거하고 단일 흐름으로.

### Task 7: 홈 ETF 카드 → /etf 액션 연결

**Files:**
- Modify: `src/lib/jaroo-home-data.ts` (실데이터 홀딩→HomeHolding 매핑 부분, ~:1399 `inferHoldingKind` 사용 지점)
- Test: `src/lib/etf/home-etf-action.test.ts`

**핵심**: kind==='etf' 홀딩의 action을 ① sessionStorage에 `buildDeepScanTargetSession(holding)` 저장(기존 딥스캔 패턴, :1206 참조) ② `actionHref='/etf'` — `deepscan-navigation.ts`가 이미 핸드오프 지원. 게스트 픽스처 카드(id 4 KODEX 200)도 동일 액션 부여.
- [x] **Step 1~5**: TDD → 커밋 `feat(etf): 홈 ETF 카드 /etf 진입 연결`
  - 기존 jaroo-home-data.test.ts의 ETF 액션 테스트를 갱신(신규 파일 대신). 게스트 픽스처 카드 포함. 브라우저에서 세션 복원 → 실데이터 렌더 확인.

---

## Phase 2 — 2단계

### Task 8: 일봉 지표 산출 (`etf-metrics.ts`)

**Files:**
- Create: `src/lib/etf/etf-metrics.ts`
- Test: `src/lib/etf/etf-metrics.test.ts`

**Interfaces:**
- Produces: `computeEtfMetrics(daily: Array<{date,close}>) → { returns:{m1,m3,m6,y1}, volatilityAnnPct, mddPct, sharpe, week52:{high,low} } | null` (일봉 <260개면 null). 계산: 변동성=일별 로그수익률 std×√252, MDD=누적최고가 대비 최대낙폭, 샤프=(연환산 수익률−3.5% 무위험)/변동성, 수익률=기간별 단순 수익률. 순수 함수 — 크롤러 daily(Task 3) 소비.

- [x] **Step 1~5**: TDD(고정 시계열 fixture로 수치 검증) → 커밋 `feat(etf): 일봉 기반 수익률·리스크 지표 산출`
  - 구현 중 결정: 상수 로그수익률(단조 상승)에서 FP 잔차로 std가 0이 아니게 나와 샤프가 폭발하는 함정 → 영변동성 엡실론(1e-12) 가드 추가. 테스트 2건은 구현이 아니라 테스트 계산이 틀렸었음(slice(-252) 오프바이원, 샤프식 우선순위).

### Task 9: 2단계 페이지 wiring

**Files:**
- Modify: `src/lib/etf/etf-view-model.ts` (returns·topHoldings·riskMetrics 실데이터 분기 + 시나리오 블록 52주 위치 교체)
- Modify: `src/app/etf/page.tsx` (notice→실데이터 교체)
- Modify: `packages/crawler/src/crawlers/etf-profile.js` (daily 수집 추가 — naver chart JSON)
- Test: view-model 테스트 확장

**핵심**: ①returns/riskMetrics = `computeEtfMetrics(profile.daily)` ②topHoldings = `profile.holdings` + 구성 코드 일괄 quotes(상위 10개, `/api/quotes/current?codes=a,b,c...`) ③시나리오 블록 = "52주 범위 위치"(현재가가 (P−low)/(high−low) 상위 X%) — **가중 목표가는 3단계 이관**(근거: 구성종목별 slim 크롤 13페이지×N건은 페이지 로드에 부적합, 경량 컨센서스 소스 확보 과제 — #265 기록). 괴리율은 product.deviationPct.
- [x] **Step 1~5**: TDD → 커밋 `feat(etf): 2단계 — 구성종목·수익률·리스크 실데이터화`
  - 일봉 소스 변경: 네이버 차트 api.stock.naver.com은 1행만 반환 → 브리핑 라우트가 쓰는 `m.stock.naver.com/api/stock/{code}/price` 페이지네이션(60×5페이지=300거래일)으로. 라이브 검증 069500=300행(2025-06-26~).
  - 구성등락률 열 미제공으로 축소: 계획의 '일괄 quotes로 등락률'은 quotes/current에 등락률 필드가 없어 불가 — 구성 카드는 비중 바 중심으로, 요약행에 사유 명시(D7).
  - 시나리오 카드에 애널리스트 목표가 부재 사유를 상시 노트로 표기(D7 유지). 브라우저 검증: 52주 위치 58%·변동성 54.6%(데이터상 급등락 년도·정합)·구성/수익률/리스크 실데이터 렌더.

### Task 10: 마무리 — 검증·기록

- [x] `npm run lint && npm run typecheck && npm test` 전체 green (웹 487/487, 크롤러 9/9, lint·typecheck 0 errors, `next build` exit 0)
- [x] 라이브 스모크: /etf 실데이터 4종 카드(52주 위치 58%·수익률·구종 Top10·리스크) 렌더 확인, 픽스처 수치("82,770"/"7,673"/"57.6%") 부재 확인. 콘솔 [error] 1건은 dev 서버 잔류 진단으로 확인(프로덕션 빌드 exit 0·런타임 무결).
- [x] 이슈 #265에 진행 코멘트(2단계 완료·가중 목표가 3단계 이관 근거) — 한국어
- [x] 스펙 §5 시나리오·구성종목 행 갱신(52주 위치 교체·가중 목표가 3단계 이관·구성등락률 미제공 사유) + 커밋 `docs(etf): ...`

## Self-Review 결과

- 스펙 커버리지: §4 아키텍처(Task 2·3·4·6·7) · §5 전 행(Task 1·5·6·8·9 + Task 10 스펙 갱신) · §7 오류 처리(Task 2 가드·Task 4·6 에러 상태) · §8 테스트(각 태스크 TDD + Task 10 스모크) — 커버. 단, 가중 목표가의 2단계 구현은 실행 불가능한 전제(페이지 로드 내 N회 13페이지 크롤)로 확인되어 3단계 이관으로 스펙을 갱신한다(Task 10).
- 타입 일관성: `EtfProfileJson`(Task 1) = 크롤러 응답(Task 3) = 프록시 전달(Task 4). `EtfNoticeReason` 3종은 Task 1·5·6에서 동일 문자열.

## 후속 작업: ETF 조회 기록 원장(별도 테이블) — 2026-09-15 추가

#265 2단계 완료 후 사용자 요청("etf 는 분석본이 db에 업로드가 잘 되고있음?")으로 ETF 조회 이력의
저장·로드 경로를 추가했다. 설계 결정: `deepscan_scan_history.payload`는 읽기 경로에서
`isCanonicalPayload`(JarooDeepScanPayload) 가드가 ETF payload를 거부하므로 단일 테이블 재사용은
봉쇄된다 → **별도 테이블 `etf_scan_history`**(스키마 분리, 원장 패턴은 deepscan과 동일).

- [x] 마이그레이션 `20260915140000_create_etf_scan_history.sql` — RLS deny-all·서비스 롤 전용, (user_id, scanned_at desc) 인덱스. `supabase db push`로 원격 dev 적용.
- [x] `src/lib/etf-history-store.ts` — record(append+prune 30건)/list/getById. 읽기 가드 `isEtfLedgerPayload`(jaroo-etf-profile-v1). price_basis=일봉 마지막 종가. charged_credits=0(무과금).
- [x] `/api/etf/profile` GET 성공 시 세션(쿠키) 있으면 원장 append — payload는 상류 응답 그대로라 클라이언트 위조 불가, 실패는 void로 조회 응답 무영향. 게스트는 미기록(deepscan과 동일).
- [x] `GET /api/etf/history`(목록) · `GET /api/etf/history/[id]`(상세, uuid·본인·계약 가드 → 404) — deepscan history 라우트 미러.
- [x] 기록 탭(/mypage/history) — 두 원장을 `mergeAnalysisHistory`(scannedAt 내림차순)로 병합. ETF 행은 파란 점 + 'ETF · 코스피/코스닥' 배지, 탭 → `/etf?code=` 재진입(후속 작업 2부터 TTL 내 재열람 캐시 히트). 딥스캔 행은 기존 A안(타깃 복원→스냅샷 캐시 히트) 유지.
- [x] 단위 테스트: etf-history-store 순수 함수 6종(계약 가드·기준가) + analysis-history 병합 4종.
- [x] E2E(라이브): /etf 방문 → DB 행(payload 300일봉·30 구성종목·price_basis 104,275) → 기록 탭 병합 렌더(ETF 행+딥스캔 행) → ETF 행 탭 → /etf 재진입. 목록/상세/404 API 경로 확인.
- 알려진 의미론 → **해결(후속 작업 2의 재열람 캐시)**: 초판에는 조회 성공마다 append돼 같은 ETF 재방문 시 행이 중복 쌓였다. 단일종목 딥스캔의 재열람 패턴(스냅샷 캐시힉 + "다시 분석하기")을 이식해 구조적으로 해소했다(아래).

게이트: lint 0 errors(기존 warning만) · typecheck 0 · 웹 376/378(타이밍 민감 #298·wisereport-kr-v123 격리 시 통과) · 신규 단위 10/10.

## 후속 작업 2: ETF 재열람 캐시 — "이미 분석한 결과" 복원 + 다시 분석하기 (2026-09-15 추가)

사용자 지적("단일종목은 이미 분석한 값을 다시 불러왔다고 명시하고 다시 분석하기 버튼도 있다 — 이것을 참고해")으로
딥스캔의 스냅샷 캐시 A안을 ETF에 동일 문법으로 이식했다.

- [x] `/api/etf/profile` 재열람 캐시 — 세션 호출자의 원장 최신 행(`lookupLatestEtfAnalysis`)이
  TTL 24h(`isSnapshotFresh` 재사용) 안이면 상류 없이 반환 + `cache: { hit, scannedAt }` 표식.
  **캐시 히트는 원장에 새 행을 남기지 않는다** → 재방문 중복행 문제 해소.
  갱신은 명시적 `refresh=1`('다시 분석하기')만 — deepscan GET 라우트와 같은 계약.
- [x] 페이지 모델 — `parseEtfProfileCacheInfo`, ready 상태에 `restoredAt`·`analysisDriftPct`
  (캐시된 분석의 마지막 일봉 종가 vs live 브리핑 시세, `computePriceDriftPct` 재사용).
- [x] /etf UI — 딥스캔 결과 화면의 `SnapshotProvenanceBar`를 **컴포넌트 그대로 재사용**
  ("{N}분 전에 분석한 결과를 그대로 보여드려요" + '다시 분석하기' 필 버튼 + |drift|≥5% 앰버 경고).
  ETF는 무과금이라 크레딧 확인 다이얼로그 없이 즉시 갱신하고, 갱신 실패 시 기존 분석 화면을 유지한다.
- [x] 테스트 — 페이지 모델 2종(캐시 표식 파싱·restoredAt/drift 주입) + 라우트 순수 계약 2종(`buildEtfProfileCacheBody`).
- [x] E2E(라이브): 재방문 → "11분 전에 분석한 결과…" 배너 + 원장 행수 불변(5→5) → '다시 분석하기' →
  `refresh=1` fresh 수집 + 배너 소멸 + 새 행 append. 배너 시각 검증(아이콘·필 버튼·여백 정상).

## 후속 작업 3: 미국 ETF 지원 — 리소스 조사·스키마 통합·실측 QA (2026-09-16 추가)

한국 ETF와 같은 공식(상태 조사 → 공개 API 실증 → 계약 확장 → 실측)으로 미국 ETF를 /etf에 편입했다.

### 리소스 조사 결과 (실측)
- FMP v3/stable ETF 엔드포인트 — **레거시 키 폐쇄(2025-08-31 이전 구독자 전용)** → 사용 불가
- Yahoo chart v8 — Node fetch TLS 지문으로 429 차단(curl은 통과) → 일봉 소스 부적합
- **최종 조합**: Polygon aggs(약 2년 일봉·키 필요) + Polygon ticker details(`type:'ETF'` 판별·명칭·통화) + Yahoo quoteSummary(쿠키+crumb — 운용사·보수·AUM·NAV·구성 Top10 보강, 무키)
- 함정 발견: `packages/crawler/.env`의 **빈 키 할당이 root .env.local 실제 키를 덮어썼음**(나중 env 파일 우선) — 빈 줄 제거로 해결. Railway/prod env 점검(G5) 시 재확인 필요.

### 계약·스키마 통합
- `jaroo-etf-profile-v1`에 `market:'us'`·`currency?:'KRW'|'USD'`(기본 KRW) 확장 — 스키마 버전 유지
- **etf_scan_history 재사용(신규 마이그레이션 불필요)** — target_key=티커(VOO), market='us'; 읽기 가드(isEtfLedgerPayload)만 확장
- 크롤러 라우트 `us-etf-profile`(yahoo/us/etf/:symbol/profile) — NOT_ETF(AAPL→400)·관용 규칙(quoteSummary 실패 시 일봉·판별·명칭만)은 한국판 미러
- 웹: /api/etf/profile이 code 6자리(KR)/티커(US) 디스패치 — 캐시·원장·refresh 계약 공유
- 뷰모델 달러 표기(시세·평단·손익·52주·NAV·AUM '조 달러'), 브리핑 카드 currentPriceCurrency 전달, 시장별 면책 소스 표기 분기
- etf-target US 분기(?symbol=·code=티커·ticker=, 세션 identifierTicker), 기록 탭 'ETF · 미국' 라벨

### 검증
- 단위: 크롤러 6종(계약·NOT_ETF·관용) + 웹 9종(타깃·브리핑 URL·USD 표기·원장 가드·라벨) — 전체 웹 507/507·크롤러 15/15·lint·typecheck 0
- 라이브 E2E(VOO): 홈 카드→'ETF 분석'→/etf(세션) → 달러 시세·차트·52주 88%($580.93~$714.95)·수익률(1Y +15.67%)·리스크(변동성 15.9%·MDD −19.0%·샤프 0.81) → 원장(target_key VOO·market us) → 기록 탡 'ETF · 미국' → 재진입 캐시 배너. AAPL은 400 거부.
- 로컬 제약: 개발 IP가 Yahoo 스로틀 중이라 구성종목·상품정보 보강층이 notice 폴백으로 실증됨(프로덕션은 별도 IP·저빈도라 동작 예상 — 배포 후 확인 필요).
