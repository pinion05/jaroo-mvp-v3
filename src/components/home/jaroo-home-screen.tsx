'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { AuthHomeStatus } from '@/components/auth/auth-home-status'
import { DeepScanLoadingScreen } from '@/components/deepscan-loading-screen'
import { shouldUseDeepScanLoadingHandoff } from '@/lib/deepscan-navigation'
import { pickDeepScanDefaultHolding } from '@/lib/deepscan-target'
import { getFinancialValueTone } from '@/lib/financial-value-tone'
import {
  applyCurrentQuotesToHomeHoldings,
  buildHomeCurrentQuoteQuery,
  buildHomeHoldingErrorCard,
  buildQuoteLookupKey,
  requiresFxConversion,
  resolveAveragePriceCurrency,
  shouldTreatQuoteFailureAsErrorCard,
  type CurrentQuoteItem,
  type HomeHoldingQuoteErrorKind,
} from '@/lib/home-current-quotes'
import {
  fetchHomeQuoteResponseWithTimeout,
  HOME_QUOTE_FETCH_TIMEOUT_MS,
  resolveUsdKrwRateAfterFailedQuoteResponse,
  shouldSkipHomeQuoteHydration,
} from '@/lib/home-quote-bootstrap'
import {
  buildAppliedHomePortfolioRowsFromPortfolioItems,
  buildHomeHoldingsFromPortfolioItems,
  buildPortfolioItemsFromAppliedHomePortfolioRows,
  homeForecast as defaultHomeForecast,
  momentumSignals as defaultMomentumSignals,
  momentumStages as defaultMomentumStages,
  persistAppliedHomePortfolio,
  persistDeepScanTarget,
  readAppliedHomePortfolio,
  type HomeBadgeTone,
  type HomeHolding,
} from '@/lib/jaroo-home-data'
import { fetchPortfolio, shouldUsePortfolioSessionFallback, syncPortfolioToServer } from '@/lib/portfolio-sync'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { AppBottomNav } from '@/components/app-bottom-nav'
import { useDeepScanStore } from '@/lib/stores/use-deepscan-store'
import { removePortfolioItemFromList, usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import { cn } from '@/lib/utils'
import { toDeepScanTargetInput } from '@/lib/workflow-types'
import styles from './jaroo-home-screen.module.css'

type MomentumSignalItem = (typeof defaultMomentumSignals)[number]
type ForecastCard = typeof defaultHomeForecast
type PortfolioStoreItem = ReturnType<typeof usePortfolioStore.getState>['items'][number]

type PortfolioRemovalTarget = {
  item: PortfolioStoreItem
  displayName: string
}

type DeepScanLoadingTarget = {
  name: string
  identifier?: string
  market?: string
  kind?: string
  shares?: number
  averagePrice?: number
  averagePriceCurrency?: 'KRW' | 'USD'
  snapshotProfitRate?: number
  currentPrice?: number
  currentPriceCurrency?: 'KRW' | 'USD'
  currentProfitRate?: number
  evaluationAmount?: number
}

type HomeV2Summary = {
  totalEvaluation: number | null
  totalEvaluationText: string
  totalPnl: number | null
  totalPnlText: string
  totalRate: number | null
  badge: string
  badgeTone: HomeBadgeTone
  hint: string
  momentumValue: string
  forecast: ForecastCard
  momentumSignals: MomentumSignalItem[]
  momentumStages: typeof defaultMomentumStages
}

type HomeV2SummaryOptions = {
  usdKrwRate?: number | null
}

type MoneyCurrency = 'KRW' | 'USD'

type MoneyEntry = {
  value: number
  currency: MoneyCurrency
}

type MoneySummary = {
  value: number | null
  currency: MoneyCurrency
  mixedWithoutFx: boolean
}

type DonutSegment = {
  holding: HomeHolding
  value: number
  labelTop: string
  labelLeft: string
}

const DONUT_LABEL_POSITIONS = [
  { top: '78%', left: '61%' },
  { top: '18%', left: '26%' },
  { top: '18%', left: '74%' },
  { top: '39%', left: '83%' },
  { top: '64%', left: '19%' },
]

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

function getHoldingIdentifierText(item: HomeHolding) {
  const identifiers = [item.identifierTicker, item.identifierCode].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  )

  return identifiers.length > 0 ? identifiers.join(' · ') : item.identifierLabel
}

function getEvaluationAmount(item: HomeHolding) {
  const directAmount = item.evaluationAmount ? parseOcrNumber(item.evaluationAmount) : null
  if (directAmount !== null) {
    return directAmount
  }

  const metaMatch = item.metaLine.match(/평가금액\s*([^·]+)/)
  const metaAmount = metaMatch ? parseOcrNumber(metaMatch[1]) : null
  if (metaAmount !== null) {
    return metaAmount
  }

  const quantity = parseOcrNumber(item.shares)
  const averagePrice = parseOcrNumber(item.averagePrice)
  return quantity !== null && averagePrice !== null ? quantity * averagePrice : null
}

function getPnlAmount(item: HomeHolding) {
  return parseOcrNumber(item.pnl)
}

function getMetricValue(item: HomeHolding, label: string) {
  return item.metrics.find((metric) => metric.label === label)?.value?.trim() || '-'
}

function getEvaluationAmountText(item: HomeHolding) {
  const metricValue = getMetricValue(item, '평가 금액')
  return metricValue !== '-' ? metricValue : (item.evaluationAmount?.trim() || '-')
}

function inferMoneyCurrencyFromText(value: string) {
  const normalizedValue = value.trim().toUpperCase()

  if (!normalizedValue || normalizedValue === '-') {
    return null
  }

  if (/^[+-]?\$/.test(normalizedValue) || normalizedValue.includes('USD')) {
    return 'USD'
  }

  if (normalizedValue.includes('₩') || normalizedValue.includes('KRW') || normalizedValue.includes('원')) {
    return 'KRW'
  }

  return null
}

function inferMoneyCurrencyForHoldingText(item: HomeHolding, value: string): MoneyCurrency {
  return inferMoneyCurrencyFromText(value) ?? (item.marketTone === 'nasdaq' ? 'USD' : 'KRW')
}

function getMoneyEntry(item: HomeHolding, value: number | null, text: string): MoneyEntry | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }

  return {
    value,
    currency: inferMoneyCurrencyForHoldingText(item, text),
  }
}

function hasUsableUsdKrwRate(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function convertMoneyEntryToKrw(entry: MoneyEntry, usdKrwRate: number) {
  return entry.currency === 'USD' ? entry.value * usdKrwRate : entry.value
}

function summarizeMoneyEntries(entries: MoneyEntry[], options: HomeV2SummaryOptions = {}): MoneySummary {
  if (entries.length === 0) {
    return { value: null, currency: 'KRW', mixedWithoutFx: false }
  }

  const currencies = new Set(entries.map((entry) => entry.currency))

  if (currencies.size === 1) {
    const [currency] = [...currencies] as MoneyCurrency[]

    return {
      value: entries.reduce((sum, entry) => sum + entry.value, 0),
      currency,
      mixedWithoutFx: false,
    }
  }

  const usdKrwRate = options.usdKrwRate

  if (hasUsableUsdKrwRate(usdKrwRate)) {
    return {
      value: entries.reduce((sum, entry) => sum + convertMoneyEntryToKrw(entry, usdKrwRate), 0),
      currency: 'KRW',
      mixedWithoutFx: false,
    }
  }

  return { value: null, currency: 'KRW', mixedWithoutFx: true }
}

function formatKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatMoneyValue(value: number | null, currency: 'KRW' | 'USD') {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  if (currency === 'USD') {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return formatKrw(value)
}

function formatSignedKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(Math.round(value)).toLocaleString('ko-KR')}원`
}

function formatSignedMoneyValue(value: number | null, currency: 'KRW' | 'USD') {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  if (currency === 'USD') {
    const sign = value > 0 ? '+' : value < 0 ? '-' : ''
    return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return formatSignedKrw(value)
}

function formatSignedRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

function getToneClass(value: number | null) {
  const tone = getFinancialValueTone(value)
  return tone === 'profit' ? styles.up : tone === 'loss' ? styles.down : undefined
}

function getStockTag(item: HomeHolding) {
  if (item.badgeTone === 'green') {
    return '수익'
  }

  if (item.badgeTone === 'red') {
    return item.cardTone === 'halt' ? '정지' : '손실'
  }

  return '관찰'
}

function getStockTagClass(item: HomeHolding) {
  if (item.badgeTone === 'green') {
    return styles.profit
  }

  if (item.badgeTone === 'red') {
    return styles.loss
  }

  return styles.watch
}

export function buildHomeV2Summary(holdings: HomeHolding[], isAppliedPortfolio: boolean, options: HomeV2SummaryOptions = {}): HomeV2Summary {
  const evaluationSummary = summarizeMoneyEntries(
    holdings.flatMap((item) => {
      const text = getEvaluationAmountText(item)
      const entry = getMoneyEntry(item, getEvaluationAmount(item), text)
      return entry ? [entry] : []
    }),
    options,
  )
  const pnlSummary = summarizeMoneyEntries(
    holdings.flatMap((item) => {
      const entry = getMoneyEntry(item, getPnlAmount(item), item.pnl)
      return entry ? [entry] : []
    }),
    options,
  )
  const totalEvaluation = evaluationSummary.value
  const totalPnl = pnlSummary.value
  const canCalculateTotalRate = totalEvaluation !== null
    && totalPnl !== null
    && evaluationSummary.currency === pnlSummary.currency
    && !evaluationSummary.mixedWithoutFx
    && !pnlSummary.mixedWithoutFx
  const principal = canCalculateTotalRate ? totalEvaluation - totalPnl : null
  const totalRate = principal !== null && principal > 0 && totalPnl !== null ? (totalPnl / principal) * 100 : null
  const negativeCount = holdings.filter((item) => (getHoldingChangeValue(item) ?? 0) < 0).length
  const badgeTone: HomeBadgeTone = totalPnl === null || totalPnl === 0 ? 'amber' : totalPnl > 0 ? 'green' : 'red'
  const badge = badgeTone === 'green' ? '수익' : badgeTone === 'red' ? '손실' : '관찰'
  const averageRate = holdings.length > 0
    ? holdings.reduce((sum, item) => sum + (getHoldingChangeValue(item) ?? 0), 0) / holdings.length
    : 0
  const momentumValue = averageRate >= 8 ? '빠르게 개선 중 ↑' : averageRate >= 0 ? '나아지는 중 ↑' : averageRate >= -10 ? '천천히 회복 중 →' : '경계 필요 ↓'
  const worstHolding = [...holdings].sort((left, right) => (getHoldingChangeValue(left) ?? 0) - (getHoldingChangeValue(right) ?? 0))[0]
  const forecastBody = isAppliedPortfolio
    ? `${holdings.length}개 보유 종목을 확인했어요. ${worstHolding?.name ?? holdings[0]?.name ?? '보유 종목'} 상태를 먼저 점검해보세요.`
    : defaultHomeForecast.body

  return {
    totalEvaluation,
    totalEvaluationText: formatMoneyValue(totalEvaluation, evaluationSummary.currency),
    totalPnl,
    totalPnlText: formatSignedMoneyValue(totalPnl, pnlSummary.currency),
    totalRate,
    badge,
    badgeTone,
    hint: `${holdings.length}개 중 ${negativeCount}개가 손실 구간이에요 · 조각을 탭하면 종목으로 이동`,
    momentumValue,
    forecast: isAppliedPortfolio
      ? {
          label: '보유 종목 요약',
          body: forecastBody,
          cta: '종목 카드에서 딥스캔을 시작하세요',
          href: '/deepscan',
        }
      : defaultHomeForecast,
    momentumSignals: holdings.slice(0, 4).map((item) => {
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
    }),
    momentumStages: defaultMomentumStages.map((stage, index) => ({
      ...stage,
      active: index === clamp(Math.round(averageRate / 8) + 2, 0, defaultMomentumStages.length - 1),
    })),
  }
}

function buildDonutSegments(holdings: HomeHolding[]): DonutSegment[] {
  const totalWeight = holdings.reduce((sum, item) => sum + Math.max(item.donutPercent, 0.01), 0) || 1
  let cursor = -90

  return holdings.map((holding, index) => {
    const value = Math.max(holding.donutPercent, 0.01)
    const size = (value / totalWeight) * 360
    const middle = cursor + size / 2
    const radians = (middle * Math.PI) / 180
    const x = 50 + Math.cos(radians) * 42
    const y = 50 + Math.sin(radians) * 42
    const presetPosition = DONUT_LABEL_POSITIONS[index]
    const segment = {
      holding,
      value,
      labelTop: presetPosition?.top ?? `${clamp(y, 10, 86).toFixed(1)}%`,
      labelLeft: presetPosition?.left ?? `${clamp(x, 9, 91).toFixed(1)}%`,
    }
    cursor += size
    return segment
  })
}

function HomeDonut({ holdings, summary, selectedId, onSelect }: {
  holdings: HomeHolding[]
  summary: HomeV2Summary
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const segments = buildDonutSegments(holdings)
  const topSegments = segments.slice(0, 5)

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut}>
        <PieChart
          width={220}
          height={220}
          className={styles.donutChart}
          role='img'
          aria-label='보유 종목 비중 원차트'
        >
          <Pie
            data={segments}
            dataKey='value'
            nameKey='holding.name'
            cx='50%'
            cy='50%'
            innerRadius={62}
            outerRadius={110}
            startAngle={90}
            endAngle={-270}
            paddingAngle={0}
            stroke='none'
            isAnimationActive={false}
            rootTabIndex={-1}
          >
            {segments.map((segment) => (
              <Cell
                key={segment.holding.id}
                fill={segment.holding.donutColor}
                opacity={selectedId === null || selectedId === segment.holding.id ? 1 : 0.72}
              />
            ))}
          </Pie>
        </PieChart>
        {topSegments.map((segment) => (
          <button
            key={segment.holding.id}
            type='button'
            className={cn(styles.dLbl, selectedId === segment.holding.id && styles.dLblOn)}
            style={{ top: segment.labelTop, left: segment.labelLeft }}
            onClick={() => onSelect(segment.holding.id)}
          >
            {segment.holding.donutLabel || segment.holding.shortName || segment.holding.name}
          </button>
        ))}
        <button type='button' className={styles.donutHole} onClick={() => onSelect(holdings[0]?.id ?? 0)}>
          <div className={cn(styles.dCenterPl, getToneClass(summary.totalPnl))}>{formatSignedRate(summary.totalRate)}</div>
          <div className={styles.dCenterLbl}>전체 손익</div>
          <div className={cn(styles.dCenterBadge, summary.badgeTone === 'green' && styles.dCenterBadgeGreen, summary.badgeTone === 'red' && styles.dCenterBadgeRed)}>
            {summary.badge}
          </div>
        </button>
      </div>
    </div>
  )
}

function StockCard({
  item,
  open,
  onToggle,
  onAction,
  onRemove,
  removeDisabled,
}: {
  item: HomeHolding
  open: boolean
  onToggle: () => void
  onAction: (item: HomeHolding, event: MouseEvent<HTMLAnchorElement>) => void
  onRemove: (item: HomeHolding) => void
  removeDisabled: boolean
}) {
  const changeValue = getHoldingChangeValue(item)
  const evaluationAmount = getEvaluationAmount(item)
  const evaluationAmountText = getEvaluationAmountText(item)
  const identifierText = getHoldingIdentifierText(item)
  const currentPriceText = getMetricValue(item, '현재가')

  return (
    <article className={cn(styles.stock, open && styles.open)}>
      <button type='button' className={styles.stockRow} onClick={onToggle} aria-expanded={open}>
        <span className={styles.stockDot} style={{ background: item.donutColor }} />
        <span className={styles.stockInfo}>
          <span className={styles.stockNameRow}>
            <span className={styles.stockName}>{item.name}</span>
            <span className={cn(styles.stockBadge, getStockTagClass(item))}>{getStockTag(item)}</span>
          </span>
          <span className={styles.stockMeta}>{item.market}{identifierText ? ` · ${identifierText}` : ''} · {item.shares}</span>
        </span>
        <span className={styles.stockRight}>
          <span className={cn(styles.stockRate, getToneClass(changeValue))}>{item.change}</span>
          <span className={cn(styles.stockAmt, getToneClass(getPnlAmount(item)))}>{item.pnl}</span>
        </span>
      </button>
      <div className={styles.stockDetail} aria-hidden={!open}>
        <div className={styles.sdFacts}>
          <div>
            <span className={styles.sdfLabel}>현재가</span>
            <span className={styles.sdfVal}>{currentPriceText}</span>
          </div>
          <div>
            <span className={styles.sdfLabel}>평단</span>
            <span className={styles.sdfVal}>{item.averagePrice}</span>
          </div>
          <div>
            <span className={styles.sdfLabel}>평가금액</span>
            <span className={styles.sdfVal}>{evaluationAmountText !== '-' ? evaluationAmountText : formatKrw(evaluationAmount)}</span>
          </div>
        </div>
        {item.actionHref ? (
          <Link href={item.actionHref} className={styles.scanBtn} onClick={(event) => onAction(item, event)}>
            🔍 딥스캔 분석 <span className={styles.sub}>세 팀이 분석해요</span>
          </Link>
        ) : (
          <button type='button' className={styles.scanBtn}>
            🔍 딥스캔 분석 <span className={styles.sub}>세 팀이 분석해요</span>
          </button>
        )}
        <button
          type='button'
          className={styles.removeBtn}
          onClick={() => onRemove(item)}
          disabled={removeDisabled}
          aria-label={`${item.name} 종목 제거`}
        >
          종목 제거
        </button>
      </div>
    </article>
  )
}

export function JarooHomeScreen() {
  const router = useRouter()
  const frameRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Record<number, HTMLElement | null>>({})
  const deepScanNavigationIdRef = useRef(0)

  const portfolioItems = usePortfolioStore((state) => state.items)
  const quoteStatus = usePortfolioStore((state) => state.quoteStatus)
  const quoteErrorMessage = usePortfolioStore((state) => state.quoteErrorMessage)
  const quoteQueryKey = usePortfolioStore((state) => state.quoteQueryKey)
  const replacePortfolioItems = usePortfolioStore((state) => state.replaceItems)
  const removePortfolioStoreItem = usePortfolioStore((state) => state.removeItem)
  const setQuoteStatus = usePortfolioStore((state) => state.setQuoteStatus)
  const patchQuote = usePortfolioStore((state) => state.patchQuote)
  const clearItemQuote = usePortfolioStore((state) => state.clearItemQuote)
  const setDeepScanTarget = useDeepScanStore((state) => state.setTarget)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openCardId, setOpenCardId] = useState<number | null>(null)
  const [openSheet, setOpenSheet] = useState<'momentum' | null>(null)
  const [liveQuoteSnapshot, setLiveQuoteSnapshot] = useState<{ query: string; items: CurrentQuoteItem[] }>({ query: '', items: [] })
  const [usdKrwRate, setUsdKrwRate] = useState<number | null>(null)
  const [quoteFailureKinds, setQuoteFailureKinds] = useState<Record<string, HomeHoldingQuoteErrorKind>>({})
  const [quoteSummaryMessage, setQuoteSummaryMessage] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [deepScanLoadingTarget, setDeepScanLoadingTarget] = useState<DeepScanLoadingTarget | null>(null)
  const [persistedPortfolioLoading, setPersistedPortfolioLoading] = useState(true)
  const [portfolioRemovalTarget, setPortfolioRemovalTarget] = useState<PortfolioRemovalTarget | null>(null)
  const [portfolioRemovalPending, setPortfolioRemovalPending] = useState(false)
  const [portfolioRemovalError, setPortfolioRemovalError] = useState<string | null>(null)


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
  const quoteStatusRef = useRef(quoteStatus)
  const quoteQueryKeyRef = useRef(quoteQueryKey)
  const quoteQuery = useMemo(() => buildHomeCurrentQuoteQuery(rawHomeHoldings), [rawHomeHoldings])
  const quoteSurfaceEnabled = hasPortfolioItems && Boolean(quoteQuery)
  const quoteRunKey = `${portfolioSignature}::${quoteQuery}::${refreshVersion}`
  const hasUsHomeHoldings = useMemo(
    () => rawHomeHoldings.some((holding) => holding.marketTone === 'nasdaq' || Boolean(holding.identifierTicker)),
    [rawHomeHoldings],
  )

  useEffect(() => {
    if (hasPortfolioItems) {
      return
    }

    let active = true

    void (async () => {
      const result = await fetchPortfolio()

      if (!active) {
        return
      }

      // logged-in: DB is single source of truth (rows or empty). no session fallback here.
      if (result.status === 'rows') {
        const items = buildPortfolioItemsFromAppliedHomePortfolioRows(result.rows)
        setPersistedPortfolioLoading(false)
        if (items.length > 0) {
          replacePortfolioItems(items)
          return
        }
        return
      }

      setPersistedPortfolioLoading(false)

      if (!shouldUsePortfolioSessionFallback(result)) {
        return
      }

      // logged-out (401) or fetch error → session cache fallback (resilience), then empty.
      const sessionPortfolio = readAppliedHomePortfolio()
      const sessionItems = sessionPortfolio ? buildPortfolioItemsFromAppliedHomePortfolioRows(sessionPortfolio.rows) : []
      if (sessionItems.length > 0) {
        replacePortfolioItems(sessionItems)
        return
      }
    })()

    return () => {
      active = false
    }
  }, [hasPortfolioItems, replacePortfolioItems])



  useEffect(() => {
    portfolioBaseItemsRef.current = portfolioBaseItems
    rawHomeHoldingsRef.current = rawHomeHoldings
  }, [portfolioBaseItems, rawHomeHoldings])

  useEffect(() => {
    quoteStatusRef.current = quoteStatus
  }, [quoteStatus])

  useEffect(() => {
    quoteQueryKeyRef.current = quoteQueryKey
  }, [quoteQueryKey])

  useEffect(() => {
    if (!portfolioRemovalTarget) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !portfolioRemovalPending) {
        setPortfolioRemovalTarget(null)
        setPortfolioRemovalError(null)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [portfolioRemovalPending, portfolioRemovalTarget])

  useEffect(() => {
    if (!quoteSurfaceEnabled) {
      return
    }

    if (shouldSkipHomeQuoteHydration({
      refreshVersion,
      quoteQueryKey: quoteQueryKeyRef.current,
      quoteQuery,
      quoteStatus: quoteStatusRef.current,
    })) {
      return
    }

    const abortController = new AbortController()

    const hydrateQuotes = async () => {
      setQuoteStatus('loading', null, quoteQuery)
      setQuoteSummaryMessage(null)
      setQuoteFailureKinds({})

      const fxRequest = hasUsHomeHoldings
        ? (async () => {
            try {
              const fxResponse = await fetchHomeQuoteResponseWithTimeout(
                fetch,
                '/api/market/fx/usd-krw',
                { cache: 'no-store', signal: abortController.signal },
                HOME_QUOTE_FETCH_TIMEOUT_MS,
              )
              if (!fxResponse.ok) {
                return { rate: null, failed: true }
              }
              const fxPayload = await fxResponse.json()
              const parsedRate = Number(fxPayload?.data?.rate)
              return {
                rate: Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : null,
                failed: !Number.isFinite(parsedRate) || parsedRate <= 0,
              }
            } catch (error) {
              if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
                throw error
              }
              return { rate: null, failed: true }
            }
          })()
        : Promise.resolve({ rate: null, failed: false })

      try {
        const [fxResult, quoteResponse] = await Promise.all([
          fxRequest,
          fetchHomeQuoteResponseWithTimeout(
            fetch,
            `/api/quotes/current?${quoteQuery}`,
            { cache: 'no-store', signal: abortController.signal },
            HOME_QUOTE_FETCH_TIMEOUT_MS,
          ),
        ])
        const nextFxRate = fxResult.rate
        const fxFetchFailed = fxResult.failed

        if (abortController.signal.aborted) {
          return
        }

        if (!quoteResponse.ok) {
          setUsdKrwRate((previousRate) => resolveUsdKrwRateAfterFailedQuoteResponse(previousRate, nextFxRate, fxFetchFailed))
          setQuoteStatus('error', '현재 시세 응답이 지연되어 기존 시세로 표시 중이에요. 다시 시도해주세요.', quoteQuery)
          return
        }

        const payload = await quoteResponse.json()
        const nextItems: CurrentQuoteItem[] = Array.isArray(payload?.data?.items) ? payload.data.items : []
        const okItems = nextItems.filter((item) => item.status === 'ok' && typeof item.price === 'number')
        const nextHoldings = applyCurrentQuotesToHomeHoldings(rawHomeHoldingsRef.current, okItems, { usdKrwRate: hasUsHomeHoldings ? nextFxRate : null })
        const nextHoldingsById = new Map(nextHoldings.map((holding) => [holding.id, holding]))
        const responseByLookupKey = new Map<string, CurrentQuoteItem>()

        for (const item of nextItems) {
          const lookupKey = item.market === 'US' ? item.ticker?.trim().toUpperCase() : item.code?.trim()
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
            continue
          }

          const quoteCurrency = quoteItem.currency === 'USD' || homeHolding.marketTone === 'nasdaq' ? 'USD' : 'KRW'
          const averagePriceCurrency = resolveAveragePriceCurrency(homeHolding, quoteCurrency, quoteItem, { usdKrwRate: nextFxRate })
          const needsFx = requiresFxConversion(quoteCurrency, averagePriceCurrency)
          if (needsFx && (fxFetchFailed || nextFxRate === null)) {
            nextFailureKinds[itemKey] = 'fx-required'
            continue
          }

          const enrichedHolding = nextHoldingsById.get(homeHolding.id)
          patchQuote(
            { code: item.code, ticker: item.ticker, name: item.name, market: item.market },
            {
              currentPrice: quoteItem.price,
              currentPriceCurrency: quoteCurrency,
              currentProfitRate: parseOcrNumber(enrichedHolding?.change ?? '') ?? undefined,
              usdKrwRate: needsFx && nextFxRate !== null ? nextFxRate : undefined,
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

        setQuoteSummaryMessage(failureCount > 0 ? '일부 종목의 시세를 불러오지 못해 기존 OCR 값으로 표시했어요.' : null)
        setQuoteStatus('success', null, quoteQuery)
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return
        }

        setQuoteFailureKinds({})
        setQuoteSummaryMessage(null)
        setQuoteStatus('error', '현재 시세 응답이 지연되어 기존 시세로 표시 중이에요. 다시 시도해주세요.', quoteQuery)
      }
    }

    void hydrateQuotes()

    return () => {
      abortController.abort()
    }
  }, [clearItemQuote, hasUsHomeHoldings, patchQuote, quoteQuery, quoteRunKey, quoteSurfaceEnabled, refreshVersion, setQuoteStatus])

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
  const summary = useMemo(
    () => buildHomeV2Summary(homeHoldings, isAppliedPortfolio, { usdKrwRate: hasUsHomeHoldings ? usdKrwRate : null }),
    [hasUsHomeHoldings, homeHoldings, isAppliedPortfolio, usdKrwRate],
  )
  const defaultDeepScanHolding = useMemo(() => {
    if (selectedHolding?.kind === 'stock') {
      return selectedHolding
    }

    return pickDeepScanDefaultHolding(homeHoldings)
  }, [homeHoldings, selectedHolding])

  const handleQuoteRefresh = useCallback(() => {
    if (quoteStatus === 'loading') {
      return
    }

    setRefreshVersion((value) => value + 1)
  }, [quoteStatus])

  const scrollToCard = useCallback((id: number) => {
    const frame = frameRef.current
    const card = cardRefs.current[id]

    if (!frame || !card) {
      return
    }

    window.setTimeout(() => {
      frame.scrollTo({
        top: card.offsetTop - 76,
        behavior: 'smooth',
      })
    }, 80)
  }, [])

  const selectHolding = useCallback((id: number, shouldScroll = true) => {
    if (selectedId === id) {
      setSelectedId(null)
      setOpenCardId(null)
      return
    }

    setSelectedId(id)
    setOpenCardId(id)

    if (shouldScroll) {
      scrollToCard(id)
    }
  }, [scrollToCard, selectedId])

  const toggleCard = useCallback((id: number) => {
    if (openCardId === id) {
      setSelectedId(null)
      setOpenCardId(null)
      return
    }

    setSelectedId(id)
    setOpenCardId(id)
  }, [openCardId])

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
      market: holding.market,
      kind: holding.kind,
      shares: item.quantity,
      averagePrice: item.averagePrice,
      averagePriceCurrency: item.averagePriceCurrency,
      snapshotProfitRate: item.snapshotProfitRate,
      currentPrice: item.currentPrice,
      currentPriceCurrency: item.currentPriceCurrency,
      currentProfitRate: item.currentProfitRate,
      evaluationAmount: item.evaluationAmount,
    })
    persistDeepScanTarget(holding)
    setDeepScanTarget({
      ...toDeepScanTargetInput(item),
      usdKrwRate: hasUsHomeHoldings ? usdKrwRate ?? undefined : undefined,
    })

    if (deepScanNavigationIdRef.current !== navigationId) {
      return
    }

    router.push(actionHref)
  }, [hasUsHomeHoldings, homeHoldings, portfolioItems, router, setDeepScanTarget, usdKrwRate])

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

  const requestHoldingRemoval = useCallback((holding: HomeHolding) => {
    const item = portfolioItems[holding.id]

    if (!item || portfolioRemovalPending) {
      return
    }

    setOpenSheet(null)
    setPortfolioRemovalError(null)
    setPortfolioRemovalTarget({ item, displayName: holding.name })
  }, [portfolioItems, portfolioRemovalPending])

  const closeHoldingRemoval = useCallback(() => {
    if (portfolioRemovalPending) {
      return
    }

    setPortfolioRemovalTarget(null)
    setPortfolioRemovalError(null)
  }, [portfolioRemovalPending])

  const confirmHoldingRemoval = useCallback(async () => {
    if (!portfolioRemovalTarget || portfolioRemovalPending) {
      return
    }

    const currentItems = usePortfolioStore.getState().items
    const nextItems = removePortfolioItemFromList(currentItems, portfolioRemovalTarget.item)

    if (nextItems.length === currentItems.length) {
      setPortfolioRemovalTarget(null)
      setPortfolioRemovalError(null)
      return
    }

    const currentSession = readAppliedHomePortfolio()
    const broker = currentSession?.broker ?? '홈 편집 포트폴리오'
    const previousRows = buildAppliedHomePortfolioRowsFromPortfolioItems(currentItems)
    const nextRows = buildAppliedHomePortfolioRowsFromPortfolioItems(nextItems)
    const appliedAt = new Date().toISOString()

    setPortfolioRemovalPending(true)
    setPortfolioRemovalError(null)

    try {
      const persisted = persistAppliedHomePortfolio({ broker, rows: nextRows, appliedAt })
      if (!persisted) {
        setPortfolioRemovalError('기기 저장소에 변경 내용을 저장하지 못했어요. 다시 시도해주세요.')
        return
      }

      const syncResult = await syncPortfolioToServer(nextRows)
      if (!syncResult.ok && syncResult.reason === 'error') {
        persistAppliedHomePortfolio({ broker, rows: previousRows, appliedAt: currentSession?.appliedAt })
        setPortfolioRemovalError('저장된 포트폴리오를 변경하지 못했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')
        return
      }

      setPersistedPortfolioLoading(false)
      removePortfolioStoreItem(portfolioRemovalTarget.item)
      setSelectedId(null)
      setOpenCardId(null)
      setPortfolioRemovalTarget(null)
      setPortfolioRemovalError(null)
    } finally {
      setPortfolioRemovalPending(false)
    }
  }, [portfolioRemovalPending, portfolioRemovalTarget, removePortfolioStoreItem])

  if (!hasPortfolioItems) {
    if (persistedPortfolioLoading) {
      return (
        <div className={styles.viewport}>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--jaroo-bg)',
              zIndex: 50,
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--jaroo-muted)' }}>포트폴리오를 불러오는 중…</span>
          </div>
        </div>
      )
    }

    return (
      <div className={styles.viewport}>
        <div className={styles.frame}>
          <header className={styles.top}>
            <div className={styles.brand}>Jaroo</div>
            <AuthHomeStatus />
          </header>
          <main className={styles.body}>
            <div className={styles.forecastCard}>
              <div className={styles.forecastLabel}>포트폴리오 준비</div>
              <div className={styles.forecastText}>로그인하거나 스크린샷을 추가해서 보유 종목을 불러와요.</div>
              <Link href='/screenshot' className={styles.refreshBtn}>스크린샷 추가하기</Link>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.viewport}>
      <div ref={frameRef} className={styles.frame}>
        <header className={styles.top}>
          <div className={styles.brand}>Jaroo</div>
          <AuthHomeStatus />
          <div className={styles.topActions}>
            <Link href='/screenshot' className={styles.tbtn} aria-label='스크린샷 추가'>＋</Link>
            <button type='button' className={styles.tbtn} aria-label='알림' onClick={() => setOpenSheet('momentum')}>
              🔔<span className={styles.dot} />
            </button>
          </div>
        </header>

        <main className={styles.body}>
          <section className={styles.mainCard} aria-label='홈 포트폴리오 요약'>
            <div className={styles.mcTop}>
              <div>
                <div className={styles.mcLabel}>총 평가액</div>
                <div className={styles.mcTotal}>{summary.totalEvaluationText}</div>
                <div className={cn(styles.mcPl, getToneClass(summary.totalPnl))}>
                  {summary.totalPnlText} · {formatSignedRate(summary.totalRate)}
                </div>
              </div>
              <div className={cn(styles.mcBadge, summary.badgeTone === 'green' && styles.profit, summary.badgeTone === 'red' && styles.loss)}>
                {summary.badge}
              </div>
            </div>

            <HomeDonut holdings={homeHoldings} summary={summary} selectedId={selectedId} onSelect={selectHolding} />
            <div className={styles.mcHint}>{summary.hint}</div>
          </section>

          <button type='button' className={styles.trend} onClick={() => setOpenSheet('momentum')}>
            <span className={styles.trendLeft}><span className={styles.trendDot} />이번 주 포트폴리오 순풍</span>
            <span className={styles.trendRight}>{summary.momentumValue}</span>
          </button>

          {quoteSurfaceEnabled && quoteStatus === 'error' ? (
            <div className={styles.forecastCard}>
              <div className={styles.forecastLabel}>시세 지연</div>
              <div className={styles.forecastText}>{quoteErrorMessage ?? '현재 시세를 불러오지 못했어요. 다시 시도해주세요.'}</div>
              <button type='button' className={styles.refreshBtn} onClick={handleQuoteRefresh}>시세 다시 불러오기</button>
            </div>
          ) : null}
          {quoteSurfaceEnabled && quoteSummaryMessage ? (
            <div className={styles.forecastCard}>
              <div className={styles.forecastLabel}>일부 시세 대기</div>
              <div className={styles.forecastText}>{quoteSummaryMessage}</div>
            </div>
          ) : null}

          <div className={styles.sectionHeader}>
            <div className={styles.sectionLabel}>종목별 현황</div>
            <button type='button' className={styles.refreshTextBtn} onClick={handleQuoteRefresh}>
              {quoteSurfaceEnabled && quoteStatus === 'loading' ? '불러오는 중' : '시세 새로고침'}
            </button>
          </div>

          {homeHoldings.map((item) => (
            <div
              key={item.id}
              ref={(node) => {
                cardRefs.current[item.id] = node
              }}
            >
              <StockCard
                item={item}
                open={openCardId === item.id}
                onToggle={() => toggleCard(item.id)}
                onAction={handleHoldingActionClick}
                onRemove={requestHoldingRemoval}
                removeDisabled={portfolioRemovalPending}
              />
            </div>
          ))}

          {!isAppliedPortfolio ? <div className={styles.forecastCard}>
            <div className={styles.forecastLabel}>{summary.forecast.label}</div>
            <div className={styles.forecastText}>{summary.forecast.body}</div>
            <Link
              href={summary.forecast.href}
              className={styles.forecastMore}
              onClick={(event) => {
                if (summary.forecast.href === '/deepscan' && defaultDeepScanHolding) {
                  event.preventDefault()
                  void navigateToDeepScanForHolding(defaultDeepScanHolding.id, summary.forecast.href)
                }
              }}
            >
              {summary.forecast.cta}
            </Link>
          </div> : null}
        </main>

        <AppBottomNav />
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
            <div className={styles.sheetSubtitle}>세 팀이 종목별 회복 신호를 간단히 요약해요</div>
            <div className={styles.momentumStages}>
              {summary.momentumStages.map((stage) => (
                <div key={stage.label} className={cn(styles.momentumStage, stage.active && styles.momentumStageActive)}>
                  <div className={styles.momentumStageLabel}>{stage.label}</div>
                  <div className={styles.momentumStageSub}>{stage.subtitle}</div>
                </div>
              ))}
            </div>
            <div className={styles.sheetSectionTitle}>종목별 회복 신호</div>
            {summary.momentumSignals.map((signal) => (
              <div key={signal.name} className={styles.signalCard}>
                <div className={styles.signalRow}>
                  <span className={styles.signal} style={{ background: signal.dot }} />
                  <div className={styles.signalName}>{signal.name}</div>
                  <div className={styles.signalBadge} style={{ background: signal.badgeBackground, color: signal.badgeColor }}>{signal.badge}</div>
                </div>
                <div className={styles.signalDesc}>{signal.description}</div>
              </div>
            ))}
          </div>
          {portfolioRemovalTarget ? (
            <div className={styles.confirmLayer}>
              <button
                type='button'
                className={styles.confirmBackdrop}
                onClick={closeHoldingRemoval}
                disabled={portfolioRemovalPending}
                aria-label='종목 제거 창 닫기'
              />
              <section
                className={styles.confirmDialog}
                role='dialog'
                aria-modal='true'
                aria-labelledby='portfolio-removal-title'
                aria-describedby='portfolio-removal-description'
              >
                <h2 id='portfolio-removal-title' className={styles.confirmTitle}>종목을 제거할까요?</h2>
                <p id='portfolio-removal-description' className={styles.confirmDescription}>
                  <strong>{portfolioRemovalTarget.displayName}</strong> 종목이 홈과 저장된 포트폴리오에서 제거됩니다.
                  {portfolioItems.length === 1 ? ' 마지막 종목을 제거하면 빈 포트폴리오 화면으로 전환됩니다.' : ''}
                </p>
                {portfolioRemovalError ? <p className={styles.confirmError} role='alert'>{portfolioRemovalError}</p> : null}
                <div className={styles.confirmActions}>
                  <button
                    type='button'
                    className={styles.confirmCancelBtn}
                    onClick={closeHoldingRemoval}
                    disabled={portfolioRemovalPending}
                    autoFocus
                  >
                    취소
                  </button>
                  <button
                    type='button'
                    className={styles.confirmRemoveBtn}
                    onClick={() => void confirmHoldingRemoval()}
                    disabled={portfolioRemovalPending}
                  >
                    {portfolioRemovalPending ? '제거 중…' : '제거하기'}
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>

      {deepScanLoadingTarget ? (
        <div className={styles.deepScanLoadingMount}>
          <div className={styles.deepScanLoadingInner}>
            <DeepScanLoadingScreen
              name={deepScanLoadingTarget.name}
              identifier={deepScanLoadingTarget.identifier}
              market={deepScanLoadingTarget.market}
              instrumentKind={deepScanLoadingTarget.kind}
              shares={deepScanLoadingTarget.shares}
              averagePrice={deepScanLoadingTarget.averagePrice}
              averagePriceCurrency={deepScanLoadingTarget.averagePriceCurrency}
              currentPrice={deepScanLoadingTarget.currentPrice}
              currentPriceCurrency={deepScanLoadingTarget.currentPriceCurrency}
              currentProfitRate={deepScanLoadingTarget.currentProfitRate}
              snapshotProfitRate={deepScanLoadingTarget.snapshotProfitRate}
              onBack={cancelDeepScanLoading}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
