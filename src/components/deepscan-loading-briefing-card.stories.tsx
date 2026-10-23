import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { CSSProperties } from 'react'

import { TodayBriefingCard } from './deepscan-loading-briefing-card'
import { DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT } from './deepscan-loading-types'

type Story = StoryObj<typeof TodayBriefingCard>

// 로딩 화면 풀스크롤 컨테이너(.loadingCard: height 100% + 내부 스크롤) 대신, 카드가
// 필요로 하는 디자인 토큰(--ds-* 변수)만 제공하는 평범한 블록 래퍼.
// 값은 .loadingCard 두 규칙의 병합 결과(후자 우선)와 동일하다.
// NOTE: .stories 파일의 모든 export는 스토리로 등록되므로 내보내지 않는다.
const BRIEFING_CARD_CONTEXT_VARS = {
  '--ds-bg': '#f5f6f8',
  '--ds-card': '#ffffff',
  '--ds-ink': '#0f1419',
  '--ds-muted': '#97a0ae',
  '--ds-mid': '#5a6473',
  '--ds-line': '#e8eaee',
  '--ds-blue': '#2b6be6',
  '--ds-blue-soft': '#e6f1fe',
  '--ds-blue-border': '#cfe0ff',
  '--ds-cream': '#fff8ec',
  '--ds-rise': '#a8323a',
  '--ds-rise-soft': '#fbe6e7',
  '--ds-emerald': '#1e7a43',
  '--ds-emerald-soft': '#e6f6ec',
  '--ds-red': '#e5484d',
  '--ds-amber': '#b8860b',
  '--ds-amber-soft': '#fef3e3',
  '--ds-skeleton-shimmer-duration': '4.2s',
  '--ds-member-pulse-duration': '4s',
} as CSSProperties

// 65거래일 내려가는 합성 일봉(짧은 반등 포함) — 차트·한 달/단기 흐름·원금회수 섹션용.
const lossDaily = Array.from({ length: 65 }, (_, index) => {
  const close = Math.round(37600 - index * 180 + Math.sin(index * 1.1) * 420)
  const prevClose = index === 0 ? close : Math.round(37600 - (index - 1) * 180 + Math.sin((index - 1) * 1.1) * 420)
  const month = String(((index % 12) + 1)).padStart(2, '0')
  const day = String(((index % 28) + 1)).padStart(2, '0')
  return {
    date: `2026-${month}-${day}`,
    open: close + 120,
    high: close + 380,
    low: close - 310,
    close,
    volume: 46000 - index * 120,
    changePct: ((close / prevClose) - 1) * 100,
  }
})

const lossBriefingSnapshot = {
  asOf: '2026-10-22T15:30:00+09:00',
  quote: {
    currentPrice: 25800,
    openPrice: 25010,
    highPrice: 26620,
    lowPrice: 24600,
    volume: 46123,
    previousVolume: 68400,
    changePct: -3.44,
    currency: 'KRW' as const,
    asOf: '2026-10-22T15:30:00+09:00',
  },
  daily: lossDaily,
  market: {
    kospi: { value: 2580.4, changePct: -1.72, asOf: '2026-10-22T15:30:00+09:00' },
    kosdaq: { value: 812.7, changePct: -2.54, asOf: '2026-10-22T15:30:00+09:00' },
  },
  recoveryForecast: {
    statusText: '원금회수 예측',
    summaryText: '각 모델에서 목표에 도달한 사례만 기준으로 계산한 기간은 약 74거래일이에요.',
    expectedRecoveryDaysText: '약 74거래일',
    recoveryProbabilityText: '61.1%',
    confidenceText: '보통',
    expectedRecoveryDays: 74,
    recoveryProbabilityPct: 61.1,
    targetPrice: 38634,
    priceHistory: lossDaily.map((row) => ({ date: row.date, close: row.close })),
    similarPatternSamples: [
      { date: lossDaily[10].date, close: lossDaily[10].close, drawdownPct: 12.4, recoveryDays: 38, recovered: true },
      { date: lossDaily[34].date, close: lossDaily[34].close, drawdownPct: 19.8, recoveryDays: null, recovered: false },
      { date: lossDaily[51].date, close: lossDaily[51].close, drawdownPct: 26.1, recoveryDays: 71, recovered: true },
    ],
    modelRows: [
      { label: '유사 패턴', recoveryDaysText: '96거래일', probabilityText: '60.3%', sampleText: '63건' },
      { label: '일반 주가 변동', recoveryDaysText: '57거래일', probabilityText: '58.2%' },
      { label: '급등락 반영', recoveryDaysText: '60거래일', probabilityText: '63.9%' },
    ],
  },
}

const analystConsensus = {
  targetPriceLabel: '53,000원',
  currentPriceLabel: '25,800원',
  analystCountLabel: '증권사 1곳',
  upsideLabel: '+105.4%',
  opinionLabel: '4.00',
  highTargetLabel: '53,000원',
  lowTargetLabel: '53,000원',
  targetPriceValue: 53000,
  currentPriceValue: 25800,
  highTargetValue: 53000,
  lowTargetValue: 53000,
  summary: '매수 의견이 우세해요.',
}

const meta: Meta<typeof TodayBriefingCard> = {
  title: 'Jaroo/딥스캔 · 오늘 장 브리핑 카드',
  component: TodayBriefingCard,
  decorators: [
    (Story) => (
      <div style={{ ...BRIEFING_CARD_CONTEXT_VARS, maxWidth: 400, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

export const LossWithRecoveryForecast: Story = {
  name: '손실 구간 · 원금회수 예측 포함',
  args: {
    currentPriceText: '25,800원',
    currentPriceCurrency: 'KRW',
    averagePriceText: '38,634원',
    averagePriceCurrency: 'KRW',
    sharesText: '51주',
    profitRateText: '-33.22%',
    profitAmountText: '-654,534원',
    forceReady: true,
    elapsedSeconds: 60,
    tradingVolumeText: '4.6만주',
    consensus: analystConsensus,
    dailyCloses: lossDaily.slice(-10).map((row) => row.close),
    seedKey: 'storybook-loss',
    briefingSnapshot: lossBriefingSnapshot,
  },
}

export const ProfitPosition: Story = {
  name: '수익 구간 (원금회수 섹션 없음)',
  args: {
    currentPriceText: '250,000원',
    currentPriceCurrency: 'KRW',
    averagePriceText: '96,852원',
    averagePriceCurrency: 'KRW',
    sharesText: '501주',
    profitRateText: '+158.0%',
    profitAmountText: '+7,673만원',
    forceReady: true,
    elapsedSeconds: 60,
    consensus: {
      ...analystConsensus,
      targetPriceLabel: '487,045원',
      currentPriceLabel: '250,000원',
      analystCountLabel: '49개 증권사 · TARGET VIEW',
      upsideLabel: '+94.8%',
      highTargetLabel: '600,000원',
      lowTargetLabel: '300,000원',
      targetPriceValue: 487045,
      currentPriceValue: 250000,
      highTargetValue: 600000,
      lowTargetValue: 300000,
    },
    dailyCloses: [232000, 235500, 238000, 236500, 241000, 243500, 242000, 246000, 248500, 250000],
    seedKey: 'storybook-profit',
    briefingSnapshot: {
      asOf: '2026-10-22T15:30:00+09:00',
      quote: { ...lossBriefingSnapshot.quote, currentPrice: 250000, changePct: 1.2 },
      daily: lossDaily.map((row) => ({ ...row, close: Math.round(row.close * 9.6) })),
      market: lossBriefingSnapshot.market,
    },
  },
}

export const ConsensusEmptyState: Story = {
  name: '컨센서스 없음 — 빈 상태 문구',
  args: {
    ...LossWithRecoveryForecast.args,
    consensus: undefined,
    consensusEmptyState: DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT,
    seedKey: 'storybook-empty',
  },
}
