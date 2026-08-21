import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTermsConsentAt, termsConsentRow } from './terms-consent'

test('parseTermsConsentAt accepts recent ISO timestamps and normalizes them', () => {
  const recent = new Date(Date.now() - 60 * 1000).toISOString()
  assert.equal(parseTermsConsentAt(recent), recent)
})

test('parseTermsConsentAt rejects empty, malformed and non-string values', () => {
  assert.equal(parseTermsConsentAt(null), null)
  assert.equal(parseTermsConsentAt(undefined), null)
  assert.equal(parseTermsConsentAt(''), null)
  assert.equal(parseTermsConsentAt('not-a-date'), null)
  assert.equal(parseTermsConsentAt(12345), null)
})

test('parseTermsConsentAt rejects timestamps from the far future or older than 7 days', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(parseTermsConsentAt(future), null)
  assert.equal(parseTermsConsentAt(stale), null)
})

test('termsConsentRow carries only the consent columns for upsert', () => {
  const row = termsConsentRow('2026-08-20T00:00:00.000Z')
  assert.deepEqual(Object.keys(row).sort(), ['terms_accepted_at', 'terms_version'])
  assert.equal(row.terms_accepted_at, '2026-08-20T00:00:00.000Z')
  assert.equal(row.terms_version, 'v1')
})
