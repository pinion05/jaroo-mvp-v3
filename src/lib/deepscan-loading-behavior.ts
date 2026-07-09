const HIDDEN_LOADING_QUICK_FACT_KEYS = new Set(['week52-position', 'etf-product-context', 'analyst-consensus'])

export type DeepScanInlineReadinessInput = {
  fetchState: string
  hasPayload: boolean
  isCommitteeHydrating: boolean
}

export function isDeepScanInlineResultsReady({
  fetchState,
  hasPayload,
  isCommitteeHydrating,
}: DeepScanInlineReadinessInput): boolean {
  return fetchState === 'success' && hasPayload && !isCommitteeHydrating
}

export function shouldDisplayDeepScanReadyResults(resultsReady: boolean): boolean {
  return resultsReady
}

export function shouldAdvanceDeepScanTimeline({
  resultsReadyForDisplay,
  elapsedSeconds,
  sequenceCompleteSeconds,
}: {
  resultsReadyForDisplay: boolean
  elapsedSeconds: number
  sequenceCompleteSeconds: number
}): boolean {
  return !resultsReadyForDisplay && elapsedSeconds < sequenceCompleteSeconds
}

export function getVisibleDeepScanBriefingItemCount(
  elapsedSeconds: number,
  revealStartSeconds: readonly number[],
  options: { forceReady?: boolean } = {},
): number {
  if (options.forceReady) {
    return revealStartSeconds.length
  }

  return revealStartSeconds.filter((at) => elapsedSeconds >= at).length
}

export function isDeepScanBriefingItemContentReady({
  elapsedSeconds,
  revealAtSeconds,
  skeletonSeconds,
  forceReady = false,
}: {
  elapsedSeconds: number
  revealAtSeconds: number
  skeletonSeconds: number
  forceReady?: boolean
}): boolean {
  return forceReady || elapsedSeconds >= revealAtSeconds + skeletonSeconds
}

export function isHiddenDeepScanLoadingQuickFact({ key, hasIndicator }: { key: string; hasIndicator?: boolean }): boolean {
  return HIDDEN_LOADING_QUICK_FACT_KEYS.has(key) || Boolean(hasIndicator)
}

export function shouldShowDeepScanSummarySkeleton({
  placeholder,
  resolvedSummaryText,
}: {
  placeholder: boolean
  resolvedSummaryText: string | null | undefined
}): boolean {
  return !placeholder && !resolvedSummaryText
}
