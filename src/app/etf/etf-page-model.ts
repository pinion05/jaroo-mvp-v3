// /etf 페이지 상태머신 + 외부 계약 어댑터 (스펙 2026-09-15 Task 6).
// 페이지 컴포넌트는 이 모듈의 순수 함수로 상태를 전이시킨다:
//   target(ok/empty/invalid) → 초기상태 → fetch 결과(브리핑 스냅샷·profile) → ready/error
// 시세·일봉 차트·시장 지표는 딥스캔과 같은 briefing-snapshot 소스를 쓰고
// (TodayBriefingCard 재사용), 전일 대비 등락률은 profile.quote.changePct에서 합성한다.

import { normalizeDeepScanCode } from '@/app/deepscan/deepscan-page-fetchers'
import type { LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { resolveDeepScanTargetSession } from '@/lib/jaroo-home-data'
import { resolveEtfPageTarget, type EtfPageTarget, type EtfTargetSessionLike } from '@/lib/etf/etf-target'
import { buildEtfViewModel, type EtfProfileJson, type EtfViewModel } from '@/lib/etf/etf-view-model'

export type EtfPageQuote = { price: number; asOf?: string }

export type EtfPageState =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | { phase: 'invalid' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready'
      vm: EtfViewModel
      briefing: LoadingBriefingSnapshot
      market: 'kospi' | 'kosdaq'
      holding: { shares: number; averagePrice: number } | null
    }

type EtfPageOkTarget = Extract<EtfPageTarget, { status: 'ok' }>

// 홈 딥스캔 세션(holding 필드가 '100주'/'101,400원' 같은 표시 문자열)을
// etf-target 계약(숫자 holding)으로 바꾼다. 한국 6자리 코드가 없는 홀딩
// (미국 ETF 등)은 빈 코드로 내려 가드가 invalid로 판정하게 한다.
export type DeepScanSnapshotLike = {
  holding?: {
    id?: number
    code?: string | null
    identifierCode?: string | null
    identifierTicker?: string | null
    name?: string
    kind?: string
    market?: string
    marketTone?: string
    shares?: string
    averagePrice?: string
  } | null
} | null

export function buildEtfSessionFromDeepScanSnapshot(snapshot: DeepScanSnapshotLike): EtfTargetSessionLike | null {
  const holding = snapshot?.holding
  if (!holding || holding.id === -1 || holding.name === '종목 미선택') {
    return null
  }

  const code = normalizeDeepScanCode(holding.identifierCode ?? holding.code ?? undefined) ?? ''
  const shares = parseOcrNumber(holding.shares ?? '')
  const averagePrice = parseOcrNumber(holding.averagePrice ?? '')

  return {
    code,
    name: holding.name ?? code,
    kind: holding.kind,
    market: holding.marketTone ?? holding.market,
    holding: shares !== null && averagePrice !== null ? { shares, averagePrice } : null,
  }
}

export function createInitialEtfPageState(target: EtfPageTarget): EtfPageState {
  switch (target.status) {
    case 'ok':
      return { phase: 'loading' }
    case 'empty':
      return { phase: 'empty' }
    default:
      return { phase: 'invalid' }
  }
}

// 딥스캔 로딩 화면이 쓰는 것과 동일 엔드포인트 — ETF 코드에서도 시세·일봉·시장이 온다.
export function buildEtfPageBriefingUrl(code: string) {
  return `/api/deepscan/briefing-snapshot?code=${encodeURIComponent(code)}`
}

export function buildEtfPageProfileUrl(code: string) {
  return `/api/etf/profile?code=${encodeURIComponent(code)}`
}

// /api/etf/profile의 400은 크롤러 NOT_ETF 판정(주식 코드 등)뿐이다 —
// 다른 말로 래핑하지 않으므로 상태코드만 보고 invalid 페이지 상태로 매핑할 수 있다.
export function isNotAnEtfProfileStatus(status: number): boolean {
  return status === 400
}

export type EtfBriefingQuote = EtfPageQuote & { snapshot: LoadingBriefingSnapshot }

export function parseEtfBriefingSnapshotResponse(body: unknown): EtfBriefingQuote | null {
  const data = (body as { data?: LoadingBriefingSnapshot } | null)?.data
  const price = data?.quote?.currentPrice
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null
  }

  return {
    price,
    asOf: typeof data?.quote?.asOf === 'string' ? data.quote.asOf : (typeof data?.asOf === 'string' ? data.asOf : undefined),
    snapshot: data ?? {},
  }
}

export function parseEtfProfileResponse(body: unknown): EtfProfileJson | null {
  const data = (body as { data?: unknown } | null)?.data as EtfProfileJson | null | undefined
  return data && data.schemaVersion === 'jaroo-etf-profile-v1' && data.ok === true ? data : null
}

export function buildEtfPageState(
  target: EtfPageOkTarget,
  briefing: (EtfPageQuote & { snapshot?: LoadingBriefingSnapshot }) | null,
  profile: EtfProfileJson | null,
): EtfPageState {
  if (!briefing) {
    return { phase: 'error', message: '시세를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' }
  }
  if (!profile) {
    return { phase: 'error', message: 'ETF 상품 정보를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' }
  }

  return {
    phase: 'ready',
    briefing: briefing.snapshot ?? {},
    market: profile.market,
    holding: target.holding,
    vm: buildEtfViewModel({
      profile,
      quote: { price: briefing.price, asOf: briefing.asOf, changePct: profile.quote?.changePct ?? null },
      holding: target.holding,
    }),
  }
}

export function resolveEtfPageTargetFromWindow(): EtfPageTarget {
  return resolveEtfPageTarget({
    searchParams: new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search),
    readSession: () => buildEtfSessionFromDeepScanSnapshot(resolveDeepScanTargetSession()),
  })
}
