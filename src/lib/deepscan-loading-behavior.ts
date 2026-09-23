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

// ─── 공시 출처 용어 정규화 ──────────────────────────────────────────────────

/**
 * 'OpenDART'라는 수집 시스템명을 일반 사용자 화면에서 없앤다(#267, 2026-09-19 합의).
 * 크롤러 생성문은 '최근 공시'로 교체됐지만 캐시된 옛 스냅샷·원장 payload에는
 * 옛 문구('최근 OpenDART 공시 N건 확인' 등)가 남아 있어 렌더 시 치환한다.
 * '최근 OpenDART 공시' → '최근 공시' (이중 접두사 방지), 'OpenDART 공시' → '최근 공시',
 * 남은 단독 'OpenDART'는 공백 정리와 함께 제거한다.
 */
export function normalizeDeepScanDisclosureWording(text: string): string {
  if (!text.includes('OpenDART')) {
    return text
  }

  return text
    .replace(/최근\s*OpenDART\s*공시/gu, '최근 공시')
    .replace(/OpenDART\s*공시/gu, '최근 공시')
    .replace(/\s*OpenDART\s*/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim()
}

// ─── '미확보 KR 페이지' 노출 제거 ───────────────────────────────────────────

/**
 * '미확보 KR 페이지 N건'은 내부 페이지 커버리지 정보라 화면에 내보내지 않는다
 * (2026-09-23 요청). 크롤러 생성단에서 제거됐지만 캐시된 옛 스냅샷·원장 payload에
 * 남아 있어 렌더 시에도 걸러낸다.
 */
export function isMissingKrPageNotice(text: string): boolean {
  return text.includes('미확보 KR 페이지')
}

/** 본문·조건 문장에서 해당 배지 문구만 제거하고 남는 구분자·'주의:' 꼬리를 정리한다. */
export function stripMissingKrPageNotice(text: string): string {
  if (!isMissingKrPageNotice(text)) {
    return text
  }

  return text
    .replace(/(?:주의:\s*)?미확보\s*KR\s*페이지\s*\d+건(?:\s*건)?/gu, '')
    .replace(/(^\s*·\s*)|(\s*·\s*$)/gu, '')
    .replace(/주의:\s*$/u, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
}
