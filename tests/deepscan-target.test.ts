import test from 'node:test'
import assert from 'node:assert/strict'

import type { JarooDeepScanPayload } from '../packages/contracts/src/deepscan'

import { buildDeepScanViewModel, createPlaceholderDeepScanHolding, pickDeepScanDefaultHolding } from '../src/lib/deepscan-target'
import { buildDeepScanHeroCard, buildDeepScanPageHeader, buildDeepScanPartialSuccessNotice, getDeepScanBlockNotice } from '../src/lib/deepscan-page-projection'
import { sanitizeOcrRows } from '../src/lib/screenshot-ocr'

const sampleHolding = {
  id: 7,
  kind: 'stock' as const,
  name: 'NAVER',
  code: '035420',
  shortName: 'NAVER',
  donutLabel: 'NAVER',
  shares: '12주',
  averagePrice: '236,000원',
  evaluationAmount: '2,359,000원',
  market: 'KOSPI',
  marketTone: 'kospi' as const,
  badge: '관찰 중',
  badgeTone: 'amber' as const,
  cardTone: 'warning' as const,
  change: '-16.7%',
  pnl: '-473,000원',
  signalTone: 'warning' as const,
  centerScore: '-16.7%',
  centerScoreColor: '#FAC775',
  centerBadge: '관찰 중',
  centerBadgeTone: 'amber' as const,
  centerName: 'NAVER',
  donutColor: '#378ADD',
  donutPercent: 0.2,
  heatmapWeight: '20%',
  heatmapBackground: '#BC7010',
  heatmapChange: '-16.7%',
  heatmapBadge: '관찰 중',
  heatmapBadgeTone: 'amber' as const,
  opinionLabel: 'AI 간략 의견',
  opinionText: '테스트 의견',
  opinionBackground: '#f8f8f6',
  opinionBorder: 'transparent',
  opinionTextColor: '#555',
  metaLine: '평단 236,000원 · 평가금액 2,359,000원',
  metrics: [
    { label: '보유 수량', value: '12주', tone: 'neutral' as const },
    { label: '수익률', value: '-16.7%', tone: 'warning' as const },
    { label: '평가 금액', value: '2,359,000원', tone: 'neutral' as const },
  ],
  actionLabel: '딥스캔',
  actionSubLabel: 'AI 9인 위원회 분석',
  actionCredits: '300cr',
  actionHref: '/deepscan',
}

test('buildDeepScanViewModel reflects selected holding data instead of samsung fixture text', () => {
  const viewModel = buildDeepScanViewModel(sampleHolding)

  assert.equal(viewModel.holding.name, 'NAVER')
  assert.equal(viewModel.statusText, '-16.7% · 12주')
  assert.match(viewModel.body, /NAVER/)
  assert.match(viewModel.body, /2,359,000원/)
  assert.equal(viewModel.insightSectionLabel, '실제 인식 데이터')

  for (const axis of viewModel.axisGroups) {
    for (const member of axis.members) {
      assert.doesNotMatch(member.reason, /삼성전자|HBM|반도체 업황/)
    }
  }

  for (const item of viewModel.insightItems) {
    assert.doesNotMatch(item.title, /삼성전자|HBM/)
    assert.doesNotMatch(item.body, /삼성전자|HBM/)
  }
})

test('pickDeepScanDefaultHolding prefers the worst stock and ignores etf entries', () => {
  const holdings = [
    { ...sampleHolding, id: 1, kind: 'etf' as const, name: 'KODEX 200', change: '-32.0%' },
    { ...sampleHolding, id: 2, name: '카카오', change: '-4.5%' },
    { ...sampleHolding, id: 3, name: 'NAVER', change: '-16.7%' },
    { ...sampleHolding, id: 4, name: '삼성전자', change: '+3.1%' },
  ]

  const selected = pickDeepScanDefaultHolding(holdings)

  assert.equal(selected?.id, 3)
  assert.equal(selected?.name, 'NAVER')
})

test('pickDeepScanDefaultHolding returns null when there is no stock candidate', () => {
  const holdings = [{ ...sampleHolding, id: 1, kind: 'etf' as const, name: 'KODEX 200' }]

  assert.equal(pickDeepScanDefaultHolding(holdings), null)
})

test('sanitizeOcrRows preserves visible code and ticker fields', () => {
  const rows = sanitizeOcrRows([
    {
      name: '애플',
      quantity: '3주',
      profitRate: '+5.2%',
      evaluationAmount: '$845.12',
      code: ' aapl ',
      ticker: ' us:aapl ',
    },
  ])

  assert.equal(rows[0]?.code, 'AAPL')
  assert.equal(rows[0]?.ticker, 'US:AAPL')
})

test('scenario probability is consistent between primary card and comparison list', () => {
  const viewModel = buildDeepScanViewModel(sampleHolding)
  const primaryScenario = viewModel.otherScenarios.find((scenario) => scenario.tone === 'primary')

  assert.equal(primaryScenario?.probability, viewModel.scenarioProbability)
})

test('placeholder holding avoids falling back to samsung mock text', () => {
  const viewModel = buildDeepScanViewModel(createPlaceholderDeepScanHolding())

  assert.equal(viewModel.holding.name, '종목 미선택')
  assert.doesNotMatch(viewModel.body, /삼성전자|HBM/)
})

type CanonicalPayloadOverrides = Omit<Partial<JarooDeepScanPayload>, 'metadata'> & {
  metadata?: Partial<JarooDeepScanPayload['metadata']> & {
    blockStatus?: Partial<JarooDeepScanPayload['metadata']['blockStatus']>
  }
}

function createCanonicalPayload(overrides: CanonicalPayloadOverrides = {}): JarooDeepScanPayload {
  const payload: JarooDeepScanPayload = {
    input: {
      instrument: {
        name: '카카오',
        code: '035720',
        ticker: '035720.KS',
        market: 'KR',
        kind: 'stock',
      },
      holding: {
        shares: '8주',
        averagePrice: '43,000원',
        evaluationAmount: '344,000원',
      },
      selectedAt: '2026-04-15T15:00:00.000Z',
      sourceContext: {
        from: 'holding',
        sessionKey: 'session-1',
        appliedAt: '2026-04-15T15:00:00.000Z',
      },
    },
    hero: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      headline: '카카오 canonical headline',
      body: '카카오 canonical body',
      statusText: 'canonical ok',
      score: 61,
      scoreLabel: '61 / 100',
      scoreDelta: '+0',
    },
    committee: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      axes: [],
    },
    insights: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      sectionLabel: 'Baseline insights',
      items: [],
      summaryTags: [],
    },
    strategy: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      weekSignal: 'Hold and verify',
      weekSignalTone: 'neutral',
      weekBadgeText: 'Baseline',
      scenarioLabel: 'Endpoint wiring pending',
      scenarioProbability: '62%',
      scenarioPeriod: '1-2 weeks',
      scenarioCondition: 'Canonical payload is available.',
      currentPriceText: '43,000원',
      targetPriceText: 'Target TBD',
      scenarioDetails: [],
      otherScenarios: [],
      otherScenarioTags: [],
    },
    sellNow: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      realizedText: 'Sell now baseline',
      rows: [],
    },
    portfolioSimulation: {
      blockState: 'ok',
      sourceRefs: [],
      fallback: null,
      error: null,
      beforeScore: 58,
      afterScore: 64,
      deltaLabel: '+6p',
      caption: 'Baseline simulation placeholder',
    },
    metadata: {
      generatedAt: '2026-04-15T15:00:00.000Z',
      version: 'test-v1',
      degraded: false,
      debugId: 'debug-1',
      inputValidity: { valid: true },
      sourceRefs: [],
      blockStatus: {
        hero: 'ok',
        committee: 'ok',
        insights: 'ok',
        strategy: 'ok',
        sellNow: 'ok',
        portfolioSimulation: 'ok',
      },
    },
  }

  return {
    ...payload,
    ...overrides,
    metadata: {
      ...payload.metadata,
      ...overrides.metadata,
      blockStatus: {
        ...payload.metadata.blockStatus,
        ...overrides.metadata?.blockStatus,
      },
    },
  }
}

test('deepscan page projection uses canonical payload hero and header instead of heuristic holding copy', () => {
  const payload = createCanonicalPayload()
  const header = buildDeepScanPageHeader({ holding: sampleHolding, selectedAt: '2026-04-15T15:00:00.000Z' }, payload)
  const hero = buildDeepScanHeroCard({ holding: sampleHolding, selectedAt: '2026-04-15T15:00:00.000Z' }, 'success', payload)

  assert.equal(header.name, '카카오')
  assert.match(header.identifierText, /035720/)
  assert.equal(hero.headline, '카카오 canonical headline')
  assert.equal(hero.body, '카카오 canonical body')
  assert.equal(hero.statusText, 'canonical ok')
  assert.equal(hero.scoreLabel, '61 / 100')
  assert.doesNotMatch(hero.body, /NAVER|삼성전자|HBM|반도체 업황/)
})

test('deepscan page projection exposes an explicit loading hero while canonical payload is pending', () => {
  const hero = buildDeepScanHeroCard({ holding: sampleHolding, selectedAt: '2026-04-15T15:00:00.000Z' }, 'loading', null)

  assert.match(hero.headline, /불러오는 중/)
  assert.match(hero.body, /canonical payload/i)
  assert.equal(hero.statusText, '로딩 중')
  assert.equal(hero.scoreLabel, 'Loading')
  assert.equal(hero.scoreDelta, '불러오는 중')
})

test('deepscan page projection surfaces canonical blocked block fallback instead of heuristic section copy', () => {
  const notice = getDeepScanBlockNotice(
    {
      blockState: 'blocked',
      sourceRefs: [],
      fallback: {
        used: true,
        reason: 'input-invalid',
        label: '입력 확인 필요',
      },
      error: {
        code: 'input-invalid',
        message: '종목 코드 또는 티커가 필요합니다.',
        retryable: false,
      },
    },
    {
      badge: 'Blocked',
      title: '위원회 분석을 표시할 수 없어요',
      body: '위원회 데이터를 아직 표시할 수 없어요.',
    },
  )

  assert.deepEqual(notice, {
    badge: 'Blocked',
    title: '입력 확인 필요',
    body: '종목 코드 또는 티커가 필요합니다.',
  })
})

test('deepscan page projection exposes a page-level partial-success notice when some blocks degrade', () => {
  const payload = createCanonicalPayload({
    metadata: {
      blockStatus: {
        hero: 'ok',
        committee: 'error',
        insights: 'ok',
        strategy: 'blocked',
        sellNow: 'ok',
        portfolioSimulation: 'ok',
      },
    },
  })

  const notice = buildDeepScanPartialSuccessNotice(payload)

  assert.deepEqual(notice, {
    badge: 'Partial',
    title: '일부 분석 결과만 표시 중이에요',
    body: 'AI 분석 결과, 전략 블록은 오류 또는 보완 필요 상태로 표시됩니다.',
  })
})
