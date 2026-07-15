export type LoadingMetricValue = string | number | undefined
export type LoadingMetricCurrency = 'KRW' | 'USD'

function inferLoadingMetricCurrency(value: LoadingMetricValue, fallback?: LoadingMetricCurrency) {
  if (typeof value === 'string') {
    if (/\$|USD/i.test(value)) {
      return 'USD'
    }
    if (/원|₩|KRW/i.test(value)) {
      return 'KRW'
    }
  }

  return fallback
}

export function parseLoadingNumericValue(value: LoadingMetricValue) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function formatLoadingSignedPercent(value: LoadingMetricValue) {
  const numericValue = parseLoadingNumericValue(value)
  if (numericValue === null) {
    return null
  }

  const roundedValue = Number(numericValue.toFixed(1))
  const sign = roundedValue > 0 ? '+' : ''
  return `${sign}${roundedValue.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`
}

export function buildDeepScanReturnRateDisplay({
  currentProfitRate,
  snapshotProfitRate,
}: {
  currentProfitRate?: LoadingMetricValue
  snapshotProfitRate?: LoadingMetricValue
}) {
  return {
    current: formatLoadingSignedPercent(currentProfitRate),
    snapshot: formatLoadingSignedPercent(snapshotProfitRate),
  }
}

export function calculateFallbackEvaluationAmount({
  evaluationAmount,
  currentPrice,
  shares,
  averagePrice,
  currentProfitRate,
}: {
  evaluationAmount?: LoadingMetricValue
  currentPrice?: LoadingMetricValue
  shares?: LoadingMetricValue
  averagePrice?: LoadingMetricValue
  currentProfitRate?: LoadingMetricValue
}) {
  const shareCount = parseLoadingNumericValue(shares)
  if (shareCount !== null) {
    const currentPriceValue = parseLoadingNumericValue(currentPrice)
    if (currentPriceValue !== null) {
      return currentPriceValue * shareCount
    }

    const averagePriceValue = parseLoadingNumericValue(averagePrice)
    const profitRateValue = parseLoadingNumericValue(currentProfitRate)
    if (averagePriceValue !== null && profitRateValue !== null) {
      return averagePriceValue * (1 + profitRateValue / 100) * shareCount
    }
  }

  return parseLoadingNumericValue(evaluationAmount) !== null ? evaluationAmount : undefined
}

export function calculateFallbackEvaluationMoney({
  evaluationAmount,
  currentPrice,
  shares,
  averagePrice,
  currentProfitRate,
  currentPriceCurrency,
  averagePriceCurrency,
  evaluationAmountCurrency,
}: {
  evaluationAmount?: LoadingMetricValue
  currentPrice?: LoadingMetricValue
  shares?: LoadingMetricValue
  averagePrice?: LoadingMetricValue
  currentProfitRate?: LoadingMetricValue
  currentPriceCurrency?: LoadingMetricCurrency
  averagePriceCurrency?: LoadingMetricCurrency
  evaluationAmountCurrency?: LoadingMetricCurrency
}) {
  const shareCount = parseLoadingNumericValue(shares)
  if (shareCount !== null) {
    const currentPriceValue = parseLoadingNumericValue(currentPrice)
    if (currentPriceValue !== null) {
      return {
        amount: currentPriceValue * shareCount,
        currency: inferLoadingMetricCurrency(currentPrice, currentPriceCurrency),
        source: 'current-price' as const,
      }
    }

    const averagePriceValue = parseLoadingNumericValue(averagePrice)
    const profitRateValue = parseLoadingNumericValue(currentProfitRate)
    if (averagePriceValue !== null && profitRateValue !== null) {
      return {
        amount: averagePriceValue * (1 + profitRateValue / 100) * shareCount,
        currency: inferLoadingMetricCurrency(averagePrice, averagePriceCurrency),
        source: 'average-price-profit-rate' as const,
      }
    }
  }

  return parseLoadingNumericValue(evaluationAmount) !== null
    ? {
      amount: evaluationAmount,
      currency: inferLoadingMetricCurrency(evaluationAmount, evaluationAmountCurrency ?? averagePriceCurrency),
      source: 'evaluation-amount' as const,
    }
    : null
}
