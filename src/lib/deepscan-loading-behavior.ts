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

// ─── 팀 요약 키워드 강조 ──────────────────────────────────────────────────────

export type DeepScanEmphasisSegment = {
  text: string
  bold: boolean
}

/**
 * 요약 문장의 `**키워드**` 마크다운을 세그먼트 배열로 분해한다.
 * 짝이 맞는 쌍만 굵게 처리하고, 닫히지 않은 `**`는 별표를 걷어낸다 —
 * 미완성 마크다운이 화면에 그대로 노출되지 않게 하기 위함.
 */
export function parseDeepScanEmphasisSegments(text: string): DeepScanEmphasisSegment[] {
  if (!text.includes('**')) {
    return [{ text, bold: false }]
  }

  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) {
    return [{ text: text.replace(/\*\*/g, ''), bold: false }]
  }

  return parts
    .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
    .filter((segment) => segment.text.length > 0)
}
