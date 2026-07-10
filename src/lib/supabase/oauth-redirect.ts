const JAROO_PRODUCTION_ORIGIN = 'https://jaroo.kr'
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

type OAuthRedirectLocation = {
  hostname: string
  origin: string
}

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase())
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

export function resolveOAuthRedirectOrigin(location: OAuthRedirectLocation): string {
  if (isLocalHostname(location.hostname)) {
    return normalizeOrigin(location.origin)
  }

  return JAROO_PRODUCTION_ORIGIN
}

export function buildOAuthRedirectTo(location: OAuthRedirectLocation = window.location): string {
  return `${resolveOAuthRedirectOrigin(location)}/auth/callback`
}
