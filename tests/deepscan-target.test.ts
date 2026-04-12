import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDeepScanViewModel, createPlaceholderDeepScanHolding, pickDeepScanDefaultHolding } from '../src/lib/deepscan-target.ts'
import { sanitizeOcrRows } from '../src/lib/screenshot-ocr.ts'

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
