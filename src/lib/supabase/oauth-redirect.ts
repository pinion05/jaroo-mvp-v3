type OAuthRedirectLocation = {
  hostname: string
  origin: string
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

// OAuth redirect uses the current deployment origin directly. Each host
// receives its own callback, and the OAuth provider (Google/Supabase) only
// honors redirect URIs registered for the client, so a spoofed or unknown
// host is rejected at the provider rather than here.
export function resolveOAuthRedirectOrigin(location: OAuthRedirectLocation): string {
  return normalizeOrigin(location.origin)
}

export function buildOAuthRedirectTo(location: OAuthRedirectLocation = window.location): string {
  return `${resolveOAuthRedirectOrigin(location)}/auth/callback`
}
