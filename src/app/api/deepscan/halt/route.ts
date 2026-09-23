import { NextRequest, NextResponse } from 'next/server'

import {
  KR_DELISTING_DISCLOSURE_KEYWORD_GROUPS,
  matchKrDisclosureRiskKeywords,
} from '../../../../../packages/crawler/src/services/deepscan-kr-disclosure-risk-keywords.js'
import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'
import {
  resolveHaltSeverityLevel,
  type DeepScanHaltDisclosuresData,
  type DeepScanHaltSeverity,
  type HaltDisclosureFiling,
} from '@/lib/deepscan-halt'

// 거래정지 화면용 공시 데이터(이슈 #276) — 최근 90일 OpenDART 공시 목록을 심각도 분류와
// 함께 내린다. 분류 규칙은 크롤러의 deepscan-kr-disclosure-risk-keywords.js(9개 리스크
// 그룹, critical/high/medium)를 그대로 재사용해 단일 진실 소스를 유지한다.

const HALT_DISCLOSURE_TIMEOUT_MS = 6_000
const HALT_DISCLOSURE_CACHE_TTL_MS = 300_000
const HALT_DISCLOSURE_WINDOW_DAYS = 90
const HALT_DISCLOSURE_PAGE_COUNT = 50

const HALT_SEVERITY_RANK: Record<DeepScanHaltSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

const HALT_GROUP_LABELS: ReadonlyMap<string, { label: string; severity: DeepScanHaltSeverity }> = new Map(
  KR_DELISTING_DISCLOSURE_KEYWORD_GROUPS.map((group) => [
    group.id,
    { label: group.label, severity: group.severity as DeepScanHaltSeverity },
  ]),
)

export type {
  DeepScanHaltDisclosuresData,
  HaltDisclosureFiling,
  HaltDisclosureSignal,
} from '@/lib/deepscan-halt'

type HaltDisclosuresRequestOptions = {
  fetcher?: typeof fetch
  timeoutMs?: number
  cacheTtlMs?: number
  now?: () => number
}

type HaltDisclosuresSuccessBody = {
  ok: true
  data: DeepScanHaltDisclosuresData
}

const haltDisclosuresCache = new Map<string, { expiresAt: number; body: HaltDisclosuresSuccessBody }>()
const haltDisclosuresInflight = new Map<string, Promise<HaltDisclosuresSuccessBody>>()

export function clearHaltDisclosuresCache() {
  haltDisclosuresCache.clear()
  haltDisclosuresInflight.clear()
}

class HaltDisclosuresTimeoutError extends Error {
  constructor() {
    super('halt disclosures upstream timed out')
    this.name = 'HaltDisclosuresTimeoutError'
  }
}

function normalizeHaltCode(value: string | null) {
  const normalized = value?.trim() ?? ''
  const match = normalized.match(/^\d{6}$/u)
  return match ? match[0] : null
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildHaltDisclosuresUpstreamUrl(baseUrl: string, code: string, now = Date.now()) {
  const toDate = new Date(now)
  const fromDate = new Date(now - HALT_DISCLOSURE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const search = new URLSearchParams({
    from: formatLocalDate(fromDate),
    to: formatLocalDate(toDate),
    pageCount: String(HALT_DISCLOSURE_PAGE_COUNT),
    sort: 'date',
    sortMth: 'desc',
  })

  return buildCrawlerUrl(baseUrl, `/api/source/opendart/kr/stocks/${encodeURIComponent(code)}/disclosures?${search.toString()}`)
}

type CrawlerDisclosuresPayload = {
  ok?: boolean
  data?: {
    filings?: Array<{
      reportName?: unknown
      receiptDate?: unknown
      disclosureTypeLabel?: unknown
      documentUrl?: unknown
    }>
  }
}

function normalizeSeverity(value: string): DeepScanHaltSeverity {
  return value === 'critical' || value === 'high' || value === 'medium' ? value : 'low'
}

export function classifyHaltFilings(payload: CrawlerDisclosuresPayload, code: string): DeepScanHaltDisclosuresData {
  const rawFilings = Array.isArray(payload.data?.filings) ? payload.data.filings : []
  const filings: HaltDisclosureFiling[] = []
  const signalCounts = new Map<string, { label: string; severity: DeepScanHaltSeverity; count: number }>()

  for (const raw of rawFilings) {
    const reportName = typeof raw.reportName === 'string' && raw.reportName.trim() ? raw.reportName.trim() : null
    if (!reportName) {
      continue
    }

    const match = matchKrDisclosureRiskKeywords(reportName)
    const severity = normalizeSeverity(match.maxSeverity)
    const documentUrl = typeof raw.documentUrl === 'string' && raw.documentUrl.trim() ? raw.documentUrl.trim() : null
    const receiptDate = typeof raw.receiptDate === 'string' && raw.receiptDate.trim() ? raw.receiptDate.trim() : null
    const disclosureTypeLabel = typeof raw.disclosureTypeLabel === 'string' && raw.disclosureTypeLabel.trim()
      ? raw.disclosureTypeLabel.trim()
      : null

    filings.push({ reportName, receiptDate, disclosureTypeLabel, documentUrl, severity })

    for (const groupId of match.groups) {
      const group = HALT_GROUP_LABELS.get(groupId)
      if (!group) {
        continue
      }

      const existing = signalCounts.get(groupId)
      if (existing) {
        existing.count += 1
      } else {
        signalCounts.set(groupId, { label: group.label, severity: group.severity, count: 1 })
      }
    }
  }

  filings.sort((left, right) => (right.receiptDate ?? '').localeCompare(left.receiptDate ?? ''))

  const maxSeverity = filings.reduce<DeepScanHaltSeverity>((current, filing) => {
    return HALT_SEVERITY_RANK[filing.severity] > HALT_SEVERITY_RANK[current] ? filing.severity : current
  }, 'low')
  const signals = [...signalCounts.values()].sort((left, right) => {
    const severityGap = HALT_SEVERITY_RANK[right.severity] - HALT_SEVERITY_RANK[left.severity]
    return severityGap !== 0 ? severityGap : right.count - left.count
  })

  return {
    code,
    windowDays: HALT_DISCLOSURE_WINDOW_DAYS,
    filings,
    summary: {
      totalCount: filings.length,
      riskCount: filings.filter((filing) => HALT_SEVERITY_RANK[filing.severity] >= HALT_SEVERITY_RANK.high).length,
      maxSeverity,
      severityLevel: resolveHaltSeverityLevel(maxSeverity),
      signals,
    },
  }
}

async function fetchHaltDisclosuresUpstream(
  upstreamUrl: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  requestSignal?: AbortSignal,
) {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (requestSignal?.aborted) {
    controller.abort()
  }

  const abortFromRequest = () => controller.abort()
  requestSignal?.addEventListener('abort', abortFromRequest, { once: true })

  try {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const response = await fetcher(upstreamUrl, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`crawler disclosures returned HTTP ${response.status}`)
    }

    return (await response.json()) as CrawlerDisclosuresPayload
  } catch (error) {
    if (timedOut && error instanceof Error && error.name === 'AbortError') {
      throw new HaltDisclosuresTimeoutError()
    }
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    requestSignal?.removeEventListener('abort', abortFromRequest)
  }
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function jsonSuccess(body: HaltDisclosuresSuccessBody, cacheTtlMs: number) {
  return NextResponse.json(body, {
    headers: cacheTtlMs > 0
      ? { 'Cache-Control': `public, s-maxage=${Math.ceil(cacheTtlMs / 1000)}, stale-while-revalidate=30` }
      : undefined,
  })
}

export async function handleHaltDisclosuresRequest(request: NextRequest, options: HaltDisclosuresRequestOptions = {}) {
  const code = normalizeHaltCode(request.nextUrl.searchParams.get('code'))
  if (!code) {
    return jsonError(400, 'invalid-code', 'code must be a 6 digit KR stock code')
  }

  const fetcher = options.fetcher ?? fetch
  const configuredTimeoutMs = options.timeoutMs ?? Number(process.env.DEEPSCAN_HALT_DISCLOSURE_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : HALT_DISCLOSURE_TIMEOUT_MS
  const configuredCacheTtlMs = options.cacheTtlMs ?? Number(process.env.DEEPSCAN_HALT_DISCLOSURE_CACHE_TTL_MS)
  const cacheTtlMs = Number.isFinite(configuredCacheTtlMs) && configuredCacheTtlMs >= 0 ? configuredCacheTtlMs : HALT_DISCLOSURE_CACHE_TTL_MS
  const now = options.now ?? (() => Date.now())

  const cached = cacheTtlMs > 0 ? haltDisclosuresCache.get(code) : undefined
  if (cached && cached.expiresAt > now()) {
    return jsonSuccess(cached.body, cacheTtlMs)
  }

  try {
    let inflight = haltDisclosuresInflight.get(code)
    if (!inflight) {
      const upstreamUrl = buildHaltDisclosuresUpstreamUrl(getCrawlerBaseUrl(), code)
      inflight = fetchHaltDisclosuresUpstream(upstreamUrl, fetcher, timeoutMs, request.signal)
        .then((payload) => ({ ok: true as const, data: classifyHaltFilings(payload, code) }))
        .finally(() => {
          haltDisclosuresInflight.delete(code)
        })
      haltDisclosuresInflight.set(code, inflight)
    }

    const body = await inflight
    if (request.signal.aborted) {
      return jsonError(499, 'client-abort', 'request aborted')
    }

    if (cacheTtlMs > 0) {
      haltDisclosuresCache.set(code, { expiresAt: now() + cacheTtlMs, body })
    }

    return jsonSuccess(body, cacheTtlMs)
  } catch (error) {
    if (request.signal.aborted) {
      return jsonError(499, 'client-abort', 'request aborted')
    }

    if (error instanceof HaltDisclosuresTimeoutError) {
      return jsonError(504, 'upstream-timeout', '거래정지 공시 정보 요청이 시간 초과됐어요.')
    }

    return jsonError(502, 'upstream-error', '거래정지 공시 정보를 불러오지 못했어요.')
  }
}

export async function GET(request: NextRequest) {
  return handleHaltDisclosuresRequest(request)
}
