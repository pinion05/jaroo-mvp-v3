import {
  buildAppliedHomePortfolioRowsFromPortfolioItems,
  readAppliedHomePortfolio,
  type AppliedHomePortfolioRow,
  type AveragePriceCurrency,
} from '@/lib/jaroo-home-data'
import { toExistingPortfolioResolution, type ExistingPortfolioResolution } from '@/lib/portfolio-merge'
import { notifyPortfolioSyncFailure } from '@/lib/portfolio-sync-notice'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { usePortfolioStore } from '@/lib/stores/use-portfolio-store'
import { buildIdentifierLabel } from '@/lib/workflow-types'

export type PortfolioSaveRow = {
  name: string
  code?: string
  ticker?: string
  market?: string
  market_tone?: AppliedHomePortfolioRow['resolvedMarketTone']
  kind?: AppliedHomePortfolioRow['resolvedKind']
  quantity: number
  average_price: number
  average_price_currency?: AveragePriceCurrency
  evaluation_amount?: number | null
  identifier_label?: string
  sort_order: number
  source: string
}

export type PortfolioDbRow = PortfolioSaveRow

export function mapAppliedRowsToSaveRows(rows: AppliedHomePortfolioRow[]): PortfolioSaveRow[] {
  return rows.map((row, index) => {
    const name = (row.resolvedName?.trim() || row.name.trim())
    const ticker = row.resolvedTicker?.trim() || row.ticker?.trim() || undefined
    const code = row.resolvedCode?.trim() || row.code?.trim() || undefined

    return {
      name,
      code,
      ticker,
      market: row.resolvedMarket?.trim() || undefined,
      market_tone: row.resolvedMarketTone,
      kind: row.resolvedKind,
      quantity: parseOcrNumber(row.quantity) ?? 0,
      average_price: parseOcrNumber(row.averagePrice) ?? 0,
      average_price_currency: row.averagePriceCurrency,
      evaluation_amount: parseOcrNumber(row.evaluationAmount) ?? null,
      identifier_label: buildIdentifierLabel(ticker, code),
      sort_order: index,
      source: 'ocr',
    }
  })
}

export function mapDbRowsToAppliedRows(rows: PortfolioDbRow[]): AppliedHomePortfolioRow[] {
  return rows.map((row) => {
    const name = (row.name ?? '').trim()
    return {
      name,
      resolvedName: name,
      quantity: row.quantity != null ? String(row.quantity) : '',
      averagePrice: row.average_price != null ? String(row.average_price) : '',
      profitRate: '',
      evaluationAmount: row.evaluation_amount != null ? String(row.evaluation_amount) : '',
      resolvedCode: row.code,
      code: row.code,
      resolvedTicker: row.ticker,
      ticker: row.ticker,
      resolvedMarket: row.market,
      resolvedMarketTone: row.market_tone,
      resolvedKind: row.kind,
      averagePriceCurrency: row.average_price_currency,
    }
  })
}

export type PortfolioFetchResult =
  | { status: 'rows'; rows: AppliedHomePortfolioRow[] }
  | { status: 'empty' }
  | { status: 'logged-out' }
  | { status: 'error' }

export type PortfolioSyncResult =
  | { ok: true; saved?: number }
  | { ok: false; reason: 'logged-out' | 'error' }

export async function parsePortfolioFetchResponse(response: Response): Promise<PortfolioFetchResult> {
  if (response.status === 401) {
    return { status: 'logged-out' }
  }
  if (!response.ok) {
    return { status: 'error' }
  }

  const payload = (await response.json()) as { rows?: PortfolioDbRow[] }
  const rows = Array.isArray(payload?.rows) ? payload.rows : []

  if (rows.length === 0) {
    return { status: 'empty' }
  }

  return { status: 'rows', rows: mapDbRowsToAppliedRows(rows) }
}

export function shouldUsePortfolioSessionFallback(result: PortfolioFetchResult) {
  return result.status === 'logged-out' || result.status === 'error'
}

export async function parsePortfolioSyncResponse(response: Response): Promise<PortfolioSyncResult> {
  if (response.status === 401) {
    return { ok: false, reason: 'logged-out' }
  }
  if (!response.ok) {
    return { ok: false, reason: 'error' }
  }

  const payload = (await response.json()) as { saved?: number }
  return { ok: true, saved: payload.saved }
}

// 적용 시점 기존 포트폴리오 조회 제한 시간. 적용이 이 조회 뒤에 이어지므로 무한 대기하지 않게 막는다.
const EXISTING_PORTFOLIO_FETCH_TIMEOUT_MS = 6_000

export async function fetchPortfolio(options: { timeoutMs?: number } = {}): Promise<PortfolioFetchResult> {
  try {
    const response = await fetch('/api/portfolio', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    })
    return await parsePortfolioFetchResponse(response)
  } catch {
    return { status: 'error' }
  }
}

export async function syncPortfolioToServer(rows: AppliedHomePortfolioRow[]): Promise<PortfolioSyncResult> {
  try {
    const response = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: mapAppliedRowsToSaveRows(rows) }),
    })

    return await parsePortfolioSyncResponse(response)
  } catch {
    return { ok: false, reason: 'error' }
  }
}

// --- 재적용 병합: 적용 시점의 기존 포트폴리오 읽기와 병합 결과 저장 ---

function readLocalPortfolioRows(): AppliedHomePortfolioRow[] {
  const storeRows = buildAppliedHomePortfolioRowsFromPortfolioItems(usePortfolioStore.getState().items)
  if (storeRows.length > 0) {
    return storeRows
  }
  return readAppliedHomePortfolio()?.rows ?? []
}

// 적용 시점의 기존 포트폴리오를 찾는다. 스토어에 종목이 있어도 서버를 먼저 읽는다 — 로그인 사용자는
// DB가 단일 소스이고(홈 로드 정책과 같다) 다른 기기에서 바뀌었을 수 있다. 서버를 못 읽으면
// 'unavailable'(로컬 행으로 병합, 서버 교체 저장은 안 함)로 떨어진다.
export async function resolveExistingPortfolioForMerge(): Promise<ExistingPortfolioResolution> {
  const fetchResult = await fetchPortfolio({ timeoutMs: EXISTING_PORTFOLIO_FETCH_TIMEOUT_MS })
  return toExistingPortfolioResolution(fetchResult, readLocalPortfolioRows())
}

export function shouldNotifyPortfolioSyncFailure(result: PortfolioSyncResult): boolean {
  return !result.ok && result.reason === 'error'
}

// 적용 뒤 서버 저장. 저장 RPC(sync_user_portfolio)는 사용자 행을 전부 지운 뒤 다시 넣는 "전체 교체"라서
// 이번 묶음이 아니라 병합 결과 전체(plan.rows)를 보낸다. 기존 목록을 서버에서 확실히 읽지 못한 경우
// (unavailable)는 보내지 않는다 — 불완전한 목록으로 교체하면 다른 기기의 종목이 지워진다.
// 로그아웃(401)은 세션 전용 모드이므로 알리지 않고, 서버 오류는 홈 배너로 알린다.
export function syncMergedPortfolioAfterApply(existing: ExistingPortfolioResolution, rows: AppliedHomePortfolioRow[]): void {
  const outcome: Promise<PortfolioSyncResult> = existing.status === 'unavailable'
    ? Promise.resolve({ ok: false, reason: 'error' })
    : syncPortfolioToServer(rows)

  void outcome.then((result) => {
    if (shouldNotifyPortfolioSyncFailure(result)) {
      notifyPortfolioSyncFailure()
    }
  })
}
