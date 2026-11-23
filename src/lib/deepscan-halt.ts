// 딥스캔 거래정지 판정 — 2층 게이트(이슈 #276).
//
// 1차(힌트): 홈이 시세 병합 시점에 계산한 카드 톤(cardTone 'halt')이 세션으로 그대로
//   전달된다. 진입 즉시 거래정지 화면을 띄우는 근거로 쓴다. 다만 신선도는 홈의
//   마지막 시세 동기화 시점 기준이다.
// 2차(권위): 딥스캔 페이지가 로딩 팩트용으로 이미 fetch하는 퀵시세에서 판정한다.
//   ① 네이버 권위 필드(tradeHalted — basic 응답의 tradeStopType/tradableStatus 유래)가
//      있으면 시각과 무관하게 그것으로 즉시 확정한다(정지→해제 전환도 여기서 검출).
//   ② 필드가 없는 시세(KRX 폴백·위세리포트 ETF 등)에서만 당일 거래량 폴백을 쓴다.
//      volume === 0이면 '정규장 시간대'(월~금 09:00~15:30 KST)에서만 정지로 본다 —
//      장전 롤오버 행과 개장 직후 무체결 종목의 오탐을 차단한다. volume > 0이면
//      언제나 거래 중. 홈을 거치지 않은 진입(기록 복원 등)도 여기서 최종 판정한다.
//   권위 판정이 불가능할 때(퀵시세 미도착, 필드·거래량 모두 없음)에만 1차 힌트와
//   제한 시간 경과 fail-open이 최종 판정을 대신한다(톤 힌트보다 우선).
// 퀵시세가 제한 시간 안에 오지 않으면 fail-open으로 일반 플로우를 유지한다 —
// 정상 종목의 스캔 시작이 거래정지 검사 때문에 지연되어선 안 된다.

import type { HomeHolding } from './holding-types'
import { isKrRegularMarketWindow } from './kr-market-hours'

export type DeepScanHaltVerdict = 'halted' | 'active' | 'pending'

export const DEEPSCAN_HALT_CHECK_TIMEOUT_MS = 10_000

export function isHaltedHomeHolding(holding: Pick<HomeHolding, 'cardTone'> | null | undefined) {
  return holding?.cardTone === 'halt'
}

/** 당일 거래량 판정 — 0 = 정지, > 0 = 거래 중, 알 수 없음(미제공·조회 실패) = null */
export function resolveHaltedQuoteVolume(volume: number | null | undefined): boolean | null {
  if (typeof volume !== 'number' || !Number.isFinite(volume)) {
    return null
  }

  return volume === 0
}

export function resolveDeepScanHaltVerdict(input: {
  targetKey: string | null
  isUsTarget: boolean
  instrumentKind?: 'stock' | 'etf' | 'etn' | null
  haltHint: boolean
  quickQuoteVolume?: number | null
  quickQuoteTradeHalted?: boolean | null
  checkExpired: boolean
  now?: Date
}): DeepScanHaltVerdict {
  if (!input.targetKey) {
    return 'active'
  }

  // 미국 종목은 거래정지 개념이 달라 판정하지 않는다(fail-open).
  if (input.isUsTarget) {
    return 'active'
  }

  // KR ETF 분기는 후속 과제(#276 범위 외) — 일반 플로우 유지.
  // ETN은 이 조기리턴을 타지 않는다: 만기·상환 정지는 거래량 판정 흐름(주식과
  // 동일)에서 검출한다(의도된 동작 변화 — 레거시 kind 'etf' ETN은 skip이었음).
  if (input.instrumentKind === 'etf') {
    return 'active'
  }

  // 2차 권위 ① — 네이버 권위 필드. 시각과 무관하게 즉시 확정한다.
  if (typeof input.quickQuoteTradeHalted === 'boolean') {
    return input.quickQuoteTradeHalted ? 'halted' : 'active'
  }

  // 2차 권위 ② — 당일 거래량 폴백(정규장 시간 게이트와 함께).
  const haltedByVolume = resolveHaltedQuoteVolume(input.quickQuoteVolume)
  if (haltedByVolume === false) {
    return 'active'
  }
  if (haltedByVolume === true) {
    if (isKrRegularMarketWindow(input.now)) {
      return 'halted'
    }

    // 정규장 밖의 거래량 0은 정지 근거가 못 된다(장전 롤오버·무체결). 이 시점에 홈 힌트가
    // 'halt'라면 권위 필드에서 나온 것(홈도 시간 게이트를 통과했으므로)이므로 유지하고,
    // 아니면 새로 기다릴 근거가 없으니 즉시 일반 플로우로 연다.
    return input.haltHint ? 'halted' : 'active'
  }

  if (input.haltHint) {
    return 'halted'
  }

  return input.checkExpired ? 'active' : 'pending'
}

/** 종목명 + 조사 '은/는' — 한글 종성(받침) 여부로 결정. 한글 음절이 아닌 문자(숫자·영문)로
 *  끝나면 조사가 발음 규칙에 따라 갈리므로 '은'을 디폴트로 쓴다. */
export function appendSubjectJosa(name: string) {
  const trimmed = name.trim()
  const last = trimmed.slice(-1)
  const code = last.charCodeAt(0)
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3

  if (!isHangulSyllable) {
    return `${trimmed}은`
  }

  return (code - 0xac00) % 28 > 0 ? `${trimmed}은` : `${trimmed}는`
}

export type DeepScanHaltSeverity = 'low' | 'medium' | 'high' | 'critical'
export type DeepScanHaltSeverityLevel = 1 | 2 | 3 | 4

const HALT_SEVERITY_LEVEL_BY_SEVERITY: Record<DeepScanHaltSeverity, DeepScanHaltSeverityLevel> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function resolveHaltSeverityLevel(severity: DeepScanHaltSeverity): DeepScanHaltSeverityLevel {
  return HALT_SEVERITY_LEVEL_BY_SEVERITY[severity]
}

export type DeepScanHaltSeverityTone = 'danger' | 'caution' | 'attention' | 'neutral'

export type DeepScanHaltSeverityDisplay = {
  level: DeepScanHaltSeverityLevel
  label: string
  badge: string
  phase: string
  tone: DeepScanHaltSeverityTone
}

// 채택 시안(jaroo_halt_min)의 4단계 심각도 표기. 단계 산출은 공시 키워드 분류
// (deepscan-kr-disclosure-risk-keywords.js)의 최대 severity를 따른다.
export const HALT_SEVERITY_DISPLAYS: Record<DeepScanHaltSeverityLevel, DeepScanHaltSeverityDisplay> = {
  4: { level: 4, label: '매우 심각', badge: '위험', phase: '상폐 절차 가능성 구간', tone: 'danger' },
  3: { level: 3, label: '심각', badge: '주의', phase: '정리매매 전 단계 가능성', tone: 'caution' },
  2: { level: 2, label: '주의', badge: '관심', phase: '추가 공시 감시 필요', tone: 'attention' },
  1: { level: 1, label: '관심', badge: '참고', phase: '특이 리스크 신호 없음', tone: 'neutral' },
}

export function resolveHaltSeverityDisplay(level: DeepScanHaltSeverityLevel) {
  return HALT_SEVERITY_DISPLAYS[level]
}

/** 심각도 카드 헬퍼 문구 — "4단계 중 N단계 · 단계 설명" */
export function buildHaltSeverityHelperText(level: DeepScanHaltSeverityLevel) {
  return `4단계 중 ${level}단계 · ${HALT_SEVERITY_DISPLAYS[level].phase}`
}

// ── 거래정지 화면 공시 데이터 계약(라우트 ↔ 화면 공유) ──

export type HaltDisclosureFiling = {
  reportName: string
  receiptDate: string | null
  disclosureTypeLabel: string | null
  documentUrl: string | null
  severity: DeepScanHaltSeverity
}

export type HaltDisclosureSignal = {
  label: string
  severity: DeepScanHaltSeverity
  count: number
}

export type DeepScanHaltDisclosuresData = {
  code: string
  windowDays: number
  filings: HaltDisclosureFiling[]
  summary: {
    totalCount: number
    riskCount: number
    maxSeverity: DeepScanHaltSeverity
    severityLevel: DeepScanHaltSeverityLevel
    signals: HaltDisclosureSignal[]
  }
}

/** 게이지 래더 색 — 시안(jaroo_halt_min) 판1/판2와 동일한 [회색, 주황, 단계색, 단계색] 래더. */
const HALT_TONE_GAUGE_COLOR: Record<DeepScanHaltSeverityDisplay['tone'], string> = {
  danger: '#e5484d',
  caution: '#e5a23d',
  attention: '#e5a23d',
  neutral: '#97a0ae',
}

export function resolveHaltMeterColors(level: DeepScanHaltSeverityLevel) {
  const toneColor = HALT_TONE_GAUGE_COLOR[HALT_SEVERITY_DISPLAYS[level].tone]
  return ['#97a0ae', '#e5a23d', toneColor, toneColor].slice(0, level)
}

/** 공시 접수일 표기 — OpenDART는 YYYY-MM-DD와 YYYYMMDD 두 형태가 섞여 온다. */
export function formatHaltFilingDate(receiptDate: string | null) {
  if (!receiptDate) {
    return null
  }

  const match = receiptDate.match(/^(\d{4})-?(\d{2})-?(\d{2})/u)
  return match ? `${match[2]}.${match[3]}` : null
}

export type HaltHoldingFacts = {
  lastTradedPriceText: string | null
  averagePriceText: string | null
  quantityText: string | null
  evaluationText: string | null
  profitRatePct: number | null
  profitRateText: string | null
}

function formatHaltMoney(value: number, currency?: string | null) {
  const formatted = value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  return currency === 'USD' ? `${formatted}$` : `${formatted}원`
}

/** 보유 현황 카드용 팩트 — 마지막 체결가(정지 전 종가) 기준 손익 계산.
 *  색 규칙은 #266/#275 확정안(플러스=빨강 / 마이너스=파랑)을 컴포넌트에서 토큰으로 적용한다. */
export function buildHaltHoldingFacts(input: {
  name: string
  lastTradedPrice: number | null
  currency?: string | null
  quantity?: number | null
  averagePrice?: number | null
  averagePriceCurrency?: string | null
  fallbackProfitRatePct?: number | null
}): HaltHoldingFacts {
  const price = typeof input.lastTradedPrice === 'number' && Number.isFinite(input.lastTradedPrice)
    ? input.lastTradedPrice
    : null
  const quantity = typeof input.quantity === 'number' && Number.isFinite(input.quantity)
    ? input.quantity
    : null
  const averagePrice = typeof input.averagePrice === 'number' && Number.isFinite(input.averagePrice)
    ? input.averagePrice
    : null

  const evaluation = price !== null && quantity !== null ? price * quantity : null
  const computedProfitRate = price !== null && averagePrice !== null && averagePrice > 0
    ? ((price / averagePrice) - 1) * 100
    : null
  const profitRatePct = computedProfitRate
    ?? (typeof input.fallbackProfitRatePct === 'number' && Number.isFinite(input.fallbackProfitRatePct)
      ? input.fallbackProfitRatePct
      : null)

  return {
    lastTradedPriceText: price !== null ? formatHaltMoney(price, input.currency) : null,
    averagePriceText: averagePrice !== null ? formatHaltMoney(averagePrice, input.averagePriceCurrency ?? input.currency) : null,
    quantityText: quantity !== null ? `${quantity.toLocaleString('ko-KR')}주` : null,
    evaluationText: evaluation !== null ? formatHaltMoney(evaluation, input.currency) : null,
    profitRatePct,
    profitRateText: profitRatePct !== null
      ? `${profitRatePct > 0 ? '+' : ''}${profitRatePct.toFixed(1)}%`
      : null,
  }
}
