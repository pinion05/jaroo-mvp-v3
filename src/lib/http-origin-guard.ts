import 'server-only'

// 브라우저 CSRF 방어 2차 계층(SameSite=lax 보완, 이슈 #224 E3).
// Origin 헤더가 있는 브라우저 요청은 요청 호스트(또는 정규 오리진)와 일치해야 하고,
// Origin이 없는 비브라우저 요청(curl·서버 간·테스트)은 통과시킨다.
export function originAllowedForStateChange(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const allowed = new Set<string>([new URL(request.url).origin])
  const canonical = process.env.NEXT_PUBLIC_JAROO_ORIGIN?.trim()
  if (canonical) {
    allowed.add(canonical.replace(/\/+$/, ''))
  }
  return allowed.has(origin)
}
