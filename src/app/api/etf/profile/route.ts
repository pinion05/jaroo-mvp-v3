import { NextRequest, NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isEtfLedgerPayload, recordEtfHistory } from '@/lib/etf-history-store'
import { buildCrawlerUrl, getCrawlerBaseUrl } from '@/lib/crawler-api'

// /api/etf/profile — 크롤러 etf-profile 수집기 프록시.
// 공개 시세성 데이터(네이버+위세리포트)라 세션을 요구하지 않되,
// 무인증 크롤러 릴레이가 되지 않도록 IP 레이트리밋 + 코드 검증 + 타임아웃을 건다
// (코드 감사 B2 교훈 — /api/deepscan/slim 사건과 동일한 방어).
//
// 부수 효과: 세션(쿠키)이 있는 호출자에 한해 조회 성공 시마다 ETF 기록 원장에
// 1행 append한다(deepscan 스캔 성공 시 recordScanHistory와 같은 패턴).
// payload는 상류 응답을 그대로 저장하므로 클라이언트 위조 여지가 없고,
// 기록 실패는 void로 삼켜 조회 응답에 영향을 주지 않는다.

export const ETF_PROFILE_RATE_LIMIT_MAX = 30 // 화면 진입당 1회 호출 기준, 탐색 여유 포함
export const ETF_PROFILE_RATE_LIMIT_WINDOW_MS = 5 * 60_000
export const ETF_PROFILE_UPSTREAM_TIMEOUT_MS = 20_000

const KR_ETF_CODE_PATTERN = /^\d{6}$/

// 인메모리 슬라이딩 윈도 — 단일 인스턴스 운영 가정(런치플랜 G7: Railway 스케일 1).
const rateBuckets = new Map<string, number[]>()

export function isEtfProfileRateLimited(key: string, now = Date.now()): boolean {
  const windowStart = now - ETF_PROFILE_RATE_LIMIT_WINDOW_MS
  const stamps = (rateBuckets.get(key) ?? []).filter((stamp) => stamp > windowStart)
  if (stamps.length >= ETF_PROFILE_RATE_LIMIT_MAX) {
    rateBuckets.set(key, stamps)
    return true
  }
  stamps.push(now)
  rateBuckets.set(key, stamps)
  return false
}

export function isValidEtfProfileCode(code: string | null | undefined): boolean {
  return KR_ETF_CODE_PATTERN.test((code ?? '').trim())
}

export function buildEtfProfileUpstreamUrl(baseUrl: string, code: string): string {
  return buildCrawlerUrl(baseUrl, `/api/source/naver-wisereport/kr/etf/${encodeURIComponent(code)}/profile`)
}

function resolveClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  return forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}

const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const

/** 세션 유저 id — 원장 기록용(게스트는 기록하지 않는다). 조회 성공 경로에서만 호출. */
async function resolveOptionalUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

/** 원장 append — 조회 응답을 지연시키지 않는다(void). payload는 상류 200 본문 그대로. */
function appendEtfHistory(userId: string, rawBody: string): void {
  try {
    const profile = JSON.parse(rawBody)?.data
    if (!isEtfLedgerPayload(profile)) return
    void recordEtfHistory({ userId, profile })
  } catch {
    // 원장 파싱 실패는 조회 성공 응답과 무관하다
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim() ?? ''
  if (!isValidEtfProfileCode(code)) {
    return NextResponse.json(
      { ok: false, data: null, error: { message: '한국 상장 ETF 코드(6자리)를 입력해주세요.' } },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  if (isEtfProfileRateLimited(resolveClientKey(request))) {
    return NextResponse.json(
      { ok: false, data: null, error: { message: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' } },
      { status: 429, headers: NO_STORE_HEADERS },
    )
  }

  const upstreamUrl = buildEtfProfileUpstreamUrl(getCrawlerBaseUrl(), code)
  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ETF_PROFILE_UPSTREAM_TIMEOUT_MS),
    })
    const body = await upstream.text()
    if (upstream.status === 400) {
      // 상류(크롤러)가 판정한 'ETF 아님' 등 클라이언트 오류는 400으로 통과시킨다.
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
        { ok: false, data: null, error: { message: 'ETF 정보를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' } },
        { status: 502, headers: NO_STORE_HEADERS },
      )
    }

    const userId = await resolveOptionalUserId()
    if (userId) appendEtfHistory(userId, body)

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
        error: { message: timedOut ? 'ETF 정보 조회 시간이 초과됐어요.' : 'ETF 정보를 가져오지 못했어요.' },
      },
      { status: timedOut ? 504 : 502, headers: NO_STORE_HEADERS },
    )
  }
}
