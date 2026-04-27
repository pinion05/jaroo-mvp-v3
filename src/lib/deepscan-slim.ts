import type { HomeHolding } from '@/lib/jaroo-home-data'

type DeepScanSummaryMetric = {
  label: string
  value: string
}

type DeepScanSummaryHighlight = {
  title: string
  body?: string
  meta?: string
}

type DeepScanSlimSummary = {
  header: {
    name: string
    identifier: string
    market: string
    currentPriceText?: string
  }
  metrics: DeepScanSummaryMetric[]
  highlights: DeepScanSummaryHighlight[]
}

type DeepScanSlimRequest = {
  market: 'KR' | 'US'
  identifier: string
}

type CachedDeepScanSlimSummary = {
  key: string
  summary: DeepScanSlimSummary
}

type UnknownRecord = Record<string, unknown>

let cachedDeepScanSlimSummary: CachedDeepScanSlimSummary | null = null

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function formatMaybeNumber(value: unknown, digits = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return value.toFixed(digits).replace(/\.0$/, '')
}

function formatUsdPrice(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined
  }

  return `$${value.toFixed(2)}`
}

function findKrMetricRows(payload: unknown) {
  const pages = asRecord(asRecord(payload)?.pages)
  const investmentIndicators = asRecord(pages?.['investment-indicators'])
  const groups = asArray(investmentIndicators?.metrics)

  return groups.flatMap((group) => asArray(asRecord(group)?.rows))
}

function findFirstPresentValue(row: Record<string, unknown>) {
  return Object.entries(row)
    .filter(([key, value]) => key !== '항목' && value != null && String(value).trim())
    .map(([, value]) => String(value).trim())
    .at(-1)
}

function normalizeKrSlimPayload(payload: unknown, identifier: string): DeepScanSlimSummary {
  const metricRows = findKrMetricRows(payload)
  const metricRowRecords = metricRows
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
  const metrics = metricRowRecords
    .filter((row) => ['ROE', '영업이익률', 'EPS', 'BPS'].includes(String(row['항목'] || '')))
    .map((row) => ({ label: String(row['항목']), value: findFirstPresentValue(row) || '-' }))
    .slice(0, 4)

  const opinion = asRecord(asRecord(asRecord(payload)?.pages)?.opinion)
  const highlights = asArray(opinion?.reportSummaries)
    .slice(0, 3)
    .map((item) => {
      const record = asRecord(item)
      return {
        title: String(record?.['종목명 - 리포트 요약'] || '').trim(),
        meta: [record?.['일자'], record?.['제공처/작성자']].filter(Boolean).join(' · '),
      }
    })
    .filter((item: DeepScanSummaryHighlight) => item.title)

  const company = asRecord(asRecord(payload)?.company)

  return {
    header: {
      name: String(company?.name || identifier),
      identifier,
      market: 'KR',
    },
    metrics,
    highlights,
  }
}

function normalizeUsSlimPayload(payload: unknown, identifier: string): DeepScanSlimSummary {
  const pages = asRecord(asRecord(payload)?.pages)
  const analysis = asRecord(pages?.analysis)
  const snap = asRecord(pages?.snap)
  const primaryMetrics = asRecord(asArray(analysis?.metrics)[0])
  const metrics = [
    { label: 'PER', value: formatMaybeNumber(primaryMetrics?.per) || '-' },
    { label: 'PBR', value: formatMaybeNumber(primaryMetrics?.pbr) || '-' },
    { label: 'ROE', value: formatMaybeNumber(primaryMetrics?.roe) || '-' },
    { label: 'EPS 성장률', value: formatMaybeNumber(primaryMetrics?.epsGw) || '-' },
  ]

  const priceVolume = asRecord(snap?.priceVolume)
  const latestPriceRow = asRecord(asArray(priceVolume?.rows).at(-1))
  const latestPrice = latestPriceRow?.close
  const highlights = asArray(snap?.news)
    .slice(0, 3)
    .map((item) => {
      const record = asRecord(item)
      const titles = asRecord(record?.titles)
      return {
        title: String(titles?.ko || titles?.en || ''),
        meta: String(record?.publishedAt || ''),
      }
    })
    .filter((item: DeepScanSummaryHighlight) => item.title)

  const company = asRecord(asRecord(payload)?.company)

  return {
    header: {
      name: String(company?.name || identifier),
      identifier,
      market: String(company?.market || 'US'),
      currentPriceText: formatUsdPrice(latestPrice),
    },
    metrics,
    highlights,
  }
}

export function normalizeDeepScanSlimPayload(payload: unknown, context: DeepScanSlimRequest): DeepScanSlimSummary {
  if (context.market === 'KR') {
    return normalizeKrSlimPayload(payload, context.identifier)
  }

  return normalizeUsSlimPayload(payload, context.identifier)
}

export function resolveDeepScanSlimRequest(target: Pick<HomeHolding, 'identifierTicker' | 'identifierCode' | 'code'>): DeepScanSlimRequest | null {
  const usTicker = target.identifierTicker?.trim().toUpperCase()
  if (usTicker) {
    return { market: 'US', identifier: usTicker }
  }

  const krCode = target.identifierCode?.trim() || target.code?.trim()
  if (krCode) {
    return { market: 'KR', identifier: krCode }
  }

  return null
}

export function buildDeepScanSlimSummaryKey(request: DeepScanSlimRequest) {
  return `${request.market}:${request.identifier}`
}

export function readCachedDeepScanSlimSummary(): CachedDeepScanSlimSummary | null {
  return cachedDeepScanSlimSummary
}

export function persistCachedDeepScanSlimSummary(entry: CachedDeepScanSlimSummary) {
  cachedDeepScanSlimSummary = entry
  return true
}

export function clearCachedDeepScanSlimSummary() {
  cachedDeepScanSlimSummary = null
}

export async function fetchDeepScanSlimSummary(request: DeepScanSlimRequest, fetcher: typeof fetch = fetch) {
  const query = request.market === 'US'
    ? `market=US&ticker=${encodeURIComponent(request.identifier)}`
    : `market=KR&code=${encodeURIComponent(request.identifier)}&version=v1.2`

  const response = await fetcher(`/api/deepscan/slim?${query}`, { cache: 'no-store' })
  if (!response.ok) {
    return null
  }

  const payload = await response.json()
  return normalizeDeepScanSlimPayload(payload, request)
}

export async function prefetchAndPersistDeepScanSlimSummary(target: Pick<HomeHolding, 'identifierTicker' | 'identifierCode' | 'code'>, fetcher: typeof fetch = fetch) {
  const request = resolveDeepScanSlimRequest(target)
  if (!request) {
    return null
  }

  const summary = await fetchDeepScanSlimSummary(request, fetcher)
  if (!summary) {
    return null
  }

  const entry = {
    key: buildDeepScanSlimSummaryKey(request),
    summary,
  }
  persistCachedDeepScanSlimSummary(entry)
  return entry
}

export type {
  CachedDeepScanSlimSummary,
  DeepScanSlimRequest,
  DeepScanSlimSummary,
  DeepScanSummaryHighlight,
  DeepScanSummaryMetric,
}
