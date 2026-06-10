export type DeepScanLoadingPriceInput = {
  payloadCurrentPrice?: number | null
  quickQuoteCurrentPrice?: number | null
  targetCurrentPrice?: number | null
  briefingCurrentPrice?: number | null
}

function isUsablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function resolveDeepScanLoadingCurrentPrice({
  payloadCurrentPrice,
  quickQuoteCurrentPrice,
  targetCurrentPrice,
  briefingCurrentPrice,
}: DeepScanLoadingPriceInput) {
  if (isUsablePrice(payloadCurrentPrice)) {
    return payloadCurrentPrice
  }

  if (isUsablePrice(quickQuoteCurrentPrice)) {
    return quickQuoteCurrentPrice
  }

  if (isUsablePrice(targetCurrentPrice)) {
    return targetCurrentPrice
  }

  if (isUsablePrice(briefingCurrentPrice)) {
    return briefingCurrentPrice
  }

  return undefined
}

export function resolveDeepScanBriefingCardCurrentPrice({
  displayCurrentPrice,
  briefingQuotePrice,
  latestClose,
}: {
  displayCurrentPrice?: number | null
  briefingQuotePrice?: number | null
  latestClose?: number | null
}) {
  return resolveDeepScanLoadingCurrentPrice({
    quickQuoteCurrentPrice: displayCurrentPrice,
    briefingCurrentPrice: briefingQuotePrice,
    targetCurrentPrice: latestClose,
  })
}
