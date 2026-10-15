import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

import { homeHoldings, type HomeHolding } from '@/lib/jaroo-home-data'

const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => {
  module.exports = new Proxy({}, { get: (_target, property) => String(property) })
}

async function loadSummaryBuilder() {
  const homeScreenModule = await import('./jaroo-home-screen')
  return homeScreenModule.buildHomeV2Summary
}

function createHolding(overrides: Partial<HomeHolding>): HomeHolding {
  return {
    ...homeHoldings[0],
    id: overrides.id ?? 0,
    name: overrides.name ?? '테스트',
    shortName: overrides.shortName ?? overrides.name ?? '테스트',
    donutLabel: overrides.donutLabel ?? overrides.name ?? '테스트',
    shares: overrides.shares ?? '1주',
    market: overrides.market ?? 'KOSPI',
    marketTone: overrides.marketTone ?? 'kospi',
    averagePrice: overrides.averagePrice ?? '1,000,000원',
    evaluationAmount: overrides.evaluationAmount ?? '1,000,000원',
    change: overrides.change ?? '+0.0%',
    pnl: overrides.pnl ?? '+0원',
    metaLine: overrides.metaLine ?? '평단 1,000,000원 · 평가금액 1,000,000원',
    metrics: overrides.metrics ?? [
      { label: '평가 금액', value: overrides.evaluationAmount ?? '1,000,000원', tone: 'neutral' },
    ],
    ...overrides,
  }
}

test('home summary는 혼합 KRW/USD 손익을 환율 없이는 수익/손실로 확정하지 않는다', async () => {
  const buildHomeV2Summary = await loadSummaryBuilder()
  const summary = buildHomeV2Summary([
    createHolding({ id: 1, name: '국내', pnl: '+100,000원', evaluationAmount: '1,100,000원', change: '+10.0%' }),
    createHolding({
      id: 2,
      name: '미국',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      pnl: '-$1,000.00',
      evaluationAmount: '$9,000.00',
      change: '-10.0%',
      metrics: [{ label: '평가 금액', value: '$9,000.00', tone: 'neutral' }],
    }),
  ], true)

  assert.equal(summary.badge, '관찰')
  assert.equal(summary.badgeTone, 'amber')
  assert.equal(summary.totalPnl, null)
  assert.equal(summary.totalPnlText, '-')
})

test('home summary는 환율이 있으면 혼합 KRW/USD 손익을 KRW로 정규화한다', async () => {
  const buildHomeV2Summary = await loadSummaryBuilder()
  const summary = buildHomeV2Summary([
    createHolding({ id: 1, name: '국내', pnl: '+100,000원', evaluationAmount: '1,100,000원', change: '+10.0%' }),
    createHolding({
      id: 2,
      name: '미국',
      market: 'NASDAQ',
      marketTone: 'nasdaq',
      pnl: '-$1,000.00',
      evaluationAmount: '$9,000.00',
      change: '-10.0%',
      metrics: [{ label: '평가 금액', value: '$9,000.00', tone: 'neutral' }],
    }),
  ], true, { usdKrwRate: 1400 })

  assert.equal(summary.badge, '손실')
  assert.equal(summary.badgeTone, 'red')
  assert.equal(summary.totalPnl, -1_300_000)
  assert.equal(summary.totalPnlText, '−1,300,000원')
  assert.equal(summary.totalEvaluationText, '13,700,000원')
})

test('expanded home stock card exposes an accessible removal action', () => {
  const source = readFileSync(new URL('./jaroo-home-screen.tsx', import.meta.url), 'utf8')

  assert.match(source, /aria-label=\{`\$\{item\.name\} 종목 제거`\}/)
  assert.match(source, /role='dialog'/)
  assert.match(source, /aria-modal='true'/)
})

// ── kind 'etn' 배선(정적 매칭) ──
// 이 파일의 테스트 인프라는 export 순수 함수 직접 호출 + 소스 정적 매칭뿐이고
// React 렌더링 환경이 없다 — fast-path의 '동작'은 deepscan-target.test.ts의
// resolveDefaultDeepScanHolding 직접 테스트가 담당하고, 여기선 배선(헬퍼 호출·
// CTA 전달)만 확인한다.
test('빠른 딥스캔 기본 타깃 fast-path는 export 헬퍼 resolveDefaultDeepScanHolding로 배선된다', () => {
  const source = readFileSync(new URL('./jaroo-home-screen.tsx', import.meta.url), 'utf8')

  assert.match(source, /resolveDefaultDeepScanHolding\(selectedHolding, homeHoldings\)/)
  assert.match(source, /import \{ resolveDefaultDeepScanHolding \} from '@\/lib\/deepscan-target'/)
  // 인라인 fast-path(kind === 'stock' 조건문)는 제거됐다
  assert.doesNotMatch(source, /if \(selectedHolding\?\.kind === 'stock'\)/)
  // forecast CTA가 defaultDeepScanHolding를 전달하는 기존 패턴 유지
  assert.match(source, /navigateToDeepScanForHolding\(defaultDeepScanHolding\.id, summary\.forecast\.href\)/)
})
