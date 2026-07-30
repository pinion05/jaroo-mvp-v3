import type { JarooDeepScanConsensusStructured, JarooDeepScanPayload } from '../../../packages/contracts/src/deepscan'
import type { LoadingQuickFact } from '@/components/deepscan-loading-screen'
import { isFiniteNumber, type LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import type { WorkflowMoneyCurrency } from '@/lib/workflow-types'
import type { LoadingQuickQuote } from './deepscan-page-types'
import { normalizeQuoteCurrency } from './deepscan-page-fetchers'

export function formatLoadingPercent(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value)}%`
}

function formatLoadingMoney(value: number, currency: WorkflowMoneyCurrency = 'KRW') {
  const suffix = currency === 'USD' ? '달러' : '원'
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value)}${suffix}`
}

function clampLoadingPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}

function resolveWeek52PositionLabel(lowGapPct: number | undefined, highGapPct: number | undefined) {
  if (typeof highGapPct === 'number' && highGapPct >= -10) {
    return '고점 근처예요'
  }

  if (typeof lowGapPct !== 'number') {
    return '가격 위치를 확인했어요'
  }

  if (lowGapPct <= 20) {
    return '바닥권 근처예요'
  }

  if (lowGapPct <= 50) {
    return '중하단 구간이에요'
  }

  if (lowGapPct <= 80) {
    return '중상단 구간이에요'
  }

  return '고점권에 가까워요'
}

export function buildWeek52LoadingQuickFact(quickQuote: LoadingQuickQuote | null): LoadingQuickFact | null {
  const currentPrice = quickQuote?.currentPrice
  const high = quickQuote?.week52High
  const low = quickQuote?.week52Low
  if (
    typeof currentPrice !== 'number'
    || typeof high !== 'number'
    || typeof low !== 'number'
    || currentPrice <= 0
    || high <= 0
    || low <= 0
    || high <= low
  ) {
    return null
  }

  const lowGapPct = ((currentPrice - low) / low) * 100
  const highGapPct = ((currentPrice - high) / high) * 100
  const rangePositionPct = clampLoadingPercent(((currentPrice - low) / (high - low)) * 100)
  const currency = quickQuote?.currentPriceCurrency ?? 'KRW'

  return {
    key: 'week52-position',
    category: '가격 위치',
    badge: '정보',
    tone: 'info',
    body: `52주 최저 대비 ${formatLoadingPercent(lowGapPct)}, 최고 대비 ${formatLoadingPercent(highGapPct)}`,
    detail: resolveWeek52PositionLabel(lowGapPct, highGapPct),
    indicator: {
      positionPct: rangePositionPct,
      markerLabel: `현재 ${formatLoadingMoney(currentPrice, currency)}`,
      deltaLabels: [`최저 대비 ${formatLoadingPercent(lowGapPct)}`, `최고 대비 ${formatLoadingPercent(highGapPct)}`],
      leftLabel: `최저 ${formatLoadingMoney(low, currency)}`,
      rightLabel: `최고 ${formatLoadingMoney(high, currency)}`,
    },
  }
}


export function buildWeek52LoadingQuickFactFromBriefingSnapshot(snapshot: LoadingBriefingSnapshot | null): LoadingQuickFact | null {
  const dailyRows = (snapshot?.daily ?? []).filter((row) => isFiniteNumber(row.close))
  if (dailyRows.length === 0) {
    return null
  }

  const quote = snapshot?.quote
  const currentPrice = isFiniteNumber(quote?.currentPrice) ? quote.currentPrice : dailyRows.at(-1)?.close
  const high = dailyRows.reduce<number | null>((max, row) => {
    const value = isFiniteNumber(row.high) ? row.high : row.close
    return max === null || value > max ? value : max
  }, null)
  const low = dailyRows.reduce<number | null>((min, row) => {
    const value = isFiniteNumber(row.low) ? row.low : row.close
    return min === null || value < min ? value : min
  }, null)

  return buildWeek52LoadingQuickFact({
    targetKey: 'briefing-snapshot',
    ...(isFiniteNumber(currentPrice) ? { currentPrice } : {}),
    ...(isFiniteNumber(high) ? { week52High: high } : {}),
    ...(isFiniteNumber(low) ? { week52Low: low } : {}),
    ...(normalizeQuoteCurrency(quote?.currency) ? { currentPriceCurrency: normalizeQuoteCurrency(quote?.currency) } : {}),
  })
}

export function parseLoadingConsensusBody(body: string, structured?: JarooDeepScanConsensusStructured) {
  const s = structured ?? {}
  // Structured fields are authoritative when the crawler emits them; the regex
  // matches below stay as a fallback for older crawlers / the US payload path.
  const analystCountMatch = body.match(/증권사\s*(\d+)\s*곳/u)
  const targetMatch = body.match(/평균\s*목표가\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const upsideMatch = body.match(/현재가\s*대비\s*([+-]?\d+(?:\.\d+)?)%/u)
  const opinionMatch = body.match(/투자의견\s*([0-9]+(?:\.\d+)?)/u)
  const highTargetMatch = body.match(/최고\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const lowTargetMatch = body.match(/최저\s*([0-9,]+(?:\.\d+)?)\s*(KRW|USD|원|달러)?/iu)
  const summaryMatch = body.match(/(모두 매수 의견이에요|매수 의견이 우세해요|의견이 갈리고 있어요|신중한 의견이 많아요)/u)
  const regexTargetCurrency: WorkflowMoneyCurrency = targetMatch?.[2]?.toUpperCase() === 'USD' || targetMatch?.[2] === '달러' ? 'USD' : 'KRW'
  const targetCurrency: WorkflowMoneyCurrency = s.currency?.toUpperCase() === 'USD' ? 'USD' : (s.currency ? 'KRW' : regexTargetCurrency)

  const pickNum = (v: number | null | undefined, fallback: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const regexTargetValue = targetMatch?.[1] ? Number(targetMatch[1].replace(/,/gu, '')) : undefined
  const targetValue = typeof s.targetPrice === 'number' && Number.isFinite(s.targetPrice) && s.targetPrice > 0 ? s.targetPrice : regexTargetValue
  const upsidePct = pickNum(s.targetGapPct, upsideMatch?.[1] ? Number(upsideMatch[1]) : undefined)
  const opinionScore = pickNum(s.recommendationScore, opinionMatch?.[1] ? Number(opinionMatch[1]) : undefined)
  const analystCount = pickNum(s.analystCount, analystCountMatch?.[1] ? Number(analystCountMatch[1]) : undefined)
  const highTargetValue = pickNum(s.highestTargetPrice, highTargetMatch?.[1] ? Number(highTargetMatch[1].replace(/,/gu, '')) : undefined)
  const lowTargetValue = pickNum(s.lowestTargetPrice, lowTargetMatch?.[1] ? Number(lowTargetMatch[1].replace(/,/gu, '')) : undefined)
  const summaryText = typeof s.opinionSummary === 'string' && s.opinionSummary.trim() ? s.opinionSummary.trim() : summaryMatch?.[1]
  const highTargetCurrency: WorkflowMoneyCurrency = highTargetMatch?.[2]?.toUpperCase() === 'USD' || highTargetMatch?.[2] === '달러' ? 'USD' : targetCurrency
  const lowTargetCurrency: WorkflowMoneyCurrency = lowTargetMatch?.[2]?.toUpperCase() === 'USD' || lowTargetMatch?.[2] === '달러' ? 'USD' : targetCurrency
  const currentPrice = typeof targetValue === 'number'
    && Number.isFinite(targetValue)
    && typeof upsidePct === 'number'
    && Number.isFinite(upsidePct)
    && 1 + upsidePct / 100 !== 0
    ? targetValue / (1 + upsidePct / 100)
    : undefined

  return {
    analystCountLabel: typeof analystCount === 'number' ? `증권사 ${analystCount}곳` : undefined,
    targetPriceLabel: typeof targetValue === 'number' && Number.isFinite(targetValue)
      ? formatLoadingMoney(targetValue, targetCurrency)
      : undefined,
    currentPriceLabel: typeof currentPrice === 'number' && Number.isFinite(currentPrice)
      ? formatLoadingMoney(currentPrice, targetCurrency)
      : undefined,
    highTargetLabel: typeof highTargetValue === 'number' && Number.isFinite(highTargetValue)
      ? formatLoadingMoney(highTargetValue, highTargetCurrency)
      : undefined,
    lowTargetLabel: typeof lowTargetValue === 'number' && Number.isFinite(lowTargetValue)
      ? formatLoadingMoney(lowTargetValue, lowTargetCurrency)
      : undefined,
    summary: summaryText,
    upsideLabel: typeof upsidePct === 'number' && Number.isFinite(upsidePct)
      ? formatLoadingPercent(upsidePct)
      : undefined,
    upsidePct: typeof upsidePct === 'number' && Number.isFinite(upsidePct) ? upsidePct : undefined,
    opinionLabel: typeof opinionScore === 'number' && Number.isFinite(opinionScore)
      ? new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(opinionScore)
      : undefined,
    opinionScore: typeof opinionScore === 'number' && Number.isFinite(opinionScore) ? opinionScore : undefined,
    // Raw numeric values feed the target-price fan chart simulation.
    targetPriceValue: typeof targetValue === 'number' && Number.isFinite(targetValue) ? targetValue : undefined,
    currentPriceValue: typeof currentPrice === 'number' && Number.isFinite(currentPrice) ? currentPrice : undefined,
    highTargetValue: typeof highTargetValue === 'number' && Number.isFinite(highTargetValue) ? highTargetValue : undefined,
    lowTargetValue: typeof lowTargetValue === 'number' && Number.isFinite(lowTargetValue) ? lowTargetValue : undefined,
  }
}

function isNoDataConsensusBody(body: string) {
  return /데[이]?타가\s*존재하지\s*않습니다|데[이]?터가\s*존재하지\s*않습니다|최근\s*3개월\s*이내에\s*제시된\s*의견이\s*없습니다|목표가\s*미제공|목표가\s*조회\s*실패/u.test(body)
}

export function isTargetPriceFailureText(value: string) {
  return /목표가\s*조회\s*실패|조회\s*실패|수집\s*실패|원천\s*(?:차단|실패|불가)|source[_-]?unavailable/i.test(value)
}

export function isTargetPriceMissingText(value: string) {
  return /목표가\s*미제공|ETF는\s*목표가\s*대신|데[이]?타가\s*존재하지\s*않습니다|데[이]?터가\s*존재하지\s*않습니다|최근\s*3개월\s*이내에\s*제시된\s*의견이\s*없습니다/u.test(value)
}

export function isExchangeProductMarket(value: string | null | undefined) {
  return /(?:^|\b)(?:ETF|ETN)(?:\b|$)/iu.test(value ?? '')
}

export function isExchangeProductPayload(payload: JarooDeepScanPayload | null, fallbackMarket?: string, fallbackKind?: string) {
  return isExchangeProductMarket(payload?.input.instrument.market ?? fallbackMarket)
    || /^(?:etf|etn)$/iu.test(payload?.input.instrument.kind ?? fallbackKind ?? '')
}

function hasHangulBatchim(value: string) {
  const lastChar = Array.from(value.trim()).at(-1)
  if (!lastChar) {
    return false
  }

  const code = lastChar.charCodeAt(0)
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0
}

export function getTargetPriceSubject(payload: JarooDeepScanPayload | null, fallbackName?: string) {
  const name = payload?.input.instrument.name?.trim() || fallbackName?.trim()
  return name ? `${name}${hasHangulBatchim(name) ? '은' : '는'}` : '이 종목은'
}

function summarizeTargetPriceReason(value: string, payload: JarooDeepScanPayload | null, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  const subject = getTargetPriceSubject(payload, fallbackName)
  if (isExchangeProductPayload(payload, fallbackMarket, fallbackKind)) {
    return 'ETF는 NAV 괴리율, 기초지수 흐름, 구성종목 비중을 기준으로 해석합니다.'
  }

  if (!normalized) {
    return `${subject} 증권사 목표가를 확인하는 중입니다.`
  }

  if (isTargetPriceFailureText(normalized)) {
    return `${subject} 증권사 목표가를 지금 불러오지 못했습니다.`
  }

  if (isTargetPriceMissingText(normalized)) {
    return `${subject} 아직 증권사 목표가가 제시되지 않은 종목입니다.`
  }

  return normalized
}

export function buildTargetPriceStatusQuickFact(payload: JarooDeepScanPayload | null, sourceBody?: string, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string): LoadingQuickFact {
  const exchangeProduct = isExchangeProductPayload(payload, fallbackMarket, fallbackKind)
  const targetPriceText = payload?.strategy.targetPriceText?.trim() ?? ''
  const reasonSource = sourceBody?.trim() || targetPriceText
  const isFailure = isTargetPriceFailureText(reasonSource)
  const isMissing = !isFailure && isTargetPriceMissingText(reasonSource)
  const hasTargetPriceValue = Boolean(targetPriceText && targetPriceText !== 'N/A' && !isFailure && !isMissing)
  const body = exchangeProduct
    ? summarizeTargetPriceReason(reasonSource, payload, fallbackName, fallbackMarket, fallbackKind)
    : hasTargetPriceValue
      ? `목표가 ${targetPriceText}`
      : summarizeTargetPriceReason(reasonSource, payload, fallbackName, fallbackMarket, fallbackKind)

  return {
    key: exchangeProduct ? 'etf-product-context' : 'analyst-consensus',
    category: exchangeProduct ? 'ETF 기준' : '목표가',
    badge: exchangeProduct ? 'NAV·구성' : isFailure ? '조회 실패' : isMissing ? '미제공' : '확인 중',
    tone: isFailure && !exchangeProduct ? 'warning' : 'info',
    body,
    detail: isFailure && !exchangeProduct ? '목표가 없음으로 확정하지 않고, 원천 조회 실패로 분리해 표시합니다.' : undefined,
  }
}

export function buildConsensusLoadingQuickFact(payload: JarooDeepScanPayload | null, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string): LoadingQuickFact | null {
  const exchangeProduct = isExchangeProductPayload(payload, fallbackMarket, fallbackKind)
  const consensus = exchangeProduct ? undefined : payload?.insights.items.find((item) => item.sourceLabel === '증권사 의견' || item.label === '컨센서스')
  if (!payload) {
    return buildTargetPriceStatusQuickFact(null, undefined, fallbackName, fallbackMarket, fallbackKind)
  }

  if (!consensus?.body?.trim()) {
    return buildTargetPriceStatusQuickFact(payload, undefined, fallbackName, fallbackMarket, fallbackKind)
  }

  if (isNoDataConsensusBody(consensus.body)) {
    return buildTargetPriceStatusQuickFact(payload, consensus.body, fallbackName, fallbackMarket, fallbackKind)
  }

  const parsedConsensus = parseLoadingConsensusBody(consensus.body, consensus.consensus)
  if (!parsedConsensus.targetPriceLabel) {
    return buildTargetPriceStatusQuickFact(payload, consensus.body, fallbackName, fallbackMarket, fallbackKind)
  }

  const isPositive = /매수|buy|상향|positive/i.test(consensus.body) || (parsedConsensus.upsidePct ?? 0) > 0 || (parsedConsensus.opinionScore ?? 0) >= 3.5
  return {
    key: 'analyst-consensus',
    category: '목표가',
    badge: isPositive ? '긍정' : '정보',
    tone: isPositive ? 'positive' : 'info',
    body: consensus.body,
    ...(parsedConsensus.targetPriceLabel
      ? {
        consensus: {
          targetPriceLabel: parsedConsensus.targetPriceLabel,
          ...(parsedConsensus.currentPriceLabel ? { currentPriceLabel: parsedConsensus.currentPriceLabel } : {}),
          ...(parsedConsensus.analystCountLabel ? { analystCountLabel: parsedConsensus.analystCountLabel } : {}),
          ...(parsedConsensus.highTargetLabel ? { highTargetLabel: parsedConsensus.highTargetLabel } : {}),
          ...(parsedConsensus.lowTargetLabel ? { lowTargetLabel: parsedConsensus.lowTargetLabel } : {}),
          ...(parsedConsensus.summary ? { summary: parsedConsensus.summary } : {}),
          ...(parsedConsensus.upsideLabel ? { upsideLabel: parsedConsensus.upsideLabel } : {}),
          ...(typeof parsedConsensus.upsidePct === 'number' ? { upsidePct: parsedConsensus.upsidePct } : {}),
          ...(parsedConsensus.opinionLabel ? { opinionLabel: parsedConsensus.opinionLabel } : {}),
          ...(typeof parsedConsensus.opinionScore === 'number' ? { opinionScore: parsedConsensus.opinionScore } : {}),
          ...(typeof parsedConsensus.targetPriceValue === 'number' ? { targetPriceValue: parsedConsensus.targetPriceValue } : {}),
          ...(typeof parsedConsensus.currentPriceValue === 'number' ? { currentPriceValue: parsedConsensus.currentPriceValue } : {}),
          ...(typeof parsedConsensus.highTargetValue === 'number' ? { highTargetValue: parsedConsensus.highTargetValue } : {}),
          ...(typeof parsedConsensus.lowTargetValue === 'number' ? { lowTargetValue: parsedConsensus.lowTargetValue } : {}),
        },
      }
      : {}),
  }
}

export function buildLoadingQuickFacts(payload: JarooDeepScanPayload | null, quickQuote: LoadingQuickQuote | null, briefingSnapshot: LoadingBriefingSnapshot | null, fallbackName?: string, fallbackMarket?: string, fallbackKind?: string): LoadingQuickFact[] {
  return [
    buildWeek52LoadingQuickFact(quickQuote) ?? buildWeek52LoadingQuickFactFromBriefingSnapshot(briefingSnapshot),
    buildConsensusLoadingQuickFact(payload, fallbackName, fallbackMarket, fallbackKind),
  ].filter((fact): fact is LoadingQuickFact => Boolean(fact))
}
