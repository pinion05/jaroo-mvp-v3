const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

type OAuthCallbackOriginInput = {
  requestUrl: string
  forwardedHost?: string | null
  forwardedProto?: string | null
}

function firstHeaderValue(value: string | null | undefined): string {
  return value?.split(',')[0]?.trim() ?? ''
}

function hostnameFromHost(host: string): string {
  const value = host.trim().toLowerCase()
  if (!value) return ''
  if (value.startsWith('[')) return value.split(']')[0] + ']'
  return value.split(':')[0] ?? ''
}

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase())
}

function normalizeOrigin(origin: string): string {
  return new URL(origin).origin
}

export function resolveOAuthCallbackOrigin(input: OAuthCallbackOriginInput): string {
  const url = new URL(input.requestUrl)
  const forwardedHost = firstHeaderValue(input.forwardedHost)
  const forwardedProto = firstHeaderValue(input.forwardedProto) || 'https'

  if (forwardedHost && !isLocalHostname(hostnameFromHost(forwardedHost))) {
    return normalizeOrigin(`${forwardedProto === 'http' ? 'http' : 'https'}://${forwardedHost}`)
  }

  // 프록시 뒤 dev(예: https://localhost)도 운영 jaroo.kr로 "추정"해 넘기지 않고
  // 요청 자기 origin으로 되돌린다. 과거 여기서 하드코딩된 운영 origin
  // (https://jaroo.kr)으로 리다이렉트해 dev 로그인 세션이 운영 도메인으로 흘러들어가는
  // 혼선이 있었다(TC-blackbox-data §6-2: dev에서 GET https://jaroo.kr/api/auth/me 관측,
  // jaroo.kr/screenshot 이동). 미등록 redirect URI는 OAuth 공급자(Supabase/Google)가
  // 거부하므로 자기 origin 유지가 안전하다.
  return url.origin
}

export function safeOAuthNext(next: string | null, origin: string): string {
  if (!next || !next.startsWith('/')) return '/home'
  const parsed = new URL(next, origin)
  if (parsed.origin !== origin) return '/home'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
