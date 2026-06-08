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
  sourceStatus?: {
    daily?: 'ok' | 'error'
    stockBasic?: 'ok' | 'error'
    kospi?: 'ok' | 'error'
    kosdaq?: 'ok' | 'error'
  }
  sources?: string[]
}

export type LoadingBriefingStreak = {
  direction: 'up' | 'down' | 'flat'
  count: number
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

export function calculateBriefingShortStreak(rows: LoadingBriefingDailyRow[]): LoadingBriefingStreak {
  if (rows.length < 2) {
    return { direction: 'flat', count: 0 }
  }

  const direction = getDailyMoveDirection(rows, rows.length - 1)
  if (direction === 'flat') {
    return { direction: 'flat', count: 0 }
  }

  let count = 0
  for (let index = rows.length - 1; index > 0; index -= 1) {
    if (getDailyMoveDirection(rows, index) !== direction) {
      break
    }
    count += 1
  }

  return { direction, count }
}
