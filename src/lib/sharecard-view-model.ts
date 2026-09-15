import type { HomeHolding } from '@/lib/holding-types'
import type { ShareCardPerformanceTone, ShareCardStock, ShareCardWind } from '@/lib/jaroo-data'
import { parseOcrNumber } from '@/lib/screenshot-ocr'

// /sharecard 공유 카드를 홈 보유 종목(HomeHolding) 실데이터로 만드는 뷰 모델.
// 금액 포맷 규칙은 홈(home-current-quotes)과 같은 컨벤션을 따른다 —
// KRW는 정수 원화, USD는 소수 2자리.

export type SharePortfolioCardModel = {
  momentumLabel: ShareCardWind
  momentumDetail: string
  totalPnl: string
  totalSummary: string
  date: string
  brand: string
}

export type BuildSharePortfolioCardOptions = {
  usdKrwRate?: number | null
  now?: Date
}

type ShareMoneyCurrency = 'KRW' | 'USD'

type ShareMoneyEntry = {
  value: number
  currency: ShareMoneyCurrency
}

type ShareMoneySummary = {
  value: number | null
  currency: ShareMoneyCurrency
  mixedWithoutFx: boolean
}

function inferMoneyCurrency(holding: HomeHolding, text: string): ShareMoneyCurrency {
  const normalized = text.trim().toUpperCase()

  if (normalized.includes('$') || normalized.includes('USD')) {
    return 'USD'
  }

  if (normalized.includes('₩') || normalized.includes('KRW') || normalized.includes('원')) {
    return 'KRW'
  }

  return holding.marketTone === 'nasdaq' ? 'USD' : 'KRW'
}

function readMoneyEntry(holding: HomeHolding, text: string | undefined): ShareMoneyEntry | null {
  const trimmed = text?.trim()

  if (!trimmed) {
    return null
  }

  const value = parseOcrNumber(trimmed)
  return value === null ? null : { value, currency: inferMoneyCurrency(holding, trimmed) }
}

function readEvaluationEntry(holding: HomeHolding): ShareMoneyEntry | null {
  const directEntry = readMoneyEntry(holding, holding.evaluationAmount)
  if (directEntry) {
    return directEntry
  }

  // 평가금액 텍스트가 없으면 수량×평단으로 대체한다 — 홈 요약(getEvaluationAmount)과 같은 규칙.
  const quantity = parseOcrNumber(holding.shares)
  const averagePrice = parseOcrNumber(holding.averagePrice)

  if (quantity === null || averagePrice === null) {
    return null
  }

  return { value: quantity * averagePrice, currency: inferMoneyCurrency(holding, holding.averagePrice) }
}

function summarizeShareMoneyEntries(entries: ShareMoneyEntry[], usdKrwRate: number | null): ShareMoneySummary {
  if (entries.length === 0) {
    return { value: null, currency: 'KRW', mixedWithoutFx: false }
  }

  const currencies = new Set(entries.map((entry) => entry.currency))

  if (currencies.size === 1) {
    const [currency] = [...currencies]
    return {
      value: entries.reduce((sum, entry) => sum + entry.value, 0),
      currency,
      mixedWithoutFx: false,
    }
  }

  if (typeof usdKrwRate === 'number' && Number.isFinite(usdKrwRate) && usdKrwRate > 0) {
    return {
      value: entries.reduce((sum, entry) => sum + (entry.currency === 'USD' ? entry.value * usdKrwRate : entry.value), 0),
      currency: 'KRW',
      mixedWithoutFx: false,
    }
  }

  return { value: null, currency: 'KRW', mixedWithoutFx: true }
}

function formatSignedShareMoney(value: number | null, currency: ShareMoneyCurrency) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  const sign = value > 0 ? '+' : value < 0 ? '-' : ''

  if (currency === 'USD') {
    return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return `${sign}${Math.round(Math.abs(value)).toLocaleString('ko-KR')}원`
}

function formatSignedShareRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null
  }

  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

function deriveWind(changeValue: number | null): ShareCardWind {
  if (changeValue === null) {
    return '미풍'
  }

  if (changeValue >= 0) {
    return '순풍'
  }

  return changeValue > -10 ? '미풍' : '역풍'
}

function derivePerformanceTone(changeValue: number | null): ShareCardPerformanceTone {
  if (changeValue === null) {
    return 'neutral'
  }

  return changeValue >= 0 ? 'positive' : 'danger'
}

export function buildShareStockCards(holdings: HomeHolding[]): ShareCardStock[] {
  return holdings.map((holding) => {
    const changeValue = parseOcrNumber(holding.change)

    return {
      name: holding.name,
      market: holding.market,
      quantity: holding.shares,
      averagePrice: holding.averagePrice,
      rate: holding.change,
      amount: holding.pnl,
      status: holding.badge,
      performanceTone: derivePerformanceTone(changeValue),
      wind: deriveWind(changeValue),
      dot: holding.donutColor,
    }
  })
}

function formatShareCardDate(now: Date) {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

export function buildSharePortfolioCard(holdings: HomeHolding[], options: BuildSharePortfolioCardOptions = {}): SharePortfolioCardModel {
  const usdKrwRate = options.usdKrwRate ?? null
  const pnlSummary = summarizeShareMoneyEntries(
    holdings.flatMap((holding) => {
      const entry = readMoneyEntry(holding, holding.pnl)
      return entry ? [entry] : []
    }),
    usdKrwRate,
  )
  const evaluationSummary = summarizeShareMoneyEntries(
    holdings
      .map((holding) => readEvaluationEntry(holding))
      .filter((entry): entry is ShareMoneyEntry => entry !== null),
    usdKrwRate,
  )

  const totalPnl = pnlSummary.value
  const canCalculateRate = totalPnl !== null
    && evaluationSummary.value !== null
    && !pnlSummary.mixedWithoutFx
    && !evaluationSummary.mixedWithoutFx
    && pnlSummary.currency === evaluationSummary.currency
  const principal = canCalculateRate && evaluationSummary.value !== null && totalPnl !== null
    ? evaluationSummary.value - totalPnl
    : null
  const totalRate = principal !== null && principal > 0 && totalPnl !== null ? (totalPnl / principal) * 100 : null
  const totalSummary = [
    totalRate !== null ? `전체 수익률 ${formatSignedShareRate(totalRate)}` : null,
    `${holdings.length}개 종목`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const changeValues = holdings
    .map((holding) => parseOcrNumber(holding.change))
    .filter((value): value is number => value !== null)
  const averageRate = changeValues.length > 0
    ? changeValues.reduce((sum, value) => sum + value, 0) / changeValues.length
    : null
  const momentumDetail = averageRate === null
    ? '데이터 확인 중'
    : averageRate >= 8
      ? '빠르게 개선 중 ↑'
      : averageRate >= 0
        ? '나아지는 중 ↑'
        : averageRate >= -10
          ? '천천히 회복 중 →'
          : '경계 필요 ↓'

  return {
    momentumLabel: deriveWind(averageRate),
    momentumDetail,
    totalPnl: formatSignedShareMoney(totalPnl, pnlSummary.currency),
    totalSummary,
    date: formatShareCardDate(options.now ?? new Date()),
    brand: 'jaroo.kr',
  }
}
