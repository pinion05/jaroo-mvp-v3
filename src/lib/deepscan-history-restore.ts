// 딥스캔 기록 → 타깃 복원(순수 변환) — 클라이언트에서 쓰는 모듈.
// 서버가 저장한 target_input은 buildRawInputFromSearchParams의 출력과 같은 모양
// (instrument: {name, code, ticker, market, kind?}, holding: {shares, averagePrice, ...}).
// 이를 딥스캔 페이지의 DeepScanTargetInput으로 되살려 setTarget + push하면
// 홈에서 진입한 것과 동일하게 스냅샷 캐시 히트(무료·즉시)로 재열람된다.

import { parseOcrNumber } from '@/lib/screenshot-ocr'
import type { DeepScanTargetInput, WorkflowInstrumentKind, WorkflowMarketTone, WorkflowMoneyCurrency } from '@/lib/workflow-types'

type RawHistoryTargetInput = {
  instrument?: {
    name?: unknown
    code?: unknown
    ticker?: unknown
    market?: unknown
    kind?: unknown
  }
  holding?: {
    shares?: unknown
    averagePrice?: unknown
    averagePriceCurrency?: unknown
    currentPrice?: unknown
    currentPriceCurrency?: unknown
    currentProfitRate?: unknown
    evaluationAmount?: unknown
    usdKrwRate?: unknown
  }
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeNumber(value: unknown): number | undefined {
  const text = normalizeText(value)
  if (text == null) return undefined
  const parsed = parseOcrNumber(text)
  return parsed ?? undefined
}

function normalizeCurrency(value: unknown): WorkflowMoneyCurrency | undefined {
  const text = normalizeText(value)?.toUpperCase()
  return text === 'USD' || text === 'KRW' ? text : undefined
}

function normalizeKind(value: unknown): WorkflowInstrumentKind | undefined {
  const text = normalizeText(value)?.toLowerCase()
  return text === 'etf' || text === 'stock' ? text : undefined
}

function normalizeMarketTone(market: string | undefined, kind: WorkflowInstrumentKind | undefined): WorkflowMarketTone {
  if (market === 'US' || market === 'NASDAQ') return 'nasdaq'
  if (kind === 'etf') return 'etf'
  if (market === 'KOSDAQ') return 'kosdaq'
  return 'kospi'
}

/** 기록의 target_input → 딥스캔 타깃. 복원 불가(수치 누락 등)면 null. */
export function buildDeepScanTargetInputFromHistoryTargetInput(raw: unknown): DeepScanTargetInput | null {
  if (raw == null || typeof raw !== 'object') return null
  const input = raw as RawHistoryTargetInput

  const name = normalizeText(input.instrument?.name)
  if (!name) return null

  const quantity = normalizeNumber(input.holding?.shares)
  const averagePrice = normalizeNumber(input.holding?.averagePrice)
  if (quantity == null || quantity <= 0 || averagePrice == null || averagePrice <= 0) return null

  const code = normalizeText(input.instrument?.code)
  const ticker = normalizeText(input.instrument?.ticker)?.toUpperCase()
  const market = normalizeText(input.instrument?.market)?.toUpperCase()
  const kind = normalizeKind(input.instrument?.kind)
  const averagePriceCurrency = normalizeCurrency(input.holding?.averagePriceCurrency)
  const currentPrice = normalizeNumber(input.holding?.currentPrice)
  const currentProfitRate = normalizeNumber(input.holding?.currentProfitRate)
  const currentPriceCurrency = normalizeCurrency(input.holding?.currentPriceCurrency)
  const evaluationAmount = normalizeNumber(input.holding?.evaluationAmount)
  const usdKrwRate = normalizeNumber(input.holding?.usdKrwRate)

  return {
    ...(code ? { code } : {}),
    ...(ticker ? { ticker } : {}),
    ...(market ? { market } : {}),
    marketTone: normalizeMarketTone(market, kind),
    ...(kind ? { kind } : {}),
    name,
    quantity,
    averagePrice,
    ...(averagePriceCurrency ? { averagePriceCurrency } : {}),
    ...(currentPrice != null ? { currentPrice } : {}),
    ...(currentProfitRate != null ? { currentProfitRate } : {}),
    ...(currentPriceCurrency ? { currentPriceCurrency } : {}),
    ...(evaluationAmount != null ? { evaluationAmount } : {}),
    ...(usdKrwRate != null ? { usdKrwRate } : {}),
  }
}
