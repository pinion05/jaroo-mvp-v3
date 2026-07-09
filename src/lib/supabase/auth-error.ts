type SupabaseAuthErrorLike = {
  name?: unknown
  status?: unknown
}

function getAuthErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const status = (error as SupabaseAuthErrorLike).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

export function isExpectedSupabaseAuthMiss(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const name = (error as SupabaseAuthErrorLike).name
  if (name === 'AuthSessionMissingError') {
    return true
  }

  const status = getAuthErrorStatus(error)
  return status !== null && status >= 400 && status < 500
}
