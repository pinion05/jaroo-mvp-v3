import { NextRequest, NextResponse } from 'next/server'

import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

// /api/etf/committee — 크롤러 etf-market-committee 수집기 프록시(/etf 페이지 AI 위원회).
// 시장 타이밍 축 3명(트렌드·시장 신호·가격 위치)만 LLM 분석한 결과를 돌려준다.
// 무과금이라 크레딧 게이트가 없는 대신, /api/etf/profile과 같은 방어를 건다:
// IP 레이트리밋 + 국내 ETF(6자리) 코드 검증 + 타임아웃(무인증 크롤러 릴레이 방지).
// 상류 완성 결과는 크롤러 캐시(6h)로 비용이 통제되고, refresh=1은 캐시 우회 재분석.

export const runtime = 'nodejs'

export const ETF_COMMITTEE_RATE_LIMIT_MAX = 15 // 화면 진입당 1회 + 재시도 여유
export const ETF_COMMITTEE_RATE_LIMIT_WINDOW_MS = 5 * 60_000
// 상류 소프트데드라인(기본 25s)보다 넉넉히 — LLM 3명 완성을 한 번에 받아온다.
export const ETF_COMMITTEE_UPSTREAM_TIMEOUT_MS = 45_000

const KR_ETF_CODE_PATTERN = /^\d{6}$/

// 인메모리 슬라이딩 윈도 — 단일 인스턴스 운영 가정(런치플랜 G7: Railway 스케일 1).
const rateBuckets = new Map<string, number[]>()

export function isEtfCommitteeRateLimited(key: string, now = Date.now()): boolean {
  const windowStart = now - ETF_COMMITTEE_RATE_LIMIT_WINDOW_MS
  const stamps = (rateBuckets.get(key) ?? []).filter((stamp) => stamp > windowStart)
  if (stamps.length >= ETF_COMMITTEE_RATE_LIMIT_MAX) {
    rateBuckets.set(key, stamps)
    return true
  }
  stamps.push(now)
  rateBuckets.set(key, stamps)
  return false
}

export function isValidEtfCommitteeCode(code: string | null | undefined): boolean {
  return KR_ETF_CODE_PATTERN.test((code ?? '').trim())
}

export function buildEtfCommitteeUpstreamUrl(
  baseUrl: string,
  code: string,
  options?: { shares?: string | null; averagePrice?: string | null; refresh?: boolean },
): string {
  const params = new URLSearchParams()
  if (options?.shares) params.set('shares', options.shares)
  if (options?.averagePrice) params.set('averagePrice', options.averagePrice)
  if (options?.refresh) params.set('crawlerCacheBypass', '1')
  const query = params.toString()
  const path = `/api/source/deepscan/kr/etf/${encodeURIComponent(code)}/committee`
  return buildCrawlerUrl(baseUrl, query ? `${path}?${query}` : path)
}

function resolveClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  return forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}

const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim() ?? ''
  if (!isValidEtfCommitteeCode(code)) {
    return NextResponse.json(
      { ok: false, data: null, error: { message: '한국 상장 ETF 코드(6자리)를 입력해주세요. AI 위원회는 국내 ETF만 지원해요.' } },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  if (isEtfCommitteeRateLimited(resolveClientKey(request))) {
    return NextResponse.json(
      { ok: false, data: null, error: { message: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' } },
      { status: 429, headers: NO_STORE_HEADERS },
    )
  }

  const upstreamUrl = buildEtfCommitteeUpstreamUrl(getCrawlerBaseUrl(), code, {
    shares: request.nextUrl.searchParams.get('shares'),
    averagePrice: request.nextUrl.searchParams.get('averagePrice'),
    refresh: request.nextUrl.searchParams.get('refresh') === '1',
  })

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ETF_COMMITTEE_UPSTREAM_TIMEOUT_MS),
    })
    const body = await upstream.text()

    if (upstream.status === 400) {
      return new NextResponse(body, {
        status: 400,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
          ...NO_STORE_HEADERS,
        },
      })
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, data: null, error: { message: 'AI 위원회 분석을 가져오지 못했어요. 잠시 후 다시 시도해주세요.' } },
        { status: 502, headers: NO_STORE_HEADERS },
      )
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        ...NO_STORE_HEADERS,
      },
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: { message: timedOut ? 'AI 위원회 분석 시간이 초과됐어요.' : 'AI 위원회 분석을 가져오지 못했어요.' },
      },
      { status: timedOut ? 504 : 502, headers: NO_STORE_HEADERS },
    )
  }
}
