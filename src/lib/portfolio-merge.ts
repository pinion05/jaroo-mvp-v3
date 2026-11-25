import { getAggregationKey } from '@/lib/ocr-review-aggregation'
import { MAX_PORTFOLIO_ROWS } from '@/lib/portfolio-validation'
import { formatComputedNumber, parseOcrNumber, parseOcrProfitRate } from '@/lib/screenshot-ocr'
import type { AppliedHomePortfolioRow } from '@/lib/jaroo-home-data'

// 재적용 병합: "이미 저장된 포트폴리오"와 "이번 검수에서 확정한 행"을 합친다.
//
// 배경(2026-11): 2026-07-06 자동저장 설계의 "Re-OCR = Replace" 결정에 따라 적용 때마다 이번 묶음만
// 서버로 보냈고, 저장 RPC(sync_user_portfolio)는 사용자 행을 전부 지운 뒤 다시 넣기 때문에 새 스크린샷에
// 없는 기존 종목이 DB에서 사라졌다. RPC는 그대로 두고, 여기서 만든 "병합 결과 전체"를 저장해 다른 종목이
// 지워지지 않게 한다. 겹치는 종목은 사용자가 종목별로 고른다(갱신/합산/유지).
//
// 이 모듈은 순수 함수만 둔다(스토어·fetch·window 비의존) — node:test에서 직접 검증한다.

export type PortfolioOverlapChoice = 'update' | 'sum' | 'keep'

export type PortfolioOverlap = {
  key: string
  displayName: string
  existing: AppliedHomePortfolioRow
  incoming: AppliedHomePortfolioRow
  choice: PortfolioOverlapChoice
  result: AppliedHomePortfolioRow
}

export type PortfolioMergePlan = {
  rows: AppliedHomePortfolioRow[]
  overlaps: PortfolioOverlap[]
  addedRows: AppliedHomePortfolioRow[]
  keptRowCount: number
}

// 적용 시점의 "기존 포트폴리오" 출처.
//   server       로그인 사용자의 DB 행(빈 배열 포함). DB가 단일 소스다.
//   session      비로그인(401). 탭 로컬(스토어, 없으면 세션스토리지) 행이 전부다.
//   unavailable  서버 조회 실패. 로컬 행으로 병합하되 서버 전체 교체 저장은 하지 않는다
//                — 불완전한 목록으로 교체하면 다른 기기의 종목을 지울 수 있다.
export type ExistingPortfolioResolution =
  | { status: 'server'; rows: AppliedHomePortfolioRow[] }
  | { status: 'session'; rows: AppliedHomePortfolioRow[] }
  | { status: 'unavailable'; rows: AppliedHomePortfolioRow[] }

export type PortfolioOverlapChoiceMap = Readonly<Record<string, PortfolioOverlapChoice>>

// 선택을 안 했으면 4월 목업의 기본값("새 정보로 업데이트")과 같게 갱신한다.
export const DEFAULT_PORTFOLIO_OVERLAP_CHOICE: PortfolioOverlapChoice = 'update'

export function resolvePortfolioOverlapChoice(choices: PortfolioOverlapChoiceMap, key: string): PortfolioOverlapChoice {
  const choice = choices[key]
  return choice === 'sum' || choice === 'keep' ? choice : DEFAULT_PORTFOLIO_OVERLAP_CHOICE
}

export function getPortfolioMergeKey(
  row: Pick<AppliedHomePortfolioRow, 'name' | 'resolvedName' | 'code' | 'resolvedCode' | 'ticker' | 'resolvedTicker'>,
): string {
  // 묶음 안 계좌 집계와 같은 종목 판정 규칙(코드 → 티커 → 정규화 이름)을 쓴다. 집계 쪽은 검수 행이라
  // 확정 값(resolved*)만 보는데, 적용된 포트폴리오 행은 확정 값이 비면 원본 값(code/ticker)으로
  // 내려간다 — DB 에서 읽은 행이나 OCR 에서 확정한 행이나 두 필드에 같은 식별자를 담는다.
  return getAggregationKey({
    resolvedCode: row.resolvedCode?.trim() || row.code,
    resolvedTicker: row.resolvedTicker?.trim() || row.ticker,
    resolvedName: row.resolvedName,
    name: row.name,
  })
}

function formatSignedAmount(value: number): string {
  const normalizedValue = Number(value.toFixed(4))
  return Number.isFinite(normalizedValue) ? `${normalizedValue > 0 ? '+' : ''}${formatComputedNumber(normalizedValue)}` : ''
}

function formatRate(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

// 겹치는 종목을 "수량 합산"으로 처리한 행. 묶음 안 계좌 집계(aggregateGroup)와 같은 규칙이다:
// 수량은 더하고, 평단은 수량 가중평균. 평단 화폐가 다르면 더할 수 없어 이번 값(갱신)으로 떨어진다.
function sumOverlapRows(existing: AppliedHomePortfolioRow, incoming: AppliedHomePortfolioRow): AppliedHomePortfolioRow {
  const existingQuantity = parseOcrNumber(existing.quantity)
  const incomingQuantity = parseOcrNumber(incoming.quantity)
  if (existingQuantity === null || incomingQuantity === null) {
    return incoming
  }

  const quantity = existingQuantity + incomingQuantity
  const existingPrice = parseOcrNumber(existing.averagePrice)
  const incomingPrice = parseOcrNumber(incoming.averagePrice)
  const sameCurrency = (existing.averagePriceCurrency ?? null) === (incoming.averagePriceCurrency ?? null)
  const canAveragePrice = sameCurrency
    && existingPrice !== null
    && incomingPrice !== null
    && existingPrice > 0
    && incomingPrice > 0
    && quantity > 0
  const averagePrice = canAveragePrice
    ? (existingQuantity * (existingPrice as number) + incomingQuantity * (incomingPrice as number)) / quantity
    : null

  const existingEvaluationAmount = parseOcrNumber(existing.evaluationAmount)
  const incomingEvaluationAmount = parseOcrNumber(incoming.evaluationAmount)
  const evaluationAmount = existingEvaluationAmount !== null && incomingEvaluationAmount !== null
    ? formatComputedNumber(existingEvaluationAmount + incomingEvaluationAmount)
    : incoming.evaluationAmount

  const existingProfitAmount = parseOcrNumber(existing.profitAmount ?? '')
  const incomingProfitAmount = parseOcrNumber(incoming.profitAmount ?? '')
  const profitAmount = existingProfitAmount !== null && incomingProfitAmount !== null
    ? formatSignedAmount(existingProfitAmount + incomingProfitAmount)
    : incoming.profitAmount

  // 수익률은 원금(수량×평단) 가중. DB에서 읽은 기존 행은 수익률이 비어 있어 이번 값으로 떨어진다
  // (홈은 어차피 실시간 시세로 다시 계산한다).
  const existingRate = parseOcrProfitRate(existing.profitRate ?? '')
  const incomingRate = parseOcrProfitRate(incoming.profitRate)
  const existingPrincipal = canAveragePrice ? existingQuantity * (existingPrice as number) : null
  const incomingPrincipal = canAveragePrice ? incomingQuantity * (incomingPrice as number) : null
  const profitRate = existingRate !== null && incomingRate !== null && existingPrincipal !== null && incomingPrincipal !== null
    && existingPrincipal + incomingPrincipal > 0
    ? formatRate(
        (existingPrincipal * existingRate + incomingPrincipal * incomingRate) / (existingPrincipal + incomingPrincipal),
      )
    : incoming.profitRate

  return {
    ...existing,
    quantity: formatComputedNumber(quantity),
    averagePrice: averagePrice === null ? incoming.averagePrice : formatComputedNumber(averagePrice),
    averagePriceCurrency: canAveragePrice ? (existing.averagePriceCurrency ?? incoming.averagePriceCurrency) : incoming.averagePriceCurrency,
    evaluationAmount,
    profitAmount,
    profitRate,
  }
}

// 병합 결과의 행 순서는 "기존 순서 그대로(겹치는 종목은 제자리에서 처리) + 새 종목은 뒤에"다.
// 검수에서 제외·에러로 빠진 행은 incoming에 없으므로 기존 종목을 건드리지 않는다.
export function planPortfolioMerge(
  existingRows: AppliedHomePortfolioRow[],
  incomingRows: AppliedHomePortfolioRow[],
  choices: PortfolioOverlapChoiceMap = {},
): PortfolioMergePlan {
  const incomingByKey = new Map<string, AppliedHomePortfolioRow>()
  for (const row of incomingRows) {
    const key = getPortfolioMergeKey(row)
    if (!incomingByKey.has(key)) {
      incomingByKey.set(key, row)
    }
  }

  const rows: AppliedHomePortfolioRow[] = []
  const overlaps: PortfolioOverlap[] = []
  const matchedKeys = new Set<string>()
  let keptRowCount = 0

  for (const existing of existingRows) {
    const key = getPortfolioMergeKey(existing)
    const incoming = incomingByKey.get(key)

    // 기존 목록 자체에 같은 종목이 중복돼 있으면 첫 행만 병합 대상으로 삼는다(합산 이중 계산 방지).
    if (!incoming || matchedKeys.has(key)) {
      rows.push(existing)
      keptRowCount += 1
      continue
    }

    matchedKeys.add(key)
    const choice = resolvePortfolioOverlapChoice(choices, key)
    const result = choice === 'update' ? incoming : choice === 'keep' ? existing : sumOverlapRows(existing, incoming)
    rows.push(result)
    overlaps.push({
      key,
      displayName: incoming.resolvedName?.trim() || incoming.name.trim() || existing.resolvedName?.trim() || existing.name,
      existing,
      incoming,
      choice,
      result,
    })
  }

  const addedRows = [...incomingByKey.values()].filter((row) => !matchedKeys.has(getPortfolioMergeKey(row)))

  return {
    rows: [...rows, ...addedRows],
    overlaps,
    addedRows,
    keptRowCount,
  }
}

export function exceedsPortfolioRowLimit(rowCount: number): boolean {
  return rowCount > MAX_PORTFOLIO_ROWS
}

type ExistingPortfolioFetchResult = {
  status: 'rows' | 'empty' | 'logged-out' | 'error'
  rows?: AppliedHomePortfolioRow[]
}

// fetchPortfolio() 결과를 적용 시점의 기존 포트폴리오 출처로 해석한다.
export function toExistingPortfolioResolution(
  fetchResult: ExistingPortfolioFetchResult,
  localRows: AppliedHomePortfolioRow[],
): ExistingPortfolioResolution {
  if (fetchResult.status === 'rows') {
    return { status: 'server', rows: Array.isArray(fetchResult.rows) ? fetchResult.rows : [] }
  }
  if (fetchResult.status === 'empty') {
    return { status: 'server', rows: [] }
  }
  if (fetchResult.status === 'logged-out') {
    return { status: 'session', rows: localRows }
  }
  return { status: 'unavailable', rows: localRows }
}
