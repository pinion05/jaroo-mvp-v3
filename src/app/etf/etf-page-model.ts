// /etf 페이지 상태머신 + 외부 계약 어댑터 (스펙 2026-09-15 Task 6).
// 페이지 컴포넌트는 이 모듈의 순수 함수로 상태를 전이시킨다:
//   target(ok/empty/invalid) → 초기상태 → fetch 결과(브리핑 스냅샷·profile) → ready/error
// 시세·일봉 차트·시장 지표는 딥스캔과 같은 briefing-snapshot 소스를 쓰고
// (TodayBriefingCard 재사용), 전일 대비 등락률은 profile.quote.changePct에서 합성한다.

import { normalizeDeepScanCode } from '@/app/deepscan/deepscan-page-fetchers'
import type { LoadingBriefingSnapshot } from '@/lib/deepscan-briefing-snapshot'
import { computePriceDriftPct } from '@/lib/deepscan-snapshot-policy'
import { parseOcrNumber } from '@/lib/screenshot-ocr'
import { resolveDeepScanTargetSession } from '@/lib/jaroo-home-data'
import { resolveEtfPageTarget, type EtfPageTarget, type EtfTargetSessionLike } from '@/lib/etf/etf-target'
import { computeEtfMetrics } from '@/lib/etf/etf-metrics'
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
      market: 'kospi' | 'kosdaq' | 'us'
      holding: { shares: number; averagePrice: number } | null
      /** 재열람 캐시 히트 — 원장에 저장된 분석 시각. fresh 수집이면 null. */
      restoredAt: string | null
      /** 캐시된 분석 기준가 vs live 시세의 가격 드리프트(%) — 캐시 히트 시에만. */
      analysisDriftPct: number | null
    }

type EtfPageOkTarget = Extract<EtfPageTarget, { status: 'ok' }>
export type { EtfPageOkTarget }

// 홈 딥스캔 세션(holding 필드가 '100주'/'101,400원' 같은 표시 문자열)을
// etf-target 계약(숫자 holding)으로 바꾼다. 한국 6자리 코드가 없는 홀딩은
// 대문자 티커(identifierTicker — 미국 ETF)로 내려 market 가드가 판정하게 한다.
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

const US_TICKER_PATTERN = /^[A-Za-z]{1,5}$/

export function buildEtfSessionFromDeepScanSnapshot(snapshot: DeepScanSnapshotLike): EtfTargetSessionLike | null {
  const holding = snapshot?.holding
  if (!holding || holding.id === -1 || holding.name === '종목 미선택') {
    return null
  }

  const krCode = normalizeDeepScanCode(holding.identifierCode ?? holding.code ?? undefined) ?? ''
  const usTicker =
    !krCode && US_TICKER_PATTERN.test(String(holding.identifierTicker ?? ''))
      ? String(holding.identifierTicker).trim().toUpperCase()
      : ''
  const shares = parseOcrNumber(holding.shares ?? '')
  const averagePrice = parseOcrNumber(holding.averagePrice ?? '')

  return {
    code: krCode || usTicker,
    name: holding.name ?? (krCode || usTicker),
    kind: holding.kind,
    market: krCode ? (holding.marketTone ?? holding.market) : 'us',
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
// 미국 ETF는 ticker+market=US 변형(브리핑 라우트의 미국 경로 — polygon 기반).
export function buildEtfPageBriefingUrl(code: string, market: 'kr' | 'us' = 'kr') {
  if (market === 'us') {
    return `/api/deepscan/briefing-snapshot?ticker=${encodeURIComponent(code)}&market=US`
  }
  return `/api/deepscan/briefing-snapshot?code=${encodeURIComponent(code)}`
}

export function buildEtfPageProfileUrl(code: string, options?: { refresh?: boolean }) {
  const base = `/api/etf/profile?code=${encodeURIComponent(code)}`
  return options?.refresh ? `${base}&refresh=1` : base
}

// 재열람 캐시 표식 — /api/etf/profile이 세션 원장의 최근 분석(TTL 내)을 돌려줄 때
// 얹는다(deepscan metadata.deepScanCache와 같은 계약). deepscan과 달리 ETF는
// 무과금이라 savedCredits 표식이 없다.
export type EtfProfileCacheInfo = { scannedAt: string }

export function parseEtfProfileCacheInfo(body: unknown): EtfProfileCacheInfo | null {
  const cache = (body as { cache?: { hit?: unknown; scannedAt?: unknown } } | null)?.cache
  if (!cache || cache.hit !== true || typeof cache.scannedAt !== 'string' || !cache.scannedAt) {
    return null
  }
  return { scannedAt: cache.scannedAt }
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
  cacheInfo?: EtfProfileCacheInfo | null,
): EtfPageState {
  if (!briefing) {
    return { phase: 'error', message: '시세를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' }
  }
  if (!profile) {
    return { phase: 'error', message: 'ETF 상품 정보를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' }
  }

  const lastClose = profile.daily?.[profile.daily.length - 1]?.close ?? null
  return {
    phase: 'ready',
    briefing: briefing.snapshot ?? {},
    market: profile.market,
    holding: target.holding,
    restoredAt: cacheInfo?.scannedAt ?? null,
    analysisDriftPct: cacheInfo ? computePriceDriftPct(lastClose, briefing.price) : null,
    vm: buildEtfViewModel({
      profile,
      quote: { price: briefing.price, asOf: briefing.asOf, changePct: profile.quote?.changePct ?? null },
      holding: target.holding,
      metrics: computeEtfMetrics(profile.daily),
    }),
  }
}

export function resolveEtfPageTargetFromWindow(): EtfPageTarget {
  return resolveEtfPageTarget({
    searchParams: new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search),
    readSession: () => buildEtfSessionFromDeepScanSnapshot(resolveDeepScanTargetSession()),
  })
}

// ─── AI 위원회(시장·차트 팀) — 국내 ETF 전용 ───────────────────────────────────
// 크롤러 etf-market-committee 응답/진행 폴링을 카드 뷰 상태로 정규화한다.
// ETF엔 PER 등 주식형 근거가 없어 시장 타이밍 축 3명(트렌드·시장 신호·가격 위치)만 분석한다.

export type EtfCommitteeMemberView = {
  memberKey: string
  title: string
  status: 'success' | 'pending' | 'error'
  score: number | null
  scoreLabel: string
  reason: string | null
}

export type EtfCommitteeState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'ready'
      axisLabel: string
      axisStatusText: string
      members: EtfCommitteeMemberView[]
      requestId: string | null
      status: string
      scannedAt: string | null
    }
  | { phase: 'error'; message: string }
  | { phase: 'disabled'; message: string }

const ETF_COMMITTEE_FALLBACK_ERROR = 'AI 위원회 분석을 가져오지 못했어요. 잠시 후 다시 시도해주세요.'

function parseEtfCommitteeMember(value: unknown): EtfCommitteeMemberView | null {
  if (!value || typeof value !== 'object') return null
  const member = value as Record<string, unknown>
  if (typeof member.title !== 'string' || !member.title) return null
  const status = member.status === 'success' || member.status === 'pending' ? member.status : 'error'
  return {
    memberKey: typeof member.memberKey === 'string' ? member.memberKey : '',
    title: member.title,
    status,
    score: typeof member.score === 'number' && Number.isFinite(member.score) ? member.score : null,
    scoreLabel: typeof member.scoreLabel === 'string' && member.scoreLabel ? member.scoreLabel : 'N/A',
    reason: typeof member.reason === 'string' && member.reason.trim() ? member.reason : null,
  }
}

function parseEtfCommitteeAxes(
  axes: unknown,
): { axisLabel: string; axisStatusText: string; members: EtfCommitteeMemberView[] } | null {
  if (!Array.isArray(axes) || axes.length === 0) return null
  const axis = axes[0]
  if (!axis || typeof axis !== 'object') return null
  const record = axis as Record<string, unknown>
  const members = (Array.isArray(record.members) ? record.members : [])
    .map(parseEtfCommitteeMember)
    .filter((member): member is EtfCommitteeMemberView => member !== null)
  if (members.length === 0) return null
  return {
    axisLabel: typeof record.label === 'string' && record.label ? record.label : '시장·차트 팀',
    axisStatusText: typeof record.axisStatusText === 'string' ? record.axisStatusText : '',
    members,
  }
}

function readEtfCommitteeCacheMarker(body: Record<string, unknown>): string | null {
  const cache = body.cache
  if (!cache || typeof cache !== 'object' || (cache as { hit?: unknown }).hit !== true) return null
  const scannedAt = (cache as { scannedAt?: unknown }).scannedAt
  return typeof scannedAt === 'string' && scannedAt ? scannedAt : null
}

/** 최초 /api/etf/committee 응답 → 카드 상태. ok:false·disabled·빈 축을 각각 안내 상태로 내린다. */
export function parseEtfCommitteeResponse(body: unknown): EtfCommitteeState {
  const record = body as Record<string, unknown> | null
  if (!record || typeof record !== 'object') {
    return { phase: 'error', message: ETF_COMMITTEE_FALLBACK_ERROR }
  }
  if (record.ok !== true) {
    const message = (record.error as { message?: unknown } | null | undefined)?.message
    return { phase: 'error', message: typeof message === 'string' && message ? message : ETF_COMMITTEE_FALLBACK_ERROR }
  }
  if (record.status === 'disabled') {
    return { phase: 'disabled', message: 'AI 위원회가 준비 중이에요. 잠시 후 다시 시도해주세요.' }
  }
  const axes = parseEtfCommitteeAxes(record.axes)
  if (!axes) {
    return { phase: 'error', message: ETF_COMMITTEE_FALLBACK_ERROR }
  }
  return {
    phase: 'ready',
    ...axes,
    requestId: typeof record.requestId === 'string' && record.requestId ? record.requestId : null,
    status: typeof record.status === 'string' ? record.status : 'unknown',
    scannedAt: readEtfCommitteeCacheMarker(record),
  }
}

/** /api/etf/committee-status 폴링 응답 → 카드 상태. 파싱 실패는 null(이전 상태 유지). */
export function parseEtfCommitteeStatusResponse(body: unknown): EtfCommitteeState | null {
  const record = body as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record.ok !== true) return null
  const axes = parseEtfCommitteeAxes(record.committeeAxes)
  if (!axes) return null
  return {
    phase: 'ready',
    ...axes,
    requestId: typeof record.requestId === 'string' && record.requestId ? record.requestId : null,
    status: typeof record.status === 'string' ? record.status : 'unknown',
    scannedAt: null,
  }
}

/** partial 셸은 requestId로 완성될 때까지 폴링한다. */
export function shouldContinueEtfCommitteePolling(state: EtfCommitteeState): boolean {
  return state.phase === 'ready' && state.status === 'partial' && Boolean(state.requestId)
}

export function buildEtfCommitteeUrl(code: string, holding: { shares: number; averagePrice: number } | null): string {
  const params = new URLSearchParams({ code })
  if (holding) {
    params.set('shares', String(holding.shares))
    params.set('averagePrice', String(holding.averagePrice))
  }
  return `/api/etf/committee?${params.toString()}`
}

export function buildEtfCommitteeStatusUrl(requestId: string): string {
  return `/api/etf/committee-status?requestId=${encodeURIComponent(requestId)}`
}

// 위원 1명의 채팅 카드 표현(딥스캔 narrativeCard 문법) — 상태 라벨/톤·점수 태그·말풍선 텍스트.
// 렌더 컴포넌트는 CSS 모듈을 물고 있어 직접 테스트할 수 없으니 여기서 순수 계산을 검증한다.
export type EtfCommitteeMemberPresentation = {
  statusLabel: '분석 완료' | '고민중' | '응답 실패'
  statusTone: 'positive' | 'neutral' | 'info' | 'warning'
  scoreTagText: string | null
  scoreTone: 'positive' | 'neutral' | 'info' | 'warning' | null
  bubbleText: string | null
  skeleton: boolean
}

export function presentEtfCommitteeMember(member: EtfCommitteeMemberView): EtfCommitteeMemberPresentation {
  if (member.status === 'success') {
    const scoreTone = member.score == null
      ? null
      : member.score >= 70
        ? 'positive'
        : member.score >= 55
          ? 'neutral'
          : 'warning'
    return {
      statusLabel: '분석 완료',
      statusTone: 'positive',
      scoreTagText: member.score == null ? null : `${member.score}점`,
      scoreTone,
      bubbleText: member.reason,
      skeleton: false,
    }
  }

  if (member.status === 'pending') {
    return {
      statusLabel: '고민중',
      statusTone: 'info',
      scoreTagText: null,
      scoreTone: null,
      bubbleText: null,
      skeleton: true,
    }
  }

  return {
    statusLabel: '응답 실패',
    statusTone: 'warning',
    scoreTagText: null,
    scoreTone: null,
    bubbleText: 'LLM 응답에 실패했어요. 잠시 후 다시 시도해주세요.',
    skeleton: false,
  }
}
