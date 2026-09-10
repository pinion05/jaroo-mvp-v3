'use client'

// 딥스캔 로딩 브리핑 카드(오늘 브리핑 + 목표가 팬차트) 미리보기.
// 실제 스캔(로그인·크레딧) 없이 차트 요소를 검증하기 위한 개발 하네스다.
import { TodayBriefingCard } from '@/components/deepscan-loading-briefing-card'
import styles from '@/components/deepscan-loading-screen.module.css'

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

export default function DebugBriefingPage() {
  return (
    <main style={{ display: 'grid', gap: 24, padding: 24, background: '#0b0e13', minHeight: '100vh' }}>
      <h1 style={{ color: '#fff', fontSize: 16 }}>딥스캔 브리핑 카드 미리보기 — 목표가 팬차트 내 평단 점선</h1>
      <section className={styles.loadingCard} style={{ maxWidth: 420 }}>
        <TodayBriefingCard {...KR_FIXTURE} />
      </section>
    </main>
  )
}
