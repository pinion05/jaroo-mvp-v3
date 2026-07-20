import type { DeepScanTargetInput } from './workflow-types'

type ResolveDeepScanHydratedTargetInput = {
  currentTarget: DeepScanTargetInput | null
  hydratedTarget: DeepScanTargetInput
  loadUsdKrwRate: () => Promise<number | undefined>
}

type ShouldStartDeepScanRequestAfterHydrationInput = {
  shouldStartRequest: boolean
  targetKey: string | null
  hydratedTargetKey: string | null
}

function normalizeIdentity(value: string | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized || undefined
}

function isFinitePositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hasSameInstrument(
  currentTarget: DeepScanTargetInput,
  hydratedTarget: DeepScanTargetInput,
) {
  const currentIdentifiers = [
    normalizeIdentity(currentTarget.code),
    normalizeIdentity(currentTarget.ticker),
  ].filter((value): value is string => Boolean(value))
  const hydratedIdentifiers = [
    normalizeIdentity(hydratedTarget.code),
    normalizeIdentity(hydratedTarget.ticker),
  ].filter((value): value is string => Boolean(value))

  if (currentIdentifiers.length > 0 && hydratedIdentifiers.length > 0) {
    return currentIdentifiers.some((identifier) => hydratedIdentifiers.includes(identifier))
  }

  return normalizeIdentity(currentTarget.name) === normalizeIdentity(hydratedTarget.name)
    && normalizeIdentity(currentTarget.market) === normalizeIdentity(hydratedTarget.market)
}

function preserveLiveTargetContext(
  currentTarget: DeepScanTargetInput | null,
  hydratedTarget: DeepScanTargetInput,
) {
  if (!currentTarget || !hasSameInstrument(currentTarget, hydratedTarget)) {
    return hydratedTarget
  }

  return {
    ...hydratedTarget,
    currentPrice: hydratedTarget.currentPrice ?? currentTarget.currentPrice,
    currentProfitRate: hydratedTarget.currentProfitRate ?? currentTarget.currentProfitRate,
    currentPriceCurrency: hydratedTarget.currentPriceCurrency ?? currentTarget.currentPriceCurrency,
    usdKrwRate: hydratedTarget.usdKrwRate ?? currentTarget.usdKrwRate,
  }
}

function needsUsdKrwRate(target: DeepScanTargetInput) {
  return target.marketTone === 'nasdaq'
    && target.averagePriceCurrency === 'KRW'
    && target.currentPriceCurrency === 'USD'
    && !isFinitePositiveNumber(target.usdKrwRate)
}

export async function resolveDeepScanHydratedTarget({
  currentTarget,
  hydratedTarget,
  loadUsdKrwRate,
}: ResolveDeepScanHydratedTargetInput) {
  const targetWithLiveContext = preserveLiveTargetContext(currentTarget, hydratedTarget)

  if (!needsUsdKrwRate(targetWithLiveContext)) {
    return targetWithLiveContext
  }

  const usdKrwRate = await loadUsdKrwRate()
  if (!isFinitePositiveNumber(usdKrwRate)) {
    return targetWithLiveContext
  }

  return {
    ...targetWithLiveContext,
    usdKrwRate,
  }
}

export function shouldStartDeepScanRequestAfterHydration({
  shouldStartRequest,
  targetKey,
  hydratedTargetKey,
}: ShouldStartDeepScanRequestAfterHydrationInput) {
  return shouldStartRequest
    && targetKey !== null
    && hydratedTargetKey === targetKey
}
