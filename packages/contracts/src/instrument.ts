// 계층 원시 타입들. deepscan.ts 가 barrel(index.ts) 를 역참조해 생기는
// 순환(index ⇄ deepscan)을 끊기 위해 원시 정의를 이 모듈로 내렸다.
// index.ts 는 이 파일을 re-export 하므로 export 표면은 그대로다.

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
