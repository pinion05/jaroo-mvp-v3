import test from 'node:test'
import assert from 'node:assert/strict'

import { safeJsonStringify, sanitizeForJson } from '../src/safe-json.js'

test('sanitizeForJson is cycle-safe and recursively redacts credentials and URL parameters', () => {
  const secret = 'credential-sentinel-195'
  const errorDetailSecret = 'error-detail-sentinel-195'
  const error = new Error(`request failed with ${errorDetailSecret}`) as Error & { details?: unknown }
  error.details = { nested: { ApiKey: errorDetailSecret } }
  const input: Record<string, unknown> = {
    ApiKey: secret,
    nested: {
      authorization: `Bearer ${secret}`,
      safe: 'kept',
      url: `https://example.test/path?x=1&crtfc_key=${secret}&access_token=${secret}`,
    },
    bigint: 42n,
    fn: () => 'ignored',
    labeledError: new Error(`request failed: api_key=${secret}`),
    error,
  }
  input.self = input

  const sanitized = sanitizeForJson(input)
  const serialized = safeJsonStringify(input)

  assert.equal((sanitized as { ApiKey?: string }).ApiKey, '[REDACTED]')
  assert.equal((sanitized as { nested?: { safe?: string } }).nested?.safe, 'kept')
  assert.match(serialized, /\[REDACTED\]/)
  assert.match(serialized, /\[Circular\]/)
  assert.equal(serialized.includes(secret), false)
  assert.equal(serialized.includes(errorDetailSecret), false)
  assert.doesNotThrow(() => JSON.parse(serialized))
})
