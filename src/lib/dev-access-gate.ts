import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// DEV ONLY(dev 배포 전용) 접근 게이트 — 공개 dev 도메인(jaroo-dev.up.railway.app / dev.jaroo.kr)에
// 프리패스 테스트 환경이 노출되는 것을 막는 HTTP Basic Auth.
// DEV_BASIC_AUTH="user:password" 형식의 env가 있을 때만 동작하며, 변수가 없는
// 운영(prod)·로컬에서는 null을 반환해 어떤 요청도 차단하지 않는다.
// /api/health는 무조건 통과시킨다(가용성 프로브용).

const ALWAYS_ALLOWED_PATHS = new Set(['/api/health'])

export function devAccessGate(request: NextRequest): NextResponse | null {
  const basic = process.env.DEV_BASIC_AUTH?.trim()
  if (!basic) return null

  const { pathname } = request.nextUrl
  if (ALWAYS_ALLOWED_PATHS.has(pathname)) return null

  const expected = `Basic ${btoa(basic)}`
  if (request.headers.get('authorization') === expected) return null

  return new NextResponse('dev 배포 접근 권한이 필요해요.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="jaroo-dev", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  })
}
