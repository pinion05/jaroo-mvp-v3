'use client'

// 딥스캔 로딩 브리핑 카드(오늘 브리핑 + 목표가 팬차트) 미리보기.
// 실제 스캔(로그인·크레딧) 없이 차트 요소를 검증하기 위한 개발 하네스다.
import { TodayBriefingCard } from '@/components/deepscan-loading-briefing-card'
import { DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT } from '@/components/deepscan-loading-types'

const KR_FIXTURE = {
  currentPriceText: '250,000원',
  currentPriceCurrency: 'KRW' as const,
  averagePriceText: '96,852원',
  averagePriceCurrency: 'KRW' as const,
  sharesText: '501',
  profitRateText: '+158.0%',
  profitAmountText: '+7,673만원',
  forceReady: true,
  elapsedSeconds: 30,
  consensus: {
    targetPriceLabel: '487,045원',
    currentPriceLabel: '250,000원',
    analystCountLabel: '49개 증권사 · TARGET VIEW',
    upsideLabel: '+94.8%',
    opinionLabel: '매수 4.00',
    highTargetLabel: '600,000원',
    lowTargetLabel: '300,000원',
    targetPriceValue: 487045,
    currentPriceValue: 250000,
    highTargetValue: 600000,
    lowTargetValue: 300000,
    summary: '컨센서스 목표가가 현재가보다 94.8% 위에 있어요.',
  },
  dailyCloses: [232000, 235500, 238000, 236500, 241000, 243500, 242000, 246000, 248500, 250000],
  seedKey: 'debug-briefing-kr',
}

// 컨센서스(목표가) 없는 일반 종목 — 스캔 완료 시점의 빈 상태 문구를 검증하는 변형 픽스처.
const KR_EMPTY_FIXTURE = {
  ...KR_FIXTURE,
  seedKey: 'debug-briefing-kr-empty',
  consensus: undefined,
  consensusEmptyState: DEEPSCAN_CONSENSUS_EMPTY_STATE_TEXT,
}

// 손실 구간 + 원금회수 예측 브리핑 — 실측 예(평단 38,634원 매수, 현재 25,800원) 재현.
// daily 65행은 37,600→25,800으로 내려가는 합성 일봉(짧은 반등을 섞어 단기 스택이 4일 안팎).
const KR_LOSS_DAILY = Array.from({ length: 65 }, (_, index) => {
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

const KR_LOSS_FIXTURE = {
  currentPriceText: '25,800원',
  currentPriceCurrency: 'KRW' as const,
  averagePriceText: '38,634원',
  averagePriceCurrency: 'KRW' as const,
  sharesText: '51주',
  profitRateText: '-33.22%',
  profitAmountText: '-654,534원',
  forceReady: true,
  elapsedSeconds: 60,
  tradingVolumeText: '4.6만주',
  consensus: {
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
  },
  dailyCloses: KR_LOSS_DAILY.map((row) => row.close).slice(-10),
  seedKey: 'debug-briefing-kr-loss',
  briefingSnapshot: {
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
    daily: KR_LOSS_DAILY,
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
      modelRows: [
        { label: '유사 패턴', recoveryDaysText: '96거래일', probabilityText: '60.3%', sampleText: '63건' },
        { label: '일반 주가 변동', recoveryDaysText: '57거래일', probabilityText: '58.2%' },
        { label: '급등락 반영', recoveryDaysText: '60거래일', probabilityText: '63.9%' },
      ],
    },
  },
}

// loadingCard는 풀스크린 로딩 화면용(height 100% + 내부 스크롤)이라 디버그 페이지에선
// 디자인 토큰(--ds-* 변수)만 제공하는 평범한 블록으로 감싼다 — 카드 3장은 페이지 스크롤로.
const CARD_CONTEXT_STYLE = {
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
  maxWidth: 420,
  background: '#fff',
} as const

export default function DebugBriefingPage() {
  return (
    <main style={{ display: 'grid', gap: 24, padding: 24, background: '#0b0e13', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ color: '#fff', fontSize: 16 }}>딥스캔 브리핑 카드 미리보기 — 목표가 팬차트 내 평단 점선</h1>
      <div style={CARD_CONTEXT_STYLE}>
        <TodayBriefingCard {...KR_FIXTURE} />
      </div>
      <h2 style={{ color: '#fff', fontSize: 14 }}>consensus 없음 — 빈 상태 문구</h2>
      <div style={CARD_CONTEXT_STYLE}>
        <TodayBriefingCard {...KR_EMPTY_FIXTURE} />
      </div>
      <h2 style={{ color: '#fff', fontSize: 14 }}>손실 구간 — 원금회수 예측 브리핑 포함</h2>
      <div style={CARD_CONTEXT_STYLE}>
        <TodayBriefingCard {...KR_LOSS_FIXTURE} />
      </div>
    </main>
  )
}
