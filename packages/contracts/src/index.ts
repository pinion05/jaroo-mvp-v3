import type { JarooInstrumentKind, JarooMarketTone } from './instrument'

export type {
  JarooInstrumentKind,
  JarooLocale,
  JarooMarketTone,
  JarooInstrumentRef,
} from './instrument'

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
