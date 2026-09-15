// 분석 기록 탭 병합 모델 — 딥스캔(deepscan_scan_history)과 ETF(etf_scan_history)
// 원장의 목록 행을 시간 내림차순 하나의 타임라인으로 합친다. 두 원장은 payload
// 계약이 달라(JarooDeepScanPayload vs jaroo-etf-profile-v1) 물리적 테이블이
// 분리돼 있으므로, UI 계약은 이 모듈에서 단일 kind 판별 유니온으로 정규화한다.

export type AnalysisHistoryKind = 'stock' | 'etf'

export type AnalysisHistoryRow = {
  id: string
  kind: AnalysisHistoryKind
  targetKey: string
  market: string | null
  stockName: string | null
  targetInput: unknown
  scannedAt: string
  /** ETF 행 전용 — 재진입(/etf?code=)에 쓴다. */
  etfCode: string | null
}

export type HistoryListRowLike = {
  id: string
  targetKey: string
  market: string | null
  stockName: string | null
  targetInput: unknown
  scannedAt: string
}

/** 두 원장 목록을 scannedAt 내림차순 병합 — ISO 문자열 정렬이 곧 시간 정렬이다. */
export function mergeAnalysisHistory(
  stockRows: HistoryListRowLike[],
  etfRows: HistoryListRowLike[],
): AnalysisHistoryRow[] {
  return [
    ...stockRows.map((row) => ({ ...row, kind: 'stock' as const, etfCode: null })),
    ...etfRows.map((row) => ({ ...row, kind: 'etf' as const, etfCode: row.targetKey })),
  ].sort((a, b) => (a.scannedAt < b.scannedAt ? 1 : a.scannedAt > b.scannedAt ? -1 : 0))
}

/** ETF 행 시장 라벨 — 원장 market은 'kospi'|'kosdaq'|'us' 소문자로 저장된다. */
export function etfMarketLabel(market: string | null): string {
  if (market === 'kospi') return '코스피'
  if (market === 'kosdaq') return '코스닥'
  if (market === 'us') return '미국'
  return market ?? '—'
}
