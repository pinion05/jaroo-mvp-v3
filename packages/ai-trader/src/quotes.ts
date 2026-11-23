// 시세 프로바이더 — 시세의 소유권은 시세 API(crawler/deepscan 계열)에 있다.
// 이 워커는 조회해서 주문 priceKrw 로 실어 보낼 뿐(spec D4, paper-trade quote ZERO 준수).
//
// web:    GET {QUOTES_BASE_URL}/api/quotes/current?codes=005930,000660 — crawler 프록시 응답 그대로 사용
//         응답: { data: { items: [{ code, price, ... }], missing } } — 등락률 필드는 현재 미제공(changePct=null)
// static: "005930:70000:-2.5" 콤마 목록 — dev/E2E/테스트용 (가격 원, 등락률 %→소수 변환)

import type { Quote } from './domain.ts'

export type QuotesProvider = {
  getQuotes(symbols: string[]): Promise<Map<string, Quote>>
}

export function createWebQuotesProvider(baseUrl: string, fetcher: typeof fetch = fetch): QuotesProvider {
  return {
    async getQuotes(symbols) {
      if (symbols.length === 0) return new Map()
      const url = `${baseUrl.replace(/\/$/, '')}/api/quotes/current?codes=${symbols.join(',')}`
      const response = await fetcher(url, { cache: 'no-store' })
      if (!response.ok) {
        throw new QuotesError(`quotes upstream ${response.status}`)
      }
      const body = (await response.json()) as {
        ok?: boolean
        data?: { items?: Array<{ code?: unknown; price?: unknown }> }
      }
      const map = new Map<string, Quote>()
      for (const item of body.data?.items ?? []) {
        const code = typeof item.code === 'string' ? item.code : null
        const price = Number(item.price)
        if (!code || !Number.isFinite(price) || price <= 0) continue
        map.set(code, { symbol: code, priceKrw: Math.round(price), changePct: null })
      }
      return map
    },
  }
}

export function createStaticQuotesProvider(spec: string): QuotesProvider {
  const map = new Map<string, Quote>()
  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [symbol, priceRaw, changeRaw] = trimmed.split(':')
    const price = Number(priceRaw)
    if (!symbol || !Number.isInteger(price) || price <= 0) {
      throw new QuotesError(`STATIC_QUOTES 파싱 실패 (CODE:원:등락률%): ${trimmed}`)
    }
    const changePct = changeRaw === undefined || changeRaw === '' ? null : Number(changeRaw) / 100
    if (changePct !== null && !Number.isFinite(changePct)) {
      throw new QuotesError(`STATIC_QUOTES 등락률 파싱 실패: ${trimmed}`)
    }
    map.set(symbol, { symbol, priceKrw: price, changePct })
  }
  return {
    async getQuotes(symbols) {
      const out = new Map<string, Quote>()
      for (const symbol of symbols) {
        const quote = map.get(symbol)
        if (quote) out.set(symbol, quote)
      }
      return out
    },
  }
}

export class QuotesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotesError'
  }
}
