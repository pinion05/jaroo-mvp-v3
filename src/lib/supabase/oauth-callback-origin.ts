const JAROO_PRODUCTION_ORIGIN = 'https://jaroo.kr'
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

  if (url.protocol === 'https:' && isLocalHostname(url.hostname)) {
    return JAROO_PRODUCTION_ORIGIN
  }

  return url.origin
}

export function safeOAuthNext(next: string | null, origin: string): string {
  if (!next || !next.startsWith('/')) return '/home'
  const parsed = new URL(next, origin)
  if (parsed.origin !== origin) return '/home'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
