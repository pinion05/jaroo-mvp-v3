export type MoneyCurrency = 'KRW' | 'USD'

export type LoadingBriefingDailyRow = {
  date: string
  open?: number | null
  high?: number | null
  low?: number | null
  close: number
  volume?: number | null
  changePct?: number | null
}

export type LoadingBriefingMarketIndex = {
  value?: number | null
  changePct?: number | null
  asOf?: string | null
}

// 로딩 브리핑용 원금회수 예측 요약 — 딥스캔 결과 recoveryForecast 블록의 표시 서브셋.
// 손실 구간(현재가 < 평단)이고 일봉 계열이 확보될 때만 붙는다.
export type LoadingBriefingRecoveryForecast = {
  statusText: string
  summaryText: string
  expectedRecoveryDaysText: string
  recoveryProbabilityText: string
  confidenceText: string
  expectedRecoveryDays: number | null
  recoveryProbabilityPct: number | null
  targetPrice: number | null
  priceHistory?: Array<{ date: string | null; close: number }>
  similarPatternSamples?: Array<{ date: string | null; close: number; drawdownPct: number; recoveryDays: number | null; recovered: boolean }>
  modelRows: Array<{ label: string; recoveryDaysText: string; probabilityText: string; sampleText?: string }>
}

export type LoadingBriefingSnapshot = {
  code?: string
  ticker?: string
  asOf?: string | null
  quote?: {
    currentPrice?: number | null
    openPrice?: number | null
    highPrice?: number | null
    lowPrice?: number | null
    volume?: number | null
    previousClose?: number | null
    previousVolume?: number | null
    changePct?: number | null
    currency?: MoneyCurrency | string | null
    asOf?: string | null
    marketStatus?: string | null
    exchange?: string | null
    source?: string | null
  }
  daily?: LoadingBriefingDailyRow[]
  market?: {
    kospi?: LoadingBriefingMarketIndex | null
    kosdaq?: LoadingBriefingMarketIndex | null
    sp500?: LoadingBriefingMarketIndex | null
    nasdaq?: LoadingBriefingMarketIndex | null
    vix?: LoadingBriefingMarketIndex | null
  }
  recoveryForecast?: LoadingBriefingRecoveryForecast | null
  sourceStatus?: {
    daily?: 'ok' | 'error'
    stockBasic?: 'ok' | 'error'
    kospi?: 'ok' | 'error'
    kosdaq?: 'ok' | 'error'
  }
  sources?: string[]
}

export type LoadingBriefingStreakRun = {
  direction: 'up' | 'down'
  count: number
}

export type LoadingBriefingStreak = {
  direction: 'up' | 'down' | 'flat'
  count: number
  /**
   * 현재 연속 흐름 직전의 마지막 방향 구간(사이의 플랫 봉은 건너뛴다).
   * 반대 방향일 수도 같은 방향일 수도 있으며 '하락하다 오늘 첫 상승' 같은
   * 맥락 구분에 쓰고, 직전 구간을 알 수 없으면 null.
   */
  previous: LoadingBriefingStreakRun | null
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getLatestBriefingDailyRow(rows: LoadingBriefingDailyRow[]) {
  return rows.length > 0 ? rows[rows.length - 1] : null
}

export function getPreviousBriefingDailyRow(rows: LoadingBriefingDailyRow[]) {
  return rows.length > 1 ? rows[rows.length - 2] : null
}

export function calculateBriefingOneMonthChangePct(rows: LoadingBriefingDailyRow[]) {
  const latest = getLatestBriefingDailyRow(rows)
  if (!latest || rows.length < 2) {
    return null
  }

  const baseIndex = Math.max(0, rows.length - 22)
  const base = rows[baseIndex]
  if (!base || !isFiniteNumber(base.close) || base.close === 0) {
    return null
  }

  return ((latest.close / base.close) - 1) * 100
}

function getDailyMoveDirection(rows: LoadingBriefingDailyRow[], index: number): LoadingBriefingStreak['direction'] {
  const row = rows[index]
  if (!row) {
    return 'flat'
  }

  if (isFiniteNumber(row.changePct) && row.changePct !== 0) {
    return row.changePct > 0 ? 'up' : 'down'
  }

  const previous = rows[index - 1]
  if (!previous || row.close === previous.close) {
    return 'flat'
  }

  return row.close > previous.close ? 'up' : 'down'
}

/** startIndex 직전(과거 방향)부터 플랫 봉을 건너뛰고 마지막 연속 구간을 센다. */
function findBriefingRunEndingBefore(rows: LoadingBriefingDailyRow[], startIndex: number): LoadingBriefingStreakRun | null {
  let index = startIndex - 1
  while (index >= 0 && getDailyMoveDirection(rows, index) === 'flat') {
    index -= 1
  }
  if (index < 0) {
    return null
  }

  const direction = getDailyMoveDirection(rows, index)
  if (direction === 'flat') {
    return null
  }

  let count = 0
  while (index >= 0 && getDailyMoveDirection(rows, index) === direction) {
    count += 1
    index -= 1
  }

  return { direction, count }
}

export function calculateBriefingShortStreak(rows: LoadingBriefingDailyRow[]): LoadingBriefingStreak {
  if (rows.length < 2) {
    return { direction: 'flat', count: 0, previous: null }
  }

  const direction = getDailyMoveDirection(rows, rows.length - 1)
  if (direction === 'flat') {
    return { direction: 'flat', count: 0, previous: findBriefingRunEndingBefore(rows, rows.length - 1) }
  }

  let count = 0
  let index = rows.length - 1
  while (index >= 0 && getDailyMoveDirection(rows, index) === direction) {
    count += 1
    index -= 1
  }

  return { direction, count, previous: findBriefingRunEndingBefore(rows, index + 1) }
}
