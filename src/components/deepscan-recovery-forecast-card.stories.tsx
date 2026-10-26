import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { JarooDeepScanPayload, JarooDeepScanRecoveryForecastBlock } from '../../packages/contracts/src/deepscan'
import { DeepScanRecoveryForecastCard } from './deepscan-recovery-forecast-card'

type Story = StoryObj<typeof DeepScanRecoveryForecastCard>

// 60거래일 내려가는 합성 일봉 — 1년 차트가 실제처럼 그려지는지 보는 용도.
const descendingSeries = Array.from({ length: 60 }, (_, index) => ({
  date: `2026-${String(Math.floor(index / 28) + 7).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
  close: Math.round(31000 - index * 160 + Math.sin(index * 1.3) * 500),
}))

function block(overrides: Partial<JarooDeepScanRecoveryForecastBlock> = {}): JarooDeepScanRecoveryForecastBlock {
  return {
    blockState: 'ok',
    sourceRefs: [],
    fallback: null,
    error: null,
    statusText: '원금회수 예측',
    summaryText: '평단 ₩38,634 회복까지 약 74거래일로 추정돼요.',
    expectedRecoveryDaysText: '약 74거래일',
    recoveryProbabilityText: '61.1%',
    confidenceText: '보통',
    currentPriceText: '₩25,800',
    targetPriceText: '₩38,634',
    drawdownText: '33.2%',
    modelRows: [
      { label: '유사 패턴', recoveryDaysText: '96거래일', probabilityText: '60.3%', sampleText: '63건' },
      { label: '일반 주가 변동', recoveryDaysText: '57거래일', probabilityText: '58.2%' },
      { label: '급등락 반영', recoveryDaysText: '60거래일', probabilityText: '63.9%' },
    ],
    disclaimer: '데이터 분석 기반 참고 정보이며 투자 권유나 수익 보장이 아닙니다. 1년 내 도달 비율은 유사 과거 표본과 5,000개 모의 경로가 252거래일 안에 각 회복 기준을 한 번 이상 터치한 비율을 종합한 값이며, 예측 정확도나 회복 보장이 아닙니다.',
    ...overrides,
  }
}

function payloadWith(recovery: JarooDeepScanRecoveryForecastBlock): JarooDeepScanPayload {
  return { recoveryForecast: recovery } as JarooDeepScanPayload
}

const meta: Meta<typeof DeepScanRecoveryForecastCard> = {
  title: 'Jaroo/딥스캔 · 원금회수 예측 카드',
  component: DeepScanRecoveryForecastCard,
  decorators: [
    (Story) => (
      <div style={{ width: 380, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

export const LossWithChart: Story = {
  name: '손실 구간 · 차트 + 유사 패턴 밴드',
  args: {
    payload: payloadWith(block({
      currentPrice: 25800,
      targetPrice: 38634,
      expectedRecoveryDays: 74,
      recoveryProbabilityPct: 61.1,
      confidenceLevel: 'medium',
      priceHistory: descendingSeries,
      similarPatternSamples: [
        { date: descendingSeries[10].date, close: descendingSeries[10].close, drawdownPct: 11.2, recoveryDays: 38, recovered: true },
        { date: descendingSeries[24].date, close: descendingSeries[24].close, drawdownPct: 19.8, recoveryDays: null, recovered: false },
        { date: descendingSeries[41].date, close: descendingSeries[41].close, drawdownPct: 24.6, recoveryDays: 71, recovered: true },
      ],
    })),
  },
}

export const LowConfidence: Story = {
  name: '낮은 신뢰도 (모델 간 편차 큼)',
  args: {
    payload: payloadWith(block({
      confidenceText: '낮음',
      confidenceLevel: 'low',
      expectedRecoveryDaysText: '약 118거래일',
      recoveryProbabilityText: '43.8%',
      recoveryProbabilityPct: 43.8,
      expectedRecoveryDays: 118,
      summaryText: '모델 간 회수 기간 편차가 커서 낮은 신뢰도로 표시했어요.',
      modelRows: [
        { label: '유사 패턴', recoveryDaysText: 'N/A', probabilityText: 'N/A' },
        { label: '일반 주가 변동', recoveryDaysText: '96거래일', probabilityText: '41.2%' },
        { label: '급등락 반영', recoveryDaysText: '141거래일', probabilityText: '46.5%' },
      ],
      priceHistory: descendingSeries.slice(0, 30),
      similarPatternSamples: [],
    })),
  },
}

export const LegacyPayloadFallback: Story = {
  name: '구형 페이로드 폴백 (차트 없음)',
  args: {
    payload: payloadWith(block()),
  },
}

export const ProfitPositionHidden: Story = {
  name: '수익 구간 — 카드 숨김',
  args: {
    payload: payloadWith(block({ drawdownText: '-7.1%', summaryText: '현재가가 이미 평단 이상이라 원금회수 목표에 도달한 상태입니다.' })),
  },
}
