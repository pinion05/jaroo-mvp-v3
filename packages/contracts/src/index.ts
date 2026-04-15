export type JarooInstrumentKind = 'stock' | 'etf'
export type JarooLocale = 'KR' | 'US'
export type JarooMarketTone = 'kospi' | 'kosdaq' | 'nasdaq' | 'etf'

export type JarooInstrumentRef = {
  name: string
  code?: string
  ticker?: string
  market?: string
  marketTone?: JarooMarketTone
  kind?: JarooInstrumentKind
  locale?: JarooLocale
  confidence?: number
}

export type JarooOcrRow = {
  name: string
  quantity: string
  profitRate: string
  evaluationAmount: string
  averagePrice: string
  resolvedName?: string
  resolvedCode?: string
  resolvedTicker?: string
  resolvedMarket?: string
  resolvedMarketTone?: JarooMarketTone
  resolvedKind?: JarooInstrumentKind
}

export type JarooQuoteSnapshot = {
  symbol: string
  price?: number
  changePercent?: number
  currency?: string
  asOf?: string
}

export * from './deepscan'
