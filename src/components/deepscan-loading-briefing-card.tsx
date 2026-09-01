'use client'

import { useRef, useEffect, useMemo } from 'react'
import { BarChart3, Calendar, Flame, Landmark, Target, Telescope, TrendingUp, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type {
  DeepScanLoadingScreenProps,
  LoadingQuickFact,
  LoadingBriefingSnapshot,
  MoneyCurrency,
} from './deepscan-loading-types'
import {
  formatNumber,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
  parseNumericValue,
  normalizeMoneyValueToCurrency,
  narrativeToneClass,
  quickFactToneToNarrativeTone,
  formatAsOfTime,
  buildTodayFlow,
  buildOneMonthMeaning,
  buildChartGeometry,
  financialToneClass,
  pctToneClass,
  formatPercentValue,
  startTodayBriefingMobileAutoScroll,
} from './deepscan-loading-utils'
import {
  TODAY_BRIEFING_FIRST_REVEAL_SECONDS,
  TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS,
  TODAY_BRIEFING_SKELETON_SECONDS,
  TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS,
  TODAY_BRIEFING_ITEM_COUNT,
} from './deepscan-loading-types'
import {
  isFiniteNumber,
  getLatestBriefingDailyRow,
  getPreviousBriefingDailyRow,
  calculateBriefingOneMonthChangePct,
  calculateBriefingShortStreak,
} from '@/lib/deepscan-briefing-snapshot'
import { resolveDeepScanBriefingCardCurrentPrice } from '@/lib/deepscan-loading-current-price'
import { getVisibleDeepScanBriefingItemCount, isDeepScanBriefingItemContentReady } from '@/lib/deepscan-loading-behavior'
import { buildConsensusFanGeometry, estimateDailyVolatility } from '@/lib/deepscan-target-price-paths'
import { cn } from '@/lib/utils'
import styles from './deepscan-loading-screen.module.css'


export function BackControl({ onBack, backHref }: Pick<DeepScanLoadingScreenProps, 'onBack' | 'backHref'>) {
  if (onBack) {
    return (
      <button type='button' className={styles.backButton} onClick={onBack} aria-label='뒤로 가기'>
        ←
      </button>
    )
  }

  return (
    <Link href={backHref ?? '/home'} className={styles.backButton} aria-label='홈으로 가기'>
      ←
    </Link>
  )
}


export function TargetPriceFanChart({
  consensus,
  dailyCloses,
  seedKey,
}: {
  consensus: NonNullable<LoadingQuickFact['consensus']>
  dailyCloses?: Array<number | null | undefined>
  seedKey?: string
}) {
  const geometry = useMemo(() => {
    const current = consensus.currentPriceValue
    const target = consensus.targetPriceValue
    if (!isFiniteNumber(current) || current <= 0 || !isFiniteNumber(target) || target <= 0) {
      return null
    }
    const volatility = estimateDailyVolatility(dailyCloses ?? [])
    return buildConsensusFanGeometry({
      currentPrice: current,
      averageTarget: target,
      highTarget: consensus.highTargetValue,
      lowTarget: consensus.lowTargetValue,
      recentCloses: dailyCloses,
      volatility,
      seed: seedKey ?? `${current}|${target}`,
    })
  }, [consensus.currentPriceValue, consensus.targetPriceValue, consensus.highTargetValue, consensus.lowTargetValue, dailyCloses, seedKey])

  if (!geometry) {
    return null
  }

  const curveClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanHighPath,
    average: styles.consensusFanTargetPath,
    low: styles.consensusFanLowPath,
  }
  const dotClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanHighDot,
    average: styles.consensusFanTargetDot,
    low: styles.consensusFanLowDot,
  }
  const legendClass: Record<'high' | 'average' | 'low', string> = {
    high: styles.consensusFanLegendHigh,
    average: styles.consensusFanLegendTarget,
    low: styles.consensusFanLegendLow,
  }
  const legendLabel: Record<'high' | 'average' | 'low', string> = {
    high: '최고',
    average: '평균',
    low: '최저',
  }
  const legendOrder: Array<'high' | 'average' | 'low'> = ['average', 'high', 'low']
  const activeKeys = new Set(geometry.curves.map((c) => c.key))

  return (
    <div className={styles.consensusFanWrap}>
      <svg className={styles.consensusFanChart} viewBox='0 0 300 120' role='img' aria-label='현재가에서 목표가까지 예상 경로'>
        {geometry.recentPath ? (
          <path className={styles.consensusFanCurrentPath} d={geometry.recentPath} />
        ) : (
          <line className={styles.consensusFanCurrentLine} x1={geometry.leftX} y1={geometry.currentY} x2={geometry.fanStartX} y2={geometry.currentY} />
        )}
        {geometry.curves.map((curve) => (
          <path key={`path-${curve.key}`} className={curveClass[curve.key]} d={curve.pathD} pathLength={1} />
        ))}
        {geometry.curves.map((curve) => (
          <circle key={`dot-${curve.key}`} className={dotClass[curve.key]} cx={geometry.rightX} cy={curve.dotY} r='3.6' />
        ))}
      </svg>
      <div className={styles.consensusFanLegend}>
        <span className={styles.consensusFanLegendCurrent}><i />현재가</span>
        {legendOrder.filter((key) => activeKeys.has(key)).map((key) => (
          <span key={`legend-${key}`} className={legendClass[key]}><i />{legendLabel[key]}</span>
        ))}
      </div>
    </div>
  )
}


export function QuickFactCard({
  fact,
}: {
  fact: LoadingQuickFact
}) {
  const indicator = fact.indicator

  return (
    <article className={cn(styles.quickFact, fact.key === 'week52-position' ? styles.positionQuickFact : undefined)}>
      <div className={styles.narrativeTags}>
        <span className={cn(styles.narrativeTag, narrativeToneClass(quickFactToneToNarrativeTone(fact.tone)))}>{fact.category}</span>
        <span className={cn(styles.narrativeTag, fact.key === 'week52-position' ? styles.positionSegmentBadge : narrativeToneClass(quickFactToneToNarrativeTone(fact.tone)))}>{fact.badge}</span>
      </div>
      <p className={styles.quickFactDetail}>{fact.body}</p>
      {fact.detail ? <p className={styles.positionDeltaLine}>{fact.detail}</p> : null}
      {indicator ? (
        <div className={styles.positionIndicator} aria-label={`${fact.category}: ${indicator.leftLabel}부터 ${indicator.rightLabel} 사이 ${indicator.markerLabel ?? '현재 위치'}`}>
          <div className={styles.positionScale} aria-hidden='true'>
            <span className={styles.positionTrack} />
            <span className={styles.positionMarker} style={{ top: `${100 - indicator.positionPct}%` }}>
              <span className={styles.positionLeader} />
              <span className={styles.positionMarkerDot} />
            </span>
          </div>
          <div className={styles.positionReadout}>
            <span className={styles.positionHighLabel}>{indicator.rightLabel}</span>
            <span className={styles.positionLowLabel}>{indicator.leftLabel}</span>
            <span className={styles.positionCurrentCallout} style={{ top: `${100 - indicator.positionPct}%` }}>
              <strong>{indicator.markerLabel ?? '현재 위치'}</strong>
              {indicator.deltaLabels?.length ? <span className={styles.positionDeltaLine}>{indicator.deltaLabels.join(' · ')}</span> : null}
            </span>
          </div>
        </div>
      ) : null}
    </article>
  )
}


export function TodayBriefingItem({
  at,
  elapsedSeconds,
  icon,
  question,
  data,
  meaning,
  forceReady = false,
}: {
  at: number
  elapsedSeconds: number
  icon: LucideIcon
  question: string
  data: ReactNode
  meaning: ReactNode
  forceReady?: boolean
}) {
  const Icon = icon
  const isVisible = forceReady || elapsedSeconds >= at
  const isContentReady = isDeepScanBriefingItemContentReady({
    elapsedSeconds,
    revealAtSeconds: at,
    skeletonSeconds: TODAY_BRIEFING_SKELETON_SECONDS,
    forceReady,
  })

  return (
    <article className={cn(styles.todayBriefItem, isVisible ? styles.todayBriefItemIn : undefined)} data-today-briefing-item='true'>
      <div className={styles.todayBriefQuestionRow}>
        <span className={styles.todayBriefIcon} aria-hidden='true'><Icon className='size-[13px]' /></span>
        <span className={styles.todayBriefQuestion}>{question}</span>
      </div>
      <div className={cn(styles.todayBriefBody, isVisible ? styles.todayBriefBodyIn : undefined)}>
        <div className={cn(styles.todayBriefBodyContent, isContentReady ? styles.todayBriefBodyContentIn : undefined)}>
          <div className={styles.todayBriefData}>{data}</div>
          <p className={styles.todayBriefMeaning}>{meaning}</p>
        </div>
        <div className={cn(styles.todayBriefSkeleton, isContentReady ? styles.todayBriefSkeletonOut : undefined)} aria-hidden='true'>
          <span className={styles.todayBriefSkeletonBar} />
          <span className={styles.todayBriefSkeletonBar} />
        </div>
      </div>
    </article>
  )
}


export function buildMarketMeaning(firstPct: number | null, secondPct: number | null, stockPct: number | null) {
  if (!isFiniteNumber(stockPct)) {
    return '내 종목의 장중 등락률을 확인하는 중이에요.'
  }

  const marketValues = [firstPct, secondPct].filter(isFiniteNumber)
  if (marketValues.length === 0) {
    return '시장 지수와 내 종목 흐름을 맞춰 보는 중이에요.'
  }

  const marketAverage = marketValues.reduce((sum, value) => sum + value, 0) / marketValues.length
  if (stockPct >= marketAverage + 0.5) {
    return '시장보다 더 강하게 움직이고 있어요.'
  }

  if (stockPct <= marketAverage - 0.5) {
    return '시장 흐름 대비 아직 덜 따라온 상태예요.'
  }

  return '시장 흐름과 비슷한 속도로 움직이고 있어요.'
}

export function TodayMarketBriefing({
  at,
  elapsedSeconds,
  firstLabel,
  firstPct,
  secondLabel,
  secondPct,
  stockPct,
  forceReady = false,
}: {
  at: number
  elapsedSeconds: number
  firstLabel: string
  firstPct: number | null
  secondLabel: string
  secondPct: number | null
  stockPct: number | null
  forceReady?: boolean
}) {
  const isVisible = forceReady || elapsedSeconds >= at
  const isContentReady = isDeepScanBriefingItemContentReady({
    elapsedSeconds,
    revealAtSeconds: at,
    skeletonSeconds: TODAY_BRIEFING_SKELETON_SECONDS,
    forceReady,
  })
  const firstPctLabel = formatPercentValue(firstPct) ?? '확인 중'
  const secondPctLabel = formatPercentValue(secondPct) ?? '확인 중'
  const stockLabel = formatPercentValue(stockPct) ?? '확인 중'

  return (
    <article className={cn(styles.todayBriefItem, isVisible ? styles.todayBriefItemIn : undefined)} data-today-briefing-item='true'>
      <div className={styles.todayBriefQuestionRow}>
        <span className={styles.todayBriefIcon} aria-hidden='true'><Landmark className='size-[13px]' /></span>
        <span className={styles.todayBriefQuestion}>오늘 시장 속에서는?</span>
      </div>
      <div className={cn(styles.todayBriefBody, isVisible ? styles.todayBriefBodyIn : undefined)}>
        <div className={cn(styles.todayBriefBodyContent, isContentReady ? styles.todayBriefBodyContentIn : undefined)}>
          <div className={styles.todayMarketGrid}>
            <div className={styles.todayMarketCell}><span>{firstLabel}</span><b className={pctToneClass(firstPct)}>{firstPctLabel}</b></div>
            <div className={styles.todayMarketCell}><span>{secondLabel}</span><b className={pctToneClass(secondPct)}>{secondPctLabel}</b></div>
            <div className={`${styles.todayMarketCell} ${styles.todayMarketCellMe}`}><span>내 종목</span><b className={pctToneClass(stockPct)}>{stockLabel}</b></div>
          </div>
          <p className={styles.todayBriefMeaning}><b>{buildMarketMeaning(firstPct, secondPct, stockPct)}</b></p>
        </div>
        <div className={cn(styles.todayBriefSkeleton, isContentReady ? styles.todayBriefSkeletonOut : undefined)} aria-hidden='true'>
          <span className={styles.todayBriefSkeletonBar} />
          <span className={styles.todayBriefSkeletonBar} />
        </div>
      </div>
    </article>
  )
}


export function TodayBriefingCard({
  currentPriceText,
  currentPriceCurrency,
  averagePriceText,
  averagePriceCurrency,
  usdKrwRate,
  sharesText,
  profitRateText,
  profitAmountText,
  forceReady = false,
  elapsedSeconds,
  briefingSnapshot,
  tradingVolumeText,
  consensus,
  dailyCloses,
  seedKey,
}: {
  currentPriceText: string | null
  currentPriceCurrency: MoneyCurrency
  averagePriceText: string | null
  averagePriceCurrency: MoneyCurrency
  usdKrwRate?: number | null
  sharesText: string | null
  profitRateText: string | null
  profitAmountText: string | null
  forceReady?: boolean
  elapsedSeconds: number
  briefingSnapshot?: LoadingBriefingSnapshot | null
  tradingVolumeText?: string | null
  consensus?: LoadingQuickFact['consensus']
  dailyCloses?: Array<number | null | undefined>
  seedKey?: string
}) {
  const todayBriefListRef = useRef<HTMLDivElement | null>(null)
  const quote = briefingSnapshot?.quote
  const averagePriceValue = parseNumericValue(averagePriceText ?? undefined)
  const chartAveragePriceValue = normalizeMoneyValueToCurrency(
    averagePriceValue,
    averagePriceCurrency,
    currentPriceCurrency,
    usdKrwRate,
  )
  const sharesValue = parseNumericValue(sharesText ?? undefined)
  const briefingModel = (() => {
    const dailyRows = (briefingSnapshot?.daily ?? []).filter((row) => isFiniteNumber(row.close))
    const latestRow = getLatestBriefingDailyRow(dailyRows)
    const previousRow = getPreviousBriefingDailyRow(dailyRows)
    const displayCurrentPriceValue = parseNumericValue(currentPriceText ?? undefined)
    const currentPriceValue = resolveDeepScanBriefingCardCurrentPrice({
      displayCurrentPrice: displayCurrentPriceValue,
      briefingQuotePrice: quote?.currentPrice,
      latestClose: latestRow?.close,
    }) ?? null
    const oneMonthPct = calculateBriefingOneMonthChangePct(dailyRows)
    const shortStreak = calculateBriefingShortStreak(dailyRows)
    const todayFlow = buildTodayFlow({
      current: currentPriceValue,
      open: quote?.openPrice ?? latestRow?.open ?? null,
      high: quote?.highPrice ?? latestRow?.high ?? null,
      low: quote?.lowPrice ?? latestRow?.low ?? null,
    })
    const volume = quote?.volume ?? latestRow?.volume ?? null
    const previousVolume = quote?.previousVolume ?? previousRow?.volume ?? null
    const volumeRatio = isFiniteNumber(volume) && isFiniteNumber(previousVolume) && previousVolume > 0 ? volume / previousVolume : null
    const chartRows = dailyRows.slice(-60)
    const chartRowsWithDisplayPrice = isFiniteNumber(currentPriceValue) && chartRows.length > 0
      ? chartRows.map((row, index) => index === chartRows.length - 1 ? { ...row, close: currentPriceValue } : row)
      : chartRows
    const chart = buildChartGeometry(chartRowsWithDisplayPrice, chartAveragePriceValue)

    return {
      currentPriceValue,
      latestRow,
      oneMonthPct,
      shortStreak,
      todayFlow,
      volumeRatio,
      chart,
    }
  })()
  const currentPriceValue = briefingModel.currentPriceValue
  const sameMoneyCurrency = currentPriceCurrency === averagePriceCurrency
  const displayCurrentPrice = currentPriceText ?? formatMoney(currentPriceValue ?? undefined, currentPriceCurrency) ?? '현재가 확인 중'
  const displayAveragePrice = averagePriceText ?? '평단 확인 중'
  const displayChartAveragePrice = (
    chartAveragePriceValue !== null && chartAveragePriceValue !== averagePriceValue
      ? formatMoney(chartAveragePriceValue, currentPriceCurrency)
      : displayAveragePrice
  ) ?? '확인 중'
  const chartAverageLabel = chartAveragePriceValue !== null && chartAveragePriceValue !== averagePriceValue ? '환산 평단' : '내 평단'
  const chartContextLabel = chartAverageLabel === '환산 평단' ? '최근 3개월 · 점선은 환산 평단' : '최근 3개월 · 점선은 내 평단'
  const displayShares = sharesText ?? '수량 확인 중'
  const comparableAveragePriceValue = sameMoneyCurrency ? averagePriceValue : chartAveragePriceValue
  const canCompareCostBasis = isFiniteNumber(currentPriceValue) && isFiniteNumber(comparableAveragePriceValue) && comparableAveragePriceValue !== 0
  const calculatedProfitRate = canCompareCostBasis
    ? ((currentPriceValue / comparableAveragePriceValue) - 1) * 100
    : null
  const calculatedProfitAmount = canCompareCostBasis && isFiniteNumber(sharesValue)
    ? (currentPriceValue - comparableAveragePriceValue) * sharesValue
    : null
  const profitRateFromBroker = parseNumericValue(profitRateText ?? undefined)
  const displayProfitRate = formatSignedPercent(calculatedProfitRate ?? undefined) ?? profitRateText ?? '계산 중'
  const displayProfitAmount = formatSignedMoney(calculatedProfitAmount, currentPriceCurrency) ?? profitAmountText ?? '계산 중'
  const oneMonthPct = briefingModel.oneMonthPct
  const oneMonthLabel = formatPercentValue(oneMonthPct)
  const shortStreak = briefingModel.shortStreak
  const streakLabel = shortStreak.direction === 'up'
    ? `${shortStreak.count}일 연속 상승`
    : shortStreak.direction === 'down'
      ? `${shortStreak.count}일 연속 하락`
      : '전일과 비슷한 흐름'
  const positionPct = calculatedProfitRate ?? profitRateFromBroker
  const needToBreakeven = canCompareCostBasis && currentPriceValue < comparableAveragePriceValue
    ? ((comparableAveragePriceValue / currentPriceValue) - 1) * 100
    : null
  const breakevenGap = canCompareCostBasis
    ? Math.abs(comparableAveragePriceValue - currentPriceValue)
    : null
  const breakevenGapText = breakevenGap !== null ? formatMoney(breakevenGap, currentPriceCurrency) : null
  const breakevenRecoveryText = breakevenGapText
    ? currentPriceCurrency === 'USD' ? `${breakevenGapText} 더 오르면 원금 회복이에요.` : `${breakevenGapText}만 오르면 원금 회복이에요.`
    : '조금만 더 오르면 원금 회복이에요.'
  const positionLabel = isFiniteNumber(positionPct)
    ? canCompareCostBasis
      ? positionPct >= 0
        ? `${chartAverageLabel}보다 ${formatPercentValue(positionPct)}`
        : isFiniteNumber(needToBreakeven) ? `본전까지 ${formatPercentValue(needToBreakeven)}` : `손실률 ${formatPercentValue(positionPct)}`
      : `보유 수익률 ${formatPercentValue(positionPct)}`
    : sameMoneyCurrency ? '평단 위치 계산 중' : '환산 평단 확인 중'
  const positionMeaning = isFiniteNumber(positionPct)
    ? canCompareCostBasis
      ? positionPct >= 0
        ? chartAverageLabel === '환산 평단'
          ? `원화 평단 ${displayAveragePrice}을 ${displayChartAveragePrice}로 환산하면 현재가가 평단 위예요.`
          : '지금 가격은 평단 위라 수익 구간이에요.'
        : breakevenRecoveryText
      : `보유 화면에서 확인한 수익률 기준으로 ${positionPct >= 0 ? '수익' : '손실'} 구간이에요.`
    : sameMoneyCurrency ? '현재가와 평단을 맞춰 보는 중이에요.' : '현재가는 달러, 평단은 원화 기준이라 환율 환산 후 비교해야 해요.'
  const todayFlow = briefingModel.todayFlow
  const volumeRatio = briefingModel.volumeRatio
  const volumeRatioLabel = isFiniteNumber(volumeRatio) ? `어제의 ${formatNumber(volumeRatio)}배` : '거래량 확인 중'
  const volumeMeaning = isFiniteNumber(volumeRatio)
    ? volumeRatio >= 1.3
      ? '평소보다 관심이 붙은 하루예요.'
      : volumeRatio >= 0.8
        ? '어제와 비슷한 수준으로 거래되고 있어요.'
        : '어제보다는 거래가 차분한 편이에요.'
    : '거래량 비교 데이터를 불러오는 중이에요.'
  const chart = briefingModel.chart
  const briefStartSeconds = Array.from(
    { length: TODAY_BRIEFING_ITEM_COUNT },
    (_, index) => TODAY_BRIEFING_FIRST_REVEAL_SECONDS + index * TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS,
  )
  const consensusAt = TODAY_BRIEFING_FIRST_REVEAL_SECONDS + TODAY_BRIEFING_ITEM_COUNT * TODAY_BRIEFING_ITEM_REVEAL_INTERVAL_SECONDS
  const visibleBriefingItemCount = getVisibleDeepScanBriefingItemCount(elapsedSeconds, briefStartSeconds, { forceReady })

  useEffect(() => (
    startTodayBriefingMobileAutoScroll(todayBriefListRef.current, visibleBriefingItemCount)
  ), [visibleBriefingItemCount])

  return (
    <section className={styles.todayBriefingCard} aria-label='오늘 장 기준 시세 브리핑'>
      <div className={styles.todayBriefingHead}>
        <div className={styles.todayLiveLabel}><span className={styles.todayLiveDot} />오늘 장 기준 · {formatAsOfTime(quote?.asOf ?? briefingSnapshot?.asOf)}</div>
        <div className={styles.todayPriceRow}>
          <div>
            <div className={styles.todayPrice}>{displayCurrentPrice}</div>
            <div className={styles.todayPriceSub}>평단 {displayAveragePrice} · {displayShares} · 거래량 {tradingVolumeText ?? '확인 중'}</div>
          </div>
          <div className={styles.todayProfitBox}>
            <div className={cn(styles.todayProfitRate, financialToneClass(calculatedProfitRate ?? profitRateText))}>{displayProfitRate}</div>
            <div className={cn(styles.todayProfitAmount, financialToneClass(calculatedProfitAmount ?? profitAmountText))}>{displayProfitAmount}</div>
          </div>
        </div>
      </div>

      <div className={styles.todayChartWrap}>
        <div className={styles.todayChartLabel}>
          <span>{chartContextLabel}</span>
          <span>일봉</span>
        </div>
        {chart.hasData ? (
          <svg className={styles.todayChartSvg} viewBox='0 0 300 120' aria-label='최근 3개월 일봉 차트'>
            <path className={cn(styles.todayChartArea, chart.isProfit === false ? styles.todayChartToneLoss : styles.todayChartToneProfit)} d={chart.areaPath} />
            <path className={cn(styles.todayChartLine, chart.isProfit === false ? styles.todayChartToneLoss : styles.todayChartToneProfit)} d={chart.linePath} pathLength={1} />
            <line className={styles.todayAvgLine} x1='4' y1={chart.averageY} x2='296' y2={chart.averageY} />
              <text className={styles.todayAvgText} x='296' y={Math.max(12, chart.averageY - 6)} textAnchor='end'>{chartAverageLabel} {displayChartAveragePrice.replace(/원$/u, '')}</text>
            <circle className={cn(styles.todayChartDot, chart.isProfit === false ? styles.todayChartToneLoss : styles.todayChartToneProfit)} cx={chart.lastPoint.x} cy={chart.lastPoint.y} r='3' />
            <circle className={cn(styles.todayChartRing, chart.isProfit === false ? styles.todayChartToneLoss : styles.todayChartToneProfit)} cx={chart.lastPoint.x} cy={chart.lastPoint.y} r='7' />
          </svg>
        ) : (
          <div className={styles.todayChartEmpty} role='status'>차트 데이터를 확인하는 중이에요</div>
        )}

      </div>

      <div className={styles.todayBriefList} ref={todayBriefListRef}>
        <TodayBriefingItem at={briefStartSeconds[0]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon={Calendar} question='최근 한 달, 어떻게 흘러왔나요?' data={<span className={pctToneClass(oneMonthPct)}>{oneMonthLabel ? `한 달 전보다 ${oneMonthLabel}` : '한 달 흐름 계산 중'}</span>} meaning={buildOneMonthMeaning(oneMonthPct)} />
        <TodayBriefingItem at={briefStartSeconds[1]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon={TrendingUp} question='단기 흐름은요?' data={<span className={shortStreak.direction === 'up' ? styles.todayUp : shortStreak.direction === 'down' ? styles.todayDown : styles.todayBlue}>{streakLabel}</span>} meaning={shortStreak.direction === 'up' ? '짧게 봐도 흐름이 살아나고 있어요.' : shortStreak.direction === 'down' ? '단기적으로는 숨 고르기가 이어지고 있어요.' : '아직 한쪽 방향으로 강하게 기울지는 않았어요.'} />
        <TodayBriefingItem at={briefStartSeconds[2]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon={Target} question='내 자리는 어디쯤일까요?' data={<span className={financialToneClass(positionPct)}>{positionLabel}</span>} meaning={<><b>{positionMeaning}</b></>} />
        <TodayMarketBriefing
          at={briefStartSeconds[3]}
          elapsedSeconds={elapsedSeconds}
          forceReady={forceReady}
          firstLabel={briefingSnapshot?.market?.sp500 ? 'S&P 500' : '코스피'}
          firstPct={briefingSnapshot?.market?.sp500?.changePct ?? briefingSnapshot?.market?.kospi?.changePct ?? null}
          secondLabel={briefingSnapshot?.market?.nasdaq ? 'NASDAQ' : '코스닥'}
          secondPct={briefingSnapshot?.market?.nasdaq?.changePct ?? briefingSnapshot?.market?.kosdaq?.changePct ?? null}
          stockPct={quote?.changePct ?? briefingModel.latestRow?.changePct ?? null}
        />
        <TodayBriefingItem at={briefStartSeconds[4]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon={BarChart3} question='오늘 하루는 어땠나요?' data={<span className={todayFlow.tone === 'positive' ? styles.todayUp : todayFlow.tone === 'negative' ? styles.todayDown : styles.todayBlue}>{todayFlow.label}</span>} meaning={todayFlow.meaning} />
        <TodayBriefingItem at={briefStartSeconds[5]} elapsedSeconds={elapsedSeconds} forceReady={forceReady} icon={Flame} question='거래는 활발했나요?' data={<span className={isFiniteNumber(volumeRatio) && volumeRatio >= 1 ? styles.todayBlue : styles.todayDown}>{volumeRatioLabel}</span>} meaning={volumeMeaning} />
        {consensus ? (
          <article
            className={cn(styles.todayBriefItem, (forceReady || elapsedSeconds >= consensusAt) ? styles.todayBriefItemIn : undefined, styles.todayBriefConsensusItem)}
            data-today-briefing-item='true'
          >
            <div className={styles.todayBriefQuestionRow}>
              <span className={styles.todayBriefIcon} aria-hidden='true'><Telescope className='size-[13px]' /></span>
              <span className={styles.todayBriefQuestion}>애널리스트 목표가는 어디쯤일까?</span>
            </div>
            {forceReady || elapsedSeconds >= consensusAt + TODAY_BRIEFING_DATA_REVEAL_DELAY_SECONDS ? (
              <div className={styles.consensusInsight}>
                <div className={styles.consensusChartTop}>
                  <div>
                    <span className={styles.consensusEyebrow}>{consensus.analystCountLabel ?? 'TARGET VIEW'}</span>
                    <strong>{consensus.targetPriceLabel}</strong>
                  </div>
                  {consensus.upsideLabel ? <span>{consensus.upsideLabel}</span> : null}
                </div>
                <TargetPriceFanChart consensus={consensus} dailyCloses={dailyCloses} seedKey={seedKey} />
                <dl className={styles.consensusStats}>
                  {consensus.currentPriceLabel ? (<div className={styles.consensusStat}><dt>현재가</dt><dd>{consensus.currentPriceLabel}</dd></div>) : null}
                  {consensus.opinionLabel ? (<div className={styles.consensusStat}><dt>투자의견</dt><dd>{consensus.opinionLabel}</dd></div>) : null}
                  {consensus.highTargetLabel ? (<div className={styles.consensusStat}><dt>최고</dt><dd>{consensus.highTargetLabel}</dd></div>) : null}
                  {consensus.lowTargetLabel ? (<div className={styles.consensusStat}><dt>최저</dt><dd>{consensus.lowTargetLabel}</dd></div>) : null}
                </dl>
                {consensus.summary ? <p className={styles.consensusSummary}>{consensus.summary}</p> : null}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  )
}
