// Deployed origins canonicalize to a single production origin. Override per
// deployment (e.g. Railway test env `https://test.jaroo.kr`) via env var so a
// non-primary host still receives its own OAuth callback.
const JAROO_PRODUCTION_ORIGIN = process.env.NEXT_PUBLIC_JAROO_ORIGIN || 'https://jaroo.kr'
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
