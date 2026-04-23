import test from 'node:test'
import assert from 'node:assert/strict'

import { buildEtfPageModel } from './etf-page-data'

const sampleEtfHolding = {
  id: 4,
  kind: 'etf' as const,
  name: 'TIGER 미국S&P500',
  code: '360750',
  shortName: 'TIGER미국',
  donutLabel: 'TIGER미국',
  shares: '12주',
  averagePrice: '18,250원',
  evaluationAmount: '221,400원',
  market: 'ETF',
  marketTone: 'etf' as const,
  identifierCode: '360750',
  identifierLabel: '360750',
  badge: '손실 중',
  badgeTone: 'red' as const,
  cardTone: 'etf' as const,
  change: '-6.1%',
  pnl: '-14,100원',
  signalTone: 'etf' as const,
  centerScore: '-6.1%',
  centerScoreColor: '#93C5FD',
  centerBadge: '손실 중',
  centerBadgeTone: 'red' as const,
  centerName: 'TIGER 미국S&P500',
  donutColor: '#185FA5',
  donutPercent: 0.2,
  heatmapWeight: '20%',
  heatmapBackground: '#1E4D8C',
  heatmapMeta: 'ETF',
  opinionLabel: 'OCR 요약',
  opinionText: '실제 보유 ETF 테스트',
  opinionBackground: '#f0f7ff',
  opinionBorder: '#B5D4F4',
  opinionTextColor: '#0C447C',
  metaLine: '종목코드 360750 · 평단 18,250원 · 현재가 18,450원',
  metrics: [
    { label: '보유 수량', value: '12주', tone: 'neutral' as const },
    { label: '수익률', value: '-6.1%', tone: 'warning' as const },
    { label: '평가 금액', value: '221,400원', tone: 'neutral' as const },
    { label: '현재가', value: '18,450원', tone: 'neutral' as const },
  ],
  actionLabel: 'ETF 분석',
  actionSubLabel: '섹터 구성 + 회복 시나리오',
  actionCredits: '300cr',
  actionHref: '/etf',
}

test('buildEtfPageModel uses selected ETF holding fields instead of static mock values', () => {
  const model = buildEtfPageModel(sampleEtfHolding)

  assert.equal(model.title, 'TIGER 미국S&P500')
  assert.equal(model.code, '360750')
  assert.equal(model.heroName, 'TIGER 미국S&P500')
  assert.equal(model.heroPrice, '18,450원')
  assert.equal(model.heroChange, '-6.1%')
  assert.equal(model.heroAveragePrice, '평단 18,250원')
  assert.deepEqual(model.heroStats, [
    { label: '보유 수량', value: '12주' },
    { label: '평가 금액', value: '221,400원' },
    { label: '손익', value: '-14,100원' },
  ])
})

test('buildEtfPageModel falls back to placeholders when live quote fields are absent', () => {
  const model = buildEtfPageModel({
    ...sampleEtfHolding,
    evaluationAmount: undefined,
    pnl: '-',
    metrics: sampleEtfHolding.metrics.filter((metric) => metric.label !== '현재가' && metric.label !== '평가 금액'),
  })

  assert.equal(model.heroPrice, '-')
  assert.equal(model.heroStats[1]?.value, '-')
  assert.equal(model.heroStats[2]?.value, '-')
})
