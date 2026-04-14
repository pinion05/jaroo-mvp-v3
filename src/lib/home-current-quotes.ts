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

function resolveHoldingCurrency(holding: HomeHolding, quoteItem?: CurrentQuoteItem) {
  if (quoteItem?.currency === 'USD' || holding.marketTone === 'nasdaq') {
    return 'USD' as const
  }

  return 'KRW' as const
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
  const evaluationAmountValue = parseOcrNumber(holding.evaluationAmount ?? '')
  if (evaluationAmountValue !== null && evaluationAmountValue > 0) {
    return evaluationAmountValue
  }

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

function applyLiveTone(holding: HomeHolding, changeValue: number | null) {
  if (holding.kind === 'etf' || changeValue === null) {
    return holding
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

function buildQuoteLookupKey(item: Pick<HomeHolding, 'marketTone' | 'identifierCode' | 'identifierTicker' | 'code'>) {
  if (item.marketTone === 'nasdaq' || item.identifierTicker) {
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

    if (holding.marketTone === 'nasdaq' || holding.identifierTicker) {
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

export function applyCurrentQuotesToHomeHoldings(holdings: HomeHolding[], quoteItems: CurrentQuoteItem[]) {
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

    const currency = resolveHoldingCurrency(holding, quoteItem)
    const livePriceText = formatMoney(quoteItem.price, currency)
    const shareCount = parseOcrNumber(holding.shares)
    const averagePriceValue = parseOcrNumber(holding.averagePrice)
    const evaluationAmountValue = shareCount === null ? null : quoteItem.price * shareCount
    const costBasisValue = shareCount === null || averagePriceValue === null ? null : shareCount * averagePriceValue
    const pnlValue = evaluationAmountValue === null || costBasisValue === null ? null : evaluationAmountValue - costBasisValue
    const changeValue = pnlValue === null || costBasisValue === null || costBasisValue === 0
      ? null
      : (pnlValue / costBasisValue) * 100
    const evaluationAmountText = evaluationAmountValue === null ? '-' : formatMoney(evaluationAmountValue, currency)
    const pnlText = formatSignedMoney(pnlValue, currency)
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

    return {
      holding: nextHolding,
      weightValue: evaluationAmountValue ?? computeHoldingBaseValue(nextHolding) ?? 1,
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
