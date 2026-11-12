/**
 * 딥스캔 평단가 통화 정규화 — 서버(build-payload)와 클라이언트(딥스캔 로딩 화면)가
 * 같은 추론을 쓴다(2026-11-12 블랙박스 테스트 T4L-B2 회귀).
 *
 * 문제 맥락: US 종목의 포트폴리오 평단가는 DB에 통화 없이 저장되는 경우가 있다
 * (OCR 확정 시 원화평단-미국주 가능성을 배제할 수 없어 undefined 로 남김 —
 * src/lib/workflow-types.ts inferAveragePriceCurrency 참고). 서버는
 * resolveCurrencyAwareAveragePrice 의 거리 휴리스틱으로 USD/KRW 를 올바로
 * 추론하지만, 클라이언트 로딩 화면은 prop 기본값 'KRW' 로 자체 환산하며
 * "평단 228원 → 환산 $0.17 → +207,846.84%" 같은 폭주 수익률을 내놓았다.
 * 이 모듈을 양쪽이 공유해 추론이 어긋나지 않게 한다.
 */

export type MoneyCurrency = 'KRW' | 'USD'

export type CurrencyAwareAveragePriceInput = {
  averagePrice?: string | number | null
  averagePriceCurrency?: string | null
  currentPrice?: number | null
  currentPriceCurrency?: string | null
  usdKrwRate?: number | null
}

export type CurrencyAwareAveragePriceResult = {
  averagePrice: number | null
  averagePriceCurrency: MoneyCurrency | null
  currentPriceCurrency: MoneyCurrency
  averagePriceInCurrentCurrency: number | null
  requiresFx: boolean
  usdKrwRate: number | null
  converted: boolean
  blockedReason: string | null
}

export function parseNumberish(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().replace(/[−–—]/g, '-')
  if (!normalized) {
    return null
  }

  const cleaned = normalized.replaceAll(',', '').replace(/[₩$€¥£%원주]/g, '')
  if (!cleaned || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null
  }

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeMoneyCurrency(value: unknown): MoneyCurrency | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toUpperCase()
  if (normalized === 'KRW' || normalized.includes('원') || normalized.includes('₩')) {
    return 'KRW'
  }

  if (normalized === 'USD' || normalized.includes('$') || normalized.includes('달러')) {
    return 'USD'
  }

  return null
}

export function normalizeUsdKrwRate(value: unknown) {
  const parsed = parseNumberish(value)
  return typeof parsed === 'number' && parsed > 0 ? parsed : null
}

export function inferAveragePriceCurrency({
  averagePrice,
  averagePriceCurrency,
  currentPrice,
  currentPriceCurrency,
  usdKrwRate,
}: Required<Pick<CurrencyAwareAveragePriceResult, 'currentPriceCurrency'>> & {
  averagePrice: number | null
  averagePriceCurrency?: string | null
  currentPrice?: number | null
  usdKrwRate?: number | null
}) {
  const explicitCurrency = normalizeMoneyCurrency(averagePriceCurrency)
  if (explicitCurrency) {
    return explicitCurrency
  }

  if (averagePrice === null) {
    return null
  }

  if (currentPriceCurrency === 'KRW') {
    return 'KRW'
  }

  if (typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return averagePrice > 10_000 ? 'KRW' : 'USD'
  }

  if (typeof usdKrwRate === 'number' && Number.isFinite(usdKrwRate) && usdKrwRate > 0) {
    const krwComparablePrice = currentPrice * usdKrwRate
    const usdDistance = Math.abs(averagePrice - currentPrice) / Math.max(Math.abs(currentPrice), 1)
    const krwDistance = Math.abs(averagePrice - krwComparablePrice) / Math.max(Math.abs(krwComparablePrice), 1)
    return krwDistance < usdDistance ? 'KRW' : 'USD'
  }

  return averagePrice > currentPrice * 20 ? 'KRW' : 'USD'
}

export function resolveCurrencyAwareAveragePrice({
  averagePrice: rawAveragePrice,
  averagePriceCurrency: rawAveragePriceCurrency,
  currentPrice,
  currentPriceCurrency: rawCurrentPriceCurrency,
  usdKrwRate: rawUsdKrwRate,
}: CurrencyAwareAveragePriceInput): CurrencyAwareAveragePriceResult {
  const averagePrice = parseNumberish(rawAveragePrice)
  const currentCurrency = normalizeMoneyCurrency(rawCurrentPriceCurrency) ?? 'USD'
  const usdKrwRate = normalizeUsdKrwRate(rawUsdKrwRate)
  const averagePriceCurrency = inferAveragePriceCurrency({
    averagePrice,
    averagePriceCurrency: rawAveragePriceCurrency,
    currentPrice,
    currentPriceCurrency: currentCurrency,
    usdKrwRate,
  })

  if (averagePrice === null || averagePriceCurrency === null) {
    return {
      averagePrice,
      averagePriceCurrency,
      currentPriceCurrency: currentCurrency,
      averagePriceInCurrentCurrency: null,
      requiresFx: false,
      usdKrwRate,
      converted: false,
      blockedReason: 'average-price-missing',
    }
  }

  if (averagePriceCurrency === currentCurrency) {
    return {
      averagePrice,
      averagePriceCurrency,
      currentPriceCurrency: currentCurrency,
      averagePriceInCurrentCurrency: averagePrice,
      requiresFx: false,
      usdKrwRate,
      converted: false,
      blockedReason: null,
    }
  }

  if (usdKrwRate === null) {
    return {
      averagePrice,
      averagePriceCurrency,
      currentPriceCurrency: currentCurrency,
      averagePriceInCurrentCurrency: null,
      requiresFx: true,
      usdKrwRate,
      converted: false,
      blockedReason: 'usd-krw-rate-missing',
    }
  }

  const convertedAveragePrice = averagePriceCurrency === 'KRW' && currentCurrency === 'USD'
    ? averagePrice / usdKrwRate
    : averagePrice * usdKrwRate

  return {
    averagePrice,
    averagePriceCurrency,
    currentPriceCurrency: currentCurrency,
    averagePriceInCurrentCurrency: convertedAveragePrice,
    requiresFx: true,
    usdKrwRate,
    converted: true,
    blockedReason: null,
  }
}

/**
 * 딥스캔 로딩 화면 표시용 평단/현재가 통화 결정.
 *
 * - 현재가 통화가 명시되지 않으면 시장(market)으로 기본값을 정한다('US' → USD, 그 외 KRW).
 * - 평단 통화가 명시되지 않으면 서버와 동일한 거리 휴리스틱으로 추론한다.
 *   (원화평단-미국주는 명시 'KRW' 로만 성립 — 추론이 KRW 를 이기지 않는다.)
 * - 추론 재료가 부족해 null 이면 현재가 통화를 그대로 쓴다(종목 시장 통화가
 *   평단 통화보다 신뢰 가능한 기본값이다).
 */
export function resolveDeepScanDisplayCurrencies({
  market,
  averagePrice,
  averagePriceCurrency,
  currentPrice,
  currentPriceCurrency,
  usdKrwRate,
}: {
  market?: string | null
  averagePrice?: string | number | null
  averagePriceCurrency?: string | null
  currentPrice?: string | number | null
  currentPriceCurrency?: string | null
  usdKrwRate?: number | null
}): { averagePriceCurrency: MoneyCurrency; currentPriceCurrency: MoneyCurrency } {
  const fallbackCurrentCurrency: MoneyCurrency = market?.trim().toUpperCase() === 'US' ? 'USD' : 'KRW'
  const resolvedCurrentCurrency = normalizeMoneyCurrency(currentPriceCurrency) ?? fallbackCurrentCurrency
  const resolvedAverageCurrency = resolveCurrencyAwareAveragePrice({
    averagePrice: averagePrice ?? null,
    averagePriceCurrency: averagePriceCurrency ?? null,
    currentPrice: parseNumberish(currentPrice ?? null),
    currentPriceCurrency: resolvedCurrentCurrency,
    usdKrwRate: usdKrwRate ?? null,
  }).averagePriceCurrency ?? resolvedCurrentCurrency

  return {
    averagePriceCurrency: resolvedAverageCurrency,
    currentPriceCurrency: resolvedCurrentCurrency,
  }
}
