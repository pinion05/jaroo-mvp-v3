// 일봉 종가 시계열 → ETF 리스크·수익률 지표 (스펙 2026-09-15 Task 8, 순수 함수).
// 크롤러가 내리는 profile.daily를 소비한다. 달력을 보지 않고 거래일 수로 기간을 잰다:
//   1/3/6/12개월 = 21/63/126/252거래일, 연율화 = √252, 무위험수익률 = 3.5%(연).
// 일봉 260개(≈1년) 미만이면 지표를 계산하지 않고 null을 돌려준다.

export const ETF_METRICS_MIN_DAILY_ROWS = 260

const PERIOD_TRADING_DAYS = { m1: 21, m3: 63, m6: 126, y1: 252 } as const

const ANNUALIZATION_TRADING_DAYS = 252
const RISK_FREE_RATE = 0.035

export type EtfMetrics = {
  returns: { m1: number | null; m3: number | null; m6: number | null; y1: number | null }
  volatilityAnnPct: number | null
  mddPct: number | null
  sharpe: number | null
  week52: { high: number; low: number } | null
}

function sanitizeDaily(daily: Array<{ date: string; close: number }> | null | undefined) {
  if (!Array.isArray(daily)) {
    return []
  }

  return daily
    .filter((row) => typeof row?.date === 'string' && Number.isFinite(row.close) && row.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date))
}

function periodReturnPct(closes: number[], tradingDays: number): number | null {
  const baseIndex = closes.length - 1 - tradingDays
  if (baseIndex < 0) return null
  const base = closes[baseIndex]
  if (!(base > 0)) return null
  return (closes[closes.length - 1] / base - 1) * 100
}

function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function computeEtfMetrics(daily: Array<{ date: string; close: number }> | null | undefined): EtfMetrics | null {
  const rows = sanitizeDaily(daily)
  if (rows.length < ETF_METRICS_MIN_DAILY_ROWS) {
    return null
  }

  const closes = rows.map((row) => row.close)
  const last = closes[closes.length - 1]
  const first = closes[0]

  const returns = {
    m1: periodReturnPct(closes, PERIOD_TRADING_DAYS.m1),
    m3: periodReturnPct(closes, PERIOD_TRADING_DAYS.m3),
    m6: periodReturnPct(closes, PERIOD_TRADING_DAYS.m6),
    y1: periodReturnPct(closes, PERIOD_TRADING_DAYS.y1),
  }

  const logReturns: number[] = []
  for (let index = 1; index < closes.length; index += 1) {
    logReturns.push(Math.log(closes[index] / closes[index - 1]))
  }
  const std = sampleStd(logReturns)
  const volatilityAnnPct = std == null ? null : std * Math.sqrt(ANNUALIZATION_TRADING_DAYS) * 100

  let runningMax = closes[0]
  let mddPct = 0
  for (const close of closes) {
    if (close > runningMax) runningMax = close
    const drawdownPct = (close / runningMax - 1) * 100
    if (drawdownPct < mddPct) mddPct = drawdownPct
  }

  let sharpe: number | null = null
  if (volatilityAnnPct !== null && volatilityAnnPct > 0 && first > 0) {
    const annualizedReturn = (last / first) ** (ANNUALIZATION_TRADING_DAYS / (closes.length - 1)) - 1
    sharpe = (annualizedReturn - RISK_FREE_RATE) / (volatilityAnnPct / 100)
  }

  const window52 = closes.slice(-PERIOD_TRADING_DAYS.y1)
  const week52 = { high: Math.max(...window52), low: Math.min(...window52) }

  return { returns, volatilityAnnPct, mddPct, sharpe, week52 }
}
