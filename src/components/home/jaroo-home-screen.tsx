'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Treemap, type PieLabelRenderProps, type TreemapNode } from 'recharts'
import { DeepScanLoadingScreen } from '@/components/deepscan-loading-screen'
import { shouldUseDeepScanLoadingHandoff } from '@/lib/deepscan-navigation'
import { pickDeepScanDefaultHolding } from '@/lib/deepscan-target'
import { prefetchAndPersistDeepScanSlimSummary } from '@/lib/deepscan-slim'
import {
  applyCurrentQuotesToHomeHoldings,
  buildHomeCurrentQuoteQuery,
  buildHomeHoldingErrorCard,
  buildQuoteLookupKey,
  requiresFxConversion,
  shouldTreatQuoteFailureAsErrorCard,
  resolveAveragePriceCurrency,
  type CurrentQuoteItem,
  type HomeHoldingQuoteErrorKind,
} from '@/lib/home-current-quotes'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { cn } from '@/lib/utils'
import {
  buildHomeHoldingsFromPortfolioItems,
  homeForecast as defaultHomeForecast,
  momentumSignals as defaultMomentumSignals,
  momentumStages as defaultMomentumStages,
  portfolioScoreBreakdown as defaultPortfolioScoreBreakdown,
  type HomeBadgeTone,
  type HomeHolding,
  type HomeMetricTone,
} from '@/lib/jaroo-home-data'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import { toDeepScanTargetInput } from '@/lib/workflow-types'
import styles from './jaroo-home-screen.module.css'

const DONUT_CHART_SIZE = 210

type ViewMode = 'donut' | 'heatmap'
type SheetMode = 'score' | 'momentum' | null
type ScoreBreakdownItem = (typeof defaultPortfolioScoreBreakdown)[number]
type MomentumSignalItem = (typeof defaultMomentumSignals)[number]
type ForecastCard = typeof defaultHomeForecast
type DonutChartDatum = HomeHolding & { value: number }
type HeatmapChartDatum = HomeHolding & { value: number; name: string }
type DeepScanLoadingTarget = {
  name: string
  identifier?: string
}

type PortfolioSummary = {
  score: string
  badge: string
  badgeTone: HomeBadgeTone
  summaryText: string
  momentumValue: string
  forecast: ForecastCard
  scoreBreakdown: ScoreBreakdownItem[]
  momentumSignals: MomentumSignalItem[]
  momentumStages: typeof defaultMomentumStages
}

type PortfolioStoreItem = ReturnType<typeof usePortfolioStore.getState>['items'][number]

function stripPortfolioQuoteFields(item: PortfolioStoreItem) {
  const { currentPrice, currentProfitRate, currentPriceCurrency, ...baseItem } = item
  void currentPrice
  void currentProfitRate
  void currentPriceCurrency
  return baseItem
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getHoldingChangeValue(item: HomeHolding) {
  return parseOcrNumber(item.change)
}

function getValueToneClass(item: HomeHolding) {
  const changeValue = getHoldingChangeValue(item)

  if (changeValue === null) {
    return undefined
  }

  if (changeValue > 0) {
    return styles.valuePositive
  }

  return styles.valueDanger
}

function getHeatmapChipStyle(item: HomeHolding) {
  if (item.badgeTone === 'green') {
    return { background: 'rgba(29,158,117,.28)', color: '#C7F0E0' }
  }

  if (item.badgeTone === 'red') {
    return { background: 'rgba(226,75,74,.35)', color: '#F7C1C1' }
  }

  return { background: 'rgba(239,159,39,.3)', color: '#FAC775' }
}

function getHeatmapChangeText(item: HomeHolding) {
  if (item.heatmapMeta) {
    return item.heatmapChange ? `${item.heatmapChange} · ${item.heatmapMeta}` : item.heatmapMeta
  }

  return item.heatmapChange ?? ''
}

function getHoldingIdentifierText(item: HomeHolding) {
  const identifiers = [item.identifierTicker, item.identifierCode].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  )

  return identifiers.length > 0 ? identifiers.join(' · ') : item.identifierLabel
}

function buildPortfolioSummary(holdings: HomeHolding[], isAppliedPortfolio: boolean): PortfolioSummary {
  if (!isAppliedPortfolio) {
    return {
      score: '54',
      badge: '주의',
      badgeTone: 'amber',
      summaryText: '1개 종목이\n위험해요',
      momentumValue: '나아지는 중 ↑',
      forecast: defaultHomeForecast,
      scoreBreakdown: defaultPortfolioScoreBreakdown,
      momentumSignals: defaultMomentumSignals,
      momentumStages: defaultMomentumStages,
    }
  }

  const changeValues = holdings.map(getHoldingChangeValue).filter((value): value is number => value !== null)
  const avgChange = changeValues.length > 0 ? changeValues.reduce((sum, value) => sum + value, 0) / changeValues.length : 0
  const negativeCount = changeValues.filter((value) => value < 0).length
  const positiveCount = changeValues.filter((value) => value >= 0).length
  const scoreNumber = clamp(Math.round(60 + avgChange), 0, 99)
  const worstHolding = [...holdings].sort((left, right) => (getHoldingChangeValue(left) ?? 0) - (getHoldingChangeValue(right) ?? 0))[0] ?? holdings[0]
  const dominantHolding = [...holdings].sort((left, right) => right.donutPercent - left.donutPercent)[0] ?? holdings[0]
  const bestHolding = [...holdings].sort((left, right) => (getHoldingChangeValue(right) ?? -999) - (getHoldingChangeValue(left) ?? -999))[0] ?? holdings[0]
  const scoreBadgeTone: HomeBadgeTone = negativeCount > 0 ? (negativeCount >= Math.ceil(holdings.length / 2) ? 'red' : 'amber') : 'green'
  const scoreBadge = scoreBadgeTone === 'green' ? '양호' : scoreBadgeTone === 'red' ? '주의' : '관찰'
  const summaryText = negativeCount > 0 ? `${negativeCount}개 종목이\n손실 구간이에요` : `${positiveCount}개 종목이\n수익 중이에요`
  const forecastBody = `${holdings.length}개 OCR 종목을 홈에 적용했어요. ${worstHolding?.name ?? holdings[0]?.name} ${worstHolding?.change ?? ''} 상태를 먼저 확인해보세요.`

  const scoreBreakdown: ScoreBreakdownItem[] = [
    {
      label: '비중 집중도',
      score: `${clamp(Math.round((dominantHolding?.donutPercent ?? 0) * 100), 0, 100)} / 100`,
      scoreColor: dominantHolding?.donutColor ?? '#185FA5',
      barWidth: `${Math.max(12, Math.round((dominantHolding?.donutPercent ?? 0) * 100))}%`,
      barColor: dominantHolding?.donutColor ?? '#185FA5',
      description: `${dominantHolding?.name ?? '-'} 비중이 가장 커요. 홈 도넛과 히트맵도 이 비중을 기준으로 다시 그려졌어요.`,
      stocks: holdings.slice(0, 4).map((item) => ({ label: `${item.name} ${item.heatmapWeight}`, dot: item.donutColor })),
    },
    {
      label: '손익 상태',
      score: `${Math.max(0, 100 - negativeCount * 20)} / 100`,
      scoreColor: negativeCount > 0 ? '#A32D2D' : '#3B6D11',
      barWidth: `${clamp(100 - negativeCount * 20, 15, 100)}%`,
      barColor: negativeCount > 0 ? '#E24B4A' : '#639922',
      description: negativeCount > 0 ? `${negativeCount}개 종목이 손실 구간이에요. 가장 약한 종목은 ${worstHolding?.name ?? '-'}예요.` : '현재 인식된 종목은 모두 수익 또는 보합 구간이에요.',
      stocks: holdings.slice(0, 4).map((item) => ({
        label: `${item.name} ${item.change}`,
        dot: item.donutColor,
        background: getHoldingChangeValue(item) !== null && (getHoldingChangeValue(item) ?? 0) < 0 ? '#FCEBEB' : '#EAF3DE',
        color: getHoldingChangeValue(item) !== null && (getHoldingChangeValue(item) ?? 0) < 0 ? '#A32D2D' : '#3B6D11',
      })),
    },
    {
      label: '회복 모멘텀',
      score: `${clamp(Math.round(avgChange + 50), 0, 100)} / 100`,
      scoreColor: avgChange >= 0 ? '#3B6D11' : '#854F0B',
      barWidth: `${clamp(Math.round(avgChange + 50), 15, 100)}%`,
      barColor: avgChange >= 0 ? '#639922' : '#EF9F27',
      description: avgChange >= 0 ? `평균 수익률이 ${avgChange.toFixed(1)}%예요. ${bestHolding?.name ?? '-'} 흐름이 가장 좋아요.` : `평균 수익률이 ${avgChange.toFixed(1)}%예요. OCR 적용 후 약한 종목부터 우선 확인하는 게 좋아요.`,
      stocks: holdings.slice(0, 4).map((item) => ({ label: `${item.name} · ${item.change}`, dot: item.donutColor })),
    },
    {
      label: '적용 상태',
      score: `${holdings.length * 10} / 100`,
      scoreColor: '#185FA5',
      barWidth: `${clamp(holdings.length * 18, 15, 100)}%`,
      barColor: '#185FA5',
      description: `merge에서 확정한 ${holdings.length}개 종목이 홈에 적용됐어요. 부족한 분석 필드는 placeholder로 채워 안정적으로 보여줘요.`,
      stocks: holdings.slice(0, 4).map((item) => ({ label: `${item.name} 적용 완료`, dot: item.donutColor })),
    },
  ]

  const momentumSignals: MomentumSignalItem[] = holdings.slice(0, 4).map((item) => {
    const changeValue = getHoldingChangeValue(item)
    const positive = changeValue !== null && changeValue >= 0
    const danger = changeValue !== null && changeValue <= -20

    return {
      name: item.name,
      dot: item.donutColor,
      badge: positive ? '순풍' : danger ? '역풍' : '미풍',
      badgeBackground: positive ? '#EAF3DE' : danger ? '#FCEBEB' : '#f0efe8',
      badgeColor: positive ? '#3B6D11' : danger ? '#A32D2D' : '#888',
      description: positive
        ? `${item.name}는 현재 ${item.change}로 인식됐어요. 수익 구간 대응 전략을 이어서 볼 수 있어요.`
        : danger
          ? `${item.name}는 ${item.change} 손실 구간이에요. 우선순위 종목으로 먼저 점검하는 게 좋아요.`
          : `${item.name}는 ${item.change} 상태예요. 추가 변화가 있는지 계속 확인해보세요.`,
      blink: danger || undefined,
    }
  })

  const activeStageIndex = avgChange >= 8 ? 4 : avgChange >= 0 ? 3 : avgChange >= -10 ? 2 : avgChange >= -20 ? 1 : 0
  const momentumStages = defaultMomentumStages.map((stage, index) => ({
    ...stage,
    active: index === activeStageIndex,
  }))
  const momentumValue = avgChange >= 8 ? '빠르게 개선 중 ↑' : avgChange >= 0 ? '나아지는 중 ↑' : avgChange >= -10 ? '천천히 회복 중 →' : '경계 필요 ↓'

  return {
    score: String(scoreNumber),
    badge: scoreBadge,
    badgeTone: scoreBadgeTone,
    summaryText,
    momentumValue,
    forecast: {
      label: 'OCR APPLIED',
      body: forecastBody,
      cta: '딥스캔으로 상세 전략 보기 ›',
      href: '/deepscan',
    },
    scoreBreakdown,
    momentumSignals,
    momentumStages,
  }
}

function HeatmapTile({
  item,
  className,
  nameClassName,
  weightClassName,
  changeClassName,
  style,
  active = false,
  onClick,
}: {
  item: HomeHolding
  className?: string
  nameClassName?: string
  weightClassName?: string
  changeClassName?: string
  style?: React.CSSProperties
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      className={cn(styles.heatmapTile, className, active && styles.heatmapTileActive, item.blink && styles.blink)}
      style={{ background: item.heatmapBackground, ...style }}
      onClick={onClick}
    >
      <div className={cn(styles.heatmapWeight, weightClassName)}>{item.heatmapWeight}</div>
      <div className={cn(styles.heatmapName, nameClassName)}>{item.shortName || item.name}</div>
      <div className={cn(styles.heatmapChange, changeClassName)}>{getHeatmapChangeText(item)}</div>
      {item.heatmapBadge ? (
        <div className={cn(styles.heatmapChip, changeClassName && styles.heatmapChipTiny)} style={getHeatmapChipStyle(item)}>
          {item.heatmapBadge}
        </div>
      ) : null}
    </button>
  )
}

function badgeToneClass(tone: HomeBadgeTone) {
  switch (tone) {
    case 'red':
      return styles.dcBadgeRed
    case 'green':
      return styles.dcBadgeGreen
    default:
      return styles.dcBadgeAmber
  }
}

function marketToneClass(tone: HomeHolding['marketTone']) {
  switch (tone) {
    case 'kospi':
      return styles.marketKospi
    case 'kosdaq':
      return styles.marketKosdaq
    case 'nasdaq':
      return styles.marketNasdaq
    default:
      return styles.marketEtf
  }
}

function signalToneClass(tone: HomeHolding['signalTone']) {
  switch (tone) {
    case 'danger':
      return styles.signalDanger
    case 'warning':
      return styles.signalWarning
    case 'positive':
      return styles.signalPositive
    case 'halt':
      return styles.signalHalt
    default:
      return styles.signalEtf
  }
}

function metricToneClass(tone: HomeMetricTone) {
  switch (tone) {
    case 'danger':
      return styles.metricDanger
    case 'warning':
      return styles.metricWarning
    case 'positive':
      return styles.metricPositive
    case 'locked':
      return styles.metricLocked
    default:
      return styles.metricNeutral
  }
}

function actionToneClass(item: HomeHolding) {
  if (item.cardTone === 'halt') {
    return styles.buttonRed
  }

  if (item.cardTone === 'profit') {
    return styles.buttonGreen
  }

  return styles.buttonBlue
}

export function JarooHomeScreen() {
  const router = useRouter()
  const frameRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const deepScanNavigationIdRef = useRef(0)

  const portfolioItems = usePortfolioStore((state) => state.items)
  const quoteStatus = usePortfolioStore((state) => state.quoteStatus)
  const quoteErrorMessage = usePortfolioStore((state) => state.quoteErrorMessage)
  const quoteQueryKey = usePortfolioStore((state) => state.quoteQueryKey)
  const setQuoteStatus = usePortfolioStore((state) => state.setQuoteStatus)
  const patchQuote = usePortfolioStore((state) => state.patchQuote)
  const clearItemQuote = usePortfolioStore((state) => state.clearItemQuote)
  const setDeepScanTarget = useDeepScanStore((state) => state.setTarget)

  const [view, setView] = useState<ViewMode>('donut')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openStockCardId, setOpenStockCardId] = useState<number | null>(null)
  const [openEtfCardId, setOpenEtfCardId] = useState<number | null>(null)
  const [openSheet, setOpenSheet] = useState<SheetMode>(null)
  const [liveQuoteSnapshot, setLiveQuoteSnapshot] = useState<{ query: string; items: CurrentQuoteItem[] }>({ query: '', items: [] })
  const [usdKrwRate, setUsdKrwRate] = useState<number | null>(null)
  const [quoteFailureKinds, setQuoteFailureKinds] = useState<Record<string, HomeHoldingQuoteErrorKind>>({})
  const [quoteSummaryMessage, setQuoteSummaryMessage] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [deepScanLoadingTarget, setDeepScanLoadingTarget] = useState<DeepScanLoadingTarget | null>(null)

  const portfolioBaseItems = useMemo(() => portfolioItems.map((item) => stripPortfolioQuoteFields(item)), [portfolioItems])
  const portfolioSignature = useMemo(
    () => portfolioBaseItems.map((item) => [item.code, item.ticker, item.name, item.market, item.quantity, item.averagePrice, item.averagePriceCurrency].filter(Boolean).join('|')).join('||'),
    [portfolioBaseItems],
  )
  const hasPortfolioItems = portfolioBaseItems.length > 0
  const isAppliedPortfolio = hasPortfolioItems
  const rawHomeHoldings = useMemo(() => buildHomeHoldingsFromPortfolioItems(portfolioItems), [portfolioItems])
  const portfolioBaseItemsRef = useRef(portfolioBaseItems)
  const rawHomeHoldingsRef = useRef(rawHomeHoldings)
  const quoteQuery = useMemo(() => buildHomeCurrentQuoteQuery(rawHomeHoldings), [rawHomeHoldings])
  const quoteSurfaceEnabled = hasPortfolioItems && Boolean(quoteQuery)
  const quoteRunKey = `${portfolioSignature}::${quoteQuery}::${refreshVersion}`
  const hasUsHomeHoldings = useMemo(
    () => rawHomeHoldings.some((holding) => holding.marketTone === 'nasdaq' || Boolean(holding.identifierTicker)),
    [rawHomeHoldings],
  )

  const redirectReasonMessage = '홈 포트폴리오가 없어 /ocr 로 이동합니다.'

  useEffect(() => {
    if (hasPortfolioItems) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      router.replace('/ocr')
    }, 350)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasPortfolioItems, router])

  useEffect(() => {
    portfolioBaseItemsRef.current = portfolioBaseItems
    rawHomeHoldingsRef.current = rawHomeHoldings
  }, [portfolioBaseItems, rawHomeHoldings])

  useEffect(() => {
    if (!quoteSurfaceEnabled) {
      return
    }

    if (refreshVersion === 0 && quoteQueryKey === quoteQuery && (quoteStatus === 'loading' || quoteStatus === 'success')) {
      return
    }

    const abortController = new AbortController()

    const clearAllKnownQuotes = () => {
      for (const item of portfolioBaseItemsRef.current) {
        clearItemQuote({ code: item.code, ticker: item.ticker, name: item.name, market: item.market })
      }
    }

    const hydrateQuotes = async () => {
      setQuoteStatus('loading', null, quoteQuery)
      setQuoteSummaryMessage(null)
      setQuoteFailureKinds({})

      let nextFxRate: number | null = null
      let fxFetchFailed = false

      if (hasUsHomeHoldings) {
        try {
          const fxResponse = await fetch('/api/market/fx/usd-krw', { cache: 'no-store', signal: abortController.signal })
          const fxPayload = await fxResponse.json()
          const parsedRate = Number(fxPayload?.data?.rate)
          if (fxResponse.ok && Number.isFinite(parsedRate) && parsedRate > 0) {
            nextFxRate = parsedRate
          } else {
            fxFetchFailed = true
          }
        } catch {
          fxFetchFailed = true
        }
      }

      try {
        const response = await fetch(`/api/quotes/current?${quoteQuery}`, { cache: 'no-store', signal: abortController.signal })
        const payload = await response.json()

        if (abortController.signal.aborted) {
          return
        }

        if (!response.ok) {
          clearAllKnownQuotes()
          setLiveQuoteSnapshot({ query: quoteQuery, items: [] })
          setUsdKrwRate(nextFxRate)
          setQuoteStatus('error', '현재 시세를 불러오지 못했어요. 다시 시도해주세요.', quoteQuery)
          return
        }

        const nextItems: CurrentQuoteItem[] = Array.isArray(payload?.data?.items) ? payload.data.items : []
        const okItems = nextItems.filter((item) => item.status === 'ok' && typeof item.price === 'number')
        const nextHoldings = applyCurrentQuotesToHomeHoldings(rawHomeHoldingsRef.current, okItems, { usdKrwRate: hasUsHomeHoldings ? nextFxRate : null })
        const nextHoldingsById = new Map(nextHoldings.map((holding) => [holding.id, holding]))
        const responseByLookupKey = new Map<string, CurrentQuoteItem>()
        for (const item of nextItems) {
          const lookupKey = item.market === 'US'
            ? item.ticker?.trim().toUpperCase()
            : item.code?.trim()
          if (lookupKey) {
            responseByLookupKey.set(lookupKey, item)
          }
        }

        const nextFailureKinds: Record<string, HomeHoldingQuoteErrorKind> = {}

        for (const [index, item] of portfolioBaseItemsRef.current.entries()) {
          const homeHolding = rawHomeHoldingsRef.current[index]
          const itemKey = `${item.code ?? ''}|${item.ticker ?? ''}|${item.name}|${item.market ?? ''}`
          const lookupKey = homeHolding ? buildQuoteLookupKey(homeHolding) : undefined
          const quoteItem = lookupKey ? responseByLookupKey.get(lookupKey) : undefined

          if (!homeHolding || !homeHolding.name.trim()) {
            nextFailureKinds[itemKey] = 'holding-invalid'
            clearItemQuote({ code: item.code, ticker: item.ticker, name: item.name, market: item.market })
            continue
          }

          if (!quoteItem || quoteItem.status !== 'ok' || typeof quoteItem.price !== 'number') {
            if (shouldTreatQuoteFailureAsErrorCard(homeHolding, 'quote-unavailable')) {
              nextFailureKinds[itemKey] = 'quote-unavailable'
            }
            clearItemQuote({ code: item.code, ticker: item.ticker, name: item.name, market: item.market })
            continue
          }

          const quoteCurrency = quoteItem.currency === 'USD' || homeHolding.marketTone === 'nasdaq' ? 'USD' : 'KRW'
          const averagePriceCurrency = resolveAveragePriceCurrency(homeHolding, quoteCurrency, quoteItem, { usdKrwRate: nextFxRate })
          const requiresFx = requiresFxConversion(quoteCurrency, averagePriceCurrency)
          if (requiresFx && (fxFetchFailed || nextFxRate === null)) {
            nextFailureKinds[itemKey] = 'fx-required'
            clearItemQuote({ code: item.code, ticker: item.ticker, name: item.name, market: item.market })
            continue
          }

          const enrichedHolding = nextHoldingsById.get(homeHolding.id)
          patchQuote(
            { code: item.code, ticker: item.ticker, name: item.name, market: item.market },
            {
              currentPrice: quoteItem.price,
              currentPriceCurrency: quoteCurrency,
              currentProfitRate: parseOcrNumber(enrichedHolding?.change ?? '') ?? undefined,
            },
          )
        }

        setLiveQuoteSnapshot({ query: quoteQuery, items: nextItems })
        setUsdKrwRate(nextFxRate)
        setQuoteFailureKinds(nextFailureKinds)

        const failureCount = Object.keys(nextFailureKinds).length
        if (failureCount === rawHomeHoldingsRef.current.length) {
          setQuoteSummaryMessage(null)
          setQuoteStatus('error', '현재 시세를 불러오지 못했어요. 다시 시도해주세요.', quoteQuery)
          return
        }

        setQuoteSummaryMessage(
          failureCount > 0
            ? '일부 종목의 시세를 불러오지 못해 오류 카드로 표시했어요.'
            : null,
        )
        setQuoteStatus('success', null, quoteQuery)
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return
        }

        clearAllKnownQuotes()
        setLiveQuoteSnapshot({ query: quoteQuery, items: [] })
        setUsdKrwRate(nextFxRate)
        setQuoteFailureKinds({})
        setQuoteSummaryMessage(null)
        setQuoteStatus('error', '현재 시세를 불러오지 못했어요. 다시 시도해주세요.', quoteQuery)
      }
    }

    void hydrateQuotes()

    return () => {
      abortController.abort()
    }
  }, [clearItemQuote, hasUsHomeHoldings, patchQuote, quoteQuery, quoteQueryKey, quoteRunKey, quoteStatus, quoteSurfaceEnabled, refreshVersion, setQuoteStatus])

  const homeHoldings = useMemo(() => {
    const quoteApplied = applyCurrentQuotesToHomeHoldings(
      rawHomeHoldings,
      quoteQuery && liveQuoteSnapshot.query === quoteQuery ? liveQuoteSnapshot.items.filter((item) => item.status === 'ok' && typeof item.price === 'number') : [],
      { usdKrwRate: hasUsHomeHoldings ? usdKrwRate : null },
    )

    return quoteApplied.map((holding, index) => {
      const item = portfolioBaseItems[index]
      if (!item) {
        return buildHomeHoldingErrorCard(holding, 'holding-invalid')
      }

      const itemKey = `${item.code ?? ''}|${item.ticker ?? ''}|${item.name}|${item.market ?? ''}`
      const failureKind = quoteSurfaceEnabled ? quoteFailureKinds[itemKey] : undefined
      return failureKind ? buildHomeHoldingErrorCard(holding, failureKind) : holding
    })
  }, [hasUsHomeHoldings, liveQuoteSnapshot, portfolioBaseItems, quoteFailureKinds, quoteQuery, quoteSurfaceEnabled, rawHomeHoldings, usdKrwRate])

  const selectedHolding = selectedId === null ? null : homeHoldings.find((item) => item.id === selectedId) ?? null
  const prefetchedDeepScanHolding = useMemo(() => {
    if (openStockCardId !== null) {
      const openedHolding = homeHoldings.find((item) => item.id === openStockCardId) ?? null
      return openedHolding?.kind === 'stock' ? openedHolding : null
    }

    return selectedHolding?.kind === 'stock' ? selectedHolding : null
  }, [homeHoldings, openStockCardId, selectedHolding])

  useEffect(() => {
    if (!prefetchedDeepScanHolding) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void prefetchAndPersistDeepScanSlimSummary(prefetchedDeepScanHolding)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [prefetchedDeepScanHolding])

  const handleQuoteRefresh = useCallback(() => {
    if (quoteStatus === 'loading') {
      return
    }

    setRefreshVersion((value) => value + 1)
  }, [quoteStatus])

  const navigateToDeepScanForHolding = useCallback(async (holdingId: number, actionHref: string) => {
    const item = portfolioItems[holdingId]
    const holding = homeHoldings.find((entry) => entry.id === holdingId)

    if (!item || !holding || !shouldUseDeepScanLoadingHandoff({ actionHref, kind: holding.kind })) {
      router.push(actionHref)
      return
    }

    const navigationId = deepScanNavigationIdRef.current + 1
    deepScanNavigationIdRef.current = navigationId
    setDeepScanLoadingTarget({
      name: holding.name,
      identifier: getHoldingIdentifierText(holding),
    })
    setDeepScanTarget(toDeepScanTargetInput(item))
    await Promise.race([
      prefetchAndPersistDeepScanSlimSummary(holding),
      new Promise((resolve) => window.setTimeout(resolve, 500)),
    ]).catch(() => undefined)

    if (deepScanNavigationIdRef.current !== navigationId) {
      return
    }

    router.push(actionHref)
  }, [homeHoldings, portfolioItems, router, setDeepScanTarget])

  const cancelDeepScanLoading = useCallback(() => {
    deepScanNavigationIdRef.current += 1
    setDeepScanLoadingTarget(null)
  }, [])

  const handleHoldingActionClick = useCallback(async (item: HomeHolding, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (!item.actionHref) {
      return
    }

    await navigateToDeepScanForHolding(item.id, item.actionHref)
  }, [navigateToDeepScanForHolding])

  const donutChartData = useMemo<DonutChartDatum[]>(
    () => homeHoldings.map((item) => ({ ...item, value: Math.max(item.donutPercent, 0.01) })),
    [homeHoldings],
  )
  const heatmapChartData = useMemo<HeatmapChartDatum[]>(
    () => homeHoldings.map((item) => ({ ...item, name: item.shortName || item.name, value: Math.max(item.donutPercent, 0.01) })),
    [homeHoldings],
  )
  const heatmapChartHeight = Math.max(234, 234 + Math.max(0, heatmapChartData.length - 5) * 34)
  const summaryData = useMemo(() => buildPortfolioSummary(homeHoldings, isAppliedPortfolio), [homeHoldings, isAppliedPortfolio])
  const defaultDeepScanHolding = useMemo(() => {
    if (selectedHolding?.kind === 'stock') {
      return selectedHolding
    }

    return pickDeepScanDefaultHolding(homeHoldings)
  }, [homeHoldings, selectedHolding])
  const renderDonutLabel = useCallback(({ x, y, payload }: PieLabelRenderProps) => {
    const item = payload as DonutChartDatum | undefined

    if (!item || typeof x !== 'number' || typeof y !== 'number') {
      return null
    }

    const textWidth = item.donutLabel.length * 6.2
    const labelX = clamp(x, textWidth / 2 + 10, DONUT_CHART_SIZE - textWidth / 2 - 10)
    const labelY = clamp(y, 12, DONUT_CHART_SIZE - 12)

    return (
      <g pointerEvents='none'>
        <rect x={labelX - textWidth / 2 - 5} y={labelY - 8} width={textWidth + 10} height={15} rx={6} fill='rgba(10,25,55,.8)' />
        <text x={labelX} y={labelY} fontSize='10' fill='white' textAnchor='middle' fontWeight='500' dominantBaseline='middle'>
          {item.donutLabel}
        </text>
      </g>
    )
  }, [])

  const scrollToCard = useCallback((id: number) => {
    const frame = frameRef.current
    const card = cardRefs.current[id]

    if (!frame || !card) {
      return
    }

    window.setTimeout(() => {
      frame.scrollTo({
        top: card.offsetTop - 56,
        behavior: 'smooth',
      })
    }, 80)
  }, [])

  const resetSelection = useCallback(() => {
    setSelectedId(null)
    setOpenStockCardId(null)
    setOpenEtfCardId(null)
  }, [])

  const selectHolding = useCallback(
    (id: number, shouldScroll = true) => {
      if (selectedId === id) {
        resetSelection()
        return
      }

      const selectedItem = homeHoldings.find((item) => item.id === id)
      setSelectedId(id)

      if (selectedItem?.kind === 'etf') {
        setOpenStockCardId(null)
        setOpenEtfCardId(id)
      } else {
        setOpenStockCardId(id)
        setOpenEtfCardId(null)
      }

      if (shouldScroll) {
        scrollToCard(id)
      }
    },
    [homeHoldings, resetSelection, scrollToCard, selectedId],
  )

  const toggleCard = useCallback(
    (id: number) => {
      if (openStockCardId === id && selectedId === id) {
        resetSelection()
        return
      }

      setSelectedId(id)
      setOpenStockCardId(id)
      setOpenEtfCardId(null)
    },
    [openStockCardId, resetSelection, selectedId],
  )

  const handleHeatmapClick = useCallback(
    (id: number) => {
      const selectedItem = homeHoldings.find((item) => item.id === id)
      setSelectedId(id)

      if (selectedItem?.kind === 'etf') {
        setOpenStockCardId(null)
        setOpenEtfCardId(id)
      } else {
        setOpenStockCardId(id)
        setOpenEtfCardId(null)
      }

      scrollToCard(id)
    },
    [homeHoldings, scrollToCard],
  )

  const toggleEtfCard = useCallback(
    (id: number) => {
      if (openEtfCardId === id && selectedId === id) {
        resetSelection()
        return
      }

      setSelectedId(id)
      setOpenStockCardId(null)
      setOpenEtfCardId(id)
    },
    [openEtfCardId, resetSelection, selectedId],
  )

  const renderHeatmapContent = useCallback(
    (node: TreemapNode) => {
      const item = node as TreemapNode & Partial<HeatmapChartDatum>

      if (item.depth !== 1 || typeof item.id !== 'number' || item.width <= 0 || item.height <= 0) {
        return <g />
      }

      const isCompactTile = item.width < 100 || item.height < 58
      const isTinyTile = item.width < 78 || item.height < 48
      const isActive = item.id === selectedId || item.id === openStockCardId || item.id === openEtfCardId

      return (
        <foreignObject x={item.x} y={item.y} width={item.width} height={item.height}>
          <HeatmapTile
            item={item as HomeHolding}
            className={styles.heatmapTreemapTile}
            weightClassName={isCompactTile ? styles.heatmapWeightSmall : undefined}
            nameClassName={isTinyTile ? styles.heatmapNameTiny : isCompactTile ? styles.heatmapNameSmall : undefined}
            changeClassName={isCompactTile ? styles.heatmapChangeSmall : undefined}
            style={{ width: '100%', height: '100%', padding: isCompactTile ? '7px 9px' : '9px 10px' }}
            active={isActive}
            onClick={() => handleHeatmapClick(item.id as number)}
          />
        </foreignObject>
      )
    },
    [handleHeatmapClick, openEtfCardId, openStockCardId, selectedId],
  )

  if (!hasPortfolioItems) {
    return (
      <div className={styles.viewport}>
        <div className={styles.frame}>
          <div className={styles.body}>
            <div className={styles.forecastCard}>
              <div className={styles.forecastLabel}>REDIRECTING</div>
              <div className={styles.forecastText}>{redirectReasonMessage ?? '홈 포트폴리오를 확인하는 중이에요.'}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.viewport}>
      <div ref={frameRef} className={styles.frame}>
        <div className={styles.topBar}>
          <div className={styles.appName}>Jaroo</div>
          <div className={styles.topIcons}>
            <button type='button' className={styles.iconButton} onClick={() => setOpenSheet('momentum')} aria-label='이번 주 회복 모멘텀 열기'>
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <line x1='7' y1='2' x2='7' y2='12' stroke='white' strokeWidth='1.8' strokeLinecap='round' />
                <line x1='2' y1='7' x2='12' y2='7' stroke='white' strokeWidth='1.8' strokeLinecap='round' />
              </svg>
            </button>
            <button type='button' className={styles.iconButton} aria-label='알림'>
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M7 1.5C4.5 1.5 2.5 3.3 2.5 5.5V9L1.5 10.5h11L11.5 9V5.5C11.5 3.3 9.5 1.5 7 1.5Z'
                  stroke='white'
                  strokeWidth='1.4'
                  fill='none'
                />
                <path d='M5.5 10.5C5.5 11.3 6.2 12 7 12s1.5-.7 1.5-1.5' stroke='white' strokeWidth='1.4' fill='none' strokeLinecap='round' />
              </svg>
              <span className={styles.bellDot} />
            </button>
          </div>
        </div>

        <div className={styles.hero}>
          <div className={styles.viewToggle}>
            <button
              type='button'
              className={cn(styles.viewToggleButton, view === 'donut' && styles.viewToggleButtonOn)}
              onClick={() => setView('donut')}
            >
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none' style={{ opacity: 0.9 }}>
                <circle cx='7' cy='7' r='5.5' stroke='white' strokeWidth='1.5' fill='none' />
                <circle cx='7' cy='7' r='2.5' fill='white' />
              </svg>
              비중
            </button>
            <button
              type='button'
              className={cn(styles.viewToggleButton, view === 'heatmap' && styles.viewToggleButtonOn)}
              onClick={() => setView('heatmap')}
            >
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none' style={{ opacity: 0.7 }}>
                <rect x='1' y='1' width='5.5' height='5.5' rx='1.5' fill='white' />
                <rect x='7.5' y='1' width='5.5' height='2.5' rx='1' fill='white' />
                <rect x='7.5' y='4.5' width='5.5' height='2' rx='1' fill='white' />
                <rect x='1' y='7.5' width='12' height='5.5' rx='1.5' fill='white' />
              </svg>
              손익
            </button>
          </div>

          <div className={cn(styles.view, view !== 'donut' && styles.hidden)}>
            <div className={styles.donutOuter}>
              <div className={styles.donutSvg}>
                <ResponsiveContainer width='100%' height='100%'>
                  <PieChart>
                    <Pie
                      data={[{ value: 1 }]}
                      dataKey='value'
                      cx='50%'
                      cy='50%'
                      innerRadius={58}
                      outerRadius={82}
                      fill='rgba(255,255,255,.07)'
                      stroke='none'
                      isAnimationActive={false}
                    />
                    <Pie
                      data={donutChartData}
                      dataKey='value'
                      nameKey='donutLabel'
                      cx='50%'
                      cy='50%'
                      innerRadius={58}
                      outerRadius={82}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={homeHoldings.length > 1 ? 3 : 0}
                      cornerRadius={3}
                      stroke='none'
                      labelLine={false}
                      label={renderDonutLabel}
                      isAnimationActive={false}
                      onClick={(data) => {
                        const item = data.payload as DonutChartDatum | undefined

                        if (item) {
                          selectHolding(item.id)
                        }
                      }}
                    >
                      {donutChartData.map((item) => (
                        <Cell
                          key={item.id}
                          fill={item.donutColor}
                          className={cn(
                            styles.arcSeg,
                            selectedId !== null && selectedId !== item.id && styles.dimmed,
                            selectedId === item.id && styles.selected,
                          )}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <button type='button' className={styles.donutCenter} onClick={() => setOpenSheet('score')}>
                <div
                  className={styles.dcScore}
                  style={{
                    fontSize: selectedHolding ? 22 : 32,
                    color: selectedHolding ? selectedHolding.centerScoreColor : 'white',
                  }}
                >
                  {selectedHolding ? selectedHolding.centerScore : summaryData.score}
                </div>
                <div className={cn(styles.dcBadge, badgeToneClass(selectedHolding?.centerBadgeTone ?? summaryData.badgeTone))}>
                  {selectedHolding ? selectedHolding.centerBadge : summaryData.badge}
                </div>
                <div className={styles.dcTxt}>
                  {selectedHolding ? (
                    selectedHolding.centerName
                  ) : (
                    <>
                      탭하면 해당
                      <br />
                      종목으로 이동해요
                    </>
                  )}
                </div>
              </button>
            </div>
            <div className={styles.scrollHint} style={{ opacity: selectedHolding ? 0 : 1 }}>
              <span>탭하면 종목 카드로 이동해요</span>
              <span className={styles.scrollArrow}>↓</span>
            </div>
            <button type='button' className={styles.momentumBanner} onClick={() => setOpenSheet('momentum')}>
              <span className={styles.momentumDot} />
              <span className={styles.momentumText}>이번 주 포트폴리오 순풍</span>
              <span className={styles.momentumValue}>{summaryData.momentumValue}</span>
              <span className={styles.momentumArrow}>›</span>
            </button>
          </div>

          <div className={cn(styles.view, view !== 'heatmap' && styles.hidden)}>
            <div className={styles.heatmapHeader}>
              <div>
                <div className={styles.heatmapScore}>{summaryData.score}</div>
                <div className={styles.heatmapScoreLabel}>포트폴리오 점수</div>
              </div>
              <div className={styles.heatmapSummary}>
                <div className={styles.heatmapSummaryBadge}>{summaryData.badge}</div>
                <div className={styles.heatmapSummaryText}>
                  {summaryData.summaryText.split('\n')[0]}
                  <br />
                  {summaryData.summaryText.split('\n')[1]}
                </div>
              </div>
            </div>
            <div className={styles.heatmapGrid}>
              <div className={styles.heatmapTreemap} style={{ height: heatmapChartHeight }}>
                <ResponsiveContainer width='100%' height='100%'>
                  <Treemap
                    data={heatmapChartData}
                    dataKey='value'
                    aspectRatio={1.25}
                    stroke='rgba(255,255,255,.08)'
                    content={renderHeatmapContent}
                    isAnimationActive={false}
                  />
                </ResponsiveContainer>
              </div>
            </div>
            <button type='button' className={styles.momentumBanner} onClick={() => setOpenSheet('momentum')}>
              <span className={styles.momentumDot} />
              <span className={styles.momentumText}>이번 주 포트폴리오 순풍</span>
              <span className={styles.momentumValue}>{summaryData.momentumValue}</span>
              <span className={styles.momentumArrow}>›</span>
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {quoteSurfaceEnabled && quoteStatus === 'error' ? (
            <div className={styles.forecastCard}>
              <div className={styles.forecastLabel}>QUOTE ERROR</div>
              <div className={styles.forecastText}>{quoteErrorMessage ?? '현재 시세를 불러오지 못했어요. 다시 시도해주세요.'}</div>
              <button type='button' className={cn(styles.detailButton, styles.buttonBlue, styles.uploadCtaButton)} onClick={handleQuoteRefresh}>
                시세 다시 불러오기
              </button>
            </div>
          ) : null}
          {quoteSurfaceEnabled && quoteSummaryMessage ? (
            <div className={styles.forecastCard}>
              <div className={styles.forecastLabel}>PARTIAL SUCCESS</div>
              <div className={styles.forecastText}>{quoteSummaryMessage}</div>
            </div>
          ) : null}
          <div className='mb-3 flex items-center justify-between gap-3'>
            <div className={styles.sectionLabel}>종목별 현황</div>
            <button type='button' className={cn(styles.detailButton, styles.buttonBlue)} onClick={handleQuoteRefresh}>
              {quoteSurfaceEnabled && quoteStatus === 'loading' ? '시세 갱신 중...' : '시세 새로고침'}
            </button>
          </div>

          {homeHoldings.map((item) => {
            const isEtf = item.kind === 'etf'
            const open = isEtf ? openEtfCardId === item.id : openStockCardId === item.id
            const valueToneClass = getValueToneClass(item)
            const holdingIdentifierText = getHoldingIdentifierText(item)

            return (
              <div
                key={item.id}
                ref={(node) => {
                  cardRefs.current[item.id] = node
                }}
                className={cn(
                  styles.stockCard,
                  item.cardTone === 'halt' && styles.cardHalt,
                  item.cardTone === 'profit' && styles.cardProfit,
                  isEtf && styles.cardEtf,
                  open && styles.cardActive,
                )}
                onClick={() => {
                  if (isEtf) {
                    toggleEtfCard(item.id)
                    return
                  }

                  toggleCard(item.id)
                }}
              >
                <div className={styles.stockCardMain}>
                  <div className={cn(styles.signal, signalToneClass(item.signalTone))} />
                  <div className={styles.stockInfo}>
                    <div className={styles.stockNameRow}>
                      <div className={styles.stockName}>{item.name}</div>
                      <div
                        className={cn(
                          styles.stockBadge,
                          item.badgeTone === 'red' && styles.badgeRed,
                          item.badgeTone === 'amber' && styles.badgeAmber,
                          item.badgeTone === 'green' && styles.badgeGreen,
                        )}
                      >
                        {item.badge}
                      </div>
                    </div>
                    <div className={styles.stockSub}>
                      <span className={cn(styles.marketTag, marketToneClass(item.marketTone))}>{item.market}</span>
                      {holdingIdentifierText ? ` · ${holdingIdentifierText}` : ''} · {item.shares}
                    </div>
                  </div>
                  <div className={styles.stockValue}>
                    <div className={cn(styles.stockValueStrong, valueToneClass)}>{item.change}</div>
                    <div className={cn(styles.stockSub, valueToneClass)} style={{ marginTop: 2 }}>
                      {item.pnl}
                    </div>
                  </div>
                </div>
                <div className={cn(styles.detail, open && styles.detailOpen)}>
                  <div
                    className={styles.aiBox}
                    style={{
                      background: item.opinionBackground,
                      borderColor: item.opinionBorder,
                    }}
                  >
                    <div
                      className={styles.aiLabel}
                      style={{
                        color:
                          item.cardTone === 'halt'
                            ? '#A32D2D'
                            : item.cardTone === 'profit'
                              ? '#3B6D11'
                              : item.kind === 'etf'
                                ? '#185FA5'
                                : '#999',
                      }}
                    >
                      {item.opinionLabel}
                    </div>
                    <div className={styles.aiText} style={{ color: item.opinionTextColor }}>
                      {item.opinionText}
                    </div>
                  </div>
                  <div className={styles.metaLine}>{item.metaLine}</div>
                  <div className={styles.metricGrid}>
                    {item.metrics.map((metric) => (
                      <div key={metric.label} className={styles.metricCard}>
                        <div className={styles.metricLabel}>{metric.label}</div>
                        <div className={cn(styles.metricValue, metricToneClass(metric.tone))}>{metric.value}</div>
                      </div>
                    ))}
                  </div>
                  {item.actionHref ? (
                    <Link
                      href={item.actionHref}
                      className={cn(styles.detailButton, actionToneClass(item))}
                      onClick={(event) => handleHoldingActionClick(item, event)}
                    >
                      {item.actionLabel}
                      {item.actionSubLabel ? <span className={styles.actionSubLabel}>{item.actionSubLabel}</span> : null}
                      {item.actionCredits ? <span className={styles.credit}>{item.actionCredits}</span> : null}
                    </Link>
                  ) : (
                    <button
                      type='button'
                      className={cn(styles.detailButton, actionToneClass(item))}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.actionLabel}
                      {item.actionSubLabel ? <span className={styles.actionSubLabel}>{item.actionSubLabel}</span> : null}
                      {item.actionCredits ? <span className={styles.credit}>{item.actionCredits}</span> : null}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          <div className={styles.forecastCard}>
            <div className={styles.forecastLabel}>{summaryData.forecast.label}</div>
            <div className={styles.forecastText}>{summaryData.forecast.body}</div>
            <Link
              href={summaryData.forecast.href}
              className={styles.forecastMore}
              onClick={(event) => {
                if (summaryData.forecast.href === '/deepscan' && defaultDeepScanHolding) {
                  event.preventDefault()
                  void navigateToDeepScanForHolding(defaultDeepScanHolding.id, summaryData.forecast.href)
                }
              }}
            >
              {summaryData.forecast.cta}
            </Link>
          </div>
        </div>

        <div className={styles.bottomNav}>
          <button type='button' className={cn(styles.navItem, styles.navItemOn)}>
            <span className={cn(styles.navIcon, styles.navIconOn)} />
            <span>홈</span>
          </button>
          <button type='button' className={styles.navItem}>
            <span className={styles.navIcon} />
            <span>포트폴리오</span>
          </button>
          <button type='button' className={styles.navItem}>
            <span className={styles.navIcon} />
            <span>분석</span>
          </button>
          <Link href='/mypage' className={styles.navItem}>
            <span className={styles.navIcon} />
            <span>마이</span>
          </Link>
        </div>
      </div>

      <div className={styles.modalMount}>
        <div className={styles.modalInner}>
          <button
            type='button'
            className={cn(styles.sheetOverlay, openSheet === 'score' && styles.sheetOverlayOpen)}
            onClick={() => setOpenSheet(null)}
            aria-label='포트폴리오 점수 닫기'
          />
          <div className={cn(styles.sheet, openSheet === 'score' && styles.sheetOpen)}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}>포트폴리오 점수</div>
            <div className={styles.sheetSubtitle}>각 항목이 내 포트폴리오에 미치는 영향이에요</div>
            <div className={styles.sheetScoreRow}>
              <div className={styles.sheetScoreNum}>{summaryData.score}</div>
              <div className={styles.sheetScoreBadge}>{summaryData.badge}</div>
              <div className={styles.sheetScoreText}>
                100점 만점
                <br />
                상위 47%
              </div>
            </div>
            {summaryData.scoreBreakdown.map((item) => (
              <div key={item.label} className={styles.breakdownItem}>
                <div className={styles.breakdownHeader}>
                  <div className={styles.breakdownLabel}>{item.label}</div>
                  <div className={styles.breakdownScore} style={{ color: item.scoreColor }}>
                    {item.score}
                  </div>
                </div>
                <div className={styles.breakdownBarTrack}>
                  <div className={styles.breakdownBarFill} style={{ width: item.barWidth, background: item.barColor }} />
                </div>
                <div className={styles.breakdownDesc}>{item.description}</div>
                <div className={styles.breakdownStocks}>
                  {item.stocks.map((stock) => (
                    <div
                      key={stock.label}
                      className={styles.breakdownStockTag}
                      style={
                        'background' in stock
                          ? {
                              background: stock.background,
                              color: stock.color,
                            }
                          : undefined
                      }
                    >
                      <span className={styles.breakdownStockDot} style={{ background: stock.dot }} />
                      {stock.label}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.modalMount}>
        <div className={styles.modalInner}>
          <button
            type='button'
            className={cn(styles.sheetOverlay, openSheet === 'momentum' && styles.sheetOverlayOpen)}
            onClick={() => setOpenSheet(null)}
            aria-label='이번 주 회복 모멘텀 닫기'
          />
          <div className={cn(styles.sheet, openSheet === 'momentum' && styles.sheetOpen)}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}>이번 주 회복 모멘텀</div>
            <div className={styles.sheetSubtitle}>9인 위원회가 매주 종목별 회복 신호를 분석해요</div>
            <div className={styles.momentumStageRow}>
              <div className={styles.momentumStages}>
                {summaryData.momentumStages.map((stage) => (
                  <div
                    key={stage.label}
                    className={cn(
                      styles.momentumStage,
                      stage.tone === 'danger' && styles.stageDanger,
                      stage.tone === 'muted' && styles.stageMuted,
                      stage.tone === 'positive' && styles.stagePositive,
                    )}
                  >
                    <div className={styles.momentumStageLabel}>{stage.label}</div>
                    <div className={styles.momentumStageSub}>{stage.subtitle}</div>
                  </div>
                ))}
              </div>
              <div className={styles.momentumStageHint}>지난주 미풍 → 이번 주 순풍으로 한 단계 올라왔어요</div>
            </div>
            <div className={styles.sheetSectionTitle}>종목별 회복 신호</div>
            {summaryData.momentumSignals.map((signal) => (
              <div key={signal.name} className={styles.breakdownItem}>
                <div className={styles.signalRow}>
                  <span className={cn(styles.signal, signal.blink && styles.blink)} style={{ background: signal.dot, marginTop: 0 }} />
                  <div className={styles.signalName}>{signal.name}</div>
                  <div className={styles.signalBadge} style={{ background: signal.badgeBackground, color: signal.badgeColor }}>
                    {signal.badge}
                  </div>
                </div>
                <div className={styles.signalDesc}>{signal.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {deepScanLoadingTarget ? (
        <div className={styles.deepScanLoadingMount}>
          <div className={styles.deepScanLoadingInner}>
            <DeepScanLoadingScreen
              name={deepScanLoadingTarget.name}
              identifier={deepScanLoadingTarget.identifier}
              onBack={cancelDeepScanLoading}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
