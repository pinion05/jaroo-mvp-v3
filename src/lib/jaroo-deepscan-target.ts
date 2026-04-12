import type { HomeHolding } from '@/lib/jaroo-home-data'

export const DEEPSCAN_TARGET_STORAGE_KEY = 'jaroo:deepscan-target'

export type DeepScanTarget = {
  name: string
  kind: HomeHolding['kind']
  market: string
  shares: string
  change: string
  averagePrice: string
  evaluationAmount?: string
  identifierTicker?: string
  identifierCode?: string
  identifierLabel?: string
}

function trimOrUndefined(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function buildIdentifierLabel(ticker?: string, code?: string) {
  const identifiers = [trimOrUndefined(ticker), trimOrUndefined(code)].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  )

  return identifiers.length > 0 ? identifiers.join(' · ') : undefined
}

export function createDeepScanTargetFromHolding(holding: HomeHolding): DeepScanTarget {
  const identifierTicker = trimOrUndefined(holding.identifierTicker)
  const identifierCode = trimOrUndefined(holding.identifierCode)

  return {
    name: holding.name,
    kind: holding.kind,
    market: holding.market,
    shares: holding.shares,
    change: holding.change,
    averagePrice: holding.averagePrice,
    evaluationAmount: holding.evaluationAmount,
    identifierTicker,
    identifierCode,
    identifierLabel: buildIdentifierLabel(identifierTicker, identifierCode) ?? trimOrUndefined(holding.identifierLabel),
  }
}

export function persistDeepScanTarget(target: DeepScanTarget) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    window.sessionStorage.setItem(DEEPSCAN_TARGET_STORAGE_KEY, JSON.stringify(target))
    return true
  } catch {
    return false
  }
}

export function readDeepScanTarget(): DeepScanTarget | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(DEEPSCAN_TARGET_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<DeepScanTarget>

    if (
      typeof parsed?.name !== 'string' ||
      typeof parsed?.kind !== 'string' ||
      typeof parsed?.market !== 'string' ||
      typeof parsed?.shares !== 'string' ||
      typeof parsed?.change !== 'string' ||
      typeof parsed?.averagePrice !== 'string'
    ) {
      return null
    }

    return {
      name: parsed.name,
      kind: parsed.kind,
      market: parsed.market,
      shares: parsed.shares,
      change: parsed.change,
      averagePrice: parsed.averagePrice,
      evaluationAmount: trimOrUndefined(parsed.evaluationAmount),
      identifierTicker: trimOrUndefined(parsed.identifierTicker),
      identifierCode: trimOrUndefined(parsed.identifierCode),
      identifierLabel: buildIdentifierLabel(parsed.identifierTicker, parsed.identifierCode) ?? trimOrUndefined(parsed.identifierLabel),
    }
  } catch {
    return null
  }
}
