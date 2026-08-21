const REDACTED = '[REDACTED]'
const CIRCULAR = '[Circular]'
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|crtfc[_-]?key|token|secret|authorization|password|passwd|cookie)/i
const SENSITIVE_QUERY_PATTERN = /([?&](?:crtfc_key|api_key|apikey|token|access_token|refresh_token|key)=)[^&#\s]*/gi
const SENSITIVE_ASSIGNMENT_PATTERN = /\b((?:crtfc[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie)\s*[:=]\s*)([^\s,;]+)/gi
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi

function redactString(value, secrets) {
  let redacted = String(value)
    .replace(SENSITIVE_QUERY_PATTERN, `$1${REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_PATTERN, `$1${REDACTED}`)

  for (const secret of secrets) {
    if (secret.length >= 4) {
      redacted = redacted.split(secret).join(REDACTED)
    }
  }
  return redacted
}

function collectSecrets(value, secrets, seen) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
  if (seen.has(value)) return
  seen.add(value)

  if (value instanceof Error) {
    collectSecrets(value.details, secrets, seen)
    collectSecrets(value.cause, secrets, seen)
    return
  }

  let entries
  try {
    entries = Array.isArray(value)
      ? value.map((entry, index) => [String(index), entry])
      : Object.entries(value)
  } catch {
    return
  }

  for (const [key, nested] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      if (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'bigint') {
        const secret = String(nested)
        if (secret) secrets.add(secret)
      }
      continue
    }
    collectSecrets(nested, secrets, seen)
  }
}

function sanitizeValue(value, state) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return redactString(value, state.secrets)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return value.description ? `[Symbol:${value.description}]` : '[Symbol]'
  if (typeof value === 'function') return `[Function${value.name ? `:${value.name}` : ''}]`

  if (state.seen.has(value)) return CIRCULAR
  state.seen.add(value)

  if (value instanceof Date) {
    const time = value.getTime()
    state.seen.delete(value)
    return Number.isNaN(time) ? 'Invalid Date' : value.toISOString()
  }

  if (value instanceof Error) {
    const output = {
      name: redactString(value.name || 'Error', state.secrets),
      message: redactString(value.message || '', state.secrets),
    }
    if (value.code !== undefined) output.code = sanitizeValue(value.code, state)
    if (value.details !== undefined) output.details = sanitizeValue(value.details, state)
    if (value.cause !== undefined) output.cause = sanitizeValue(value.cause, state)
    state.seen.delete(value)
    return output
  }

  if (Array.isArray(value)) {
    const output = []
    for (const entry of value) {
      try {
        output.push(sanitizeValue(entry, state))
      } catch {
        output.push('[Unserializable]')
      }
    }
    state.seen.delete(value)
    return output
  }

  const output = {}
  let entries
  try {
    entries = Object.entries(value)
  } catch {
    state.seen.delete(value)
    return '[Unserializable]'
  }

  for (const [key, nested] of entries) {
    try {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeValue(nested, state)
    } catch {
      output[key] = '[Unserializable]'
    }
  }
  state.seen.delete(value)
  return output
}

export function sanitizeForJson(value, options = {}) {
  try {
    const secrets = new Set(
      Array.isArray(options.secrets)
        ? options.secrets.filter((entry) => entry !== null && entry !== undefined).map(String)
        : [],
    )
    collectSecrets(value, secrets, new WeakSet())
    return sanitizeValue(value, { secrets, seen: new WeakSet() })
  } catch {
    return '[Unserializable]'
  }
}

export function safeJsonStringify(value, space = 2, options = {}) {
  try {
    return JSON.stringify(sanitizeForJson(value, options), null, space)
  } catch {
    return JSON.stringify('[Unserializable]')
  }
}

export {
  REDACTED,
  SENSITIVE_KEY_PATTERN,
}
