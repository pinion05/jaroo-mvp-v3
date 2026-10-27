import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/proxy'

// 수파베이스 리버스 프록시(런타임) — /auth/v1/*, /rest/v1/*를 사설망 내부 서비스로 전달한다.
// next.config.ts의 빌드타임 리라이트가 CLI 업로드 배포(railway up)에서 stale 변수
// 스냅샷으로 비활성화되는 문제(2026-10-27 실측)를 회피해, 요청 시점(런타임) env로 판정한다.
// 변수가 없는 prod/로컬은 프록시하지 않고 기존 호스티드 경로 그대로.
const SUPABASE_PROXY_ROUTES: Array<{ prefix: string; envName: string }> = [
  { prefix: '/auth/v1', envName: 'SUPABASE_AUTH_INTERNAL_URL' },
  { prefix: '/rest/v1', envName: 'SUPABASE_REST_INTERNAL_URL' },
]

async function proxySupabaseRequest(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl
  const route = SUPABASE_PROXY_ROUTES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
  if (!route) return null
  const target = process.env[route.envName]?.replace(/\/+$/, '')
  if (!target) return null
  const subPath = pathname.slice(route.prefix.length) || '/'
  const upstream = new URL(`${target}${subPath === '/' ? '/' : subPath}${request.nextUrl.search}`)
  const init: RequestInit = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    redirect: 'manual',
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer()
  }
  const upstreamResponse = await fetch(upstream, init)
  const headers = new Headers(upstreamResponse.headers)
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  })
}

export async function proxy(request: NextRequest) {
  const proxied = await proxySupabaseRequest(request)
  if (proxied) return proxied
  return updateSupabaseSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
