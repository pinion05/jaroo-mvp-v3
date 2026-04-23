import { parseOcrNumber } from '@/lib/screenshot-ocr'
import type { HomeHolding } from '@/lib/jaroo-home-data'

export type CurrentQuoteItem = {
  market?: string | null
  code?: string | null
  ticker?: string | null
  price?: number | null
  currency?: string | null
  asOf?: string | null
  source?: string | null
  status?: string | null
}

export type CurrentQuoteFxOptions = {
  usdKrwRate?: number | null
}

function upsertMetric(
  metrics: HomeHolding['metrics'],
  label: string,
  value: string,
  tone: HomeHolding['metrics'][number]['tone'] = 'neutral',
) {
  let matched = false
  const nextMetrics = metrics.map((metric) => {
    if (metric.label !== label) {
      return metric
    }

    matched = true
    return { ...metric, value, tone }
  })

  if (!matched) {
    nextMetrics.push({ label, value, tone })
  }

  return nextMetrics
}

function inferCurrencyFromMoneyText(value: string | undefined) {
  const normalized = value?.trim().toUpperCase() ?? ''

  if (!normalized) {
    return null
  }

  if (normalized.includes('$') || normalized.includes('USD')) {
    return 'USD' as const
  }

  if (normalized.includes('₩') || normalized.includes('원') || normalized.includes('KRW')) {
    return 'KRW' as const
  }

  return null
}

function resolveQuoteCurrency(holding: HomeHolding, quoteItem?: CurrentQuoteItem) {
  if (quoteItem?.currency === 'USD' || holding.marketTone === 'nasdaq') {
    return 'USD' as const
  }

  return 'KRW' as const
}

export function resolveAveragePriceCurrency(
  holding: HomeHolding,
  quoteCurrency: 'KRW' | 'USD',
  quoteItem?: CurrentQuoteItem,
  options: CurrentQuoteFxOptions = {},
) {
  if (holding.averagePriceCurrency === 'KRW' || holding.averagePriceCurrency === 'USD') {
    return holding.averagePriceCurrency
  }

  const explicitCurrency = inferCurrencyFromMoneyText(holding.averagePrice)
  if (explicitCurrency) {
    return explicitCurrency
  }

  if (quoteCurrency === 'KRW') {
    return 'KRW' as const
  }

  if (holding.marketTone !== 'nasdaq') {
    return quoteCurrency
  }

  const averagePriceValue = parseOcrNumber(holding.averagePrice)
  const quotePrice = typeof quoteItem?.price === 'number' && Number.isFinite(quoteItem.price) ? quoteItem.price : null
  if (averagePriceValue === null || quotePrice === null || quotePrice <= 0) {
    return null
  }

  const usdKrwRate = options.usdKrwRate
  if (typeof usdKrwRate === 'number' && Number.isFinite(usdKrwRate) && usdKrwRate > 0) {
    const krwComparablePrice = quotePrice * usdKrwRate
    const usdRelativeDistance = Math.abs(averagePriceValue - quotePrice) / Math.max(Math.abs(quotePrice), 1)
    const krwRelativeDistance = Math.abs(averagePriceValue - krwComparablePrice) / Math.max(Math.abs(krwComparablePrice), 1)

    return krwRelativeDistance < usdRelativeDistance ? 'KRW' : 'USD'
  }

  return averagePriceValue > quotePrice * 20 ? 'KRW' : 'USD'
}

export function requiresFxConversion(
  quoteCurrency: 'KRW' | 'USD',
  averagePriceCurrency: 'KRW' | 'USD' | null,
) {
  return quoteCurrency === 'USD' && averagePriceCurrency === 'KRW'
}

function convertMoneyAmount(
  value: number | null,
  fromCurrency: 'KRW' | 'USD' | null,
  toCurrency: 'KRW' | 'USD',
  options: CurrentQuoteFxOptions,
) {
  if (value === null || fromCurrency === null) {
    return null
  }

  if (fromCurrency === toCurrency) {
    return value
  }

  const usdKrwRate = options.usdKrwRate
  if (typeof usdKrwRate !== 'number' || !Number.isFinite(usdKrwRate) || usdKrwRate <= 0) {
    return null
  }

  if (fromCurrency === 'KRW' && toCurrency === 'USD') {
    return value / usdKrwRate
  }

  if (fromCurrency === 'USD' && toCurrency === 'KRW') {
    return value * usdKrwRate
  }

  return null
}

function formatMoney(value: number, currency: 'KRW' | 'USD') {
  if (currency === 'USD') {
    return `$${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatSignedMoney(value: number | null, currency: 'KRW' | 'USD') {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  if (currency === 'USD') {
    return `${value > 0 ? '+' : value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.round(Math.abs(value)).toLocaleString('ko-KR')}원`
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  const roundedValue = Number(value.toFixed(1))
  return `${roundedValue >= 0 ? '+' : ''}${roundedValue.toFixed(1)}%`
}

function computeHoldingBaseValue(holding: HomeHolding) {
  const shareCount = parseOcrNumber(holding.shares)
  const averagePriceValue = parseOcrNumber(holding.averagePrice)

  if (shareCount === null || averagePriceValue === null) {
    return null
  }

  const baseValue = shareCount * averagePriceValue
  return Number.isFinite(baseValue) && baseValue > 0 ? baseValue : null
}

function deriveMetricTone(changeValue: number | null): HomeHolding['metrics'][number]['tone'] {
  if (changeValue === null) {
    return 'neutral'
  }

  if (changeValue >= 0) {
    return 'positive'
  }

  return changeValue <= -20 ? 'danger' : 'warning'
}

function deriveExchangeProductBadge(changeValue: number | null) {
  if (changeValue === null) {
    return null
  }

  if (changeValue >= 0) {
    return {
      badge: '수익 중' as const,
      badgeTone: 'green' as const,
    }
  }

  return {
    badge: '손실 중' as const,
    badgeTone: 'red' as const,
  }
}

function applyLiveTone(holding: HomeHolding, changeValue: number | null) {
  const isEtnHolding = /ETN/i.test(holding.market ?? '')

  if (changeValue === null) {
    return holding
  }

  if (holding.kind === 'etf') {
    const exchangeProductBadge = deriveExchangeProductBadge(changeValue)
    if (!exchangeProductBadge) {
      return holding
    }

    const nextHolding = {
      ...holding,
      badge: exchangeProductBadge.badge,
      badgeTone: exchangeProductBadge.badgeTone,
      centerBadge: exchangeProductBadge.badge,
      centerBadgeTone: exchangeProductBadge.badgeTone,
      heatmapBadge: exchangeProductBadge.badge,
      heatmapBadgeTone: exchangeProductBadge.badgeTone,
    }

    if (!isEtnHolding) {
      return nextHolding
    }

    if (changeValue >= 0) {
      return {
        ...nextHolding,
        cardTone: 'profit' as const,
        signalTone: 'positive' as const,
        centerScoreColor: '#9FE1CB',
        heatmapBackground: '#1A7A5E',
        blink: undefined,
      }
    }

    if (changeValue <= -20) {
      return {
        ...nextHolding,
        cardTone: 'danger' as const,
        signalTone: 'danger' as const,
        centerScoreColor: '#F09595',
        heatmapBackground: '#C13030',
        blink: true,
      }
    }

    return {
      ...nextHolding,
      cardTone: 'warning' as const,
      signalTone: 'warning' as const,
      centerScoreColor: '#FAC775',
      heatmapBackground: '#BC7010',
      blink: undefined,
    }
  }

  if (changeValue >= 0) {
    return {
      ...holding,
      badge: '수익 중' as const,
      badgeTone: 'green' as const,
      cardTone: 'profit' as const,
      signalTone: 'positive' as const,
      centerScoreColor: '#9FE1CB',
      centerBadge: '수익 중',
      centerBadgeTone: 'green' as const,
      heatmapBackground: '#1A7A5E',
      heatmapBadge: '수익 중',
      heatmapBadgeTone: 'green' as const,
      blink: undefined,
    }
  }

  if (changeValue <= -20) {
    return {
      ...holding,
      badge: '긴급 점검' as const,
      badgeTone: 'red' as const,
      cardTone: 'danger' as const,
      signalTone: 'danger' as const,
      centerScoreColor: '#F09595',
      centerBadge: '긴급 점검',
      centerBadgeTone: 'red' as const,
      heatmapBackground: '#C13030',
      heatmapBadge: '긴급 점검',
      heatmapBadgeTone: 'red' as const,
      blink: true,
    }
  }

  return {
    ...holding,
    badge: '관찰 중' as const,
    badgeTone: 'amber' as const,
    cardTone: 'warning' as const,
    signalTone: 'warning' as const,
    centerScoreColor: '#FAC775',
    centerBadge: '관찰 중',
    centerBadgeTone: 'amber' as const,
    heatmapBackground: '#BC7010',
    heatmapBadge: '관찰 중',
    heatmapBadgeTone: 'amber' as const,
    blink: undefined,
  }
}

export type HomeHoldingQuoteErrorKind = 'quote-unavailable' | 'fx-required' | 'holding-invalid'

export function shouldTreatQuoteFailureAsErrorCard(
  holding: Pick<HomeHolding, 'kind'>,
  kind: HomeHoldingQuoteErrorKind,
) {
  if (kind === 'quote-unavailable' && holding.kind === 'etf') {
    return false
  }

  return true
}

export function buildQuoteLookupKey(item: Pick<HomeHolding, 'marketTone' | 'identifierCode' | 'identifierTicker' | 'code'>) {
  if (item.marketTone === 'nasdaq') {
    return item.identifierTicker?.trim().toUpperCase() || undefined
  }

  return item.identifierCode?.trim() || item.code?.trim() || undefined
}

export function buildHomeCurrentQuoteQuery(holdings: HomeHolding[]) {
  const codes = new Set<string>()
  const tickers = new Set<string>()

  for (const holding of holdings) {
    const key = buildQuoteLookupKey(holding)
    if (!key) continue

    if (holding.marketTone === 'nasdaq') {
      tickers.add(key)
      continue
    }

    codes.add(key)
  }

  const searchParams = new URLSearchParams()
  if (codes.size > 0) {
    searchParams.set('codes', [...codes].join(','))
  }
  if (tickers.size > 0) {
    searchParams.set('tickers', [...tickers].join(','))
  }

  return searchParams.toString()
}

export function buildHomeHoldingErrorCard(holding: HomeHolding, kind: HomeHoldingQuoteErrorKind): HomeHolding {
  const label = kind === 'fx-required'
    ? '환율 오류'
    : kind === 'holding-invalid'
      ? '데이터 오류'
      : '시세 오류'
  const description = kind === 'fx-required'
    ? 'USD/KRW 환율을 불러오지 못해 이 종목의 수익률을 계산하지 못했어요.'
    : kind === 'holding-invalid'
      ? '이 종목의 데이터 형식이 올바르지 않아 홈에서 계산할 수 없어요.'
      : '현재 시세를 불러오지 못해 이 종목의 손익을 계산하지 못했어요.'

  return {
    ...holding,
    badge: label,
    badgeTone: 'red',
    cardTone: 'danger',
    signalTone: holding.kind === 'etf' ? 'etf' : 'danger',
    change: label,
    pnl: '-',
    centerScore: '오류',
    centerScoreColor: '#F09595',
    centerBadge: label,
    centerBadgeTone: 'red',
    heatmapChange: undefined,
    heatmapMeta: kind === 'fx-required' ? '수익률 대기' : '재시도 필요',
    heatmapBadge: label,
    heatmapBadgeTone: 'red',
    blink: holding.kind === 'etf' ? undefined : true,
    opinionLabel: '오류 안내',
    opinionText: description,
    opinionBackground: '#FFF0F0',
    opinionBorder: '#F7C1C1',
    opinionTextColor: '#791F1F',
    metaLine: `${holding.metaLine} · ${label}`,
    metrics: upsertMetric(
      upsertMetric(
        upsertMetric(holding.metrics, '현재가', '-', 'danger'),
        '평가 금액',
        '-',
        'danger',
      ),
      '수익률',
      kind === 'fx-required' ? '환율 필요' : '-',
      'danger',
    ),
  }
}

export function applyCurrentQuotesToHomeHoldings(
  holdings: HomeHolding[],
  quoteItems: CurrentQuoteItem[],
  options: CurrentQuoteFxOptions = {},
) {
  const quoteMap = new Map<string, CurrentQuoteItem>()

  for (const quoteItem of quoteItems) {
    const key = quoteItem.market === 'US'
      ? quoteItem.ticker?.trim().toUpperCase()
      : quoteItem.code?.trim()

    if (!key || quoteItem.status !== 'ok' || typeof quoteItem.price !== 'number') {
      continue
    }

    quoteMap.set(key, quoteItem)
  }

  const updatedHoldings = holdings.map((holding) => {
    const key = buildQuoteLookupKey(holding)
    if (!key) {
      return {
        holding,
        weightValue: computeHoldingBaseValue(holding) ?? 1,
      }
    }

    const quoteItem = quoteMap.get(key)
    if (!quoteItem || typeof quoteItem.price !== 'number') {
      return {
        holding,
        weightValue: computeHoldingBaseValue(holding) ?? 1,
      }
    }

    const quoteCurrency = resolveQuoteCurrency(holding, quoteItem)
    const averagePriceCurrency = resolveAveragePriceCurrency(holding, quoteCurrency, quoteItem, options)
    const livePriceText = formatMoney(quoteItem.price, quoteCurrency)
    const shareCount = parseOcrNumber(holding.shares)
    const averagePriceValue = parseOcrNumber(holding.averagePrice)
    const evaluationAmountValue = shareCount === null ? null : quoteItem.price * shareCount
    const rawCostBasisValue = shareCount === null || averagePriceValue === null ? null : shareCount * averagePriceValue
    const costBasisValue = convertMoneyAmount(rawCostBasisValue, averagePriceCurrency, quoteCurrency, options)
    const pnlValue = evaluationAmountValue === null || costBasisValue === null ? null : evaluationAmountValue - costBasisValue
    const changeValue = pnlValue === null || costBasisValue === null || costBasisValue === 0
      ? null
      : (pnlValue / costBasisValue) * 100
    const evaluationAmountText = evaluationAmountValue === null ? '-' : formatMoney(evaluationAmountValue, quoteCurrency)
    const pnlText = formatSignedMoney(pnlValue, quoteCurrency)
    const changeText = formatPercent(changeValue)
    const metricTone = deriveMetricTone(changeValue)
    const baseMetaLine = holding.metaLine
      .replace(/ · 평가금액 [^·]+/g, '')
      .replace(/ · 현재가 .*$/, '')
    const metaLine = `${baseMetaLine} · 평가금액 ${evaluationAmountText} · 현재가 ${livePriceText}`

    const nextHolding = applyLiveTone({
      ...holding,
      evaluationAmount: evaluationAmountText,
      metaLine,
      change: changeText,
      pnl: pnlText,
      centerScore: changeText,
      heatmapChange: changeText,
      metrics: upsertMetric(
        upsertMetric(
          upsertMetric(holding.metrics, '수익률', changeText, metricTone),
          '평가 금액',
          evaluationAmountText,
          'neutral',
        ),
        '현재가',
        livePriceText,
        'neutral',
      ),
    }, changeValue)

    const normalizedWeightValue = convertMoneyAmount(evaluationAmountValue, quoteCurrency, 'KRW', options)
      ?? convertMoneyAmount(rawCostBasisValue, averagePriceCurrency, 'KRW', options)
      ?? evaluationAmountValue
      ?? computeHoldingBaseValue(nextHolding)
      ?? 1

    return {
      holding: nextHolding,
      weightValue: normalizedWeightValue,
    }
  })

  const totalWeight = updatedHoldings.reduce((sum, item) => sum + item.weightValue, 0) || updatedHoldings.length

  return updatedHoldings.map(({ holding, weightValue }) => {
    const donutPercent = weightValue / totalWeight

    return {
      ...holding,
      donutPercent,
      heatmapWeight: `${Math.round(donutPercent * 100)}%`,
    }
  })
}
